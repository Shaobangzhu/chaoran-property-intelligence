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
      "@chaoran-property-intelligence/postgres": new URL(
        "./packages/postgres/src/index.ts",
        import.meta.url,
      ).pathname,
      "@chaoran-property-intelligence/rentcast": new URL(
        "./packages/rentcast/src/index.ts",
        import.meta.url,
      ).pathname,
      "@chaoran-property-intelligence/telegram": new URL(
        "./packages/telegram/src/index.ts",
        import.meta.url,
      ).pathname,
    },
  },
});
