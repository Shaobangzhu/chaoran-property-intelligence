import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("web document security policy", () => {
  it("ships a restrictive CSP that permits only the selected map service", async () => {
    const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

    expect(html).toContain('http-equiv="Content-Security-Policy"');
    expect(html).toContain("default-src 'self'");
    expect(html).toContain(
      "connect-src 'self' https://tiles.openfreemap.org",
    );
    expect(html).toContain("object-src 'none'");
    expect(html).toContain("base-uri 'none'");
    expect(html).not.toContain("script-src 'unsafe-inline'");
    expect(html).not.toContain("script-src 'unsafe-eval'");
  });
});
