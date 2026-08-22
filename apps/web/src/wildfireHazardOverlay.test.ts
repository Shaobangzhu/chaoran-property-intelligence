import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { WildfireHazardMetadata } from "./wildfireHazardMetadata.js";
import {
  WILDFIRE_HAZARD_ARTIFACT_URL,
  WILDFIRE_HAZARD_FILL_LAYER_ID,
  WILDFIRE_HAZARD_LAYER_IDS,
  WILDFIRE_HAZARD_OUTLINE_LAYER_IDS,
  WILDFIRE_HAZARD_SOURCE_ID,
  createWildfireHazardOverlayController,
  loadWildfireHazardArtifact,
  parseWildfireHazardArtifact,
  type WildfireHazardLayer,
  type WildfireHazardMap,
  type WildfireHazardOverlayState,
} from "./wildfireHazardOverlay.js";

const listingsLayerId = "stored-listing-points";

afterEach(() => vi.unstubAllGlobals());

describe("wildfire hazard artifact validation", () => {
  it("accepts the published Block 19.2 artifact", () => {
    const publishedArtifact = JSON.parse(
      readFileSync(
        new URL(
          "../public/data/wildfire-hazard/fhsz-five-cities-2025.1.geojson",
          import.meta.url,
        ),
        "utf8",
      ),
    );

    expect(parseWildfireHazardArtifact(publishedArtifact).features).toHaveLength(
      85,
    );
  });

  it("accepts the three reviewed severities and polygon geometry", () => {
    expect(parseWildfireHazardArtifact(createArtifact()).features).toHaveLength(
      3,
    );
  });

  it("rejects unsupported severities and malformed geometry", () => {
    const unsupported = createArtifact();
    unsupported.features[0]!.properties.severity = "extreme";
    expect(() => parseWildfireHazardArtifact(unsupported)).toThrow(
      "Unsupported wildfire hazard severity",
    );

    const malformed = createArtifact();
    malformed.features[0]!.geometry.coordinates[0] = [
      [-117.6, 33.9],
      [-117.5, 33.9],
      [-117.5, 34],
    ];
    expect(() => parseWildfireHazardArtifact(malformed)).toThrow(
      "Polygon rings must contain at least four positions",
    );
  });

  it("loads the versioned artifact from the same origin with cancellation", async () => {
    const artifact = createArtifact();
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => artifact,
      ok: true,
    });
    vi.stubGlobal("fetch", fetchMock);
    const signal = new AbortController().signal;

    await expect(loadWildfireHazardArtifact(signal)).resolves.toEqual(artifact);
    expect(fetchMock).toHaveBeenCalledWith(WILDFIRE_HAZARD_ARTIFACT_URL, {
      signal,
    });
  });
});

describe("wildfire hazard overlay controller", () => {
  it("loads once, installs hidden layers below listings, and toggles visibility", async () => {
    const map = new FakeWildfireHazardMap();
    const loadArtifact = vi.fn(async () =>
      parseWildfireHazardArtifact(createArtifact()),
    );
    const loadMetadata = vi.fn(async () => createMetadata());
    const states: WildfireHazardOverlayState[] = [];
    const controller = createWildfireHazardOverlayController({
      beforeLayerId: listingsLayerId,
      loadArtifact,
      loadMetadata,
      map,
      onStateChange: (state) => states.push(state),
    });

    expect(loadArtifact).not.toHaveBeenCalled();
    expect(loadMetadata).not.toHaveBeenCalled();
    expect(map.sources.size).toBe(0);

    await controller.setVisible(true);

    expect(loadArtifact).toHaveBeenCalledOnce();
    expect(loadMetadata).toHaveBeenCalledOnce();
    expect(map.sources.get(WILDFIRE_HAZARD_SOURCE_ID)).toMatchObject({
      type: "geojson",
    });
    expect(map.layers.map(({ layer }) => layer.id)).toEqual(
      WILDFIRE_HAZARD_LAYER_IDS,
    );
    expect(map.layers.every(({ beforeId }) => beforeId === listingsLayerId)).toBe(
      true,
    );
    expect(
      map.layers.every(({ initialVisibility }) => initialVisibility === "none"),
    ).toBe(true);
    expect(currentVisibilities(map)).toEqual(
      WILDFIRE_HAZARD_LAYER_IDS.map(() => "visible"),
    );
    expect(states.at(-1)).toMatchObject({ status: "ready", visible: true });

    await controller.setVisible(false);
    expect(currentVisibilities(map)).toEqual(
      WILDFIRE_HAZARD_LAYER_IDS.map(() => "none"),
    );
    expect(states.at(-1)).toMatchObject({ status: "ready", visible: false });

    await controller.setVisible(true);
    expect(loadArtifact).toHaveBeenCalledOnce();
    expect(map.addSourceCalls).toBe(1);
    expect(map.layers).toHaveLength(4);
  });

  it("uses monotonic red fills and severity-specific outlines", async () => {
    const map = new FakeWildfireHazardMap();
    const controller = createWildfireHazardOverlayController({
      beforeLayerId: listingsLayerId,
      loadArtifact: async () => parseWildfireHazardArtifact(createArtifact()),
      loadMetadata: async () => createMetadata(),
      map,
    });

    await controller.setVisible(true);

    const fill = map.getLayer(WILDFIRE_HAZARD_FILL_LAYER_ID);
    expect(fill?.paint).toMatchObject({
      "fill-color": [
        "match",
        ["get", "severity"],
        "moderate",
        "#f8b4ad",
        "high",
        "#e85d55",
        "very-high",
        "#a61b1b",
        "rgba(0, 0, 0, 0)",
      ],
      "fill-opacity": [
        "match",
        ["get", "severity"],
        "moderate",
        0.16,
        "high",
        0.22,
        "very-high",
        0.28,
        0,
      ],
    });

    expect(
      Object.entries(WILDFIRE_HAZARD_OUTLINE_LAYER_IDS).map(
        ([severity, id]) => [
          severity,
          map.getLayer(id)?.filter,
          map.getLayer(id)?.paint,
        ],
      ),
    ).toEqual([
      [
        "moderate",
        ["==", ["get", "severity"], "moderate"],
        {
          "line-color": "#d9776d",
          "line-opacity": 0.55,
          "line-width": 0.7,
        },
      ],
      [
        "high",
        ["==", ["get", "severity"], "high"],
        {
          "line-color": "#c43c32",
          "line-opacity": 0.65,
          "line-width": 0.9,
        },
      ],
      [
        "very-high",
        ["==", ["get", "severity"], "very-high"],
        {
          "line-color": "#7f1d1d",
          "line-opacity": 0.75,
          "line-width": 1.1,
        },
      ],
    ]);
  });

  it("honors a disable request that arrives while the artifact is loading", async () => {
    const map = new FakeWildfireHazardMap();
    let resolveArtifact:
      | ((artifact: ReturnType<typeof parseWildfireHazardArtifact>) => void)
      | undefined;
    const loadArtifact = vi.fn(
      () =>
        new Promise<ReturnType<typeof parseWildfireHazardArtifact>>(
          (resolve) => {
            resolveArtifact = resolve;
          },
        ),
    );
    const states: WildfireHazardOverlayState[] = [];
    const controller = createWildfireHazardOverlayController({
      beforeLayerId: listingsLayerId,
      loadArtifact,
      loadMetadata: async () => createMetadata(),
      map,
      onStateChange: (state) => states.push(state),
    });

    const pendingLoad = controller.setVisible(true);
    await Promise.resolve();
    await controller.setVisible(false);
    resolveArtifact?.(parseWildfireHazardArtifact(createArtifact()));
    await pendingLoad;

    expect(states.at(-1)).toMatchObject({ status: "ready", visible: false });
    expect(currentVisibilities(map)).toEqual(
      WILDFIRE_HAZARD_LAYER_IDS.map(() => "none"),
    );

    await controller.setVisible(true);
    expect(loadArtifact).toHaveBeenCalledOnce();
    expect(states.at(-1)).toMatchObject({ status: "ready", visible: true });
  });

  it("rolls back partial installation and reports a bounded overlay error", async () => {
    const map = new FakeWildfireHazardMap();
    map.failLayerId = WILDFIRE_HAZARD_OUTLINE_LAYER_IDS.high;
    const states: WildfireHazardOverlayState[] = [];
    const controller = createWildfireHazardOverlayController({
      beforeLayerId: listingsLayerId,
      loadArtifact: async () => parseWildfireHazardArtifact(createArtifact()),
      loadMetadata: async () => createMetadata(),
      map,
      onStateChange: (state) => states.push(state),
    });

    await expect(controller.setVisible(true)).resolves.toBeUndefined();

    expect(map.sources.size).toBe(0);
    expect(map.layers).toHaveLength(0);
    expect(states.at(-1)).toEqual({ status: "error", visible: false });
  });

  it("does not install hazard geometry without reviewed attribution", async () => {
    const map = new FakeWildfireHazardMap();
    const states: WildfireHazardOverlayState[] = [];
    const controller = createWildfireHazardOverlayController({
      beforeLayerId: listingsLayerId,
      loadArtifact: async () => parseWildfireHazardArtifact(createArtifact()),
      loadMetadata: async () => {
        throw new Error("missing provenance");
      },
      map,
      onStateChange: (state) => states.push(state),
    });

    await controller.setVisible(true);

    expect(map.sources.size).toBe(0);
    expect(map.layers).toHaveLength(0);
    expect(states.at(-1)).toEqual({ status: "error", visible: false });
  });

  it("can retry after a failed load without retaining partial state", async () => {
    const map = new FakeWildfireHazardMap();
    const loadArtifact = vi
      .fn<(signal: AbortSignal) => Promise<ReturnType<typeof parseWildfireHazardArtifact>>>()
      .mockRejectedValueOnce(new Error("private provider detail"))
      .mockResolvedValueOnce(parseWildfireHazardArtifact(createArtifact()));
    const states: WildfireHazardOverlayState[] = [];
    const controller = createWildfireHazardOverlayController({
      beforeLayerId: listingsLayerId,
      loadArtifact,
      loadMetadata: async () => createMetadata(),
      map,
      onStateChange: (state) => states.push(state),
    });

    await controller.setVisible(true);
    expect(states.at(-1)).toEqual({ status: "error", visible: false });

    await controller.setVisible(true);
    expect(loadArtifact).toHaveBeenCalledTimes(2);
    expect(states.at(-1)).toMatchObject({ status: "ready", visible: true });
    expect(map.layers).toHaveLength(4);
  });

  it("aborts pending loading and removes installed resources on destroy", async () => {
    const pendingMap = new FakeWildfireHazardMap();
    let capturedSignal: AbortSignal | undefined;
    const pendingController = createWildfireHazardOverlayController({
      beforeLayerId: listingsLayerId,
      loadArtifact: (signal) => {
        capturedSignal = signal;
        return new Promise((resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason));
        });
      },
      loadMetadata: async () => createMetadata(),
      map: pendingMap,
    });

    const pendingLoad = pendingController.setVisible(true);
    await Promise.resolve();
    pendingController.destroy();
    await expect(pendingLoad).resolves.toBeUndefined();
    expect(capturedSignal?.aborted).toBe(true);

    const installedMap = new FakeWildfireHazardMap();
    const installedController = createWildfireHazardOverlayController({
      beforeLayerId: listingsLayerId,
      loadArtifact: async () => parseWildfireHazardArtifact(createArtifact()),
      loadMetadata: async () => createMetadata(),
      map: installedMap,
    });
    await installedController.setVisible(true);
    installedController.destroy();

    expect(installedMap.layers).toHaveLength(0);
    expect(installedMap.sources.size).toBe(0);
  });
});

class FakeWildfireHazardMap implements WildfireHazardMap {
  readonly sources = new Map<string, unknown>();
  readonly layers: Array<{
    beforeId: string | undefined;
    initialVisibility: unknown;
    layer: WildfireHazardLayer;
  }> = [];
  readonly visibilities = new Map<string, unknown>();
  addSourceCalls = 0;
  failLayerId: string | undefined;

  addSource(id: string, source: unknown): void {
    this.addSourceCalls += 1;
    this.sources.set(id, source);
  }

  getSource(id: string): unknown {
    return this.sources.get(id);
  }

  removeSource(id: string): void {
    this.sources.delete(id);
  }

  addLayer(layer: WildfireHazardLayer, beforeId?: string): void {
    if (layer.id === this.failLayerId) {
      throw new Error("simulated MapLibre layer failure");
    }
    this.layers.push({
      beforeId,
      initialVisibility: layer.layout?.visibility,
      layer,
    });
    this.visibilities.set(layer.id, layer.layout?.visibility);
  }

  getLayer(id: string): WildfireHazardLayer | undefined {
    return this.layers.find(({ layer }) => layer.id === id)?.layer;
  }

  removeLayer(id: string): void {
    const index = this.layers.findIndex(({ layer }) => layer.id === id);
    if (index >= 0) {
      this.layers.splice(index, 1);
    }
    this.visibilities.delete(id);
  }

  setLayoutProperty(id: string, property: string, value: unknown): void {
    if (property === "visibility") {
      this.visibilities.set(id, value);
    }
  }
}

function currentVisibilities(map: FakeWildfireHazardMap): unknown[] {
  return WILDFIRE_HAZARD_LAYER_IDS.map((id) => map.visibilities.get(id));
}

function createArtifact(): {
  features: Array<{
    geometry: {
      coordinates: number[][][];
      type: "Polygon";
    };
    properties: {
      designationStatus: string;
      responsibilityArea: string;
      severity: string;
      sourceVersion: string;
    };
    type: "Feature";
  }>;
  type: "FeatureCollection";
} {
  return {
    type: "FeatureCollection",
    features: ["moderate", "high", "very-high"].map((severity, index) => ({
      type: "Feature",
      properties: {
        designationStatus: index === 0 ? "recommended" : "locally-adopted",
        responsibilityArea: "lra",
        severity,
        sourceVersion: "FHSZLRA25_1",
      },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-117.6 + index * 0.01, 33.9],
            [-117.5 + index * 0.01, 33.9],
            [-117.5 + index * 0.01, 34],
            [-117.6 + index * 0.01, 33.9],
          ],
        ],
      },
    })),
  };
}

function createMetadata(): WildfireHazardMetadata {
  return {
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
  };
}
