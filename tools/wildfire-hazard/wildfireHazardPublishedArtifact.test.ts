import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const artifactUrl = new URL(
  "../../apps/web/public/data/wildfire-hazard/fhsz-five-cities-2025.1.geojson",
  import.meta.url,
);
const manifestUrl = new URL(
  "../../apps/web/public/data/wildfire-hazard/manifest.json",
  import.meta.url,
);
const artifactText = readFileSync(artifactUrl, "utf8");
const artifact = JSON.parse(artifactText);
const manifest = JSON.parse(readFileSync(manifestUrl, "utf8"));
const expectedArtifactSha256 =
  "d02baebe5e5b1ddaab3b81c0fcff4e973c3cd363b645432712e9609d15e1863f";

describe("published wildfire hazard artifact", () => {
  it("matches its committed provenance and budget contract", () => {
    const sha256 = createHash("sha256").update(artifactText).digest("hex");

    expect(sha256).toBe(expectedArtifactSha256);
    expect(sha256).toBe(manifest.artifact.sha256);
    expect(Buffer.byteLength(artifactText)).toBe(manifest.artifact.bytes);
    expect(artifact.features).toHaveLength(manifest.artifact.featureCount);
    expect(manifest.artifact).toMatchObject({
      version: "2025.1",
      sha256: expectedArtifactSha256,
      bytes: 933_093,
      gzipBytes: 234_976,
      featureCount: 85,
      severityCounts: {
        moderate: 28,
        high: 27,
        "very-high": 30,
      },
      responsibilityAreaCounts: {
        sra: 18,
        lra: 67,
      },
    });
    expect(manifest.quality).toMatchObject({
      clippedInvalidGeometryCount: 1,
      repairedInvalidGeometryCount: 0,
      invalidGeometryCount: 0,
      excludedNonWildlandFeatureCount: 8,
      inputEligibleFeatureCount: 85,
      outputFeatureCount: 85,
      removedZeroAreaNonPolygonComponentCount: 1,
    });
    expect(manifest.quality.budgets.actualRawBytes).toBeLessThanOrEqual(
      manifest.quality.budgets.maximumRawBytes,
    );
    expect(manifest.quality.budgets.actualGzipBytes).toBeLessThanOrEqual(
      manifest.quality.budgets.maximumGzipBytes,
    );
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

  it("keeps the reviewed jurisdiction designation boundary explicit", () => {
    expect(
      Object.fromEntries(
        manifest.targetJurisdictions.map(
          (jurisdiction: {
            name: string;
            lraDesignationStatus: string;
          }) => [jurisdiction.name, jurisdiction.lraDesignationStatus],
        ),
      ),
    ).toEqual({
      Chino: "locally-adopted",
      "Chino Hills": "locally-adopted",
      Corona: "locally-adopted",
      Eastvale: "recommended",
      "Jurupa Valley": "locally-adopted",
    });
  });
});
