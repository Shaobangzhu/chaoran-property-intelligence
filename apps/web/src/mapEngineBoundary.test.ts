import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("production map-engine boundary", () => {
  it("ships ArcGIS as the only web map engine", async () => {
    const [
      manifest,
      main,
      arcgisComponents,
      lazyTerrainScene,
      mapShell,
      styles,
      viteConfig,
      lockfile,
    ] =
      await Promise.all([
        readFile(new URL("../package.json", import.meta.url), "utf8"),
        readFile(new URL("./main.tsx", import.meta.url), "utf8"),
        readFile(new URL("./arcgisComponents.ts", import.meta.url), "utf8"),
        readFile(
          new URL("./lazyArcgisTerrainListingsScene.ts", import.meta.url),
          "utf8",
        ),
        readFile(new URL("./ListingsMap.tsx", import.meta.url), "utf8"),
        readFile(new URL("./styles.css", import.meta.url), "utf8"),
        readFile(new URL("../vite.config.ts", import.meta.url), "utf8"),
        readFile(new URL("../../../pnpm-lock.yaml", import.meta.url), "utf8"),
      ]);

    expect(manifest).not.toContain("maplibre-gl");
    expect(lockfile).not.toContain("maplibre-gl@");
    expect(main).not.toContain("maplibre-gl");
    expect(main).toContain('import "./arcgisComponents.js"');
    expect(main).not.toContain("arcgisTerrainListingsScene");
    expect(arcgisComponents).toContain(
      '@arcgis/map-components/components/arcgis-map',
    );
    expect(arcgisComponents).not.toContain("arcgis-scene");
    expect(lazyTerrainScene).toContain(
      'import("@arcgis/map-components/components/arcgis-scene")',
    );
    expect(lazyTerrainScene).toContain(
      'import("./arcgisTerrainListingsScene.js")',
    );
    expect(mapShell).not.toContain("maplibre-gl");
    expect(mapShell).not.toContain("OpenFreeMap");
    expect(mapShell).toContain("createLazyArcgisTerrainListingsScene");
    expect(mapShell).not.toContain('from "./arcgisTerrainListingsScene.js"');
    expect(styles).not.toContain(".maplibregl-");
    expect(viteConfig).toContain('envDir: "../.."');
  });
});
