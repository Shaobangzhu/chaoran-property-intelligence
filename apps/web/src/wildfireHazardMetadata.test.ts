import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  WILDFIRE_HAZARD_MANIFEST_URL,
  loadWildfireHazardMetadata,
  parseWildfireHazardManifest,
} from "./wildfireHazardMetadata.js";

afterEach(() => vi.unstubAllGlobals());

describe("wildfire hazard manifest metadata", () => {
  it("parses the published manifest into the browser attribution contract", () => {
    const metadata = parseWildfireHazardManifest(readPublishedManifest());

    expect(metadata).toEqual({
      artifactVersion: "2025.1",
      snapshotAt: "2026-08-22T00:29:56Z",
      sourceName: "CAL FIRE / Office of the State Fire Marshal",
      sourceUrl:
        "https://osfm.fire.ca.gov/what-we-do/community-wildfire-preparedness-and-mitigation/fire-hazard-severity-zones",
      sourceVersions: {
        lra: "FHSZLRA25_1",
        sra: "FHSZSRA_23_3",
      },
      jurisdictions: [
        { name: "Chino", status: "locally-adopted" },
        { name: "Chino Hills", status: "locally-adopted" },
        { name: "Corona", status: "locally-adopted" },
        { name: "Eastvale", status: "recommended" },
        { name: "Jurupa Valley", status: "locally-adopted" },
      ],
      coverageTargets: [
        {
          id: "chino",
          label: "Chino",
          kind: "incorporated-jurisdiction",
          boundarySourceId: "city-boundaries",
          lraDesignationStatus: "locally-adopted",
          evidenceId: "chino-valley-ordinance-2025-01",
          coverageDisclosure:
            "Official incorporated-city boundary supplied by California Incorporated Cities.",
        },
        {
          id: "chino-hills",
          label: "Chino Hills",
          kind: "incorporated-jurisdiction",
          boundarySourceId: "city-boundaries",
          lraDesignationStatus: "locally-adopted",
          evidenceId: "chino-valley-ordinance-2025-01",
          coverageDisclosure:
            "Official incorporated-city boundary supplied by California Incorporated Cities.",
        },
        {
          id: "corona",
          label: "Corona",
          kind: "incorporated-jurisdiction",
          boundarySourceId: "city-boundaries",
          lraDesignationStatus: "locally-adopted",
          evidenceId: "corona-ordinance-3418",
          coverageDisclosure:
            "Official incorporated-city boundary supplied by California Incorporated Cities.",
        },
        {
          id: "eastvale",
          label: "Eastvale",
          kind: "incorporated-jurisdiction",
          boundarySourceId: "city-boundaries",
          lraDesignationStatus: "recommended",
          evidenceId: "eastvale-proposal-review",
          coverageDisclosure:
            "Official incorporated-city boundary supplied by California Incorporated Cities.",
        },
        {
          id: "jurupa-valley",
          label: "Jurupa Valley",
          kind: "incorporated-jurisdiction",
          boundarySourceId: "city-boundaries",
          lraDesignationStatus: "locally-adopted",
          evidenceId: "jurupa-valley-ordinance-2025-13",
          coverageDisclosure:
            "Official incorporated-city boundary supplied by California Incorporated Cities.",
        },
        {
          id: "stevenson-ranch-91381",
          label: "Stevenson Ranch",
          kind: "market-context",
          boundarySourceId: "census-stevenson-ranch-cdp",
          lraDesignationStatus: "locally-adopted",
          evidenceId: "los-angeles-county-ordinance-2025-0027",
          coverageDisclosure:
            "The ACS 2025 Stevenson Ranch CDP is a statistical product coverage boundary. Its clip edge is not an official CAL FIRE severity transition, city limit, postal boundary, or parcel determination.",
          productSelector: { kind: "zip", value: "91381" },
        },
      ],
    });
  });

  it("parses schema v2 coverage targets without changing the five jurisdiction statuses", () => {
    const metadata = parseWildfireHazardManifest(createV2Manifest());

    expect(metadata.jurisdictions).toEqual([
      { name: "Chino", status: "locally-adopted" },
      { name: "Chino Hills", status: "locally-adopted" },
      { name: "Corona", status: "locally-adopted" },
      { name: "Eastvale", status: "recommended" },
      { name: "Jurupa Valley", status: "locally-adopted" },
    ]);
    expect(metadata.coverageTargets).toHaveLength(6);
    expect(metadata.coverageTargets.at(-1)).toEqual({
      id: "stevenson-ranch-91381",
      label: "Stevenson Ranch",
      kind: "market-context",
      boundarySourceId: "census-zcta-91381",
      lraDesignationStatus: "recommended",
      evidenceId: "stevenson-ranch-cal-fire-recommended",
      coverageDisclosure: "ZIP 91381 is a market context, not a city boundary.",
      productSelector: { kind: "zip", value: "91381" },
    });
  });

  it("loads the same-origin manifest with the supplied abort signal", async () => {
    const manifest = readPublishedManifest();
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => manifest,
      ok: true,
    });
    vi.stubGlobal("fetch", fetchMock);
    const signal = new AbortController().signal;

    await expect(loadWildfireHazardMetadata(signal)).resolves.toEqual(
      parseWildfireHazardManifest(manifest),
    );
    expect(fetchMock).toHaveBeenCalledWith(WILDFIRE_HAZARD_MANIFEST_URL, {
      signal,
    });
  });

  it("rejects incomplete, insecure, or unsupported provenance", () => {
    const insecure = structuredClone(readPublishedManifest());
    insecure.sources[0].canonicalUrl = "http://example.test/fhsz";
    expect(() => parseWildfireHazardManifest(insecure)).toThrow(
      "HTTPS canonical source",
    );

    const unsupportedStatus = structuredClone(readPublishedManifest());
    unsupportedStatus.coverageTargets[0].lraDesignationStatus = "pending";
    expect(() => parseWildfireHazardManifest(unsupportedStatus)).toThrow(
      "Unsupported coverage target designation status",
    );

    const missingCoverageTargets = structuredClone(readPublishedManifest());
    missingCoverageTargets.coverageTargets = [];
    expect(() => parseWildfireHazardManifest(missingCoverageTargets)).toThrow(
      "coverage targets are required",
    );
  });

  it.each([
    [
      "an unknown target kind",
      (manifest: Record<string, any>) => {
        manifest.coverageTargets[0].kind = "district";
      },
      /Unsupported coverage target kind/,
    ],
    [
      "an unknown target status",
      (manifest: Record<string, any>) => {
        manifest.coverageTargets[0].lraDesignationStatus = "pending";
      },
      /Unsupported coverage target designation status/,
    ],
    [
      "a duplicate target label",
      (manifest: Record<string, any>) => {
        manifest.coverageTargets[1].label = manifest.coverageTargets[0].label;
      },
      /Duplicate coverage target label/,
    ],
    [
      "a missing boundary source",
      (manifest: Record<string, any>) => {
        manifest.coverageTargets[0].boundarySourceId = "missing-source";
      },
      /unknown boundary source/,
    ],
    [
      "a missing evidence record",
      (manifest: Record<string, any>) => {
        manifest.coverageTargets[0].evidenceId = "missing-evidence";
      },
      /unknown designation evidence/,
    ],
    [
      "an insecure evidence URL",
      (manifest: Record<string, any>) => {
        manifest.designationEvidence[0].url = "http://example.test/evidence";
      },
      /HTTPS designation evidence URL/,
    ],
    [
      "an unsafe artifact filename",
      (manifest: Record<string, any>) => {
        manifest.artifact.fileName = "../hazard.geojson";
      },
      /safe GeoJSON artifact filename/,
    ],
  ])("rejects schema v2 with %s", (_label, mutate, expectedError) => {
    const manifest = createV2Manifest();
    mutate(manifest);

    expect(() => parseWildfireHazardManifest(manifest)).toThrow(expectedError);
  });
});

function createV2Manifest(): Record<string, any> {
  const incorporatedTargets = [
    ["chino", "Chino", "locally-adopted", "chino-evidence"],
    ["chino-hills", "Chino Hills", "locally-adopted", "chino-evidence"],
    ["corona", "Corona", "locally-adopted", "corona-evidence"],
    ["eastvale", "Eastvale", "recommended", "eastvale-evidence"],
    [
      "jurupa-valley",
      "Jurupa Valley",
      "locally-adopted",
      "jurupa-valley-evidence",
    ],
  ].map(([id, label, status, evidenceId]) => ({
    id,
    label,
    kind: "incorporated-jurisdiction",
    boundarySourceId: "city-boundaries",
    lraDesignationStatus: status,
    evidenceId,
    coverageDisclosure: "Official incorporated-city boundary.",
  }));

  return {
    schemaVersion: 2,
    artifact: {
      fileName: "fhsz-six-markets-2025.1.geojson",
      mediaType: "application/geo+json",
      version: "2025.1",
      sha256: "f".repeat(64),
      bytes: 1_000,
      gzipBytes: 500,
      featureCount: 12,
      coordinateCount: 120,
      bounds: [-118.7, 33.7, -117.3, 34.5],
      severityCounts: { moderate: 4, high: 4, "very-high": 4 },
      responsibilityAreaCounts: { lra: 8, sra: 4 },
      designationStatusCounts: {
        effective: 4,
        recommended: 2,
        "locally-adopted": 6,
      },
    },
    generatedFromSnapshotAt: "2026-08-24T12:00:00Z",
    tooling: {
      node: "24.19.0",
      gdalImage: "ghcr.io/osgeo/gdal:3.13.2@sha256:test",
    },
    sources: [
      createV2Source("lra", "FHSZLRA25_1", "a"),
      createV2Source("sra", "FHSZSRA_23_3", "b"),
      createV2Source("city-boundaries", "24_1", "c"),
      createV2Source("census-zcta-91381", "2025", "d"),
    ],
    designationEvidence: [
      createEvidence("chino-evidence"),
      createEvidence("corona-evidence"),
      createEvidence("eastvale-evidence"),
      createEvidence("jurupa-valley-evidence"),
      createEvidence("stevenson-ranch-cal-fire-recommended"),
    ],
    coverageTargets: [
      ...incorporatedTargets,
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

function createV2Source(id: string, version: string, hashCharacter: string) {
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

function createEvidence(id: string) {
  return {
    id,
    title: `${id} title`,
    url: `https://example.test/${id}`,
    finding: `${id} finding`,
  };
}

function readPublishedManifest(): Record<string, any> {
  return JSON.parse(
    readFileSync(
      new URL("../public/data/wildfire-hazard/manifest.json", import.meta.url),
      "utf8",
    ),
  );
}
