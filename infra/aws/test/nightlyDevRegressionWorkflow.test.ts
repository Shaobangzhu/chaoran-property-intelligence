import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const workflowPath = fileURLToPath(
  new URL(
    "../../../.github/workflows/nightly-dev-regression.yml",
    import.meta.url,
  ),
);

describe("nightly DEV regression workflow", () => {
  it("supports scheduled and manual runs against the protected dev source", () => {
    const workflow = readFileSync(workflowPath, "utf8");

    expect(workflow).toContain("schedule:");
    expect(workflow).toContain('cron: "23 9 * * *"');
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("ref: dev");
    expect(workflow).toContain("git rev-parse HEAD");
  });

  it("uses only the public HTTPS DEV origin without AWS credentials", () => {
    const workflow = readFileSync(workflowPath, "utf8");

    expect(workflow).toContain("vars.CPI_AWS_DEV_BASE_URL");
    expect(workflow).toContain("CPI_PLAYWRIGHT_REMOTE_BASE_URL");
    expect(workflow).toContain("target.username");
    expect(workflow).toContain("target.password");
    expect(workflow).not.toContain("id-token: write");
    expect(workflow).not.toContain("configure-aws-credentials");
    expect(workflow).not.toContain("AWS_ACCESS_KEY_ID");
    expect(workflow).not.toMatch(/^\s*environment:/mu);
    expect(workflow).not.toMatch(/^\s+aws\s/imu);
  });

  it("runs bounded read-only regression without fixed sleeps", () => {
    const workflow = readFileSync(workflowPath, "utf8");

    expect(workflow).toContain('CPI_PLAYWRIGHT_RETRIES: "1"');
    expect(workflow).toContain("tools/aws/waitForHttp.mjs");
    expect(workflow).toContain("--attempts 6");
    expect(workflow).toContain("pnpm exec playwright test");
    expect(workflow).not.toContain("--grep @smoke");
    expect(workflow).not.toMatch(/\bsleep\b/u);
  });

  it("enforces quarantine metadata and fails unexpected retries", () => {
    const workflow = readFileSync(workflowPath, "utf8");

    expect(workflow).toContain("validateFlakeRegistry.mjs");
    expect(workflow).toContain("analyzePlaywrightResults.mjs");
    expect(workflow).toContain("--fail-on-unexpected");
    expect(workflow).toContain("tests/flaky-tests.json");
    expect(workflow).toContain("Enforce regression and flake outcomes");
  });

  it("publishes Allure, traces, retry evidence, and a linked summary", () => {
    const workflow = readFileSync(workflowPath, "utf8");

    expect(workflow).toContain("pnpm report:allure");
    expect(workflow).toContain("pnpm report:github-summary");
    expect(workflow).toContain("flake-evidence/");
    expect(workflow).toContain("test-results/playwright/");
    expect(workflow).toContain("artifact-url");
    expect(workflow).toContain("retention-days: 30");
  });
});
