import { describe, expect, it } from "vitest";

import {
  createQualityGatePlan,
  formatPlanMarkdown,
} from "./qualityGatePlan.mjs";

describe("quality gate plan", () => {
  it("treats documentation-only changes as an intentional skip", () => {
    expect(createQualityGatePlan(["docs/testing/test-framework.md"])).toMatchObject({
      backend: false,
      docsOnly: true,
      frontend: false,
      full: false,
      infra: false,
      integration: false,
      system: false,
      typecheckBuild: false,
    });
  });

  it("runs web and system coverage for frontend changes", () => {
    expect(createQualityGatePlan(["apps/web/src/App.tsx"])).toMatchObject({
      backend: false,
      docsOnly: false,
      frontend: true,
      full: false,
      infra: false,
      integration: false,
      system: true,
      typecheckBuild: true,
    });
  });

  it("runs API, integration, system, and build coverage for API changes", () => {
    expect(createQualityGatePlan(["apps/api/src/createApp.ts"])).toMatchObject({
      backend: true,
      docsOnly: false,
      frontend: false,
      full: false,
      infra: false,
      integration: true,
      system: true,
      typecheckBuild: true,
    });
  });

  it("falls back to the full gate for shared domain changes", () => {
    expect(createQualityGatePlan(["packages/domain/src/listingFilter.ts"])).toMatchObject({
      backend: true,
      docsOnly: false,
      frontend: true,
      full: true,
      infra: true,
      integration: true,
      system: true,
      typecheckBuild: true,
    });
  });

  it("falls back to the full gate for workflow and lockfile changes", () => {
    expect(
      createQualityGatePlan([".github/workflows/ci.yml", "pnpm-lock.yaml"]),
    ).toMatchObject({
      backend: true,
      docsOnly: false,
      frontend: true,
      full: true,
      infra: true,
      integration: true,
      system: true,
      typecheckBuild: true,
    });
  });

  it("runs infrastructure coverage without browser smoke for CDK changes", () => {
    expect(createQualityGatePlan(["infra/aws/lib/propertyAlertStack.ts"])).toMatchObject({
      backend: true,
      docsOnly: false,
      frontend: false,
      full: false,
      infra: true,
      integration: true,
      system: false,
      typecheckBuild: true,
    });
  });

  it("falls back to the full gate when no changed files are detected", () => {
    expect(createQualityGatePlan([])).toMatchObject({
      backend: true,
      docsOnly: false,
      frontend: true,
      full: true,
      infra: true,
      integration: true,
      system: true,
      typecheckBuild: true,
    });
  });

  it("formats a bounded Markdown summary", () => {
    const plan = createQualityGatePlan(["apps/web/src/App.tsx"]);

    expect(formatPlanMarkdown(plan, ["apps/web/src/App.tsx"])).toContain(
      "Selected suites: frontend, system, typecheckBuild",
    );
  });
});
