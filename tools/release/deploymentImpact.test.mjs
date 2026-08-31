import { describe, expect, it } from "vitest";

import {
  createDeploymentImpact,
  formatDeploymentImpactMarkdown,
} from "./deploymentImpact.mjs";

describe("deployment impact", () => {
  it("skips AWS deployment for documentation-only changes", () => {
    expect(
      createDeploymentImpact([
        "docs/operations/block-29-4-dev-public-acceptance.md",
        "README.md",
      ]),
    ).toMatchObject({
      deployableFiles: [],
      deployRequired: false,
      skippedFiles: [
        "README.md",
        "docs/operations/block-29-4-dev-public-acceptance.md",
      ],
    });
  });

  it("skips AWS deployment for test-only changes", () => {
    expect(
      createDeploymentImpact([
        "apps/api/src/createApp.test.ts",
        "infra/aws/test/devDeploymentWorkflow.test.ts",
        "tests/api/smoke.playwright.ts",
        "tools/release/deploymentImpact.spec.mjs",
      ]),
    ).toMatchObject({
      deployableFiles: [],
      deployRequired: false,
    });
  });

  it("requires deployment for runtime and infrastructure changes", () => {
    expect(
      createDeploymentImpact([
        "apps/web/src/App.tsx",
        "infra/aws/lib/publicApplicationStack.ts",
      ]),
    ).toMatchObject({
      deployRequired: true,
      deployableFiles: [
        "apps/web/src/App.tsx",
        "infra/aws/lib/publicApplicationStack.ts",
      ],
    });
  });

  it("uses a deployment for unknown paths and an empty push diff", () => {
    expect(createDeploymentImpact(["custom.config.mjs"]).deployRequired).toBe(
      true,
    );
    expect(createDeploymentImpact([]).deployRequired).toBe(true);
  });

  it("forces manual dispatches through the reviewed deployment path", () => {
    expect(
      createDeploymentImpact(["docs/runbook.md"], { forceDeploy: true }),
    ).toMatchObject({
      deployRequired: true,
      forced: true,
    });
  });

  it("can evaluate an empty deployed-to-candidate range without forcing", () => {
    expect(
      createDeploymentImpact([], { emptyMeansDeploy: false }),
    ).toMatchObject({
      deployRequired: false,
    });
  });

  it("formats auditable deployment evidence", () => {
    const markdown = formatDeploymentImpactMarkdown(
      createDeploymentImpact(["docs/runbook.md"]),
    );

    expect(markdown).toContain("Deployment required: no");
    expect(markdown).toContain("all changed files are explicitly non-deployable");
    expect(markdown).toContain("`docs/runbook.md`");
  });
});

