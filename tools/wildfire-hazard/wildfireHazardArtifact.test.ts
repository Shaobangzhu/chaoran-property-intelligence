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
  it("records schema v2 artifact, source, target, tool, and license provenance", () => {
    const { artifact, ...input } = createManifestInput();
    const manifest = createWildfireHazardManifest({ artifact, ...input });

    expect(manifest).toMatchObject({
      schemaVersion: 2,
      artifact: {
        fileName: "fhsz-six-markets-2025.1.geojson",
        version: "2025.1",
        sha256: artifact.sha256,
        bytes: Buffer.byteLength(artifact.json),
        featureCount: 3,
      },
      generatedFromSnapshotAt: "2026-08-22T00:13:29Z",
      tooling: {
        node: process.versions.node,
      },
      coverageTargets: [
        expect.objectContaining({
          id: "chino",
          label: "Chino",
          kind: "incorporated-jurisdiction",
          boundarySourceId: "city-boundaries",
          lraDesignationStatus: "locally-adopted",
        }),
        expect.objectContaining({
          id: "stevenson-ranch-91381",
          label: "Stevenson Ranch",
          kind: "market-context",
          boundarySourceId: "census-zcta-91381",
          lraDesignationStatus: "recommended",
          productSelector: { kind: "zip", value: "91381" },
        }),
      ],
    });
    expect(manifest.sources).toContainEqual(
      expect.objectContaining({ id: "lra", license: "CC BY" }),
    );
  });

  it.each([
    [
      "an unknown target kind",
      (input: Record<string, any>) => {
        input.coverageTargets[0].kind = "district";
      },
      /Unsupported coverage target kind/,
    ],
    [
      "an unknown designation status",
      (input: Record<string, any>) => {
        input.coverageTargets[0].lraDesignationStatus = "pending";
      },
      /Unsupported coverage target designation status/,
    ],
    [
      "a duplicate target id",
      (input: Record<string, any>) => {
        input.coverageTargets[1].id = input.coverageTargets[0].id;
      },
      /Duplicate coverage target id/,
    ],
    [
      "a missing boundary source reference",
      (input: Record<string, any>) => {
        input.coverageTargets[0].boundarySourceId = "missing-source";
      },
      /unknown boundary source/,
    ],
    [
      "a missing evidence reference",
      (input: Record<string, any>) => {
        input.coverageTargets[0].evidenceId = "missing-evidence";
      },
      /unknown designation evidence/,
    ],
    [
      "an insecure evidence URL",
      (input: Record<string, any>) => {
        input.designationEvidence[0].url = "http://example.test/evidence";
      },
      /HTTPS designation evidence URL/,
    ],
    [
      "an unsafe artifact filename",
      (input: Record<string, any>) => {
        input.artifactFileName = "../hazard.geojson";
      },
      /safe GeoJSON artifact filename/,
    ],
    [
      "artifact checksum disagreement",
      (input: Record<string, any>) => {
        input.artifact.sha256 = "0".repeat(64);
      },
      /SHA-256 does not match its bytes/,
    ],
  ])("rejects %s", (_label, mutate, expectedError) => {
    const manifestInput = createManifestInput();
    mutate(manifestInput);
    const { artifact, ...input } = manifestInput;

    expect(() =>
      createWildfireHazardManifest({ artifact, ...input }),
    ).toThrow(expectedError);
  });
});

function createManifestInput(): Record<string, any> {
  return {
    artifact: buildWildfireHazardArtifact([source]),
    artifactFileName: "fhsz-six-markets-2025.1.geojson",
    artifactVersion: "2025.1",
    snapshotAt: "2026-08-22T00:13:29Z",
    gdalImage:
      "ghcr.io/osgeo/gdal:ubuntu-small-3.13.2@sha256:49b1b7a9779340ad66e7f87ea78ea632e923867df24e68c6d17f0079220e16b3",
    sources: [
      createManifestSource("lra", "FHSZLRA25_1", "a"),
      createManifestSource("sra", "FHSZSRA_23_3", "b"),
      createManifestSource("city-boundaries", "24_1", "c"),
      createManifestSource("census-zcta-91381", "2025", "d"),
    ],
    designationEvidence: [
      {
        id: "chino-valley-ordinance-2025-01",
        title: "Chino Valley ordinance",
        url: "https://example.test/chino-evidence",
        finding: "The locally adopted classification applies.",
      },
      {
        id: "stevenson-ranch-cal-fire-recommended",
        title: "CAL FIRE recommended map",
        url: "https://example.test/stevenson-ranch-evidence",
        finding: "The recommended classification applies to this market context.",
      },
    ],
    coverageTargets: [
      {
        id: "chino",
        label: "Chino",
        kind: "incorporated-jurisdiction",
        boundarySourceId: "city-boundaries",
        lraDesignationStatus: "locally-adopted",
        evidenceId: "chino-valley-ordinance-2025-01",
        coverageDisclosure: "Official incorporated-city boundary.",
      },
      {
        id: "stevenson-ranch-91381",
        label: "Stevenson Ranch",
        kind: "market-context",
        boundarySourceId: "census-zcta-91381",
        lraDesignationStatus: "recommended",
        evidenceId: "stevenson-ranch-cal-fire-recommended",
        coverageDisclosure: "ZIP 91381 is a market context, not a city boundary.",
        productSelector: { kind: "zip", value: "91381" },
      },
    ],
  };
}

function createManifestSource(id: string, version: string, hashCharacter: string) {
  return {
    id,
    title: `${id} source`,
    canonicalUrl:
      id === "lra" || id === "sra"
        ? "https://example.test/cal-fire"
        : `https://example.test/${id}`,
    sha256: hashCharacter.repeat(64),
    version,
    license: "CC BY",
    attribution: "CAL FIRE / Office of the State Fire Marshal",
  };
}

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
