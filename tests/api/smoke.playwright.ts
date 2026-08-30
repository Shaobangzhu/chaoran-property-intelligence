import { expect, test } from "@playwright/test";

const adminCredentials = {
  email: "admin@example.com",
  password: "correct horse battery staple!",
};
const isRemoteSmoke = Boolean(
  process.env.CPI_PLAYWRIGHT_REMOTE_BASE_URL,
);
const expectedReleaseSha = process.env.CPI_EXPECTED_RELEASE_SHA;
const expectedDeploymentStage = process.env.CPI_EXPECTED_DEPLOYMENT_STAGE;

test.describe("@smoke API smoke", () => {
  test("serves the database-independent health contract", async ({
    request,
  }) => {
    const response = await request.get("/api/health");

    await expect(response).toBeOK();
    expect(response.headers()["cache-control"]).toMatch(/no-store/u);
    expect(response.headers()["x-frame-options"]).toBe("DENY");
    expect(response.headers()["x-request-id"]).toMatch(/.+/u);
    if (isRemoteSmoke) {
      expect(response.headers()["strict-transport-security"]).toMatch(
        /max-age=/u,
      );
      expect(response.headers()["x-content-type-options"]).toBe("nosniff");
    }
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  test("rejects protected listing reads before authentication", async ({
    request,
  }) => {
    const response = await request.get("/api/listings");

    expect(response.status()).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "AUTHENTICATION_REQUIRED",
        message: "Authentication is required",
      },
    });
  });

  test("binds Web and API artifacts to the expected release", async ({
    request,
  }) => {
    test.skip(
      expectedReleaseSha === undefined || expectedDeploymentStage === undefined,
      "Release identity is required only for deployed acceptance",
    );
    const expected = {
      gitSha: expectedReleaseSha,
      stage: expectedDeploymentStage,
    };
    const [apiResponse, webResponse] = await Promise.all([
      request.get("/api/release"),
      request.get("/release.json"),
    ]);

    await expect(apiResponse).toBeOK();
    await expect(webResponse).toBeOK();
    expect(apiResponse.headers()["cache-control"]).toMatch(/no-store/u);
    expect(webResponse.headers()["cache-control"]).toMatch(/no-store/u);
    await expect(apiResponse.json()).resolves.toEqual(expected);
    await expect(webResponse.json()).resolves.toEqual(expected);
  });

  test("logs in, reads the session, reads listings, and logs out", async ({
    request,
  }) => {
    test.skip(
      isRemoteSmoke,
      "AWS DEV smoke must not depend on or mutate a deployed user session",
    );
    const loginResponse = await request.post("/api/auth/login", {
      data: adminCredentials,
    });
    await expect(loginResponse).toBeOK();
    expect(loginResponse.headers()["set-cookie"]).toMatch(/HttpOnly/u);
    await expect(loginResponse.json()).resolves.toEqual({
      user: {
        email: "admin@example.com",
        id: "0198c7d2-7668-7775-b0fc-b789690a60a0",
        role: "admin",
      },
    });

    const sessionResponse = await request.get("/api/auth/me");
    await expect(sessionResponse).toBeOK();
    await expect(sessionResponse.json()).resolves.toEqual({
      user: {
        email: "admin@example.com",
        id: "0198c7d2-7668-7775-b0fc-b789690a60a0",
        role: "admin",
      },
    });

    const listingsResponse = await request.get("/api/listings");
    await expect(listingsResponse).toBeOK();
    const listingsBody = await listingsResponse.json();
    expect(listingsBody).toMatchObject({
      listings: [
        {
          formattedAddress: "123 Main St, Eastvale, CA 92880",
          source: "rentcast",
        },
      ],
    });

    const logoutResponse = await request.post("/api/auth/logout");
    expect(logoutResponse.status()).toBe(204);

    const signedOutResponse = await request.get("/api/auth/me");
    expect(signedOutResponse.status()).toBe(401);
  });
});
