import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const workflowPath = fileURLToPath(
  new URL("../../../.github/workflows/deploy-production.yml", import.meta.url),
);

describe("production deployment workflow", () => {
  it("is a two-run manually confirmed main-branch operation", () => {
    const workflow = readFileSync(workflowPath, "utf8");

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("github.ref == 'refs/heads/main'");
    expect(workflow).toContain("    environment:\n      name: production");
    expect(workflow).toContain("ref: ${{ github.sha }}");
    expect(workflow).toContain("inputs.operation == 'plan'");
    expect(workflow).toContain("inputs.confirmation == 'plan-production'");
    expect(workflow).toContain("inputs.operation == 'deploy'");
    expect(workflow).toContain("inputs.confirmation == 'deploy-production'");
    expect(workflow).toContain("inputs.approved_plan_digest != ''");
    expect(workflow).not.toMatch(/^\s*push:/mu);
  });

  it("requires explicit API migration authorization for deploy", () => {
    const workflow = readFileSync(workflowPath, "utf8");

    expect(workflow).toContain(
      "inputs.migration_confirmation == 'authorize-production-api-migration'",
    );
    expect(workflow).toContain(
      "Plan or deploy production with reviewed migration boundary",
    );
  });

  it("uses the existing exact-main OIDC role and immutable action pins", () => {
    const workflow = readFileSync(workflowPath, "utf8");

    expect(workflow).toContain("id-token: write");
    expect(workflow).toContain(
      "arn:aws:iam::${{ vars.AWS_ACCOUNT_ID }}:role/cpi-github-deploy",
    );
    expect(workflow).not.toContain("AWS_ACCESS_KEY_ID");
    expect(workflow).not.toContain("AWS_SECRET_ACCESS_KEY");
    for (const line of workflow
      .split("\n")
      .filter((candidate) => candidate.trim().startsWith("uses:"))) {
      expect(line).toMatch(/@[a-f0-9]{40}(?:\s|$)/u);
    }
  });

  it("binds a classified account-backed plan to commit and AWS state", () => {
    const workflow = readFileSync(workflowPath, "utf8");

    expect(workflow).toContain("cdk diff");
    expect(workflow).toContain("classifyCdkDiff.mjs");
    expect(workflow).toContain("--fail-on-delete");
    expect(workflow).toContain("createDeploymentApproval.mjs");
    expect(workflow).toContain("--expected-digest");
    expect(workflow).toContain("retention-days: 90");
  });

  it("deploys only explicit production stacks with both schedules disabled", () => {
    const workflow = readFileSync(workflowPath, "utf8");

    expect(workflow).toContain("ChaoranPropertyIntelligenceProductionEdge");
    expect(workflow).toContain(
      "ChaoranPropertyIntelligenceProductionPublicApplication",
    );
    expect(workflow).toContain('-c releaseSha="$GITHUB_SHA"');
    expect(workflow).toContain("-c scheduleEnabled=false");
    expect(workflow).toContain("-c showingListScheduleEnabled=false");
    expect(workflow).not.toContain("cdk deploy --all");
  });

  it("runs identity-bound read-only production smoke without worker behavior", () => {
    const workflow = readFileSync(workflowPath, "utf8");

    expect(workflow).toContain("CPI_EXPECTED_RELEASE_SHA=$GITHUB_SHA");
    expect(workflow).toContain("CPI_EXPECTED_DEPLOYMENT_STAGE=production");
    expect(workflow).toContain("--cache-control no-store");
    expect(workflow).toContain("pnpm exec playwright test --grep @smoke");
    expect(workflow).not.toContain("rentcast:");
    expect(workflow).not.toContain("telegram:");
    expect(workflow).not.toContain("openai:");
    expect(workflow).not.toContain("runAlertWorker");
    expect(workflow).not.toMatch(/\bsleep\b/u);
  });
});
