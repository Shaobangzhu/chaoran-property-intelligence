import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const dockerfilePath = fileURLToPath(
  new URL("../../../Dockerfile", import.meta.url),
);
const dockerignorePath = fileURLToPath(
  new URL("../../../.dockerignore", import.meta.url),
);
const apiDockerfilePath = fileURLToPath(
  new URL("../../../Dockerfile.api", import.meta.url),
);

describe("production runtime image", () => {
  it("makes the RDS CA bundle readable by the non-root runtime user", () => {
    const dockerfile = readFileSync(dockerfilePath, "utf8");

    expect(dockerfile).toContain("RUN install -d -m 0755 /app/certs");
    expect(dockerfile).toContain(
      "COPY --from=rds-certificate --chmod=0444 /global-bundle.pem /app/certs/global-bundle.pem",
    );
    expect(dockerfile).toContain("USER node");
  });

  it("builds a dedicated non-root API image with the RDS trust bundle", () => {
    const dockerfile = readFileSync(apiDockerfilePath, "utf8");

    expect(dockerfile).toContain("RUN pnpm build:api");
    expect(dockerfile).toContain(
      "--filter @chaoran-property-intelligence/api",
    );
    expect(dockerfile).toContain(
      "COPY --from=rds-certificate --chmod=0444 /global-bundle.pem /app/certs/global-bundle.pem",
    );
    expect(dockerfile).toContain("USER node");
    expect(dockerfile).toContain(
      'CMD ["node", "apps/api/dist/server.js"]',
    );
    expect(dockerfile).not.toContain("alert-worker");
  });

  it("builds only the alert worker runtime", () => {
    const dockerfile = readFileSync(dockerfilePath, "utf8");

    expect(dockerfile).toContain("RUN pnpm build:alert-worker");
    expect(dockerfile).not.toContain("RUN pnpm build:runtime");
    expect(dockerfile).not.toContain("COPY apps/api");
    expect(dockerfile).not.toContain("COPY apps/web");
    expect(dockerfile).toContain(
      "COPY packages/openai/package.json packages/openai/package.json",
    );
    expect(dockerfile).toContain(
      "COPY packages/pdf/package.json packages/pdf/package.json",
    );
    expect(dockerfile).toContain(
      "COPY packages/s3/package.json packages/s3/package.json",
    );
  });

  it("excludes local quality artifacts from the deployable image context", () => {
    const dockerignore = readFileSync(dockerignorePath, "utf8");

    expect(dockerignore).toContain("allure-report");
    expect(dockerignore).toContain("allure-results");
    expect(dockerignore).toContain("playwright-report");
    expect(dockerignore).toContain("test-results");
  });
});
