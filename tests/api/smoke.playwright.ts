import { expect, test } from "@playwright/test";

const adminCredentials = {
  email: "admin@example.com",
  password: "correct horse battery staple!",
};

test.describe("@smoke API smoke", () => {
  test("serves the database-independent health contract", async ({
    request,
  }) => {
    const response = await request.get("/api/health");

    await expect(response).toBeOK();
    expect(response.headers()["cache-control"]).toMatch(/no-store/u);
    expect(response.headers()["x-frame-options"]).toBe("DENY");
    expect(response.headers()["x-request-id"]).toMatch(/.+/u);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  test("rejects protected listing reads before authentication", async ({
    request,
  }) => {
    const response = await request.get("/api/listings");

    expect(response.status()).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: "AUTHENTICATION_REQUIRED" },
    });
  });

  test("logs in, reads the session, reads listings, and logs out", async ({
    request,
  }) => {
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
