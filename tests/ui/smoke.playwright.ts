import { expect, test } from "@playwright/test";

const adminCredentials = {
  email: "admin@example.com",
  password: "correct horse battery staple!",
};

test.describe("@smoke UI smoke", () => {
  test.beforeEach(async ({ page }) => {
    await page.route(/^https?:\/\/(?!127\.0\.0\.1(?::\d+)?\/).+/u, (route) =>
      route.abort(),
    );
  });

  test("shows the private sign-in screen", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
  });

  test("signs in and renders protected listings", async ({ page }) => {
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
    await signIn(page);

    await page.getByRole("button", { name: "Sign out" }).click();

    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  });
});

async function signIn(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Email").fill(adminCredentials.email);
  await page.getByLabel("Password").fill(adminCredentials.password);
  await page.getByRole("button", { name: "Sign in" }).click();
}
