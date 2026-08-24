// @vitest-environment jsdom

import Graphic from "@arcgis/core/Graphic.js";
import Extent from "@arcgis/core/geometry/Extent.js";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer.js";
import SimpleMarkerSymbol from "@arcgis/core/symbols/SimpleMarkerSymbol.js";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./arcgisRuntime.js", () => ({
  initializeArcgisRuntime: vi.fn(),
}));

import {
  ArcgisListingsMapInitializationError,
  createArcgisListingsMapWithDependencies,
  type ArcgisListingsMapDependencies,
} from "./arcgisListingsMap.js";
import { coronaListing, eastvaleListing } from "./listingFixtures.js";
import type { CreateListingsMapOptions } from "./listingsMapDriver.js";

afterEach(() => {
  document.body.replaceChildren();
});

describe("ArcGIS listings map driver", () => {
  it("creates one configured map host and one top-right zoom control", () => {
    const harness = createArcgisHarness();

    const driver = createArcgisListingsMapWithDependencies(
      harness.options,
      harness.dependencies,
    );

    expect(harness.initializeRuntime).toHaveBeenCalledOnce();
    expect(harness.container.children).toHaveLength(1);
    expect(harness.container.firstElementChild).toBe(harness.mapElement);
    expect(harness.mapElement.className).toBe("arcgis-listings-map");
    expect(harness.mapElement.autoDestroyDisabled).toBe(true);
    expect(harness.mapElement.basemap).toBe("arcgis/navigation");
    expect(harness.mapElement.center).toEqual([-117.58, 33.94]);
    expect(harness.mapElement.zoom).toBe(10);
    expect(harness.mapElement.popupDisabled).toBe(true);
    expect(harness.mapElement.hideAttribution).toBe(false);
    expect(harness.mapElement.children).toHaveLength(1);
    expect(harness.zoomElement.slot).toBe("top-right");

    driver.destroy();
  });

  it("queues listings until ready and reconciles stable graphics by listing ID", async () => {
    const harness = createArcgisHarness();
    const driver = createArcgisListingsMapWithDependencies(
      harness.options,
      harness.dependencies,
    );

    driver.updateListings([eastvaleListing, coronaListing], coronaListing.id);
    expect(harness.mapAdd).not.toHaveBeenCalled();

    await harness.resolveReady();

    expect(harness.mapAdd).toHaveBeenCalledOnce();
    expect(harness.onReady).toHaveBeenCalledOnce();
    const layer = getListingsLayer(harness);
    expect(layer.graphics).toHaveLength(2);

    const eastvaleGraphic = getGraphic(layer, eastvaleListing.id);
    const coronaGraphic = getGraphic(layer, coronaListing.id);
    expectMarker(eastvaleGraphic, "#0d6e6e", 10.5);
    expectMarker(coronaGraphic, "#a24f2a", 13.5);

    driver.updateListings([eastvaleListing], eastvaleListing.id);

    expect(layer.graphics).toHaveLength(1);
    expect(getGraphic(layer, eastvaleListing.id)).toBe(eastvaleGraphic);
    expectMarker(eastvaleGraphic, "#a24f2a", 13.5);
    const point = eastvaleGraphic.geometry;
    expect(point?.type).toBe("point");
    if (point?.type === "point") {
      expect(point.longitude).toBe(eastvaleListing.longitude);
      expect(point.latitude).toBe(eastvaleListing.latitude);
    }
  });

  it("selects only listing-layer hits and scopes pointer feedback", async () => {
    const harness = createArcgisHarness();
    const driver = createArcgisListingsMapWithDependencies(
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
    dispatchMapEvent(harness.mapElement, "arcgisViewClick", {
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

    const unrelatedLayer = new GraphicsLayer();
    harness.hitTest.mockResolvedValueOnce({
      results: [{ graphic, layer: unrelatedLayer, type: "graphic" }],
    });
    dispatchMapEvent(harness.mapElement, "arcgisViewClick", {
      type: "click",
      x: 40,
      y: 50,
    });
    await settlePromises();
    expect(harness.onSelect).toHaveBeenCalledOnce();

    harness.hitTest.mockResolvedValueOnce({
      results: [{ graphic, layer, type: "graphic" }],
    });
    dispatchMapEvent(harness.mapElement, "arcgisViewPointerMove", {
      type: "pointer-move",
      x: 60,
      y: 70,
    });
    await settlePromises();
    expect(harness.mapElement.style.cursor).toBe("pointer");
    expect(harness.viewContainer.style.cursor).toBe("pointer");

    dispatchMapEvent(harness.mapElement, "arcgisViewPointerLeave", {
      type: "pointer-leave",
    });
    expect(harness.mapElement.style.cursor).toBe("");
    expect(harness.viewContainer.style.cursor).toBe("");
  });

  it("ignores stale pointer hit-test completion", async () => {
    const harness = createArcgisHarness();
    const driver = createArcgisListingsMapWithDependencies(
      harness.options,
      harness.dependencies,
    );
    driver.updateListings([eastvaleListing], null);
    await harness.resolveReady();
    const layer = getListingsLayer(harness);
    const graphic = getGraphic(layer, eastvaleListing.id);
    const staleHitTest = createDeferred<{ results: [] }>();
    const currentHitTest = createDeferred<{
      results: Array<{
        graphic: Graphic;
        layer: GraphicsLayer;
        type: "graphic";
      }>;
    }>();
    harness.hitTest
      .mockReturnValueOnce(staleHitTest.promise)
      .mockReturnValueOnce(currentHitTest.promise);

    dispatchMapEvent(harness.mapElement, "arcgisViewPointerMove", {
      type: "pointer-move",
      x: 10,
      y: 10,
    });
    dispatchMapEvent(harness.mapElement, "arcgisViewPointerMove", {
      type: "pointer-move",
      x: 20,
      y: 20,
    });
    currentHitTest.resolve({
      results: [{ graphic, layer, type: "graphic" }],
    });
    await settlePromises();
    expect(harness.mapElement.style.cursor).toBe("pointer");

    staleHitTest.resolve({ results: [] });
    await settlePromises();
    expect(harness.mapElement.style.cursor).toBe("pointer");
  });

  it("preserves zero, single, multi-listing, and focus viewpoints", async () => {
    const harness = createArcgisHarness();
    const driver = createArcgisListingsMapWithDependencies(
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
        zoom: 12.5,
      },
      { animate: false },
    );
    await settlePromises();

    harness.mapElement.zoom = 15;
    driver.fitToListings([eastvaleListing, coronaListing]);
    const multiTarget = harness.goTo.mock.calls.at(-1)?.[0];
    expect(multiTarget).toBeInstanceOf(Extent);
    expect(harness.goTo).toHaveBeenLastCalledWith(multiTarget, {
      animate: false,
    });
    expect(harness.mapElement.padding).toEqual({
      bottom: 56,
      left: 56,
      right: 56,
      top: 56,
    });
    await settlePromises();
    expect(harness.mapElement.zoom).toBe(13);
    expect(harness.mapElement.padding).toEqual({
      bottom: 0,
      left: 0,
      right: 0,
      top: 0,
    });

    harness.mapElement.zoom = 11;
    driver.focusListing(coronaListing);
    expect(harness.goTo).toHaveBeenLastCalledWith(
      {
        center: [coronaListing.longitude, coronaListing.latitude],
        zoom: 12.5,
      },
      { animate: true, duration: 450 },
    );
  });

  it("runs the latest pre-ready navigation before reporting ready", async () => {
    const harness = createArcgisHarness();
    const driver = createArcgisListingsMapWithDependencies(
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
        zoom: 12.5,
      },
      { animate: true, duration: 450 },
    );
    expect(harness.onReady).toHaveBeenCalledOnce();
  });

  it("reports one bounded initialization error", async () => {
    const harness = createArcgisHarness();
    createArcgisListingsMapWithDependencies(
      harness.options,
      harness.dependencies,
    );

    harness.mapElement.dispatchEvent(new CustomEvent("arcgisLoadError"));
    harness.ready.reject(new Error("credential-bearing provider detail"));
    await settlePromises();

    expect(harness.onError).toHaveBeenCalledOnce();
    expect(harness.onError).toHaveBeenCalledWith(
      expect.any(ArcgisListingsMapInitializationError),
    );
    expect(harness.onError.mock.calls[0]?.[0]).not.toHaveProperty(
      "message",
      expect.stringContaining("credential-bearing"),
    );
  });

  it("destroys idempotently and ignores late ready completion", async () => {
    const harness = createArcgisHarness();
    const driver = createArcgisListingsMapWithDependencies(
      harness.options,
      harness.dependencies,
    );

    driver.destroy();
    driver.destroy();
    harness.ready.resolve();
    await settlePromises();

    expect(harness.destroyElement).toHaveBeenCalledOnce();
    expect(harness.container.children).toHaveLength(0);
    expect(harness.mapAdd).not.toHaveBeenCalled();
    expect(harness.onReady).not.toHaveBeenCalled();
    expect(harness.onError).not.toHaveBeenCalled();
  });

  it("removes its installed layer and handlers on destroy", async () => {
    const harness = createArcgisHarness();
    const driver = createArcgisListingsMapWithDependencies(
      harness.options,
      harness.dependencies,
    );
    driver.updateListings([eastvaleListing], null);
    await harness.resolveReady();
    const layer = getListingsLayer(harness);

    driver.destroy();
    dispatchMapEvent(harness.mapElement, "arcgisViewClick", {
      type: "click",
      x: 20,
      y: 30,
    });
    await settlePromises();

    expect(harness.mapRemove).toHaveBeenCalledOnce();
    expect(harness.mapRemove).toHaveBeenCalledWith(layer);
    expect(layer.graphics).toHaveLength(0);
    expect(harness.hitTest).not.toHaveBeenCalled();
    expect(harness.onSelect).not.toHaveBeenCalled();
  });
});

function createArcgisHarness(): ArcgisHarness {
  const container = document.createElement("div");
  document.body.append(container);
  const rawMapElement = document.createElement("div");
  const rawZoomElement = document.createElement("div");
  const viewContainer = document.createElement("div");
  const ready = createDeferred<void>();
  const initializeRuntime = vi.fn();
  const mapAdd = vi.fn();
  const mapRemove = vi.fn();
  const hitTest = vi.fn(() => Promise.resolve({ results: [] }));
  const goTo = vi.fn(() => Promise.resolve());
  const destroyElement = vi.fn(() => Promise.resolve());
  const map = { add: mapAdd, remove: mapRemove };

  Object.assign(rawMapElement, {
    destroy: destroyElement,
    goTo,
    hitTest,
    map,
    view: { container: viewContainer },
    viewOnReady: vi.fn(() => ready.promise),
    zoom: 10,
  });

  const mapElement = rawMapElement as unknown as ReturnType<
    ArcgisListingsMapDependencies["createMapElement"]
  >;
  const zoomElement = rawZoomElement as unknown as ReturnType<
    ArcgisListingsMapDependencies["createZoomElement"]
  >;
  const onError = vi.fn();
  const onReady = vi.fn();
  const onSelect = vi.fn();
  const options: CreateListingsMapOptions = {
    container,
    onDraftCoordinatesChange: vi.fn(),
    onError,
    onReady,
    onSelect,
    onWildfireHazardStateChange: vi.fn(),
  };
  const dependencies: ArcgisListingsMapDependencies = {
    createMapElement: () => mapElement,
    createZoomElement: () => zoomElement,
    initializeRuntime,
  };

  return {
    container,
    dependencies,
    destroyElement,
    goTo,
    hitTest,
    initializeRuntime,
    mapAdd,
    mapElement,
    mapRemove,
    onError,
    onReady,
    onSelect,
    options,
    ready,
    resolveReady: async () => {
      ready.resolve();
      await settlePromises();
    },
    viewContainer,
    zoomElement,
  };
}

interface ArcgisHarness {
  container: HTMLElement;
  dependencies: ArcgisListingsMapDependencies;
  destroyElement: ReturnType<typeof vi.fn>;
  goTo: ReturnType<typeof vi.fn>;
  hitTest: ReturnType<typeof vi.fn>;
  initializeRuntime: ReturnType<typeof vi.fn>;
  mapAdd: ReturnType<typeof vi.fn>;
  mapElement: ReturnType<ArcgisListingsMapDependencies["createMapElement"]>;
  mapRemove: ReturnType<typeof vi.fn>;
  onError: ReturnType<typeof vi.fn>;
  onReady: ReturnType<typeof vi.fn>;
  onSelect: ReturnType<typeof vi.fn>;
  options: CreateListingsMapOptions;
  ready: Deferred<void>;
  resolveReady: () => Promise<void>;
  viewContainer: HTMLElement;
  zoomElement: ReturnType<ArcgisListingsMapDependencies["createZoomElement"]>;
}

function getListingsLayer(harness: ArcgisHarness): GraphicsLayer {
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

function expectMarker(
  graphic: Graphic,
  color: string,
  sizeInPoints: number,
): void {
  expect(graphic.symbol).toBeInstanceOf(SimpleMarkerSymbol);
  const symbol = graphic.symbol as SimpleMarkerSymbol;
  expect(symbol.color.toHex()).toBe(color);
  expect(symbol.size).toBeCloseTo(sizeInPoints);
  expect(symbol.outline.color?.toHex()).toBe("#ffffff");
  expect(symbol.outline.width).toBeCloseTo(1.5);
}

function dispatchMapEvent(
  mapElement: ArcgisHarness["mapElement"],
  eventName: string,
  detail: Record<string, unknown>,
): void {
  mapElement.dispatchEvent(new CustomEvent(eventName, { detail }));
}

async function settlePromises(): Promise<void> {
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
