import { expect, test, type Page, type Response } from "@playwright/test";

const adminCredentials = {
  email: "admin@example.com",
  password: "correct horse battery staple!",
};
const remoteBaseURL = process.env.CPI_PLAYWRIGHT_REMOTE_BASE_URL;
const allowedApplicationOrigin = new URL(
  remoteBaseURL ?? "http://127.0.0.1:5173",
).origin;
const isRemoteSmoke = Boolean(remoteBaseURL);

test.describe("@smoke UI smoke", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/*", (route) => {
      const requestUrl = new URL(route.request().url());
      if (
        !["http:", "https:"].includes(requestUrl.protocol) ||
        requestUrl.origin === allowedApplicationOrigin
      ) {
        return route.continue();
      }
      return route.abort();
    });
  });

  test("shows the private sign-in screen", async ({ page }) => {
    test.setTimeout(isRemoteSmoke ? 150_000 : 30_000);
    const response = await openPrivateSignInScreen(page);

    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    if (isRemoteSmoke) {
      expect(response?.headers()["strict-transport-security"]).toMatch(
        /max-age=/u,
      );
      expect(response?.headers()["x-frame-options"]).toBe("DENY");
    }
  });

  test("signs in and renders protected listings", async ({ page }) => {
    test.skip(
      isRemoteSmoke,
      "AWS DEV smoke must not depend on or mutate a deployed user session",
    );
    await signIn(page);

    await expect(page.getByRole("heading", { name: "Listings" })).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "123 Main St, Eastvale, CA 92880",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Workspace" }),
    ).toBeVisible();
  });

  test("signs out of the protected workspace", async ({ page }) => {
    test.skip(
      isRemoteSmoke,
      "AWS DEV smoke must not depend on or mutate a deployed user session",
    );
    await signIn(page);

    await page.getByRole("button", { name: "Sign out" }).click();

    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  });
});

async function openPrivateSignInScreen(page: Page): Promise<Response | null> {
  if (!isRemoteSmoke) {
    return page.goto("/");
  }

  let readyResponse: Response | null = null;
  await expect
    .poll(
      async () => {
        try {
          const response = await page.goto("/", {
            waitUntil: "domcontentloaded",
          });
          const signInHeading = page.getByRole("heading", { name: "Sign in" });
          await signInHeading
            .waitFor({ state: "visible", timeout: 10_000 })
            .catch(() => undefined);
          const signInVisible = await signInHeading
            .isVisible()
            .catch(() => false);
          if (response !== null && response.ok() && signInVisible) {
            readyResponse = response;
            return "ready";
          }

          const bodyText = await page
            .locator("body")
            .innerText()
            .catch(() => "unavailable");
          return `HTTP ${response?.status() ?? "no-response"}; body ${bodyText.slice(0, 160)}`;
        } catch (error) {
          return error instanceof Error ? error.message : "navigation failed";
        }
      },
      {
        intervals: [1_000, 2_000, 5_000],
        message: "DEV web runtime did not reach the private sign-in screen",
        timeout: 120_000,
      },
    )
    .toBe("ready");
  return readyResponse;
}

async function signIn(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Email").fill(adminCredentials.email);
  await page.getByLabel("Password").fill(adminCredentials.password);
  await page.getByRole("button", { name: "Sign in" }).click();
}
