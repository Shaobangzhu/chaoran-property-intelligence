import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const workflowPath = fileURLToPath(
  new URL("../../../.github/workflows/deploy-production.yml", import.meta.url),
);

describe("production deployment workflow", () => {
  it("is a manually confirmed main-branch deployment", () => {
    const workflow = readFileSync(workflowPath, "utf8");

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("github.ref == 'refs/heads/main'");
    expect(workflow).toContain("inputs.confirmation == 'deploy-production'");
    expect(workflow).not.toMatch(/^\s*push:/m);
  });

  it("uses GitHub OIDC without long-lived AWS credentials", () => {
    const workflow = readFileSync(workflowPath, "utf8");

    expect(workflow).toContain("id-token: write");
    expect(workflow).toContain("contents: read");
    expect(workflow).toContain(
      "arn:aws:iam::${{ vars.AWS_ACCOUNT_ID }}:role/cpi-github-deploy",
    );
    expect(workflow).not.toContain("AWS_ACCESS_KEY_ID");
    expect(workflow).not.toContain("AWS_SECRET_ACCESS_KEY");
  });

  it("verifies the repository before deploying both disabled-schedule stacks", () => {
    const workflow = readFileSync(workflowPath, "utf8");

    expect(workflow).toContain("run: pnpm test");
    expect(workflow).toContain("run: pnpm typecheck");
    expect(workflow).toContain("run: pnpm build");
    expect(workflow).toContain("cdk deploy --all");
    expect(workflow).toContain("-c scheduleEnabled=false");
    expect(workflow).toContain("--require-approval never");
  });
});
