import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@chaoran-property-intelligence/application": new URL(
        "./packages/application/src/index.ts",
        import.meta.url,
      ).pathname,
      "@chaoran-property-intelligence/domain": new URL(
        "./packages/domain/src/index.ts",
        import.meta.url,
      ).pathname,
    },
  },
});
