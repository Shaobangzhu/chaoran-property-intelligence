import { describe, expect, it } from "vitest";

import {
  assertReleaseClassification,
  classifyReleaseChanges,
  formatReleaseClassificationMarkdown,
} from "./classifyReleaseChanges.mjs";

describe("release change classification", () => {
  it("routes application changes to the exact DEV release gate", () => {
    expect(
      classifyReleaseChanges([
        "apps/api/src/createApp.ts",
        "packages/postgres/migrations/0008_listing_retention.sql",
        "infra/aws/lib/publicApplicationStack.ts",
        ".github/workflows/deploy-dev.yml",
      ]),
    ).toEqual({
      applicationRequired: true,
      platformRequired: false,
      documentationOnly: false,
      applicationFiles: [
        ".github/workflows/deploy-dev.yml",
        "apps/api/src/createApp.ts",
        "infra/aws/lib/publicApplicationStack.ts",
        "packages/postgres/migrations/0008_listing_retention.sql",
      ],
      platformFiles: [],
      nonDeployableFiles: [],
      unclassifiedFiles: [],
    });
  });

  it("routes Guardrails and release-policy changes to the platform gate", () => {
    expect(
      classifyReleaseChanges([
        "infra/aws/lib/accountGuardrailsStack.ts",
        ".github/workflows/deploy-account-guardrails.yml",
        ".github/workflows/release-quality-gate.yml",
        "infra/aws/bin/guardrails.ts",
        "infra/aws/lib/accountGuardrailsApplication.ts",
        "tools/aws/createDeploymentApproval.mjs",
        "tools/release/classifyReleaseChanges.mjs",
      ]),
    ).toMatchObject({
      applicationRequired: false,
      platformRequired: true,
      documentationOnly: false,
      platformFiles: [
        ".github/workflows/deploy-account-guardrails.yml",
        ".github/workflows/release-quality-gate.yml",
        "infra/aws/bin/guardrails.ts",
        "infra/aws/lib/accountGuardrailsApplication.ts",
        "infra/aws/lib/accountGuardrailsStack.ts",
        "tools/aws/createDeploymentApproval.mjs",
        "tools/release/classifyReleaseChanges.mjs",
      ],
      unclassifiedFiles: [],
    });
  });

  it("marks shared delivery files as application and platform changes", () => {
    const classification = classifyReleaseChanges([
      ".github/workflows/deploy-production.yml",
      "infra/aws/bin/app.ts",
      "infra/aws/lib/deploymentStage.ts",
      "infra/aws/package.json",
      "pnpm-lock.yaml",
    ]);

    expect(classification).toMatchObject({
      applicationRequired: true,
      platformRequired: true,
      applicationFiles: [
        ".github/workflows/deploy-production.yml",
        "infra/aws/bin/app.ts",
        "infra/aws/lib/deploymentStage.ts",
        "infra/aws/package.json",
        "pnpm-lock.yaml",
      ],
      platformFiles: [
        ".github/workflows/deploy-production.yml",
        "infra/aws/bin/app.ts",
        "infra/aws/lib/deploymentStage.ts",
        "infra/aws/package.json",
        "pnpm-lock.yaml",
      ],
      unclassifiedFiles: [],
    });
  });

  it("keeps documentation, tests, snapshots, and fixtures non-deployable", () => {
    const classification = classifyReleaseChanges([
      "README.md",
      "apps/api/src/createApp.test.ts",
      "docs/runbooks/release-production-delivery.md",
      "infra/aws/test/accountGuardrailsStack.test.ts",
      "packages/domain/src/__snapshots__/listing.snap",
      "tools/wildfire-hazard/fixtures/response.json",
    ]);

    expect(classification).toMatchObject({
      applicationRequired: false,
      platformRequired: false,
      documentationOnly: true,
      nonDeployableFiles: [
        "README.md",
        "apps/api/src/createApp.test.ts",
        "docs/runbooks/release-production-delivery.md",
        "infra/aws/test/accountGuardrailsStack.test.ts",
        "packages/domain/src/__snapshots__/listing.snap",
        "tools/wildfire-hazard/fixtures/response.json",
      ],
      unclassifiedFiles: [],
    });
  });

  it("normalizes and de-duplicates changed paths", () => {
    const classification = classifyReleaseChanges([
      "./apps/web/src/App.tsx",
      "apps\\web\\src\\App.tsx",
      " docs/runbook.md ",
      "",
    ]);

    expect(classification.applicationFiles).toEqual(["apps/web/src/App.tsx"]);
    expect(classification.nonDeployableFiles).toEqual(["docs/runbook.md"]);
  });

  it("fails closed for unknown and empty change sets", () => {
    const unknown = classifyReleaseChanges(["CODEOWNERS"]);

    expect(unknown).toMatchObject({
      applicationRequired: false,
      platformRequired: false,
      documentationOnly: false,
      unclassifiedFiles: ["CODEOWNERS"],
    });
    expect(() => assertReleaseClassification(unknown)).toThrow(
      "failed closed for unclassified files: CODEOWNERS",
    );

    const empty = classifyReleaseChanges([]);
    expect(empty.documentationOnly).toBe(false);
    expect(() => assertReleaseClassification(empty)).toThrow(
      "no changed files were detected",
    );
  });

  it("handles delete and rename paths conservatively when Git supplies both paths", () => {
    const classification = classifyReleaseChanges([
      "apps/api/src/oldName.ts",
      "docs/new-name.md",
    ]);

    expect(classification).toMatchObject({
      applicationRequired: true,
      documentationOnly: false,
      applicationFiles: ["apps/api/src/oldName.ts"],
      nonDeployableFiles: ["docs/new-name.md"],
    });
  });

  it("formats auditable classification evidence", () => {
    const classification = classifyReleaseChanges([
      "apps/web/src/App.tsx",
      "infra/aws/lib/accountGuardrailsStack.ts",
      "docs/runbook.md",
    ]);
    const markdown = formatReleaseClassificationMarkdown(classification);

    expect(markdown).toContain("Classification valid: yes");
    expect(markdown).toContain("Application gate required: yes");
    expect(markdown).toContain("Platform gate required: yes");
    expect(markdown).toContain("`docs/runbook.md`");
  });
});
