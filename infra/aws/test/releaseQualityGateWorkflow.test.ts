import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { validateMultilineWorkflowShell } from "./workflowShellSyntax.js";

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
  it("keeps every multiline shell run block syntactically valid", () => {
    const workflow = readFileSync(workflowPath, "utf8");

    expect(validateMultilineWorkflowShell(workflow)).toBeGreaterThan(0);
  });

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

  it("classifies release changes before running a deployment-specific gate", () => {
    const workflow = readFileSync(workflowPath, "utf8");

    expect(workflow).toContain("name: Classify release changes");
    expect(workflow).toContain(
      "CPI_RELEASE_BASE_SHA: ${{ github.event.pull_request.base.sha }}",
    );
    expect(workflow).toContain(
      "CPI_RELEASE_CANDIDATE_SHA: ${{ github.event.pull_request.head.sha }}",
    );
    expect(workflow).toContain(
      "name: Checkout trusted base classifier with full ancestry",
    );
    expect(workflow).toContain("ref: ${{ github.event.pull_request.base.sha }}");
    expect(workflow).toContain("classifyReleaseChanges.mjs");
    expect(workflow).toContain("--base \"$CPI_RELEASE_BASE_SHA\"");
    expect(workflow).toContain("--head \"$CPI_RELEASE_CANDIDATE_SHA\"");
    expect(workflow).toContain("--github-output \"$GITHUB_OUTPUT\"");
    expect(workflow).toContain(
      "test-results/release-change-classification.md",
    );
    expect(workflow).toContain(
      "application_required: ${{ steps.release-changes.outputs.application_required }}",
    );
    expect(workflow).toContain(
      "platform_required: ${{ steps.release-changes.outputs.platform_required }}",
    );
    expect(workflow).toContain(
      "documentation_only: ${{ steps.release-changes.outputs.documentation_only }}",
    );
    expect(workflow).toContain(
      "classification_valid: ${{ steps.release-changes.outputs.classification_valid }}",
    );
    expect(workflow).toContain("application_release:\n    name:");
    expect(workflow).toContain("needs: classify");
  });

  it("runs the exact DEV release lane only for classified application changes", () => {
    const workflow = readFileSync(workflowPath, "utf8");
    const applicationLaneIndex = workflow.indexOf("  application_release:");
    const sourceEnforcementIndex = workflow.indexOf(
      "- name: Enforce application dev-to-main release path",
    );

    expect(applicationLaneIndex).toBeGreaterThan(-1);
    expect(workflow).toContain(
      "needs.classify.outputs.classification_valid == 'true'",
    );
    expect(workflow).toContain(
      "needs.classify.outputs.application_required == 'true'",
    );
    expect(sourceEnforcementIndex).toBeGreaterThan(applicationLaneIndex);
  });

  it("requires application releases to use a same-repository dev-to-main pull request", () => {
    const workflow = readFileSync(workflowPath, "utf8");

    expect(workflow).toContain("pull_request:");
    expect(workflow).toContain("- main");
    expect(workflow).toContain(
      'if [ "$CPI_RELEASE_HEAD_REF" != "dev" ]; then',
    );
    expect(workflow).toContain("Application changes must be promoted");
    expect(workflow).toContain("exact DEV application lane accepts only");
    expect(workflow).toContain("Retarget this application change");
    expect(workflow).toContain("CPI_RELEASE_HEAD_REPOSITORY");
    expect(workflow).not.toMatch(/^\s*push:/mu);
  });

  it("does not emit secondary report failures when release preflight fails", () => {
    const workflow = readFileSync(workflowPath, "utf8");
    const applicationLane = extractWorkflowJob(workflow, "application_release");
    const guardedEvidenceSteps = applicationLane.match(
      /if: always\(\) && steps\.playwright\.outcome == 'success'/gu,
    );

    expect(guardedEvidenceSteps).toHaveLength(5);
    expect(applicationLane).not.toMatch(/^\s+if: always\(\)\s*$/gmu);
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

  it("keeps the application lane on the public DEV origin without AWS credentials", () => {
    const workflow = readFileSync(workflowPath, "utf8");
    const applicationLane = extractWorkflowJob(workflow, "application_release");

    expect(applicationLane).toContain("vars.CPI_AWS_DEV_BASE_URL");
    expect(applicationLane).not.toContain("id-token: write");
    expect(applicationLane).not.toContain("configure-aws-credentials");
    expect(applicationLane).not.toMatch(/^\s+aws\s/imu);
  });

  it("synthesizes an isolated Guardrails candidate without AWS credentials", () => {
    const workflow = readFileSync(workflowPath, "utf8");
    const synthLane = extractWorkflowJob(workflow, "platform_synth");

    expect(synthLane).toContain(
      "needs.classify.outputs.platform_required == 'true'",
    );
    expect(synthLane).toContain("permissions:\n      contents: read");
    expect(synthLane).not.toContain("id-token: write");
    expect(synthLane).not.toContain("configure-aws-credentials");
    expect(synthLane).toContain("Enforce same-repository platform source");
    expect(synthLane).toContain(
      'if [ "$CPI_RELEASE_HEAD_REPOSITORY" != "$GITHUB_REPOSITORY" ]; then',
    );
    expect(synthLane).toContain(
      "ref: ${{ github.event.pull_request.head.sha }}",
    );
    expect(synthLane).toContain("pnpm exec vitest run");
    expect(synthLane).toContain("--app 'node dist/bin/guardrails.js'");
    expect(synthLane).toContain("--exclusively");
    expect(synthLane).toContain("--no-lookups");
    expect(synthLane).toContain(
      'JSON.stringify(["ChaoranPropertyIntelligenceGuardrails"])',
    );
    expect(synthLane).toContain("guardrails-candidate-assembly-");
  });

  it("creates a template-only account-backed Guardrails plan without deploying", () => {
    const workflow = readFileSync(workflowPath, "utf8");
    const planLane = extractWorkflowJob(workflow, "platform_plan");

    expect(planLane).toContain("- platform_synth");
    expect(planLane).toContain(
      "needs.classify.outputs.platform_required == 'true'",
    );
    expect(planLane).toContain("needs.platform_synth.result == 'success'");
    expect(planLane).toContain("id-token: write");
    expect(planLane).toContain("environment:\n      name: production");
    expect(planLane).toContain(
      "ref: ${{ github.event.pull_request.base.sha }}",
    );
    expect(planLane).toContain("actions/download-artifact@");
    expect(planLane).toContain("role/cpi-github-deploy");
    expect(planLane).toContain("aws sts get-caller-identity");
    expect(planLane).toContain("--method template");
    expect(planLane).toContain("--fail-on-delete");
    expect(planLane).toContain("createDeploymentApproval.mjs");
    expect(planLane).toContain("--stage account-guardrails");
    expect(planLane).toContain("retention-days: 30");
    expect(planLane).not.toContain("cdk deploy");
    expect(planLane).not.toContain("CPI_ALERT_EMAIL");
    expect(planLane).not.toContain("CPI_MONTHLY_BUDGET_USD");
    expect(planLane).not.toContain("ChaoranPropertyIntelligenceDev");
    expect(planLane).not.toContain("ChaoranPropertyIntelligenceProduction");
    expect(planLane).not.toContain("scheduleEnabled");
    expect(planLane).not.toContain("showingListScheduleEnabled");
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

  it("pins every third-party action to an immutable commit", () => {
    const workflow = readFileSync(workflowPath, "utf8");

    for (const line of workflow
      .split("\n")
      .filter((candidate) => candidate.trim().startsWith("uses:"))) {
      expect(line).toMatch(/@[a-f0-9]{40}(?:\s|$)/u);
    }
  });
});

function extractWorkflowJob(workflow: string, jobId: string): string {
  const start = workflow.indexOf(`  ${jobId}:`);
  if (start === -1) {
    throw new Error(`Workflow job ${jobId} was not found`);
  }

  const remaining = workflow.slice(start + 1);
  const nextJobOffset = remaining.search(/^  [a-z][a-z0-9_]*:\s*$/mu);

  return nextJobOffset === -1
    ? workflow.slice(start)
    : workflow.slice(start, start + 1 + nextJobOffset);
}
