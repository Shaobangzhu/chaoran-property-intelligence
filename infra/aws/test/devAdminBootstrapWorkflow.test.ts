import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const workflowPath = fileURLToPath(
  new URL(
    "../../../.github/workflows/bootstrap-dev-admin.yml",
    import.meta.url,
  ),
);

describe("DEV administrator bootstrap workflow", () => {
  it("is manual, DEV-only, and protected by its own environment", () => {
    const workflow = readFileSync(workflowPath, "utf8");

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("github.ref == 'refs/heads/dev'");
    expect(workflow).toContain("name: development-admin-bootstrap");
    expect(workflow).not.toMatch(/^\s*(push|pull_request|schedule):/mu);
    expect(workflow).not.toContain("ChaoranPropertyIntelligenceProduction");
  });

  it("requires separate plan and create runs bound by a digest", () => {
    const workflow = readFileSync(workflowPath, "utf8");

    expect(workflow).toContain("plan-dev-admin");
    expect(workflow).toContain("create-dev-admin");
    expect(workflow).toContain("approved_plan_digest");
    expect(workflow).toContain("createDevAdminBootstrapApproval.mjs");
    expect(workflow).toContain('--expected-digest "$CPI_APPROVED_PLAN_DIGEST"');
  });

  it("uses the isolated OIDC role without long-lived AWS credentials", () => {
    const workflow = readFileSync(workflowPath, "utf8");

    expect(workflow).toContain("id-token: write");
    expect(workflow).toContain("role/cpi-github-dev-admin-bootstrap");
    expect(workflow).toContain("aws sts get-caller-identity");
    expect(workflow).not.toContain("AWS_ACCESS_KEY_ID");
    expect(workflow).not.toContain("AWS_SECRET_ACCESS_KEY");
  });

  it("keeps credentials in an ephemeral secret and always requests deletion", () => {
    const workflow = readFileSync(workflowPath, "utf8");

    expect(workflow).toContain("secrets.CPI_DEV_ADMIN_EMAIL");
    expect(workflow).toContain("secrets.CPI_DEV_ADMIN_PASSWORD");
    expect(workflow).toContain("cpi/dev/admin-bootstrap/${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}");
    expect(workflow).toContain('--secret-string "file://$secret_file"');
    expect(workflow).toContain("--force-delete-without-recovery");
    expect(workflow).not.toContain("echo $CPI_DEV_ADMIN_PASSWORD");
  });

  it("runs exactly one bounded Fargate task without fixed sleeps", () => {
    const workflow = readFileSync(workflowPath, "utf8");

    expect(workflow).toContain("aws ecs run-task");
    expect(workflow).toContain("--count 1");
    expect(workflow).toContain("aws ecs wait tasks-stopped");
    expect(workflow).toContain("cpi-dev-daily-property-alert");
    expect(workflow).toContain("cpi-dev-weekly-showing-list");
    expect(workflow).toContain('daily: $daily_state, weekly: $weekly_state');
    expect(workflow).not.toMatch(/\bsleep\b/u);
    expect(workflow).not.toContain("--run-showing-list");
    expect(workflow).not.toContain("--run\"");
  });
});
