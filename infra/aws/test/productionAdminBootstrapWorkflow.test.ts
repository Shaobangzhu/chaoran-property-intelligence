import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { validateMultilineWorkflowShell } from "./workflowShellSyntax.js";

const workflowPath = fileURLToPath(
  new URL(
    "../../../.github/workflows/bootstrap-production-admin.yml",
    import.meta.url,
  ),
);

describe("production administrator bootstrap workflow", () => {
  it("is manual, main-only, and protected by its own environment", () => {
    const workflow = readFileSync(workflowPath, "utf8");

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("github.ref == 'refs/heads/main'");
    expect(workflow).toContain("name: production-admin-bootstrap");
    expect(workflow).not.toMatch(/^\s*(push|pull_request|schedule):/mu);
    expect(workflow).not.toContain("ChaoranPropertyIntelligenceDev");
  });

  it("requires separate plan and create runs bound by a digest", () => {
    const workflow = readFileSync(workflowPath, "utf8");

    expect(workflow).toContain("plan-production-admin");
    expect(workflow).toContain("create-production-admin");
    expect(workflow).toContain("approved_plan_digest");
    expect(workflow).toContain(
      "createProductionAdminBootstrapApproval.mjs",
    );
    expect(workflow).toContain(
      '--expected-digest "$CPI_APPROVED_PLAN_DIGEST"',
    );
  });

  it("uses the isolated OIDC role without long-lived AWS credentials", () => {
    const workflow = readFileSync(workflowPath, "utf8");

    expect(workflow).toContain("id-token: write");
    expect(workflow).toContain(
      "role/cpi-github-production-admin-bootstrap",
    );
    expect(workflow).toContain("aws sts get-caller-identity");
    expect(workflow).not.toContain("AWS_ACCESS_KEY_ID");
    expect(workflow).not.toContain("AWS_SECRET_ACCESS_KEY");
  });

  it("keeps credentials in an ephemeral production secret", () => {
    const workflow = readFileSync(workflowPath, "utf8");

    expect(workflow).toContain("secrets.CPI_PRODUCTION_ADMIN_EMAIL");
    expect(workflow).toContain("secrets.CPI_PRODUCTION_ADMIN_PASSWORD");
    expect(workflow).toContain(
      "cpi/production/admin-bootstrap/${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}",
    );
    expect(workflow).toContain('--secret-string "file://$secret_file"');
    expect(workflow).toContain("--force-delete-without-recovery");
    expect(workflow).not.toContain("echo $CPI_PRODUCTION_ADMIN_PASSWORD");
  });

  it("runs exactly one bounded task and keeps both schedules disabled", () => {
    const workflow = readFileSync(workflowPath, "utf8");

    expect(workflow).toContain("aws ecs run-task");
    expect(workflow).toContain("--count 1");
    expect(workflow).toContain("aws ecs wait tasks-stopped");
    expect(workflow).toContain("cpi-daily-property-alert");
    expect(workflow).toContain("cpi-weekly-showing-list");
    expect(workflow).toContain(
      'daily: $daily_state, weekly: $weekly_state',
    );
    expect(workflow).not.toMatch(/\bsleep\b/u);
    expect(workflow).not.toContain("--run-showing-list");
  });

  it("contains syntactically valid multiline Bash", () => {
    const workflow = readFileSync(workflowPath, "utf8");

    expect(validateMultilineWorkflowShell(workflow)).toBeGreaterThan(0);
  });
});
