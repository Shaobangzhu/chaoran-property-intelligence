import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const workflowPath = fileURLToPath(
  new URL(
    "../../../.github/workflows/release-quality-gate.yml",
    import.meta.url,
  ),
);
const prQualityGatePath = fileURLToPath(
  new URL("../../../.github/workflows/pr-quality-gate.yml", import.meta.url),
);
const legacyCiPath = fileURLToPath(
  new URL("../../../.github/workflows/ci.yml", import.meta.url),
);

describe("release promotion gate workflow", () => {
  it("uses the DEV PR quality gate as the only source verification workflow", () => {
    const workflow = readFileSync(prQualityGatePath, "utf8");

    expect(workflow).toContain("name: PR Quality Gate");
    expect(workflow).toContain("pull_request:");
    expect(workflow).toContain("- dev");
    expect(workflow).toContain("name: quality-gate");
    expect(workflow).toContain("pnpm typecheck");
    expect(workflow).toContain("pnpm build");
    expect(existsSync(legacyCiPath)).toBe(false);
  });

  it("is named for exact AWS DEV promotion", () => {
    const workflow = readFileSync(workflowPath, "utf8");

    expect(workflow).toContain("name: Release Promotion Gate");
    expect(workflow).toContain("name: Promote exact AWS DEV release");
  });

  it("accepts only a same-repository dev-to-main pull request", () => {
    const workflow = readFileSync(workflowPath, "utf8");

    expect(workflow).toContain("pull_request:");
    expect(workflow).toContain("- main");
    expect(workflow).toContain(
      'if [ "$CPI_RELEASE_HEAD_REF" != "dev" ]; then',
    );
    expect(workflow).toContain("Open feature branches against dev");
    expect(workflow).toContain("Retarget this feature pull request");
    expect(workflow).toContain("CPI_RELEASE_HEAD_REPOSITORY");
    expect(workflow).not.toMatch(/^\s*push:/mu);
  });

  it("does not emit secondary report failures when release preflight fails", () => {
    const workflow = readFileSync(workflowPath, "utf8");
    const guardedEvidenceSteps = workflow.match(
      /if: always\(\) && steps\.playwright\.outcome == 'success'/gu,
    );

    expect(guardedEvidenceSteps).toHaveLength(5);
    expect(workflow).not.toMatch(/^\s+if: always\(\)\s*$/gmu);
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

  it("reuses source verification and runs only remote promotion evidence", () => {
    const workflow = readFileSync(workflowPath, "utf8");

    expect(workflow).not.toMatch(/^\s*run: pnpm test\s*$/mu);
    expect(workflow).not.toMatch(/^\s*run: pnpm typecheck\s*$/mu);
    expect(workflow).not.toMatch(/^\s*run: pnpm build\s*$/mu);
    expect(workflow).not.toContain("CPI_PLAYWRIGHT_START_WEB");
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
