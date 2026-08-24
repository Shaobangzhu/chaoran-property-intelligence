import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("web document security policy", () => {
  it("ships a restrictive CSP for the ArcGIS map runtime", async () => {
    const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

    expect(html).toContain('http-equiv="Content-Security-Policy"');
    expect(html).toContain("default-src 'self'");
    expect(html).not.toContain("tiles.openfreemap.org");
    expect(html).toContain(
      "connect-src 'self' blob: https://basemapstyles-api.arcgis.com https://basemaps-api.arcgis.com https://cdn.arcgis.com https://js.arcgis.com https://static.arcgis.com",
    );
    expect(html).not.toContain("https://*.arcgis.com");
    expect(html).toContain(
      "img-src 'self' data: blob: https://cdn.arcgis.com",
    );
    expect(html).toContain(
      "script-src 'self' 'wasm-unsafe-eval' https://js.arcgis.com",
    );
    expect(html).toContain("object-src 'none'");
    expect(html).toContain("base-uri 'none'");
    expect(html).not.toContain("script-src 'unsafe-inline'");
    expect(html).not.toContain("script-src 'unsafe-eval'");
  });
});
