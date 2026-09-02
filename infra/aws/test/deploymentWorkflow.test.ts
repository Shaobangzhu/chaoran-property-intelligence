import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { validateMultilineWorkflowShell } from "./workflowShellSyntax.js";

const workflowPath = fileURLToPath(
  new URL("../../../.github/workflows/deploy-production.yml", import.meta.url),
);

describe("production deployment workflow", () => {
  it("keeps every multiline shell run block syntactically valid", () => {
    const workflow = readFileSync(workflowPath, "utf8");

    expect(validateMultilineWorkflowShell(workflow)).toBeGreaterThan(0);
  });

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
    expect(workflow).toContain("--method template");
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

  it("keeps production Price Estimation egress behind explicit stage budget approval", () => {
    const workflow = readFileSync(workflowPath, "utf8");

    expect(workflow).toContain(
      "vars.CPI_PRODUCTION_PRICE_ESTIMATION_RUNTIME_ENABLED || 'false'",
    );
    expect(workflow).toContain(
      "vars.CPI_PRODUCTION_PRICE_ESTIMATION_OPENAI_ENABLED || 'false'",
    );
    expect(workflow).toContain(
      "vars.CPI_PRODUCTION_PRICE_ESTIMATION_BUDGET_APPROVED || 'false'",
    );
    expect(workflow).toContain(
      "tools/aws/validatePriceEstimationRuntime.mjs",
    );
    expect(
      workflow.match(/-c priceEstimationRuntimeEnabled=/gu),
    ).toHaveLength(3);
    expect(
      workflow.match(/-c priceEstimationOpenAiEnabled=/gu),
    ).toHaveLength(3);
  });

  it("keeps every AWS mutation behind the deploy-only input boundary", () => {
    const workflow = readFileSync(workflowPath, "utf8");
    const deployOnlySteps = [
      "Deploy approved production stacks with schedules disabled",
      "Publish immutable production web build",
      "Publish bounded production deployment failure notification",
    ];

    for (const stepName of deployOnlySteps) {
      const stepStart = workflow.indexOf(`- name: ${stepName}`);
      const nextStep = workflow.indexOf("\n      - name:", stepStart + 1);
      const step = workflow.slice(
        stepStart,
        nextStep === -1 ? workflow.length : nextStep,
      );

      expect(stepStart, `${stepName} must exist`).toBeGreaterThanOrEqual(0);
      expect(step).toContain("if:");
      expect(step).toContain("inputs.operation == 'deploy'");
    }
  });

  it("runs identity-bound read-only production smoke without worker behavior", () => {
    const workflow = readFileSync(workflowPath, "utf8");

    expect(workflow).toContain(
      "VITE_ARCGIS_API_KEY: ${{ secrets.CPI_PRODUCTION_ARCGIS_API_KEY }}",
    );
    expect(workflow).toContain("verifyArcgisWebBuild.mjs");
    expect(workflow).toContain("CPI_EXPECTED_RELEASE_SHA=$GITHUB_SHA");
    expect(workflow).toContain("CPI_EXPECTED_DEPLOYMENT_STAGE=production");
    expect(workflow).toContain("--cache-control no-store");
    expect(workflow).toContain("pnpm exec playwright test --grep @smoke");
    expect(workflow).toContain("RuntimeSecretNames");
    expect(workflow).toContain('index("RENTCAST_API_KEY")');
    expect(workflow).toContain('index("OPENAI_API_KEY")');
    expect(workflow).not.toContain("rentcast:");
    expect(workflow).not.toContain("telegram:");
    expect(workflow).not.toContain("openai:");
    expect(workflow).not.toContain("runAlertWorker");
    expect(workflow).not.toMatch(/\bsleep\b/u);
  });
});
