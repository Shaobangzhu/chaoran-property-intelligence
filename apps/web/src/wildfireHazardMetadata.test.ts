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
    unsupportedStatus.targetJurisdictions[0].lraDesignationStatus = "pending";
    expect(() => parseWildfireHazardManifest(unsupportedStatus)).toThrow(
      "Unsupported jurisdiction designation status",
    );

    const missingJurisdiction = structuredClone(readPublishedManifest());
    missingJurisdiction.targetJurisdictions.pop();
    expect(() => parseWildfireHazardManifest(missingJurisdiction)).toThrow(
      "exactly five target jurisdictions",
    );
  });
});

function readPublishedManifest(): Record<string, any> {
  return JSON.parse(
    readFileSync(
      new URL("../public/data/wildfire-hazard/manifest.json", import.meta.url),
      "utf8",
    ),
  );
}
