import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const artifactUrl = new URL(
  "../../apps/web/public/data/wildfire-hazard/fhsz-supported-markets-2025.1-r3.geojson",
  import.meta.url,
);
const rollbackArtifactUrl = new URL(
  "../../apps/web/public/data/wildfire-hazard/fhsz-supported-markets-2025.1-r2.geojson",
  import.meta.url,
);
const manifestUrl = new URL(
  "../../apps/web/public/data/wildfire-hazard/manifest.json",
  import.meta.url,
);
const artifactText = readFileSync(artifactUrl, "utf8");
const artifact = JSON.parse(artifactText);
const manifestText = readFileSync(manifestUrl, "utf8");
const manifest = JSON.parse(manifestText);
const expectedArtifactSha256 =
  "766a643e69b99c3d1e6442c94f2480a97c19a116fdb8b06c757045043fdf6427";
const expectedManifestSha256 =
  "f521440a4f632e9b14b931bf145fab9b257843086db63495be538794d4f536f3";
const expectedRollbackArtifactSha256 =
  "7d8486b94ef6802ab5866d17b0a591634dfe3e16843ef58a21143a43df5e09fd";

describe("published wildfire hazard artifact", () => {
  it("matches its committed provenance and budget contract", () => {
    const sha256 = createHash("sha256").update(artifactText).digest("hex");
    const manifestSha256 = createHash("sha256")
      .update(manifestText)
      .digest("hex");

    expect(sha256).toBe(expectedArtifactSha256);
    expect(manifestSha256).toBe(expectedManifestSha256);
    expect(sha256).toBe(manifest.artifact.sha256);
    expect(Buffer.byteLength(artifactText)).toBe(manifest.artifact.bytes);
    expect(artifact.features).toHaveLength(manifest.artifact.featureCount);
    expect(manifest.artifact).toMatchObject({
      fileName: "fhsz-supported-markets-2025.1-r3.geojson",
      version: "2025.1",
      sha256: expectedArtifactSha256,
      bytes: 1_374_114,
      gzipBytes: 354_030,
      featureCount: 110,
      coordinateCount: 52_460,
      bounds: [-118.622305, 33.5993963, -117.3673113, 34.417989],
      severityCounts: {
        moderate: 33,
        high: 38,
        "very-high": 39,
      },
      responsibilityAreaCounts: {
        sra: 27,
        lra: 83,
      },
      designationStatusCounts: {
        effective: 27,
        recommended: 11,
        "locally-adopted": 72,
      },
    });
    expect(manifest.quality).toMatchObject({
      clippedInvalidGeometryCount: 1,
      repairedInvalidGeometryCount: 0,
      invalidGeometryCount: 0,
      excludedNonWildlandFeatureCount: 11,
      inputEligibleFeatureCount: 110,
      outputFeatureCount: 110,
      removedZeroAreaNonPolygonComponentCount: 1,
    });
    expect(manifest.quality.budgets.actualRawBytes).toBeLessThanOrEqual(
      manifest.quality.budgets.maximumRawBytes,
    );
    expect(manifest.quality.budgets.actualGzipBytes).toBeLessThanOrEqual(
      manifest.quality.budgets.maximumGzipBytes,
    );
    expect(
      createHash("sha256")
        .update(readFileSync(rollbackArtifactUrl, "utf8"))
        .digest("hex"),
    ).toBe(expectedRollbackArtifactSha256);
  });

  it("contains only the minimal accepted browser geometry and properties", () => {
    for (const feature of artifact.features) {
      expect(feature.type).toBe("Feature");
      expect(["Polygon", "MultiPolygon"]).toContain(feature.geometry.type);
      expect(Object.keys(feature.properties).sort()).toEqual([
        "designationStatus",
        "responsibilityArea",
        "severity",
        "sourceVersion",
      ]);
      expect(["moderate", "high", "very-high"]).toContain(
        feature.properties.severity,
      );
    }
  });

  it("keeps all seven reviewed coverage targets and their designation evidence explicit", () => {
    expect(manifest.schemaVersion).toBe(2);
    expect(manifest.coverageTargets).toHaveLength(7);
    expect(
      Object.fromEntries(
        manifest.coverageTargets.map(
          (target: {
            id: string;
            lraDesignationStatus: string;
          }) => [target.id, target.lraDesignationStatus],
        ),
      ),
    ).toEqual({
      chino: "locally-adopted",
      "chino-hills": "locally-adopted",
      corona: "locally-adopted",
      eastvale: "recommended",
      "jurupa-valley": "locally-adopted",
      "stevenson-ranch-91381": "locally-adopted",
      irvine: "locally-adopted",
    });

    expect(manifest.coverageTargets.at(-2)).toEqual({
      id: "stevenson-ranch-91381",
      label: "Stevenson Ranch",
      kind: "market-context",
      boundarySourceId: "census-stevenson-ranch-cdp",
      lraDesignationStatus: "locally-adopted",
      evidenceId: "los-angeles-county-ordinance-2025-0027",
      coverageDisclosure:
        "The ACS 2025 Stevenson Ranch CDP is a statistical product coverage boundary. Its clip edge is not an official CAL FIRE severity transition, city limit, postal boundary, or parcel determination.",
      productSelector: { kind: "zip", value: "91381" },
    });
    expect(manifest.coverageTargets.at(-1)).toEqual({
      id: "irvine",
      label: "Irvine",
      kind: "incorporated-jurisdiction",
      boundarySourceId: "irvine-city-boundary",
      lraDesignationStatus: "locally-adopted",
      evidenceId: "irvine-ordinance-25-19",
      coverageDisclosure:
        "Official incorporated-city boundary supplied by California Incorporated Cities.",
    });
    expect(
      manifest.coverageTargets.every(
        (target: Record<string, unknown>) => !("boundarySelector" in target),
      ),
    ).toBe(true);

    expect(manifest.sources).toContainEqual(
      expect.objectContaining({
        id: "census-stevenson-ranch-cdp",
        version: "ACS 2025 PLACE 0674130",
        sha256:
          "2405aaedb264e5854c933f6e461aa3bf6b5e9109f73d6baba0fa65baf47292cf",
        bytes: 24_175,
      }),
    );
    expect(manifest.sources).toContainEqual(
      expect.objectContaining({
        id: "irvine-city-boundary",
        version: "audited 2026-08-25; topologically equal to 24_1",
        sha256:
          "368205802647ca6d9c476682edf8425a9ef781ffda7c4e171697a67920ec8b23",
        bytes: 39_079,
      }),
    );
    expect(manifest.quality.byCoverageTarget["stevenson-ranch-91381"]).toEqual({
      label: "Stevenson Ranch",
      inputEligibleFeatureCount: 11,
      inputAreaSquareMeters: 15_476_630.378,
      invalidGeometryCount: 0,
      bySeverity: {
        high: {
          featureCount: 7,
          areaSquareMeters: 1_224_243.512,
          invalidGeometryCount: 0,
        },
        moderate: {
          featureCount: 1,
          areaSquareMeters: 834_439.336,
          invalidGeometryCount: 0,
        },
        "very-high": {
          featureCount: 3,
          areaSquareMeters: 13_417_947.53,
          invalidGeometryCount: 0,
        },
      },
    });
    expect(manifest.quality.byCoverageTarget.irvine).toEqual({
      label: "Irvine",
      inputEligibleFeatureCount: 14,
      inputAreaSquareMeters: 65_514_371.608,
      invalidGeometryCount: 0,
      bySeverity: {
        high: {
          featureCount: 4,
          areaSquareMeters: 17_279_370.955,
          invalidGeometryCount: 0,
        },
        moderate: {
          featureCount: 4,
          areaSquareMeters: 5_637_434.955,
          invalidGeometryCount: 0,
        },
        "very-high": {
          featureCount: 6,
          areaSquareMeters: 42_597_565.698,
          invalidGeometryCount: 0,
        },
      },
    });
  });

  it("keeps every incorporated market on official city geometry with non-empty hazard coverage", () => {
    const expectedTargets = {
      chino: {
        boundarySourceId: "city-boundaries",
        evidenceId: "chino-valley-ordinance-2025-01",
        label: "Chino",
        lraDesignationStatus: "locally-adopted",
      },
      "chino-hills": {
        boundarySourceId: "city-boundaries",
        evidenceId: "chino-valley-ordinance-2025-01",
        label: "Chino Hills",
        lraDesignationStatus: "locally-adopted",
      },
      corona: {
        boundarySourceId: "city-boundaries",
        evidenceId: "corona-ordinance-3418",
        label: "Corona",
        lraDesignationStatus: "locally-adopted",
      },
      eastvale: {
        boundarySourceId: "city-boundaries",
        evidenceId: "eastvale-proposal-review",
        label: "Eastvale",
        lraDesignationStatus: "recommended",
      },
      "jurupa-valley": {
        boundarySourceId: "city-boundaries",
        evidenceId: "jurupa-valley-ordinance-2025-13",
        label: "Jurupa Valley",
        lraDesignationStatus: "locally-adopted",
      },
      irvine: {
        boundarySourceId: "irvine-city-boundary",
        evidenceId: "irvine-ordinance-25-19",
        label: "Irvine",
        lraDesignationStatus: "locally-adopted",
      },
    } as const;

    const incorporatedTargets = Object.fromEntries(
      manifest.coverageTargets
        .filter(
          (target: { kind: string }) =>
            target.kind === "incorporated-jurisdiction",
        )
        .map((target: { id: string }) => [target.id, target]),
    );

    expect(Object.keys(incorporatedTargets).sort()).toEqual(
      Object.keys(expectedTargets).sort(),
    );
    for (const [id, expected] of Object.entries(expectedTargets)) {
      expect(incorporatedTargets[id]).toMatchObject({
        ...expected,
        kind: "incorporated-jurisdiction",
      });
      expect(incorporatedTargets[id]).not.toHaveProperty("productSelector");
      expect(manifest.quality.byCoverageTarget[id]).toMatchObject({
        label: expected.label,
        invalidGeometryCount: 0,
      });
      expect(
        manifest.quality.byCoverageTarget[id].inputEligibleFeatureCount,
      ).toBeGreaterThan(0);
      expect(
        manifest.quality.byCoverageTarget[id].inputAreaSquareMeters,
      ).toBeGreaterThan(0);
    }
  });
});
