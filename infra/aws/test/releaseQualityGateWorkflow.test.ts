import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  extractMultilineWorkflowShellScripts,
  validateMultilineWorkflowShell,
} from "./workflowShellSyntax.js";

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
const releasePolicyAdrPath = fileURLToPath(
  new URL(
    "../../../docs/adr/0020-change-classified-release-promotion.md",
    import.meta.url,
  ),
);
const releasePolicyRunbookPath = fileURLToPath(
  new URL(
    "../../../docs/runbooks/change-classified-release-promotion.md",
    import.meta.url,
  ),
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

  it("keeps the stable exact AWS DEV promotion context on the final gate", () => {
    const workflow = readFileSync(workflowPath, "utf8");

    expect(workflow).toContain("name: Release Promotion Gate");
    expect(workflow.match(/name: Promote exact AWS DEV release/gu)).toHaveLength(
      1,
    );
    expect(extractWorkflowJob(workflow, "application_release")).toContain(
      "name: Verify exact AWS DEV application release",
    );
    expect(extractWorkflowJob(workflow, "release_gate")).toContain(
      "name: Promote exact AWS DEV release",
    );
    expect(workflow).not.toMatch(/^\s+paths(?:-ignore)?:/gmu);
  });

  it("keeps rollout and branch-policy documentation aligned with the stable gate", () => {
    const adr = readFileSync(releasePolicyAdrPath, "utf8");
    const runbook = readFileSync(releasePolicyRunbookPath, "utf8");
    const requiredContext =
      "Release Promotion Gate / Promote exact AWS DEV release";

    expect(adr).toContain(requiredContext);
    expect(adr).toContain("bootstrap_fallback=false");
    expect(adr).toContain("Application or mixed work follows");
    expect(runbook).toContain(requiredContext);
    expect(runbook).toContain("## One-Time Rollout");
    expect(runbook).toContain("## Normal Branch Policy");
    expect(runbook).toContain("PR Quality Gate / quality-gate");
    expect(runbook).toContain(
      "do not require `Classify release changes`, `Verify exact AWS DEV application",
    );
    expect(runbook).toContain(
      "Do not add workflow-level `paths` or `paths-ignore`",
    );
    expect(runbook).toContain("Never copy or execute the candidate classifier");
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
      "bootstrap_fallback: ${{ steps.release-changes.outputs.bootstrap_fallback }}",
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

  it("uses both high-assurance lanes only while the trusted classifier is absent", () => {
    const workflow = readFileSync(workflowPath, "utf8");
    const classificationJob = extractWorkflowJob(workflow, "classify");
    const classificationScript = extractMultilineWorkflowShellScripts(
      workflow,
    ).find(
      ({ name }) =>
        name === "Classify application, platform, and non-deployable changes",
    )?.script;

    expect(classificationScript).toBeDefined();
    expect(classificationJob).toContain(
      "ref: ${{ github.event.pull_request.base.sha }}",
    );
    expect(classificationJob).not.toContain(
      "ref: ${{ github.event.pull_request.head.sha }}",
    );
    expect(classificationScript).toContain(
      "if [ ! -f tools/release/classifyReleaseChanges.mjs ]; then",
    );
    expect(classificationScript).toContain('echo "application_required=true"');
    expect(classificationScript).toContain('echo "platform_required=true"');
    expect(classificationScript).toContain('echo "documentation_only=false"');
    expect(classificationScript).toContain('echo "classification_valid=true"');
    expect(classificationScript).toContain('echo "bootstrap_fallback=true"');
    expect(classificationScript).toContain(
      'echo "bootstrap_fallback=false"',
    );
    expect(classificationScript).toContain(
      "The candidate classifier was not executed.",
    );

    const result = runClassificationBootstrapFallback(
      classificationScript ?? "",
    );

    expect(result.status).toBe(0);
    expect(result.output).toContain("application_required=true");
    expect(result.output).toContain("platform_required=true");
    expect(result.output).toContain("documentation_only=false");
    expect(result.output).toContain("classification_valid=true");
    expect(result.output).toContain("bootstrap_fallback=true");
    expect(result.summary).toContain("Trusted base classifier: not yet installed");
    expect(result.summary).toContain(
      "conservative application and platform lanes",
    );
  });

  it("records docs and tests as an explicit no-deployment lane", () => {
    const workflow = readFileSync(workflowPath, "utf8");
    const noDeploymentLane = extractWorkflowJob(workflow, "no_deployment");

    expect(noDeploymentLane).toContain(
      "needs.classify.outputs.classification_valid == 'true'",
    );
    expect(noDeploymentLane).toContain(
      "needs.classify.outputs.documentation_only == 'true'",
    );
    expect(noDeploymentLane).toContain("permissions: {}");
    expect(noDeploymentLane).toContain(
      "CPI_CHANGED_FILE_COUNT: ${{ needs.classify.outputs.changed_file_count }}",
    );
    expect(noDeploymentLane).toContain("No deployment required");
    expect(noDeploymentLane).not.toContain("uses:");
    expect(noDeploymentLane).not.toContain("actions/checkout");
    expect(noDeploymentLane).not.toContain("pnpm");
    expect(noDeploymentLane).not.toContain("playwright");
    expect(noDeploymentLane).not.toContain("CPI_AWS_DEV_BASE_URL");
    expect(noDeploymentLane).not.toContain("id-token: write");
    expect(noDeploymentLane).not.toContain("configure-aws-credentials");
    expect(noDeploymentLane).not.toContain("environment:");
    expect(noDeploymentLane).not.toMatch(/^\s+aws\s/imu);
  });

  it("aggregates every conditional lane into one stable required check", () => {
    const workflow = readFileSync(workflowPath, "utf8");
    const releaseGate = extractWorkflowJob(workflow, "release_gate");

    expect(releaseGate).toContain("name: Promote exact AWS DEV release");
    expect(releaseGate).toContain("- classify");
    expect(releaseGate).toContain("- no_deployment");
    expect(releaseGate).toContain("- application_release");
    expect(releaseGate).toContain("- platform_synth");
    expect(releaseGate).toContain("- platform_plan");
    expect(releaseGate).toContain("if: always()");
    expect(releaseGate).toContain("permissions: {}");
    expect(releaseGate).toContain(
      "CPI_CLASSIFICATION_RESULT: ${{ needs.classify.result }}",
    );
    expect(releaseGate).toContain(
      "CPI_BOOTSTRAP_FALLBACK: ${{ needs.classify.outputs.bootstrap_fallback }}",
    );
    expect(releaseGate).toContain(
      "CPI_APPLICATION_RELEASE_RESULT: ${{ needs.application_release.result }}",
    );
    expect(releaseGate).toContain(
      "CPI_NO_DEPLOYMENT_RESULT: ${{ needs.no_deployment.result }}",
    );
    expect(releaseGate).toContain(
      "CPI_PLATFORM_SYNTH_RESULT: ${{ needs.platform_synth.result }}",
    );
    expect(releaseGate).toContain(
      "CPI_PLATFORM_PLAN_RESULT: ${{ needs.platform_plan.result }}",
    );
    expect(releaseGate).toContain("require_boolean");
    expect(releaseGate).toContain("require_result");
    expect(releaseGate).toContain("No release lane selected");
    expect(releaseGate).toContain("Conflicting release lanes");
    expect(releaseGate).toContain("Stable release promotion decision");
    expect(releaseGate).toContain('exit "$gate_status"');
    expect(releaseGate).not.toContain("uses:");
    expect(releaseGate).not.toContain("actions/checkout");
    expect(releaseGate).not.toContain("id-token: write");
    expect(releaseGate).not.toContain("environment:");
  });

  it("accepts every valid release-lane result matrix", () => {
    const scenarios: Array<{
      name: string;
      overrides: Record<string, string>;
    }> = [
      {
        name: "documentation and tests only",
        overrides: {},
      },
      {
        name: "application only",
        overrides: {
          CPI_APPLICATION_RELEASE_RESULT: "success",
          CPI_APPLICATION_REQUIRED: "true",
          CPI_DOCUMENTATION_ONLY: "false",
          CPI_NO_DEPLOYMENT_RESULT: "skipped",
        },
      },
      {
        name: "platform only",
        overrides: {
          CPI_DOCUMENTATION_ONLY: "false",
          CPI_NO_DEPLOYMENT_RESULT: "skipped",
          CPI_PLATFORM_PLAN_RESULT: "success",
          CPI_PLATFORM_REQUIRED: "true",
          CPI_PLATFORM_SYNTH_RESULT: "success",
        },
      },
      {
        name: "mixed application and platform",
        overrides: {
          CPI_APPLICATION_RELEASE_RESULT: "success",
          CPI_APPLICATION_REQUIRED: "true",
          CPI_DOCUMENTATION_ONLY: "false",
          CPI_NO_DEPLOYMENT_RESULT: "skipped",
          CPI_PLATFORM_PLAN_RESULT: "success",
          CPI_PLATFORM_REQUIRED: "true",
          CPI_PLATFORM_SYNTH_RESULT: "success",
        },
      },
      {
        name: "one-time conservative bootstrap fallback",
        overrides: {
          CPI_APPLICATION_RELEASE_RESULT: "success",
          CPI_APPLICATION_REQUIRED: "true",
          CPI_BOOTSTRAP_FALLBACK: "true",
          CPI_DOCUMENTATION_ONLY: "false",
          CPI_NO_DEPLOYMENT_RESULT: "skipped",
          CPI_PLATFORM_PLAN_RESULT: "success",
          CPI_PLATFORM_REQUIRED: "true",
          CPI_PLATFORM_SYNTH_RESULT: "success",
        },
      },
    ];

    for (const scenario of scenarios) {
      const result = runStableReleaseGate(scenario.overrides);

      expect({
        scenario: scenario.name,
        status: result.status,
        stderr: result.stderr,
        stdout: result.stdout,
      }).toMatchObject({
        scenario: scenario.name,
        status: 0,
      });
      expect(result.summary).toContain("Stable release promotion decision");
    }
  });

  it("fails closed for invalid, failed, unexpected, and conflicting lanes", () => {
    const scenarios: Array<{
      expectedError: string;
      name: string;
      overrides: Record<string, string>;
    }> = [
      {
        expectedError: "Release classification failed",
        name: "failed classification",
        overrides: {
          CPI_CLASSIFICATION_RESULT: "failure",
          CPI_CLASSIFICATION_VALID: "false",
          CPI_DOCUMENTATION_ONLY: "false",
          CPI_NO_DEPLOYMENT_RESULT: "skipped",
        },
      },
      {
        expectedError: "Release lane outcome mismatch",
        name: "failed required application lane",
        overrides: {
          CPI_APPLICATION_RELEASE_RESULT: "failure",
          CPI_APPLICATION_REQUIRED: "true",
          CPI_DOCUMENTATION_ONLY: "false",
          CPI_NO_DEPLOYMENT_RESULT: "skipped",
        },
      },
      {
        expectedError: "Release lane outcome mismatch",
        name: "unexpected non-required application lane",
        overrides: {
          CPI_APPLICATION_RELEASE_RESULT: "success",
        },
      },
      {
        expectedError: "Conflicting release lanes",
        name: "documentation combined with application",
        overrides: {
          CPI_APPLICATION_RELEASE_RESULT: "success",
          CPI_APPLICATION_REQUIRED: "true",
        },
      },
    ];

    for (const scenario of scenarios) {
      const result = runStableReleaseGate(scenario.overrides);

      expect({
        scenario: scenario.name,
        status: result.status,
      }).toMatchObject({
        scenario: scenario.name,
        status: 1,
      });
      expect(result.stdout).toContain(scenario.expectedError);
      expect(result.summary).toContain("Stable release promotion decision");
    }
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

  it("compares Guardrails source templates without AWS access or deploying", () => {
    const workflow = readFileSync(workflowPath, "utf8");
    const planLane = extractWorkflowJob(workflow, "platform_plan");

    expect(planLane).toContain("- platform_synth");
    expect(planLane).toContain(
      "needs.classify.outputs.platform_required == 'true'",
    );
    expect(planLane).toContain("needs.platform_synth.result == 'success'");
    expect(planLane).toContain("permissions:\n      contents: read");
    expect(planLane).not.toContain("id-token: write");
    expect(planLane).not.toContain("environment:");
    expect(planLane).toContain(
      "ref: ${{ github.event.pull_request.base.sha }}",
    );
    expect(planLane).toContain("actions/download-artifact@");
    expect(planLane).not.toContain("${{ runner.temp }}");
    expect(planLane).toContain('test -n "$RUNNER_TEMP"');
    expect(planLane).toContain(
      'guardrails_base_assembly="$RUNNER_TEMP/guardrails-base-assembly"',
    );
    expect(planLane).toContain(
      'echo "CPI_GUARDRAILS_BASE_ASSEMBLY=$guardrails_base_assembly" >> "$GITHUB_ENV"',
    );
    expect(planLane).toContain('mkdir -p "$guardrails_base_assembly"');
    expect(planLane).toContain("Synthesize trusted base Guardrails template");
    expect(planLane).toContain(
      "if [ ! -f infra/aws/dist/bin/guardrails.js ]; then",
    );
    expect(planLane).toContain("guardrails_entrypoint='dist/bin/app.js'");
    expect(planLane).toContain("legacy CDK app with an exclusive stack target");
    expect(planLane).toContain("guardrails-plan/comparison-inputs.txt");
    expect(planLane).toContain("--no-lookups");
    expect(planLane).toContain(
      "--template \"$CPI_GUARDRAILS_BASE_ASSEMBLY/ChaoranPropertyIntelligenceGuardrails.template.json\"",
    );
    expect(planLane).toContain("--method template");
    expect(planLane).toContain("--fail-on-delete");
    expect(planLane).toContain("sha256sum guardrails-plan/cdk-diff.txt");
    expect(planLane).toContain("guardrails-plan/source-comparison.txt");
    expect(planLane).toContain("cannot authorize an AWS deployment");
    expect(planLane).toContain("release-guardrails-source-comparison-");
    expect(planLane).toContain("retention-days: 30");
    expect(planLane).not.toContain("configure-aws-credentials");
    expect(planLane).not.toContain("AWS_ACCOUNT_ID");
    expect(planLane).not.toContain("${{ vars.");
    expect(planLane).not.toContain("${{ secrets.");
    expect(planLane).not.toContain("role/cpi-github-deploy");
    expect(planLane).not.toContain("aws sts get-caller-identity");
    expect(planLane).not.toMatch(/^\s+aws\s/imu);
    expect(planLane).not.toContain("createDeploymentApproval.mjs");
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

function runStableReleaseGate(overrides: Record<string, string>) {
  const workflow = readFileSync(workflowPath, "utf8");
  const script = extractMultilineWorkflowShellScripts(workflow).find(
    ({ name }) => name === "Enforce selected release lane outcomes",
  )?.script;
  if (script === undefined) {
    throw new Error("Stable release gate shell script was not found");
  }

  const outputDirectory = mkdtempSync(join(tmpdir(), "cpi-release-gate-"));
  const summaryPath = join(outputDirectory, "summary.md");

  try {
    const result = spawnSync("bash", ["-c", script], {
      encoding: "utf8",
      env: {
        ...process.env,
        CPI_APPLICATION_RELEASE_RESULT: "skipped",
        CPI_APPLICATION_REQUIRED: "false",
        CPI_BOOTSTRAP_FALLBACK: "false",
        CPI_CLASSIFICATION_RESULT: "success",
        CPI_CLASSIFICATION_VALID: "true",
        CPI_DOCUMENTATION_ONLY: "true",
        CPI_NO_DEPLOYMENT_RESULT: "success",
        CPI_PLATFORM_PLAN_RESULT: "skipped",
        CPI_PLATFORM_REQUIRED: "false",
        CPI_PLATFORM_SYNTH_RESULT: "skipped",
        GITHUB_STEP_SUMMARY: summaryPath,
        ...overrides,
      },
    });

    return {
      status: result.status,
      stderr: result.stderr,
      stdout: result.stdout,
      summary: existsSync(summaryPath) ? readFileSync(summaryPath, "utf8") : "",
    };
  } finally {
    rmSync(outputDirectory, { force: true, recursive: true });
  }
}

function runClassificationBootstrapFallback(script: string) {
  const workingDirectory = mkdtempSync(
    join(tmpdir(), "cpi-release-classification-bootstrap-"),
  );
  const outputPath = join(workingDirectory, "github-output.txt");
  const summaryPath = join(workingDirectory, "summary.md");

  try {
    const result = spawnSync("bash", ["-c", script], {
      cwd: workingDirectory,
      encoding: "utf8",
      env: {
        ...process.env,
        GITHUB_OUTPUT: outputPath,
        GITHUB_STEP_SUMMARY: summaryPath,
      },
    });

    return {
      status: result.status,
      output: existsSync(outputPath) ? readFileSync(outputPath, "utf8") : "",
      summary: existsSync(summaryPath) ? readFileSync(summaryPath, "utf8") : "",
    };
  } finally {
    rmSync(workingDirectory, { force: true, recursive: true });
  }
}
