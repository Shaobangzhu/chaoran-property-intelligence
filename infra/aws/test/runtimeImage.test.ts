import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const dockerfilePath = fileURLToPath(
  new URL("../../../Dockerfile", import.meta.url),
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
});
