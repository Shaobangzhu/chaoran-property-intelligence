import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const workflowPath = fileURLToPath(
  new URL("../../../.github/workflows/deploy-dev.yml", import.meta.url),
);

describe("DEV deployment workflow", () => {
  it("runs only for dev and places plan and deploy behind separate environment jobs", () => {
    const workflow = readFileSync(workflowPath, "utf8");

    expect(workflow).toContain("- dev");
    expect(workflow).toContain("github.ref == 'refs/heads/dev'");
    expect(workflow.match(/name: development/gu)).toHaveLength(2);
    expect(workflow).toContain(
      "Plan DEV deployment (approval 1; no migration)",
    );
    expect(workflow).toContain(
      "Deploy DEV (approval 2; API startup migrates DEV)",
    );
  });

  it("uses the isolated DEV OIDC role and verifies the target account", () => {
    const workflow = readFileSync(workflowPath, "utf8");

    expect(workflow).toContain("id-token: write");
    expect(workflow).toContain(
      "arn:aws:iam::${{ vars.AWS_ACCOUNT_ID }}:role/cpi-github-deploy-dev",
    );
    expect(workflow).toContain("aws sts get-caller-identity");
    expect(workflow).not.toContain("AWS_ACCESS_KEY_ID");
    expect(workflow).not.toContain("AWS_SECRET_ACCESS_KEY");
  });

  it("classifies account-backed diff and blocks deletes before deployment", () => {
    const workflow = readFileSync(workflowPath, "utf8");

    expect(workflow).toContain("--method template");
    expect(workflow).toContain("--fail-on-delete");
    expect(workflow).toContain("CREATE UPDATE REPLACE DELETE");
    expect(workflow).toContain("dev-cdk-diff-");
  });

  it("deploys only explicit DEV stacks with both schedules disabled", () => {
    const workflow = readFileSync(workflowPath, "utf8");

    expect(workflow).toContain("ChaoranPropertyIntelligenceDevEdge");
    expect(workflow).toContain(
      "ChaoranPropertyIntelligenceDevPublicApplication",
    );
    expect(workflow).toContain("-c targetStage=dev");
    expect(workflow).toContain("-c scheduleEnabled=false");
    expect(workflow).toContain("-c showingListScheduleEnabled=false");
    expect(workflow).not.toContain("ChaoranPropertyIntelligenceProduction");
  });

  it("publishes web content then runs bounded read-only smoke with evidence", () => {
    const workflow = readFileSync(workflowPath, "utf8");

    expect(workflow).toContain("aws s3 sync");
    expect(workflow).toContain("cloudfront wait invalidation-completed");
    expect(workflow).toContain("tools/aws/waitForHttp.mjs");
    expect(workflow).toContain("CPI_PLAYWRIGHT_REMOTE_BASE_URL");
    expect(workflow).toContain("pnpm exec playwright test --grep @smoke");
    expect(workflow).toContain("list-object-versions");
    expect(workflow).toContain("aws sns publish");
    expect(workflow).not.toMatch(/\bsleep\b/u);
  });
});
