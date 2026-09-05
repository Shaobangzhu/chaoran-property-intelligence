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
    expect(workflow).toContain("fetch-depth: 0");
    expect(workflow).toContain("git rev-parse HEAD");
    expect(workflow).toContain("CPI_TESTED_GIT_SHA=$tested_sha");
    expect(workflow).toContain("verifyDeployedRelease.mjs");
    expect(workflow).toContain("test-results/deployed-release.md");
    expect(workflow).not.toContain("CPI_EXPECTED_RELEASE_SHA=$tested_sha");
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

  it("publishes one Access-protected daily report through a least-privilege job", () => {
    const workflow = readFileSync(workflowPath, "utf8");

    expect(workflow).toContain("name: Publish protected 30-day Allure portal");
    expect(workflow).toContain("name: allure-reports");
    expect(workflow).toContain("secrets.CLOUDFLARE_API_TOKEN");
    expect(workflow).toContain("vars.CLOUDFLARE_ACCOUNT_ID");
    expect(workflow).toContain("vars.CLOUDFLARE_PAGES_PROJECT_NAME");
    expect(workflow).toContain("wrangler@4.129.0 pages deploy");
    expect(workflow).toContain("node-version: 24.19.0");
    expect(workflow).toContain("version: 11.19.0");
    expect(workflow).toContain("--branch=main");
    expect(workflow).toContain("--retention-days 30");
    expect(workflow).toContain("--max-file-bytes 25000000");
    expect(workflow).toContain("--max-files 19000");
    expect(workflow).toContain("restoreReportArtifacts.mjs");
    expect(workflow).toContain("allure-pages-report-${{ github.run_id }}");
    expect(workflow).toContain("archive_entries=\"$(unzip -Z1 \"$archive\")\"");
    expect(workflow).toContain("grep -Eq '(^|/)\\.\\.?(/|$)|\\\\'");
    expect(workflow).toContain("overwrite: true");
    expect(workflow).toContain("allure-history-state");
    expect(workflow).toContain("allure-history/history.jsonl");
    expect(workflow).not.toContain("allure-results/history");
    expect(workflow).not.toContain("pull_request:");
    expect(workflow).not.toMatch(
      /uses:\s+actions\/(?:download|upload)-artifact@v4/u,
    );
  });

  it("keeps the Cloudflare credential outside the regression job", () => {
    const workflow = readFileSync(workflowPath, "utf8");
    const publishJobStart = workflow.indexOf("  publish-allure:");

    expect(publishJobStart).toBeGreaterThan(0);
    expect(workflow.slice(0, publishJobStart)).not.toContain(
      "CLOUDFLARE_API_TOKEN",
    );
    expect(workflow.slice(publishJobStart)).toContain(
      "CLOUDFLARE_API_TOKEN",
    );
  });
});
