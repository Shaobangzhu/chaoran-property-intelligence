// @vitest-environment jsdom

import Graphic from "@arcgis/core/Graphic.js";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer.js";
import IconSymbol3DLayer from "@arcgis/core/symbols/IconSymbol3DLayer.js";
import PointSymbol3D from "@arcgis/core/symbols/PointSymbol3D.js";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./arcgisRuntime.js", () => ({
  initializeArcgisRuntime: vi.fn(),
}));

import {
  ArcgisTerrainListingsSceneInitializationError,
  createArcgisTerrainListingsSceneWithDependencies,
  type ArcgisTerrainListingsSceneDependencies,
} from "./arcgisTerrainListingsScene.js";
import {
  coronaListing,
  eastvaleListing,
  stevensonRanchListing,
} from "./listingFixtures.js";
import type { CreateListingsMapOptions } from "./listingsMapDriver.js";
import type { WildfireHazardOverlayState } from "./wildfireHazardOverlay.js";

afterEach(() => {
  document.body.replaceChildren();
});

describe("ArcGIS terrain listings scene driver", () => {
  it("creates one local World Elevation scene without forcing quality", () => {
    const harness = createTerrainHarness();

    const driver = createArcgisTerrainListingsSceneWithDependencies(
      harness.options,
      harness.dependencies,
    );

    expect(harness.supportsWebGL2).toHaveBeenCalledOnce();
    expect(harness.initializeRuntime).toHaveBeenCalledOnce();
    expect(harness.container.children).toHaveLength(1);
    expect(harness.container.firstElementChild).toBe(harness.sceneElement);
    expect(harness.sceneElement.className).toBe(
      "arcgis-terrain-listings-scene",
    );
    expect(harness.sceneElement.autoDestroyDisabled).toBe(true);
    expect(harness.sceneElement.basemap).toBe("arcgis/navigation");
    expect(harness.sceneElement.ground).toBe("world-elevation");
    expect(harness.sceneElement.viewingMode).toBe("local");
    expect(harness.sceneElement.cameraPosition).toEqual([
      -117.58, 33.65, 45_000,
    ]);
    expect(harness.sceneElement.cameraHeading).toBe(0);
    expect(harness.sceneElement.cameraTilt).toBe(55);
    expect(harness.sceneElement.popupDisabled).toBe(true);
    expect(harness.sceneElement.hideAttribution).toBe(false);
    expect(harness.sceneElement.qualityProfile).toBeUndefined();
    expect(harness.zoomElement.slot).toBe("top-right");
    expect(harness.sceneElement.children).toHaveLength(1);
    expect(harness.sceneElement.firstElementChild).toBe(harness.zoomElement);

    driver.destroy();
  });

  it("fails closed before creating a scene when WebGL2 is unavailable", () => {
    const harness = createTerrainHarness();
    harness.supportsWebGL2.mockReturnValue(false);

    const driver = createArcgisTerrainListingsSceneWithDependencies(
      harness.options,
      harness.dependencies,
    );
    driver.updateListings([eastvaleListing], eastvaleListing.id);
    driver.fitToListings([eastvaleListing]);
    driver.focusListing(eastvaleListing);
    driver.updateDraftMarker(null);
    driver.resize();
    driver.destroy();

    expect(harness.initializeRuntime).not.toHaveBeenCalled();
    expect(harness.container.children).toHaveLength(0);
    expect(harness.onError).toHaveBeenCalledOnce();
    expect(harness.onError).toHaveBeenCalledWith(
      expect.any(ArcgisTerrainListingsSceneInitializationError),
    );
    expect(harness.onReady).not.toHaveBeenCalled();
  });

  it("queues and reconciles one terrain-aware graphic per stable listing ID", async () => {
    const harness = createTerrainHarness();
    const driver = createArcgisTerrainListingsSceneWithDependencies(
      harness.options,
      harness.dependencies,
    );

    driver.updateListings([eastvaleListing, coronaListing], coronaListing.id);
    expect(harness.mapAdd).not.toHaveBeenCalled();
    await harness.resolveReady();

    expect(harness.loadGround).toHaveBeenCalledWith(harness.map);
    expect(harness.mapAdd).toHaveBeenCalledOnce();
    expect(harness.onReady).toHaveBeenCalledOnce();
    const layer = getListingsLayer(harness);
    expect(layer.elevationInfo?.mode).toBe("relative-to-ground");
    expect(layer.elevationInfo?.offset).toBe(8);
    expect(layer.screenSizePerspectiveEnabled).toBe(false);
    expect(layer.graphics).toHaveLength(2);

    const eastvaleGraphic = getGraphic(layer, eastvaleListing.id);
    const coronaGraphic = getGraphic(layer, coronaListing.id);
    expectTerrainMarker(eastvaleGraphic, "#0d6e6e", 14);
    expectTerrainMarker(coronaGraphic, "#a24f2a", 18);

    driver.updateListings([eastvaleListing], eastvaleListing.id);
    expect(layer.graphics).toHaveLength(1);
    expect(getGraphic(layer, eastvaleListing.id)).toBe(eastvaleGraphic);
    expectTerrainMarker(eastvaleGraphic, "#a24f2a", 18);
  });

  it("selects only current listing-layer hits and ignores stale completions", async () => {
    const harness = createTerrainHarness();
    const driver = createArcgisTerrainListingsSceneWithDependencies(
      harness.options,
      harness.dependencies,
    );
    driver.updateListings([eastvaleListing], null);
    await harness.resolveReady();
    const layer = getListingsLayer(harness);
    const graphic = getGraphic(layer, eastvaleListing.id);

    harness.hitTest.mockResolvedValueOnce({
      results: [{ graphic, layer, type: "graphic" }],
    });
    dispatchSceneEvent(harness.sceneElement, "arcgisViewClick", {
      type: "click",
      x: 20,
      y: 30,
    });
    await settlePromises();
    expect(harness.hitTest).toHaveBeenCalledWith(
      expect.objectContaining({ x: 20, y: 30 }),
      { include: layer },
    );
    expect(harness.onSelect).toHaveBeenCalledWith(eastvaleListing.id);

    const lateHit = createDeferred<{
      results: Array<{
        graphic: Graphic;
        layer: GraphicsLayer;
        type: "graphic";
      }>;
    }>();
    harness.hitTest.mockReturnValueOnce(lateHit.promise);
    dispatchSceneEvent(harness.sceneElement, "arcgisViewClick", {
      type: "click",
      x: 40,
      y: 50,
    });
    driver.destroy();
    lateHit.resolve({ results: [{ graphic, layer, type: "graphic" }] });
    await settlePromises();

    expect(harness.onSelect).toHaveBeenCalledOnce();
  });

  it("scopes pointer feedback to the listings layer", async () => {
    const harness = createTerrainHarness();
    const driver = createArcgisTerrainListingsSceneWithDependencies(
      harness.options,
      harness.dependencies,
    );
    driver.updateListings([eastvaleListing], null);
    await harness.resolveReady();
    const layer = getListingsLayer(harness);
    const graphic = getGraphic(layer, eastvaleListing.id);

    harness.hitTest.mockResolvedValueOnce({
      results: [{ graphic, layer, type: "graphic" }],
    });
    dispatchSceneEvent(harness.sceneElement, "arcgisViewPointerMove", {
      type: "pointer-move",
      x: 20,
      y: 30,
    });
    await settlePromises();
    expect(harness.sceneElement.style.cursor).toBe("pointer");
    expect(harness.viewContainer.style.cursor).toBe("pointer");

    dispatchSceneEvent(harness.sceneElement, "arcgisViewPointerLeave", {
      type: "pointer-leave",
    });
    expect(harness.sceneElement.style.cursor).toBe("");
    expect(harness.viewContainer.style.cursor).toBe("");
  });

  it("uses bounded empty, single, multi-listing, and focus camera commands", async () => {
    const harness = createTerrainHarness();
    const driver = createArcgisTerrainListingsSceneWithDependencies(
      harness.options,
      harness.dependencies,
    );
    await harness.resolveReady();

    driver.fitToListings([]);
    expect(harness.goTo).not.toHaveBeenCalled();

    driver.fitToListings([eastvaleListing]);
    expect(harness.goTo).toHaveBeenLastCalledWith(
      {
        center: [eastvaleListing.longitude, eastvaleListing.latitude],
        zoom: 14,
      },
      { animate: false },
    );
    expect(harness.sceneElement.cameraTilt).toBe(58);

    driver.fitToListings([eastvaleListing, coronaListing]);
    const multiTarget = harness.goTo.mock.calls.at(-1)?.[0] as {
      center: [number, number];
      zoom: number;
    };
    expect(multiTarget.center[0]).toBeCloseTo(
      (eastvaleListing.longitude + coronaListing.longitude) / 2,
    );
    expect(multiTarget.center[1]).toBeCloseTo(
      (eastvaleListing.latitude + coronaListing.latitude) / 2,
    );
    expect(multiTarget.zoom).toBeGreaterThanOrEqual(9.5);
    expect(multiTarget.zoom).toBeLessThanOrEqual(12.5);
    expect(harness.goTo).toHaveBeenLastCalledWith(multiTarget, {
      animate: false,
    });

    harness.sceneElement.zoom = 18;
    driver.focusListing(coronaListing);
    expect(harness.goTo).toHaveBeenLastCalledWith(
      {
        center: [coronaListing.longitude, coronaListing.latitude],
        zoom: 15,
      },
      { animate: true },
    );
    expect(harness.sceneElement.cameraTilt).toBe(62);
  });

  it("fits the legacy market and ZIP 91381 into one bounded terrain camera", async () => {
    const harness = createTerrainHarness();
    const driver = createArcgisTerrainListingsSceneWithDependencies(
      harness.options,
      harness.dependencies,
    );
    await harness.resolveReady();

    driver.fitToListings([eastvaleListing, stevensonRanchListing]);

    const target = harness.goTo.mock.calls.at(-1)?.[0] as {
      center: [number, number];
      zoom: number;
    };
    expect(target.center[0]).toBeCloseTo(
      (eastvaleListing.longitude + stevensonRanchListing.longitude) / 2,
    );
    expect(target.center[1]).toBeCloseTo(
      (eastvaleListing.latitude + stevensonRanchListing.latitude) / 2,
    );
    expect(target.zoom).toBeGreaterThanOrEqual(9.5);
    expect(target.zoom).toBeLessThan(12.5);
    expect(harness.goTo).toHaveBeenLastCalledWith(target, {
      animate: false,
    });
  });

  it("runs only the latest pre-ready camera command before reporting ready", async () => {
    const harness = createTerrainHarness();
    const driver = createArcgisTerrainListingsSceneWithDependencies(
      harness.options,
      harness.dependencies,
    );
    driver.fitToListings([eastvaleListing]);
    driver.focusListing(coronaListing);

    await harness.resolveReady();

    expect(harness.goTo).toHaveBeenCalledOnce();
    expect(harness.goTo).toHaveBeenCalledWith(
      {
        center: [coronaListing.longitude, coronaListing.latitude],
        zoom: 14,
      },
      { animate: true },
    );
    expect(harness.onReady).toHaveBeenCalledOnce();
  });

  it("keeps draft inert and replays queued CAL FIRE visibility after ready", async () => {
    const harness = createTerrainHarness();
    const driver = createArcgisTerrainListingsSceneWithDependencies(
      harness.options,
      harness.dependencies,
    );

    driver.updateDraftMarker({
      confirmed: false,
      coordinates: { latitude: 33.9, longitude: -117.6 },
    });
    await driver.setWildfireHazardVisible(true);
    expect(harness.createWildfireHazardOverlay).not.toHaveBeenCalled();
    await harness.resolveReady();

    expect(getListingsLayer(harness).graphics).toHaveLength(0);
    expect(harness.onDraftCoordinatesChange).not.toHaveBeenCalled();
    expect(harness.createWildfireHazardOverlay).toHaveBeenCalledWith({
      map: harness.map,
      onStateChange: harness.onWildfireHazardStateChange,
    });
    expect(harness.setWildfireHazardVisible).toHaveBeenCalledOnce();
    expect(harness.setWildfireHazardVisible).toHaveBeenCalledWith(true);

    await driver.setWildfireHazardVisible(false);
    expect(harness.setWildfireHazardVisible).toHaveBeenLastCalledWith(false);
  });

  it("forwards CAL FIRE state and isolates overlay construction failure", async () => {
    const harness = createTerrainHarness();
    createArcgisTerrainListingsSceneWithDependencies(
      harness.options,
      harness.dependencies,
    );
    await harness.resolveReady();
    const readyState: WildfireHazardOverlayState = {
      metadata: {
        artifactVersion: "2025.1",
        jurisdictions: [],
        snapshotAt: "2026-08-22T00:00:00.000Z",
        sourceName: "CAL FIRE / OSFM",
        sourceUrl: "https://osfm.fire.ca.gov/",
        sourceVersions: { lra: "FHSZLRA25_1", sra: "FHSZSRA_23_3" },
      },
      status: "ready",
      visible: true,
    };
    harness.emitWildfireHazardState(readyState);
    expect(harness.onWildfireHazardStateChange).toHaveBeenCalledWith(
      readyState,
    );

    const failedHarness = createTerrainHarness();
    failedHarness.createWildfireHazardOverlay.mockImplementationOnce(() => {
      throw new Error("private overlay construction detail");
    });
    createArcgisTerrainListingsSceneWithDependencies(
      failedHarness.options,
      failedHarness.dependencies,
    );
    await failedHarness.resolveReady();

    expect(failedHarness.onReady).toHaveBeenCalledOnce();
    expect(failedHarness.onError).not.toHaveBeenCalled();
    expect(failedHarness.onWildfireHazardStateChange).toHaveBeenCalledWith({
      status: "error",
      visible: false,
    });
  });

  it("reports one bounded scene or ground initialization error", async () => {
    const sceneHarness = createTerrainHarness();
    createArcgisTerrainListingsSceneWithDependencies(
      sceneHarness.options,
      sceneHarness.dependencies,
    );
    sceneHarness.sceneElement.dispatchEvent(
      new CustomEvent("arcgisLoadError"),
    );
    sceneHarness.ready.reject(
      new Error("credential-bearing scene provider detail"),
    );
    await settlePromises();
    expectBoundedInitializationError(sceneHarness);

    const groundHarness = createTerrainHarness();
    groundHarness.loadGround.mockRejectedValueOnce(
      new Error("private terrain service detail"),
    );
    createArcgisTerrainListingsSceneWithDependencies(
      groundHarness.options,
      groundHarness.dependencies,
    );
    await groundHarness.resolveReady();
    expectBoundedInitializationError(groundHarness);
    expect(groundHarness.mapAdd).not.toHaveBeenCalled();
    expect(groundHarness.onReady).not.toHaveBeenCalled();
  });

  it("defers idempotent destruction and suppresses late readiness", async () => {
    const harness = createTerrainHarness();
    const driver = createArcgisTerrainListingsSceneWithDependencies(
      harness.options,
      harness.dependencies,
    );

    driver.destroy();
    driver.destroy();
    expect(harness.destroyElement).not.toHaveBeenCalled();
    expect(harness.container.children).toHaveLength(0);

    harness.componentReady.resolve();
    harness.ready.resolve();
    await settlePromises();

    expect(harness.destroyElement).toHaveBeenCalledOnce();
    expect(harness.mapAdd).not.toHaveBeenCalled();
    expect(harness.onReady).not.toHaveBeenCalled();
    expect(harness.onError).not.toHaveBeenCalled();
  });

  it("removes its installed layer and handlers on destroy", async () => {
    const harness = createTerrainHarness();
    const driver = createArcgisTerrainListingsSceneWithDependencies(
      harness.options,
      harness.dependencies,
    );
    driver.updateListings([eastvaleListing], null);
    await harness.resolveReady();
    const layer = getListingsLayer(harness);

    driver.destroy();
    dispatchSceneEvent(harness.sceneElement, "arcgisViewClick", {
      type: "click",
      x: 20,
      y: 30,
    });
    await settlePromises();

    expect(harness.mapRemove).toHaveBeenCalledOnce();
    expect(harness.mapRemove).toHaveBeenCalledWith(layer);
    expect(harness.destroyWildfireHazardOverlay).toHaveBeenCalledOnce();
    expect(layer.graphics).toHaveLength(0);
    expect(harness.hitTest).not.toHaveBeenCalled();
    expect(harness.onSelect).not.toHaveBeenCalled();
  });
});

function createTerrainHarness(): TerrainHarness {
  const container = document.createElement("div");
  document.body.append(container);
  const rawSceneElement = document.createElement("div");
  const rawZoomElement = document.createElement("div");
  const viewContainer = document.createElement("div");
  const componentReady = createDeferred<void>();
  const ready = createDeferred<void>();
  const initializeRuntime = vi.fn();
  const supportsWebGL2 = vi.fn(() => true);
  const mapAdd = vi.fn();
  const mapRemove = vi.fn();
  const hitTest = vi.fn(() => Promise.resolve({ results: [] }));
  const goTo = vi.fn(() => Promise.resolve());
  const destroyElement = vi.fn(() => Promise.resolve());
  const map = { add: mapAdd, ground: {}, remove: mapRemove };
  const loadGround = vi.fn(async () => undefined);
  const setWildfireHazardVisible = vi.fn(async () => undefined);
  const destroyWildfireHazardOverlay = vi.fn();
  let emitWildfireHazardState = (
    _state: WildfireHazardOverlayState,
  ): void => undefined;
  const createWildfireHazardOverlay = vi.fn(
    ({ onStateChange }: { onStateChange?: typeof emitWildfireHazardState }) => {
      emitWildfireHazardState = onStateChange ?? (() => undefined);
      return {
        destroy: destroyWildfireHazardOverlay,
        setVisible: setWildfireHazardVisible,
      };
    },
  );

  Object.assign(rawSceneElement, {
    componentOnReady: vi.fn(() => componentReady.promise),
    destroy: destroyElement,
    goTo,
    hitTest,
    map,
    view: { container: viewContainer },
    viewOnReady: vi.fn(() => ready.promise),
    zoom: 10,
  });

  const sceneElement = rawSceneElement as unknown as ReturnType<
    ArcgisTerrainListingsSceneDependencies["createSceneElement"]
  >;
  const zoomElement = rawZoomElement as unknown as ReturnType<
    ArcgisTerrainListingsSceneDependencies["createZoomElement"]
  >;
  const onError = vi.fn();
  const onDraftCoordinatesChange = vi.fn();
  const onReady = vi.fn();
  const onSelect = vi.fn();
  const onWildfireHazardStateChange = vi.fn();
  const options: CreateListingsMapOptions = {
    container,
    onDraftCoordinatesChange,
    onError,
    onReady,
    onSelect,
    onWildfireHazardStateChange,
  };
  const dependencies: ArcgisTerrainListingsSceneDependencies = {
    createSceneElement: () => sceneElement,
    createWildfireHazardOverlay,
    createZoomElement: () => zoomElement,
    initializeRuntime,
    loadGround,
    supportsWebGL2,
  };

  return {
    componentReady,
    container,
    createWildfireHazardOverlay,
    dependencies,
    destroyElement,
    destroyWildfireHazardOverlay,
    emitWildfireHazardState: (state) => emitWildfireHazardState(state),
    goTo,
    hitTest,
    initializeRuntime,
    loadGround,
    map,
    mapAdd,
    mapRemove,
    onDraftCoordinatesChange,
    onError,
    onReady,
    onSelect,
    onWildfireHazardStateChange,
    options,
    ready,
    resolveReady: async () => {
      ready.resolve();
      await settlePromises();
    },
    sceneElement,
    setWildfireHazardVisible,
    supportsWebGL2,
    viewContainer,
    zoomElement,
  };
}

interface TerrainHarness {
  componentReady: Deferred<void>;
  container: HTMLElement;
  createWildfireHazardOverlay: ReturnType<typeof vi.fn>;
  dependencies: ArcgisTerrainListingsSceneDependencies;
  destroyElement: ReturnType<typeof vi.fn>;
  destroyWildfireHazardOverlay: ReturnType<typeof vi.fn>;
  emitWildfireHazardState: (state: WildfireHazardOverlayState) => void;
  goTo: ReturnType<typeof vi.fn>;
  hitTest: ReturnType<typeof vi.fn>;
  initializeRuntime: ReturnType<typeof vi.fn>;
  loadGround: ReturnType<typeof vi.fn>;
  map: unknown;
  mapAdd: ReturnType<typeof vi.fn>;
  mapRemove: ReturnType<typeof vi.fn>;
  onDraftCoordinatesChange: ReturnType<typeof vi.fn>;
  onError: ReturnType<typeof vi.fn>;
  onReady: ReturnType<typeof vi.fn>;
  onSelect: ReturnType<typeof vi.fn>;
  onWildfireHazardStateChange: ReturnType<typeof vi.fn>;
  options: CreateListingsMapOptions;
  ready: Deferred<void>;
  resolveReady: () => Promise<void>;
  sceneElement: ReturnType<
    ArcgisTerrainListingsSceneDependencies["createSceneElement"]
  >;
  setWildfireHazardVisible: ReturnType<typeof vi.fn>;
  supportsWebGL2: ReturnType<typeof vi.fn>;
  viewContainer: HTMLElement;
  zoomElement: ReturnType<
    ArcgisTerrainListingsSceneDependencies["createZoomElement"]
  >;
}

function getListingsLayer(harness: TerrainHarness): GraphicsLayer {
  const layer: unknown = harness.mapAdd.mock.calls[0]?.[0];
  expect(layer).toBeInstanceOf(GraphicsLayer);
  return layer as GraphicsLayer;
}

function getGraphic(layer: GraphicsLayer, listingId: string): Graphic {
  const graphic = layer.graphics.find(
    (candidate) => candidate.attributes.listingId === listingId,
  );
  expect(graphic).toBeInstanceOf(Graphic);
  return graphic as Graphic;
}

function expectTerrainMarker(
  graphic: Graphic,
  color: string,
  size: number,
): void {
  expect(graphic.symbol).toBeInstanceOf(PointSymbol3D);
  const symbol = graphic.symbol as PointSymbol3D;
  const symbolLayer = symbol.symbolLayers.at(0);
  expect(symbolLayer).toBeInstanceOf(IconSymbol3DLayer);
  const icon = symbolLayer as IconSymbol3DLayer;
  expect(icon.resource?.primitive).toBe("circle");
  expect(icon.material?.color?.toHex()).toBe(color);
  expect(icon.size).toBe(size);
  expect(icon.outline?.color?.toHex()).toBe("#ffffff");
  expect(icon.outline?.size).toBe(2);
}

function expectBoundedInitializationError(harness: TerrainHarness): void {
  expect(harness.onError).toHaveBeenCalledOnce();
  expect(harness.onError).toHaveBeenCalledWith(
    expect.any(ArcgisTerrainListingsSceneInitializationError),
  );
  const error = harness.onError.mock.calls[0]?.[0] as Error | undefined;
  expect(error?.message).toBe("ArcGIS terrain listings scene is unavailable.");
}

function dispatchSceneEvent(
  sceneElement: TerrainHarness["sceneElement"],
  eventName: string,
  detail: Record<string, unknown>,
): void {
  sceneElement.dispatchEvent(new CustomEvent(eventName, { detail }));
}

async function settlePromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

interface Deferred<T> {
  promise: Promise<T>;
  reject: (reason?: unknown) => void;
  resolve: (value: T) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}
