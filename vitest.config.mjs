import { configDefaults, defineConfig } from "vitest/config";
import * as os from "node:os";

const allureEnvironmentInfo = {
  ci: process.env.CI === "true" ? "true" : "false",
  git_ref: process.env.GITHUB_REF_NAME ?? process.env.GITHUB_REF ?? "local",
  git_sha: process.env.GITHUB_SHA ?? "local",
  node_version: process.version,
  os_platform: os.platform(),
  os_release: os.release(),
  test_framework: "vitest",
};

export default defineConfig({
  resolve: {
    alias: {
      "@chaoran-property-intelligence/auth": new URL(
        "./packages/auth/src/index.ts",
        import.meta.url,
      ).pathname,
      "@chaoran-property-intelligence/application": new URL(
        "./packages/application/src/index.ts",
        import.meta.url,
      ).pathname,
      "@chaoran-property-intelligence/domain": new URL(
        "./packages/domain/src/index.ts",
        import.meta.url,
      ).pathname,
      "@chaoran-property-intelligence/openai": new URL(
        "./packages/openai/src/index.ts",
        import.meta.url,
      ).pathname,
      "@chaoran-property-intelligence/pdf": new URL(
        "./packages/pdf/src/index.ts",
        import.meta.url,
      ).pathname,
      "@chaoran-property-intelligence/postgres": new URL(
        "./packages/postgres/src/index.ts",
        import.meta.url,
      ).pathname,
      "@chaoran-property-intelligence/rentcast": new URL(
        "./packages/rentcast/src/index.ts",
        import.meta.url,
      ).pathname,
      "@chaoran-property-intelligence/s3": new URL(
        "./packages/s3/src/index.ts",
        import.meta.url,
      ).pathname,
      "@chaoran-property-intelligence/telegram": new URL(
        "./packages/telegram/src/index.ts",
        import.meta.url,
      ).pathname,
    },
  },
  test: {
    exclude: [...configDefaults.exclude, "infra/aws/cdk.out/**"],
    reporters: [
      "default",
      [
        "allure-vitest/reporter",
        {
          environmentInfo: allureEnvironmentInfo,
          resultsDir: "allure-results",
        },
      ],
    ],
    setupFiles: ["allure-vitest/setup"],
  },
});
