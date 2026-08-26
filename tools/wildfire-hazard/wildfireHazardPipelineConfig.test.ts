import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  createBoundaryClip,
  resolveCoverageTargetBoundary,
  validateBuildConfig,
} from "./pipelineConfig.mjs";

const config = JSON.parse(
  readFileSync(new URL("./config.json", import.meta.url), "utf8"),
);

describe("wildfire hazard pipeline config", () => {
  it("models six jurisdictions and the Stevenson Ranch ZIP market separately", () => {
    expect(() => validateBuildConfig(config)).not.toThrow();
    expect(config.artifact.fileName).toBe(
      "fhsz-supported-markets-2025.1-r3.geojson",
    );
    expect(config.publication).toEqual({
      enabled: true,
      approvedInBlock: "27.6",
    });
    expect(config.coverageTargets).toHaveLength(7);
    expect(config.coverageTargets.at(-2)).toMatchObject({
      id: "stevenson-ranch-91381",
      label: "Stevenson Ranch",
      kind: "market-context",
      boundarySourceId: "census-stevenson-ranch-cdp",
      boundarySelector: { field: "GEOID", equals: "0674130" },
      lraDesignationStatus: "locally-adopted",
      productSelector: { kind: "zip", value: "91381" },
    });
    expect(config.coverageTargets.at(-1)).toMatchObject({
      id: "irvine",
      label: "Irvine",
      kind: "incorporated-jurisdiction",
      boundarySourceId: "irvine-city-boundary",
      boundarySelector: { field: "CITY", equals: "Irvine" },
      lraDesignationStatus: "locally-adopted",
      evidenceId: "irvine-ordinance-25-19",
    });
    expect(config.coverageTargets.at(-1)).not.toHaveProperty("productSelector");
  });

  it("resolves each selector to exactly one feature in its tracked source", () => {
    const { sourcesById } = validateBuildConfig(config);
    for (const target of config.coverageTargets) {
      const source = sourcesById.get(target.boundarySourceId);
      const collection = JSON.parse(
        readFileSync(new URL(`../../${source.trackedPath}`, import.meta.url), "utf8"),
      );
      expect(
        resolveCoverageTargetBoundary(target, source, collection).geometry,
      ).toBeDefined();
    }
  });

  it("pins every tracked boundary source to its reviewed bytes", () => {
    for (const source of config.sources.filter(
      (candidate: { trackedPath?: string }) => candidate.trackedPath !== undefined,
    )) {
      const bytes = readFileSync(
        new URL(`../../${source.trackedPath}`, import.meta.url),
      );
      expect(bytes.byteLength).toBeLessThanOrEqual(source.maximumBytes);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(
        source.sha256,
      );
    }
  });

  it("creates quoted GDAL predicates without accepting raw SQL", () => {
    const target = {
      id: "quoted-value",
      boundarySelector: { field: "NAME", equals: "O'Brien" },
    };
    const source = {
      gdalDataSource: "/work/sources/boundary.geojson",
      gdalLayer: "boundary",
    };

    expect(createBoundaryClip(target, source)).toEqual({
      dataSource: "/work/sources/boundary.geojson",
      layer: "boundary",
      where: `"NAME" = 'O''Brien'`,
    });
    expect(() =>
      createBoundaryClip(
        {
          ...target,
          boundarySelector: { field: "NAME OR 1=1", equals: "x" },
        },
        source,
      ),
    ).toThrow(/Unsafe coverage target quoted-value selector field/);
  });

  it.each([
    [[], 0],
    [[feature("0674130"), feature("0674130")], 2],
  ])("fails closed when the selector does not resolve once", (features, count) => {
    const target = {
      id: "stevenson-ranch-91381",
      label: "Stevenson Ranch",
      boundarySelector: { field: "GEOID", equals: "0674130" },
    };
    const source = { id: "census-stevenson-ranch-cdp" };

    expect(() =>
      resolveCoverageTargetBoundary(target, source, {
        type: "FeatureCollection",
        features,
      }),
    ).toThrow(new RegExp(`received ${count}`));
  });

  it("rejects a selected non-polygon boundary", () => {
    const target = {
      id: "stevenson-ranch-91381",
      label: "Stevenson Ranch",
      boundarySelector: { field: "GEOID", equals: "0674130" },
    };

    expect(() =>
      resolveCoverageTargetBoundary(
        target,
        { id: "census-stevenson-ranch-cdp" },
        {
          type: "FeatureCollection",
          features: [
            {
              ...feature("0674130"),
              geometry: { type: "Point", coordinates: [-118.59, 34.39] },
            },
          ],
        },
      ),
    ).toThrow(/must be a Polygon or MultiPolygon/);
  });

  it("fails closed when target provenance is incomplete", () => {
    const candidate = structuredClone(config);
    candidate.coverageTargets.at(-1)!.evidenceId = "missing-evidence";

    expect(() => validateBuildConfig(candidate)).toThrow(
      /unknown designation evidence missing-evidence/,
    );
  });
});

function feature(geoid: string) {
  return {
    type: "Feature",
    properties: { GEOID: geoid },
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [-118.6, 34.3],
          [-118.5, 34.3],
          [-118.5, 34.4],
          [-118.6, 34.3],
        ],
      ],
    },
  };
}
