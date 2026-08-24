import GeoJSONLayer from "@arcgis/core/layers/GeoJSONLayer.js";
import type Layer from "@arcgis/core/layers/Layer.js";
import UniqueValueRenderer from "@arcgis/core/renderers/UniqueValueRenderer.js";
import SimpleFillSymbol from "@arcgis/core/symbols/SimpleFillSymbol.js";
import { describe, expect, it, vi } from "vitest";

import {
  ARCGIS_WILDFIRE_HAZARD_LAYER_ID,
  createArcgisWildfireHazardLayer,
  createArcgisWildfireHazardOverlayControllerWithDependencies,
  type ArcgisWildfireHazardMap,
  type ArcgisWildfireHazardOverlayDependencies,
} from "./arcgisWildfireHazardOverlay.js";
import type { WildfireHazardMetadata } from "./wildfireHazardMetadata.js";
import {
  parseWildfireHazardArtifact,
  type WildfireHazardFeatureCollection,
  type WildfireHazardOverlayState,
} from "./wildfireHazardOverlay.js";

describe("ArcGIS wildfire hazard layer", () => {
  it("uses one non-popup GeoJSON layer with the reviewed severity renderer", () => {
    const layer = createArcgisWildfireHazardLayer("blob:cpi-hazard-test");

    expect(layer).toBeInstanceOf(GeoJSONLayer);
    expect(layer.id).toBe(ARCGIS_WILDFIRE_HAZARD_LAYER_ID);
    expect(layer.url).toBe("blob:cpi-hazard-test");
    expect(layer.visible).toBe(false);
    expect(layer.popupEnabled).toBe(false);
    expect(layer.listMode).toBe("hide");
    expect(layer.legendEnabled).toBe(false);
    expect(layer.outFields).toEqual(["severity"]);
    expect(layer.renderer).toBeInstanceOf(UniqueValueRenderer);

    const renderer = layer.renderer as UniqueValueRenderer;
    expect(renderer.field).toBe("severity");
    expect(renderer.defaultSymbol).toBeNull();
    const infos = renderer.uniqueValueInfos ?? [];
    expect(infos.map(({ value }) => value)).toEqual([
      "moderate",
      "high",
      "very-high",
    ]);
    expectFillSymbol(infos[0]?.symbol, {
      fill: [248, 180, 173, 0.16],
      outline: [217, 119, 109, 0.55],
      outlineWidth: 0.525,
    });
    expectFillSymbol(infos[1]?.symbol, {
      fill: [232, 93, 85, 0.22],
      outline: [196, 60, 50, 0.65],
      outlineWidth: 0.675,
    });
    expectFillSymbol(infos[2]?.symbol, {
      fill: [166, 27, 27, 0.28],
      outline: [127, 29, 29, 0.75],
      outlineWidth: 0.825,
    });
  });
});

describe("ArcGIS wildfire hazard overlay", () => {
  it("loads once, inserts below listing graphics, and toggles without refetching", async () => {
    const harness = createHarness();
    harness.map.findLayerById = () => null;
    const controller = harness.createController();

    expect(harness.loadArtifact).not.toHaveBeenCalled();
    expect(harness.loadMetadata).not.toHaveBeenCalled();
    expect(harness.states).toEqual([{ status: "idle", visible: false }]);

    await controller.setVisible(true);

    expect(harness.loadArtifact).toHaveBeenCalledOnce();
    expect(harness.loadMetadata).toHaveBeenCalledOnce();
    expect(harness.createObjectUrl).toHaveBeenCalledWith(harness.artifact);
    expect(harness.createLayer).toHaveBeenCalledWith("blob:cpi-hazard-1");
    expect(harness.layers).toHaveLength(1);
    expect(harness.map.add).toHaveBeenCalledWith(harness.layers[0], 0);
    expect(harness.layers[0]?.visible).toBe(true);
    expect(harness.states.at(-1)).toEqual({
      metadata: harness.metadata,
      status: "ready",
      visible: true,
    });

    await controller.setVisible(false);
    expect(harness.layers[0]?.visible).toBe(false);
    expect(harness.states.at(-1)).toMatchObject({
      status: "ready",
      visible: false,
    });

    await controller.setVisible(true);
    expect(harness.layers[0]?.visible).toBe(true);
    expect(harness.loadArtifact).toHaveBeenCalledOnce();
    expect(harness.loadMetadata).toHaveBeenCalledOnce();
    expect(harness.createLayer).toHaveBeenCalledOnce();
  });

  it("honors a disable request while the artifact is loading", async () => {
    const harness = createHarness();
    const artifactLoad = createDeferred<WildfireHazardFeatureCollection>();
    harness.loadArtifact.mockReturnValueOnce(artifactLoad.promise);
    const controller = harness.createController();

    const pendingLoad = controller.setVisible(true);
    await Promise.resolve();
    await controller.setVisible(false);
    artifactLoad.resolve(harness.artifact);
    await pendingLoad;

    expect(harness.layers).toHaveLength(1);
    expect(harness.layers[0]?.visible).toBe(false);
    expect(harness.states.at(-1)).toMatchObject({
      status: "ready",
      visible: false,
    });

    await controller.setVisible(true);
    expect(harness.loadArtifact).toHaveBeenCalledOnce();
    expect(harness.layers[0]?.visible).toBe(true);
  });

  it("requires reviewed metadata before creating a Blob or layer", async () => {
    const harness = createHarness();
    harness.loadMetadata.mockRejectedValueOnce(new Error("missing provenance"));
    const controller = harness.createController();

    await expect(controller.setVisible(true)).resolves.toBeUndefined();

    expect(harness.createObjectUrl).not.toHaveBeenCalled();
    expect(harness.createLayer).not.toHaveBeenCalled();
    expect(harness.map.add).not.toHaveBeenCalled();
    expect(harness.states.at(-1)).toEqual({
      status: "error",
      visible: false,
    });
  });

  it("rolls back a failed layer load and retries from a clean state", async () => {
    const harness = createHarness();
    harness.layerLoadResults.push(new Error("private ArcGIS detail"), null);
    const controller = harness.createController();

    await controller.setVisible(true);

    expect(harness.map.add).not.toHaveBeenCalled();
    expect(harness.destroyLayer).toHaveBeenCalledOnce();
    expect(harness.revokeObjectUrl).toHaveBeenCalledWith("blob:cpi-hazard-1");
    expect(harness.states.at(-1)).toEqual({
      status: "error",
      visible: false,
    });

    await controller.setVisible(true);

    expect(harness.loadArtifact).toHaveBeenCalledTimes(2);
    expect(harness.createLayer).toHaveBeenCalledTimes(2);
    expect(harness.map.add).toHaveBeenCalledWith(harness.layers[1], 0);
    expect(harness.states.at(-1)).toMatchObject({
      status: "ready",
      visible: true,
    });
  });

  it("rolls back an add failure and keeps the overlay retryable", async () => {
    const harness = createHarness();
    harness.map.add.mockImplementationOnce(() => {
      throw new Error("simulated layer-order failure");
    });
    const controller = harness.createController();

    await controller.setVisible(true);

    expect(harness.destroyLayer).toHaveBeenCalledOnce();
    expect(harness.revokeObjectUrl).toHaveBeenCalledWith("blob:cpi-hazard-1");
    expect(harness.states.at(-1)).toEqual({
      status: "error",
      visible: false,
    });

    await controller.setVisible(true);
    expect(harness.map.add).toHaveBeenLastCalledWith(harness.layers[1], 0);
    expect(harness.states.at(-1)).toMatchObject({
      status: "ready",
      visible: true,
    });
  });

  it("aborts pending work and removes the layer and Blob URL on destroy", async () => {
    const pendingHarness = createHarness();
    let signal: AbortSignal | undefined;
    pendingHarness.loadArtifact.mockImplementationOnce((currentSignal) => {
      signal = currentSignal;
      return new Promise((resolve, reject) => {
        currentSignal.addEventListener("abort", () => reject(currentSignal.reason));
      });
    });
    const pendingController = pendingHarness.createController();
    const pendingLoad = pendingController.setVisible(true);
    await Promise.resolve();

    pendingController.destroy();
    await expect(pendingLoad).resolves.toBeUndefined();
    expect(signal?.aborted).toBe(true);
    expect(pendingHarness.createObjectUrl).not.toHaveBeenCalled();

    const installedHarness = createHarness();
    const installedController = installedHarness.createController();
    await installedController.setVisible(true);
    const layer = installedHarness.layers[0];

    installedController.destroy();
    installedController.destroy();

    expect(installedHarness.map.remove).toHaveBeenCalledOnce();
    expect(installedHarness.map.remove).toHaveBeenCalledWith(layer);
    expect(installedHarness.destroyLayer).toHaveBeenCalledOnce();
    expect(installedHarness.revokeObjectUrl).toHaveBeenCalledOnce();
  });
});

function createHarness(): ArcgisOverlayHarness {
  const artifact = parseWildfireHazardArtifact(createArtifact());
  const metadata = createMetadata();
  const states: WildfireHazardOverlayState[] = [];
  const installedLayers = new Map<string, GeoJSONLayer>();
  const layers: GeoJSONLayer[] = [];
  const layerLoadResults: Array<Error | null> = [];
  const destroyLayer = vi.fn();
  let objectUrlSequence = 0;
  const map: ArcgisWildfireHazardMap & {
    add: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  } = {
    add: vi.fn((layer: Layer) => {
      installedLayers.set(layer.id, layer as GeoJSONLayer);
    }),
    findLayerById: (id) => installedLayers.get(id),
    remove: vi.fn((layer: Layer) => {
      installedLayers.delete(layer.id);
    }),
  };
  const createLayer = vi.fn((url: string) => {
    const layer = createArcgisWildfireHazardLayer(url);
    const result = layerLoadResults.shift();
    vi.spyOn(layer, "load").mockImplementation(async () => {
      if (result instanceof Error) {
        throw result;
      }
      return layer;
    });
    vi.spyOn(layer, "destroy").mockImplementation(() => {
      destroyLayer(layer);
    });
    layers.push(layer);
    return layer;
  });
  const createObjectUrl = vi.fn(() => {
    objectUrlSequence += 1;
    return `blob:cpi-hazard-${objectUrlSequence}`;
  });
  const revokeObjectUrl = vi.fn();
  const loadArtifact = vi.fn(async (_signal: AbortSignal) => artifact);
  const loadMetadata = vi.fn(async (_signal: AbortSignal) => metadata);
  const dependencies: ArcgisWildfireHazardOverlayDependencies = {
    createLayer,
    createObjectUrl,
    loadArtifact,
    loadMetadata,
    revokeObjectUrl,
  };

  return {
    artifact,
    createController: () =>
      createArcgisWildfireHazardOverlayControllerWithDependencies(
        { map, onStateChange: (state) => states.push(state) },
        dependencies,
      ),
    createLayer,
    createObjectUrl,
    destroyLayer,
    layerLoadResults,
    layers,
    loadArtifact,
    loadMetadata,
    map,
    metadata,
    revokeObjectUrl,
    states,
  };
}

interface ArcgisOverlayHarness {
  artifact: WildfireHazardFeatureCollection;
  createController: () => ReturnType<
    typeof createArcgisWildfireHazardOverlayControllerWithDependencies
  >;
  createLayer: ReturnType<typeof vi.fn>;
  createObjectUrl: ReturnType<typeof vi.fn>;
  destroyLayer: ReturnType<typeof vi.fn>;
  layerLoadResults: Array<Error | null>;
  layers: GeoJSONLayer[];
  loadArtifact: ReturnType<typeof vi.fn>;
  loadMetadata: ReturnType<typeof vi.fn>;
  map: ArcgisWildfireHazardMap & {
    add: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  };
  metadata: WildfireHazardMetadata;
  revokeObjectUrl: ReturnType<typeof vi.fn>;
  states: WildfireHazardOverlayState[];
}

function expectFillSymbol(
  symbol: unknown,
  expected: {
    fill: [number, number, number, number];
    outline: [number, number, number, number];
    outlineWidth: number;
  },
): void {
  expect(symbol).toBeInstanceOf(SimpleFillSymbol);
  const fill = symbol as SimpleFillSymbol;
  expect(fill.color.toRgba()).toEqual(expected.fill);
  expect(fill.outline?.color?.toRgba()).toEqual(expected.outline);
  expect(fill.outline?.width).toBeCloseTo(expected.outlineWidth);
}

function createArtifact(): unknown {
  const severities = ["moderate", "high", "very-high"] as const;
  return {
    features: severities.map((severity, index) => ({
      geometry: {
        coordinates: [
          [
            [-117.7 + index * 0.01, 33.8],
            [-117.6 + index * 0.01, 33.8],
            [-117.6 + index * 0.01, 33.9],
            [-117.7 + index * 0.01, 33.8],
          ],
        ],
        type: "Polygon",
      },
      properties: {
        designationStatus: "effective",
        responsibilityArea: "sra",
        severity,
        sourceVersion: "2025.1",
      },
      type: "Feature",
    })),
    type: "FeatureCollection",
  };
}

function createMetadata(): WildfireHazardMetadata {
  return {
    artifactVersion: "2025.1",
    jurisdictions: [
      { name: "Chino", status: "locally-adopted" },
      { name: "Chino Hills", status: "locally-adopted" },
      { name: "Corona", status: "recommended" },
      { name: "Eastvale", status: "recommended" },
      { name: "Jurupa Valley", status: "recommended" },
    ],
    snapshotAt: "2026-08-22T00:00:00.000Z",
    sourceName: "CAL FIRE / OSFM",
    sourceUrl: "https://osfm.fire.ca.gov/",
    sourceVersions: { lra: "FHSZLRA25_1", sra: "FHSZSRA_23_3" },
  };
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: (value) => resolvePromise?.(value),
  };
}
