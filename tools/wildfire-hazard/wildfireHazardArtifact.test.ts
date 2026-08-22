import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  buildWildfireHazardArtifact,
  createWildfireHazardManifest,
} from "./artifact.mjs";

const fixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/lra.geojson", import.meta.url),
    "utf8",
  ),
);

const source = {
  responsibilityArea: "lra" as const,
  designationStatus: "locally-adopted" as const,
  sourceVersion: "FHSZLRA25_1",
  jurisdiction: "Corona",
  featureCollection: fixture,
};

describe("buildWildfireHazardArtifact", () => {
  it("normalizes the severity allowlist and preserves polygons, holes, and multipolygons", () => {
    const artifact = buildWildfireHazardArtifact([source]);

    expect(artifact.collection.features).toHaveLength(3);
    expect(artifact.statistics).toMatchObject({
      featureCount: 3,
      excludedNonWildlandCount: 1,
      severityCounts: {
        moderate: 1,
        high: 1,
        "very-high": 1,
      },
    });
    expect(
      artifact.collection.features.map((feature) => feature.properties),
    ).toEqual([
      {
        severity: "moderate",
        responsibilityArea: "lra",
        designationStatus: "locally-adopted",
        sourceVersion: "FHSZLRA25_1",
      },
      {
        severity: "high",
        responsibilityArea: "lra",
        designationStatus: "locally-adopted",
        sourceVersion: "FHSZLRA25_1",
      },
      {
        severity: "very-high",
        responsibilityArea: "lra",
        designationStatus: "locally-adopted",
        sourceVersion: "FHSZLRA25_1",
      },
    ]);
    expect(artifact.collection.features[1]?.geometry.coordinates).toHaveLength(
      2,
    );
    expect(artifact.collection.features[2]?.geometry.type).toBe(
      "MultiPolygon",
    );
  });

  it("serializes deterministically when source feature order changes", () => {
    const first = buildWildfireHazardArtifact([source]);
    const second = buildWildfireHazardArtifact([
      {
        ...source,
        featureCollection: {
          ...fixture,
          features: [...fixture.features].reverse(),
        },
      },
    ]);

    expect(second.json).toBe(first.json);
    expect(second.sha256).toBe(first.sha256);
  });

  it.each([
    [
      "an unknown severity",
      createFeatureCollection({
        properties: { FHSZ: "Extreme" },
      }),
      /Unknown FHSZ severity/,
    ],
    [
      "a non-polygon geometry",
      createFeatureCollection({
        geometry: {
          type: "Point",
          coordinates: [-117.6, 33.9],
        },
      }),
      /Polygon or MultiPolygon/,
    ],
    [
      "a non-finite coordinate",
      createFeatureCollection({
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [-117.6, 33.9],
              [-117.5, 33.9],
              [-117.5, Number.NaN],
              [-117.6, 33.9],
            ],
          ],
        },
      }),
      /finite longitude and latitude/,
    ],
  ])("rejects %s", (_label, featureCollection, expectedError) => {
    expect(() =>
      buildWildfireHazardArtifact([
        { ...source, featureCollection },
      ]),
    ).toThrow(expectedError);
  });
});

describe("createWildfireHazardManifest", () => {
  it("records deterministic artifact, source, tool, and license provenance", () => {
    const artifact = buildWildfireHazardArtifact([source]);
    const manifest = createWildfireHazardManifest({
      artifact,
      artifactFileName: "fhsz-five-cities-2025.1.geojson",
      artifactVersion: "2025.1",
      snapshotAt: "2026-08-22T00:13:29Z",
      gdalImage:
        "ghcr.io/osgeo/gdal:ubuntu-small-3.13.2@sha256:49b1b7a9779340ad66e7f87ea78ea632e923867df24e68c6d17f0079220e16b3",
      sources: [
        {
          id: "lra",
          title: "2025 combined LRA Fire Hazard Severity Zones",
          canonicalUrl: "https://example.test/lra.zip",
          sha256: "a".repeat(64),
          version: "FHSZLRA25_1",
          license: "CC BY",
          attribution: "CAL FIRE / Office of the State Fire Marshal",
        },
      ],
    });

    expect(manifest).toMatchObject({
      schemaVersion: 1,
      artifact: {
        fileName: "fhsz-five-cities-2025.1.geojson",
        version: "2025.1",
        sha256: artifact.sha256,
        bytes: Buffer.byteLength(artifact.json),
        featureCount: 3,
      },
      generatedFromSnapshotAt: "2026-08-22T00:13:29Z",
      tooling: {
        node: process.versions.node,
      },
      sources: [
        expect.objectContaining({
          id: "lra",
          license: "CC BY",
        }),
      ],
    });
  });
});

function createFeatureCollection(overrides: Record<string, unknown>) {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { FHSZ: "High" },
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [-117.6, 33.9],
              [-117.5, 33.9],
              [-117.5, 34],
              [-117.6, 33.9],
            ],
          ],
        },
        ...overrides,
      },
    ],
  };
}
