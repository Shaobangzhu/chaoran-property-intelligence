import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { validateMultilineWorkflowShell } from "./workflowShellSyntax.js";

const workflowPath = fileURLToPath(
  new URL(
    "../../../.github/workflows/deploy-account-guardrails.yml",
    import.meta.url,
  ),
);

describe("account Guardrails deployment workflow", () => {
  it("keeps every multiline shell run block syntactically valid", () => {
    const workflow = readFileSync(workflowPath, "utf8");

    expect(validateMultilineWorkflowShell(workflow)).toBeGreaterThan(0);
  });

  it("is a two-run manually confirmed main-branch operation", () => {
    const workflow = readFileSync(workflowPath, "utf8");

    expect(workflow).toContain("name: Deploy account guardrails");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("github.ref == 'refs/heads/main'");
    expect(workflow).toContain("inputs.operation == 'plan'");
    expect(workflow).toContain(
      "inputs.confirmation == 'plan-account-guardrails'",
    );
    expect(workflow).toContain("inputs.operation == 'deploy'");
    expect(workflow).toContain(
      "inputs.confirmation == 'deploy-account-guardrails'",
    );
    expect(workflow).toContain("inputs.approved_plan_digest != ''");
    expect(workflow).not.toMatch(/^\s*push:/mu);
  });

  it("reuses the protected production OIDC boundary", () => {
    const workflow = readFileSync(workflowPath, "utf8");

    expect(workflow).toContain("    environment:\n      name: production");
    expect(workflow).toContain("id-token: write");
    expect(workflow).toContain(
      "arn:aws:iam::${{ vars.AWS_ACCOUNT_ID }}:role/cpi-github-deploy",
    );
    expect(workflow).toContain("aws sts get-caller-identity");
    expect(workflow).not.toContain("AWS_ACCESS_KEY_ID");
    expect(workflow).not.toContain("AWS_SECRET_ACCESS_KEY");
  });

  it("plans and deploys only the account Guardrails stack", () => {
    const workflow = readFileSync(workflowPath, "utf8");

    expect(
      workflow.match(/ChaoranPropertyIntelligenceGuardrails/gu),
    ).toHaveLength(4);
    expect(workflow.match(/--exclusively/gu)).toHaveLength(2);
    expect(workflow).toContain("--method template");
    expect(workflow).toContain("--fail-on-delete");
    expect(workflow).not.toContain("ChaoranPropertyIntelligenceDev");
    expect(workflow).not.toContain("ChaoranPropertyIntelligenceProduction");
    expect(workflow).not.toContain("scheduleEnabled");
    expect(workflow).not.toContain("showingListScheduleEnabled");
  });

  it("binds deploy to the reviewed commit and account-backed diff", () => {
    const workflow = readFileSync(workflowPath, "utf8");

    expect(workflow).toContain("ref: ${{ github.sha }}");
    expect(workflow).toContain("createDeploymentApproval.mjs");
    expect(workflow).toContain("--stage account-guardrails");
    expect(workflow).toContain("--expected-digest");
    expect(workflow).toContain("retention-days: 90");
  });

  it("keeps the AWS mutation behind the deploy-only boundary", () => {
    const workflow = readFileSync(workflowPath, "utf8");
    const stepName = "Deploy approved account Guardrails stack only";
    const stepStart = workflow.indexOf(`- name: ${stepName}`);
    const nextStep = workflow.indexOf("\n      - name:", stepStart + 1);
    const step = workflow.slice(
      stepStart,
      nextStep === -1 ? workflow.length : nextStep,
    );

    expect(stepStart).toBeGreaterThanOrEqual(0);
    expect(step).toContain("if: inputs.operation == 'deploy'");
    expect(step).toContain("cdk deploy");
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
