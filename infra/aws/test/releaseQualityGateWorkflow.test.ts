import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const workflowPath = fileURLToPath(
  new URL(
    "../../../.github/workflows/release-quality-gate.yml",
    import.meta.url,
  ),
);

describe("release quality gate workflow", () => {
  it("accepts only a same-repository dev-to-main pull request", () => {
    const workflow = readFileSync(workflowPath, "utf8");

    expect(workflow).toContain("pull_request:");
    expect(workflow).toContain("- main");
    expect(workflow).toContain('test "$CPI_RELEASE_HEAD_REF" = "dev"');
    expect(workflow).toContain("CPI_RELEASE_HEAD_REPOSITORY");
    expect(workflow).not.toMatch(/^\s*push:/mu);
  });

  it("checks out the exact candidate with full ancestry", () => {
    const workflow = readFileSync(workflowPath, "utf8");

    expect(workflow).toContain(
      "CPI_RELEASE_CANDIDATE_SHA: ${{ github.event.pull_request.head.sha }}",
    );
    expect(workflow).toContain("ref: ${{ github.event.pull_request.head.sha }}");
    expect(workflow).toContain("fetch-depth: 0");
    expect(workflow).toContain("git rev-parse HEAD");
    expect(workflow).toContain("CPI_EXPECTED_DEPLOYMENT_STAGE: dev");
  });

  it("accepts only exact or non-runtime descendant candidates", () => {
    const workflow = readFileSync(workflowPath, "utf8");

    expect(workflow).toContain("verifyDeployedRelease.mjs");
    expect(workflow).toContain("--candidate-sha");
    expect(workflow).toContain("test-results/deployed-release.md");
    expect(workflow).not.toContain(
      "CPI_EXPECTED_RELEASE_SHA: ${{ github.event.pull_request.head.sha }}",
    );
  });

  it("uses only the public DEV origin and never requests AWS credentials", () => {
    const workflow = readFileSync(workflowPath, "utf8");

    expect(workflow).toContain("vars.CPI_AWS_DEV_BASE_URL");
    expect(workflow).not.toContain("id-token: write");
    expect(workflow).not.toContain("configure-aws-credentials");
    expect(workflow).not.toMatch(/^\s+aws\s/imu);
  });

  it("runs full source and remote-safe regression with flake enforcement", () => {
    const workflow = readFileSync(workflowPath, "utf8");

    expect(workflow).toContain("run: pnpm test");
    expect(workflow).toContain("run: pnpm typecheck");
    expect(workflow).toContain("run: pnpm build");
    expect(workflow).toContain("pnpm exec playwright test");
    expect(workflow).not.toContain("--grep @smoke");
    expect(workflow).toContain("--fail-on-unexpected");
    expect(workflow).not.toMatch(/\bsleep\b/u);
  });

  it("publishes bounded release evidence", () => {
    const workflow = readFileSync(workflowPath, "utf8");

    expect(workflow).toContain("pnpm report:allure");
    expect(workflow).toContain("pnpm report:github-summary");
    expect(workflow).toContain("artifact-url");
    expect(workflow).toContain("retention-days: 30");
  });
});
