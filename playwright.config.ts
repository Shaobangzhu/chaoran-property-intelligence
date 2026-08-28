import { defineConfig, devices } from "@playwright/test";
import * as os from "node:os";

const shouldStartWeb = process.env.CPI_PLAYWRIGHT_START_WEB === "true";
const apiPort = readPort(
  process.env.CPI_PLAYWRIGHT_API_PORT,
  shouldStartWeb ? 3_000 : 3_100,
  "CPI_PLAYWRIGHT_API_PORT",
);
const webPort = readPort(
  process.env.CPI_PLAYWRIGHT_WEB_PORT,
  5_173,
  "CPI_PLAYWRIGHT_WEB_PORT",
);
const apiBaseURL = `http://127.0.0.1:${apiPort}`;
const webBaseURL = `http://127.0.0.1:${webPort}`;
const allureEnvironmentInfo = createAllureEnvironmentInfo("playwright");

export default defineConfig({
  expect: {
    timeout: 5_000,
  },
  forbidOnly: Boolean(process.env.CI),
  fullyParallel: false,
  outputDir: "test-results/playwright",
  projects: [
    {
      name: "api-smoke",
      testMatch: /\/api\/.*\.playwright\.ts/u,
      use: {
        baseURL: apiBaseURL,
      },
    },
    {
      name: "ui-smoke",
      testMatch: /\/ui\/.*\.playwright\.ts/u,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: webBaseURL,
      },
    },
  ],
  reporter: [
    ["list"],
    [
      "allure-playwright",
      {
        detail: true,
        environmentInfo: allureEnvironmentInfo,
        globalLabels: [
          { name: "layer", value: "system" },
          { name: "owner", value: "quality-engineering" },
        ],
        resultsDir: "allure-results",
        suiteTitle: true,
      },
    ],
    ["html", { open: "never", outputFolder: "playwright-report" }],
  ],
  retries: process.env.CI ? 1 : 0,
  testDir: "./tests",
  timeout: 30_000,
  use: {
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: `node tests/support/local-api-stub.mjs --port ${apiPort}`,
      reuseExistingServer: !process.env.CI,
      timeout: 15_000,
      url: `${apiBaseURL}/api/health`,
    },
    ...(shouldStartWeb
      ? [
          {
            command: `VITE_ARCGIS_API_KEY=playwright-local-key pnpm --dir apps/web dev --host 127.0.0.1 --port ${webPort}`,
            reuseExistingServer: !process.env.CI,
            timeout: 30_000,
            url: webBaseURL,
          },
        ]
      : []),
  ],
});

function readPort(
  value: string | undefined,
  defaultValue: number,
  name: string,
): number {
  if (value === undefined || value.trim().length === 0) {
    return defaultValue;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(`${name} must be a valid TCP port`);
  }
  return parsed;
}

function createAllureEnvironmentInfo(
  testFramework: string,
): Record<string, string> {
  return {
    ci: process.env.CI === "true" ? "true" : "false",
    git_ref: process.env.GITHUB_REF_NAME ?? process.env.GITHUB_REF ?? "local",
    git_sha: process.env.GITHUB_SHA ?? "local",
    node_version: process.version,
    os_platform: os.platform(),
    os_release: os.release(),
    test_framework: testFramework,
  };
}
