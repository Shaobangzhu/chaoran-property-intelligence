import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const workflowPath = fileURLToPath(
  new URL("../../../.github/workflows/deploy-dev.yml", import.meta.url),
);

function extractLiteralRunScripts(workflow: string) {
  const lines = workflow.split("\n");
  const scripts: Array<{ name: string; script: string }> = [];

  for (let index = 0; index < lines.length; index += 1) {
    const runMatch = /^(\s*)run:\s*\|-\s*$/u.exec(lines[index] ?? "");
    if (!runMatch) {
      continue;
    }

    const runIndent = runMatch[1]?.length ?? 0;
    const scriptIndent = runIndent + 2;
    const scriptLines: string[] = [];

    for (index += 1; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      const indentation = /^\s*/u.exec(line)?.[0].length ?? 0;
      if (line.length > 0 && indentation <= runIndent) {
        index -= 1;
        break;
      }
      scriptLines.push(line.slice(Math.min(scriptIndent, line.length)));
    }

    const precedingLines = lines.slice(0, index - scriptLines.length);
    const name = [...precedingLines]
      .reverse()
      .find((line) => /^\s*- name:\s+/u.test(line))
      ?.replace(/^\s*- name:\s+/u, "") ?? "unnamed run step";
    scripts.push({ name, script: scriptLines.join("\n") });
  }

  return scripts;
}

describe("DEV deployment workflow", () => {
  it("runs only after a push to dev or a dev-scoped manual dispatch", () => {
    const workflow = readFileSync(workflowPath, "utf8");

    expect(workflow).toContain("- dev");
    expect(workflow).toMatch(/^  push:$/mu);
    expect(workflow).not.toContain("pull_request:");
    expect(workflow).toContain("github.event_name == 'push'");
    expect(workflow).toContain("github.ref == 'refs/heads/dev'");
    expect(workflow).toContain("github.event_name == 'workflow_dispatch'");
    expect(workflow.match(/ref: \$\{\{ github\.sha \}\}/gu)).toHaveLength(3);
  });

  it("classifies deployment impact before requesting AWS approval", () => {
    const workflow = readFileSync(workflowPath, "utf8");

    expect(workflow).toContain("Classify DEV deployment impact");
    expect(workflow).toContain("tools/release/deploymentImpact.mjs");
    expect(workflow).toContain("${{ github.event.before }}");
    expect(workflow).toContain("--force-deploy");
    expect(workflow).toContain(
      'test "$GITHUB_REF" = "refs/heads/dev"',
    );
    expect(workflow).toContain('[[ "$base_sha" =~ ^0+$ ]]');
    expect(workflow).toContain(
      "needs.classify.outputs.deploy_required == 'true'",
    );
    expect(workflow).toContain("Record intentional DEV deployment skip");
    expect(workflow).toContain(
      "No AWS credentials, environment approval, CDK plan, migration, or deployment was requested.",
    );
  });

  it("keeps every literal shell run block syntactically valid", () => {
    const workflow = readFileSync(workflowPath, "utf8");
    const scripts = extractLiteralRunScripts(workflow);

    expect(scripts.length).toBeGreaterThan(0);
    for (const { name, script } of scripts) {
      const result = spawnSync("bash", ["-n"], {
        encoding: "utf8",
        input: script,
      });

      expect(result.stderr, `${name} contains invalid Bash`).toBe("");
      expect(result.status, `${name} contains invalid Bash`).toBe(0);
    }
  });

  it("places plan and deploy behind separate environment jobs", () => {
    const workflow = readFileSync(workflowPath, "utf8");

    expect(workflow.match(/name: development/gu)).toHaveLength(2);
    expect(workflow).toContain(
      "Plan DEV deployment (approval 1; no migration)",
    );
    expect(workflow).toContain(
      "Deploy DEV (approval 2; API startup migrates DEV)",
    );
    expect(workflow).toContain("needs.verify.result == 'success'");
    expect(workflow).toContain("needs.plan.result == 'success'");
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
    expect(workflow).toContain("deployment-plan/run-context.md");
    expect(workflow).toContain("if-no-files-found: warn");
  });

  it("deploys only explicit DEV stacks with both schedules disabled", () => {
    const workflow = readFileSync(workflowPath, "utf8");

    expect(workflow).toContain("ChaoranPropertyIntelligenceDevEdge");
    expect(workflow).toContain(
      "ChaoranPropertyIntelligenceDevPublicApplication",
    );
    expect(workflow).toContain("-c targetStage=dev");
    expect(workflow).toContain('-c releaseSha="$GITHUB_SHA"');
    expect(workflow).toContain("-c scheduleEnabled=false");
    expect(workflow).toContain("-c showingListScheduleEnabled=false");
    expect(workflow.match(/--exclusively/gu)).toHaveLength(2);
    expect(workflow).not.toContain(
      "cdk deploy \\\n+            ChaoranPropertyIntelligenceGuardrails",
    );
    expect(workflow).not.toContain("ChaoranPropertyIntelligenceProduction");
  });

  it("publishes web content then runs bounded read-only smoke with evidence", () => {
    const workflow = readFileSync(workflowPath, "utf8");

    expect(workflow).toContain("aws s3 sync");
    expect(workflow).toContain("--cache-control no-store");
    expect(workflow).toContain("cloudfront wait invalidation-completed");
    expect(workflow).toContain("tools/aws/waitForHttp.mjs");
    expect(workflow).toContain("CPI_PLAYWRIGHT_REMOTE_BASE_URL");
    expect(workflow).toContain("createReleaseManifest.mjs");
    expect(workflow).toContain("CPI_EXPECTED_RELEASE_SHA=$GITHUB_SHA");
    expect(workflow).toContain("CPI_EXPECTED_DEPLOYMENT_STAGE=dev");
    expect(workflow).toContain("pnpm exec playwright test --grep @smoke");
    expect(workflow).toContain("list-object-versions");
    expect(workflow).toContain("aws sns publish");
    expect(workflow).not.toMatch(/\bsleep\b/u);
  });

  it("keeps AWS CLI JMESPath expressions protected from shell parsing", () => {
    const workflow = readFileSync(workflowPath, "utf8");

    expect(workflow).not.toContain('--query \\"');
    expect(
      workflow.match(
        /--query 'ServiceSummaryList\[\?ServiceName==`cpi-dev-api`\]\.ServiceArn \| \[0\]'/gu,
      ),
    ).toHaveLength(2);
    expect(workflow).toContain(
      "--query 'Stacks[0].Outputs[?OutputKey==`DeploymentFailureTopicArn`].OutputValue | [0]'",
    );
  });
});
