// @vitest-environment jsdom

import Graphic from "@arcgis/core/Graphic.js";
import Extent from "@arcgis/core/geometry/Extent.js";
import Point from "@arcgis/core/geometry/Point.js";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer.js";
import PictureMarkerSymbol from "@arcgis/core/symbols/PictureMarkerSymbol.js";
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
import type { CreateArcgisWildfireHazardOverlayOptions } from "./arcgisWildfireHazardOverlay.js";
import {
  coronaListing,
  eastvaleListing,
  stevensonRanchListing,
} from "./listingFixtures.js";
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

    expect(harness.mapAdd).toHaveBeenCalledTimes(2);
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

  it("installs a topmost draft layer and reconciles one anchored marker", async () => {
    const harness = createArcgisHarness();
    const driver = createArcgisListingsMapWithDependencies(
      harness.options,
      harness.dependencies,
    );
    driver.updateDraftMarker({
      confirmed: false,
      coordinates: { latitude: 33.8753, longitude: -117.5664 },
    });

    await harness.resolveReady();

    expect(harness.mapAdd).toHaveBeenCalledTimes(2);
    const listingsLayer = getListingsLayer(harness);
    const draftLayer = getDraftLayer(harness);
    expect(harness.mapAdd.mock.calls.map((call) => call[0])).toEqual([
      listingsLayer,
      draftLayer,
    ]);
    expect(draftLayer.graphics).toHaveLength(1);
    const draftGraphic = draftLayer.graphics.at(0);
    expect(draftGraphic).toBeInstanceOf(Graphic);
    expect(draftGraphic?.symbol).toBeInstanceOf(PictureMarkerSymbol);
    const unconfirmedSymbol = draftGraphic?.symbol as PictureMarkerSymbol;
    expect(unconfirmedSymbol.url).toMatch(/^data:image\/svg\+xml/);
    expect(unconfirmedSymbol.width).toBeCloseTo(20.25);
    expect(unconfirmedSymbol.height).toBeCloseTo(30.75);
    expect(unconfirmedSymbol.yoffset).toBeCloseTo(15.375);
    expect(harness.mapElement.style.cursor).toBe("crosshair");

    harness.hitTest.mockResolvedValueOnce({
      results: [
        { graphic: draftGraphic, layer: draftLayer, type: "graphic" },
      ],
    });
    dispatchMapEvent(harness.mapElement, "arcgisViewPointerMove", {
      type: "pointer-move",
      x: 20,
      y: 30,
    });
    await settlePromises();
    expect(harness.mapElement.style.cursor).toBe("grab");

    driver.updateDraftMarker({
      confirmed: true,
      coordinates: { latitude: 33.9, longitude: -117.6 },
    });

    expect(draftLayer.graphics).toHaveLength(1);
    expect(draftLayer.graphics.at(0)).toBe(draftGraphic);
    expect(draftGraphic?.symbol).toBeInstanceOf(PictureMarkerSymbol);
    const confirmedSymbol = draftGraphic?.symbol as PictureMarkerSymbol;
    expect(confirmedSymbol.url).not.toBe(unconfirmedSymbol.url);
    const point = draftGraphic?.geometry;
    expect(point?.type).toBe("point");
    if (point?.type === "point") {
      expect(point.longitude).toBe(-117.6);
      expect(point.latitude).toBe(33.9);
    }

    driver.updateDraftMarker(null);
    expect(draftLayer.graphics).toHaveLength(0);
    expect(harness.mapElement.style.cursor).toBe("");
  });

  it("places drafts only on background clicks and suppresses listing or draft hits", async () => {
    const harness = createArcgisHarness();
    const driver = createArcgisListingsMapWithDependencies(
      harness.options,
      harness.dependencies,
    );
    driver.updateListings([eastvaleListing], null);
    driver.updateDraftMarker({ confirmed: false, coordinates: null });
    await harness.resolveReady();
    const listingsLayer = getListingsLayer(harness);
    const draftLayer = getDraftLayer(harness);
    const listingGraphic = getGraphic(listingsLayer, eastvaleListing.id);

    harness.hitTest.mockResolvedValueOnce({ results: [] });
    dispatchMapEvent(harness.mapElement, "arcgisViewClick", {
      mapPoint: new Point({ latitude: 33.9, longitude: -117.6 }),
      type: "click",
      x: 20,
      y: 30,
    });
    await settlePromises();
    expect(harness.onDraftCoordinatesChange).toHaveBeenCalledWith({
      latitude: 33.9,
      longitude: -117.6,
    });

    harness.hitTest.mockResolvedValueOnce({
      results: [
        { graphic: listingGraphic, layer: listingsLayer, type: "graphic" },
      ],
    });
    dispatchMapEvent(harness.mapElement, "arcgisViewClick", {
      mapPoint: new Point({ latitude: 34, longitude: -117.7 }),
      type: "click",
      x: 40,
      y: 50,
    });
    await settlePromises();
    expect(harness.onSelect).toHaveBeenCalledWith(eastvaleListing.id);
    expect(harness.onDraftCoordinatesChange).toHaveBeenCalledOnce();

    driver.updateDraftMarker({
      confirmed: false,
      coordinates: { latitude: 33.8753, longitude: -117.5664 },
    });
    const draftGraphic = draftLayer.graphics.at(0);
    expect(draftGraphic).toBeInstanceOf(Graphic);
    harness.hitTest.mockResolvedValueOnce({
      results: [
        { graphic: draftGraphic, layer: draftLayer, type: "graphic" },
      ],
    });
    dispatchMapEvent(harness.mapElement, "arcgisViewClick", {
      mapPoint: new Point({ latitude: 34.1, longitude: -117.8 }),
      type: "click",
      x: 60,
      y: 70,
    });
    await settlePromises();
    expect(harness.onDraftCoordinatesChange).toHaveBeenCalledOnce();
  });

  it("ignores a late background hit after draft mode closes", async () => {
    const harness = createArcgisHarness();
    const driver = createArcgisListingsMapWithDependencies(
      harness.options,
      harness.dependencies,
    );
    driver.updateDraftMarker({ confirmed: false, coordinates: null });
    await harness.resolveReady();
    const lateHitTest = createDeferred<{ results: [] }>();
    harness.hitTest.mockReturnValueOnce(lateHitTest.promise);

    dispatchMapEvent(harness.mapElement, "arcgisViewClick", {
      mapPoint: new Point({ latitude: 33.9, longitude: -117.6 }),
      type: "click",
      x: 20,
      y: 30,
    });
    driver.updateDraftMarker(null);
    lateHitTest.resolve({ results: [] });
    await settlePromises();

    expect(harness.onDraftCoordinatesChange).not.toHaveBeenCalled();
    expect(harness.mapElement.style.cursor).toBe("");
  });

  it("drags only the draft graphic and emits coordinates on drag end", async () => {
    const harness = createArcgisHarness();
    const driver = createArcgisListingsMapWithDependencies(
      harness.options,
      harness.dependencies,
    );
    driver.updateDraftMarker({
      confirmed: true,
      coordinates: { latitude: 33.8753, longitude: -117.5664 },
    });
    await harness.resolveReady();
    const draftLayer = getDraftLayer(harness);
    const draftGraphic = draftLayer.graphics.at(0);
    expect(draftGraphic).toBeInstanceOf(Graphic);
    harness.hitTest.mockResolvedValueOnce({
      results: [
        { graphic: draftGraphic, layer: draftLayer, type: "graphic" },
      ],
    });
    const stopStart = vi.fn();
    const defer = vi.fn(async (operation: () => Promise<void>) => operation());

    dispatchMapEvent(harness.mapElement, "arcgisViewDrag", {
      action: "start",
      button: 0,
      defer,
      stopPropagation: stopStart,
      type: "drag",
      x: 20,
      y: 30,
    });
    await settlePromises();
    expect(defer).toHaveBeenCalledOnce();
    expect(stopStart).toHaveBeenCalledOnce();
    expect(harness.mapElement.style.cursor).toBe("grabbing");

    harness.toMap.mockReturnValueOnce(
      new Point({ latitude: 33.9, longitude: -117.6 }),
    );
    const stopUpdate = vi.fn();
    dispatchMapEvent(harness.mapElement, "arcgisViewDrag", {
      action: "update",
      button: 0,
      stopPropagation: stopUpdate,
      type: "drag",
      x: 40,
      y: 50,
    });
    expect(stopUpdate).toHaveBeenCalledOnce();
    expect(harness.onDraftCoordinatesChange).not.toHaveBeenCalled();
    const updatedPoint = draftGraphic?.geometry;
    expect(updatedPoint?.type).toBe("point");
    if (updatedPoint?.type === "point") {
      expect(updatedPoint.longitude).toBe(-117.6);
      expect(updatedPoint.latitude).toBe(33.9);
    }

    harness.toMap.mockReturnValueOnce(
      new Point({ latitude: 33.91, longitude: -117.61 }),
    );
    const stopEnd = vi.fn();
    dispatchMapEvent(harness.mapElement, "arcgisViewDrag", {
      action: "end",
      button: 0,
      stopPropagation: stopEnd,
      type: "drag",
      x: 45,
      y: 55,
    });
    expect(stopEnd).toHaveBeenCalledOnce();
    expect(harness.onDraftCoordinatesChange).toHaveBeenCalledWith({
      latitude: 33.91,
      longitude: -117.61,
    });
    expect(harness.mapElement.style.cursor).toBe("grab");
  });

  it("leaves map dragging untouched when drag start misses the draft", async () => {
    const harness = createArcgisHarness();
    const driver = createArcgisListingsMapWithDependencies(
      harness.options,
      harness.dependencies,
    );
    driver.updateDraftMarker({
      confirmed: false,
      coordinates: { latitude: 33.8753, longitude: -117.5664 },
    });
    await harness.resolveReady();
    harness.hitTest.mockResolvedValueOnce({ results: [] });
    const stopStart = vi.fn();
    const defer = vi.fn(async (operation: () => Promise<void>) => operation());

    dispatchMapEvent(harness.mapElement, "arcgisViewDrag", {
      action: "start",
      button: 0,
      defer,
      stopPropagation: stopStart,
      type: "drag",
      x: 20,
      y: 30,
    });
    await settlePromises();
    dispatchMapEvent(harness.mapElement, "arcgisViewDrag", {
      action: "update",
      button: 0,
      stopPropagation: vi.fn(),
      type: "drag",
      x: 40,
      y: 50,
    });

    expect(stopStart).not.toHaveBeenCalled();
    expect(harness.toMap).not.toHaveBeenCalled();
    expect(harness.onDraftCoordinatesChange).not.toHaveBeenCalled();
  });

  it("ignores a late draft hit after the marker is removed", async () => {
    const harness = createArcgisHarness();
    const driver = createArcgisListingsMapWithDependencies(
      harness.options,
      harness.dependencies,
    );
    driver.updateDraftMarker({
      confirmed: false,
      coordinates: { latitude: 33.8753, longitude: -117.5664 },
    });
    await harness.resolveReady();
    const draftLayer = getDraftLayer(harness);
    const draftGraphic = draftLayer.graphics.at(0);
    const lateHitTest = createDeferred<{
      results: Array<{
        graphic: Graphic;
        layer: GraphicsLayer;
        type: "graphic";
      }>;
    }>();
    harness.hitTest.mockReturnValueOnce(lateHitTest.promise);
    const stopStart = vi.fn();
    const defer = vi.fn(async (operation: () => Promise<void>) => operation());

    dispatchMapEvent(harness.mapElement, "arcgisViewDrag", {
      action: "start",
      button: 0,
      defer,
      stopPropagation: stopStart,
      type: "drag",
      x: 20,
      y: 30,
    });
    driver.updateDraftMarker(null);
    lateHitTest.resolve({
      results: [
        {
          graphic: draftGraphic as Graphic,
          layer: draftLayer,
          type: "graphic",
        },
      ],
    });
    await settlePromises();

    expect(stopStart).not.toHaveBeenCalled();
    expect(harness.toMap).not.toHaveBeenCalled();
    expect(harness.onDraftCoordinatesChange).not.toHaveBeenCalled();
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

  it("fits the legacy market and ZIP 91381 into one cross-region extent", async () => {
    const harness = createArcgisHarness();
    const driver = createArcgisListingsMapWithDependencies(
      harness.options,
      harness.dependencies,
    );
    await harness.resolveReady();

    driver.fitToListings([eastvaleListing, stevensonRanchListing]);

    const target = harness.goTo.mock.calls.at(-1)?.[0];
    expect(target).toBeInstanceOf(Extent);
    const extent = target as Extent;
    expect(extent.xmin).toBeCloseTo(stevensonRanchListing.longitude);
    expect(extent.xmax).toBeCloseTo(eastvaleListing.longitude);
    expect(extent.ymin).toBeCloseTo(eastvaleListing.latitude);
    expect(extent.ymax).toBeCloseTo(stevensonRanchListing.latitude);
    expect(extent.spatialReference.wkid).toBe(4326);
    expect(harness.goTo).toHaveBeenLastCalledWith(extent, {
      animate: false,
    });
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

  it("queues hazard visibility, forwards overlay state, and destroys the controller", async () => {
    const harness = createArcgisHarness();
    const driver = createArcgisListingsMapWithDependencies(
      harness.options,
      harness.dependencies,
    );

    await driver.setWildfireHazardVisible(true);
    expect(harness.createWildfireHazardOverlay).not.toHaveBeenCalled();

    await harness.resolveReady();
    expect(harness.createWildfireHazardOverlay).toHaveBeenCalledOnce();
    expect(harness.overlaySetVisible).toHaveBeenCalledWith(true);

    harness.getWildfireHazardOverlayOptions()?.onStateChange?.({
      status: "loading",
      visible: false,
    });
    expect(harness.onWildfireHazardStateChange).toHaveBeenCalledWith({
      status: "loading",
      visible: false,
    });
    expect(harness.onError).not.toHaveBeenCalled();

    await driver.setWildfireHazardVisible(false);
    expect(harness.overlaySetVisible).toHaveBeenLastCalledWith(false);

    driver.destroy();
    expect(harness.overlayDestroy).toHaveBeenCalledOnce();
  });

  it("keeps the base map ready when overlay construction fails", async () => {
    const harness = createArcgisHarness();
    harness.createWildfireHazardOverlay.mockImplementationOnce(() => {
      throw new Error("private overlay construction detail");
    });
    createArcgisListingsMapWithDependencies(
      harness.options,
      harness.dependencies,
    );

    await harness.resolveReady();

    expect(harness.onReady).toHaveBeenCalledOnce();
    expect(harness.onError).not.toHaveBeenCalled();
    expect(harness.onWildfireHazardStateChange).toHaveBeenCalledWith({
      status: "error",
      visible: false,
    });
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

  it("defers idempotent destruction until the component lifecycle settles", async () => {
    const harness = createArcgisHarness();
    const driver = createArcgisListingsMapWithDependencies(
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

    expect(harness.mapRemove).toHaveBeenCalledTimes(2);
    expect(harness.mapRemove).toHaveBeenCalledWith(layer);
    expect(harness.mapRemove).toHaveBeenCalledWith(getDraftLayer(harness));
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
  const componentReady = createDeferred<void>();
  const ready = createDeferred<void>();
  const initializeRuntime = vi.fn();
  const mapAdd = vi.fn();
  const mapRemove = vi.fn();
  const hitTest = vi.fn(() => Promise.resolve({ results: [] }));
  const goTo = vi.fn(() => Promise.resolve());
  const toMap = vi.fn();
  const destroyElement = vi.fn(() => Promise.resolve());
  const map = { add: mapAdd, remove: mapRemove };
  let wildfireHazardOverlayOptions:
    | CreateArcgisWildfireHazardOverlayOptions
    | undefined;
  const overlayDestroy = vi.fn();
  const overlaySetVisible = vi.fn(async () => undefined);
  const createWildfireHazardOverlay = vi.fn(
    (overlayOptions: CreateArcgisWildfireHazardOverlayOptions) => {
      wildfireHazardOverlayOptions = overlayOptions;
      return {
        destroy: overlayDestroy,
        setVisible: overlaySetVisible,
      };
    },
  );

  Object.assign(rawMapElement, {
    componentOnReady: vi.fn(() => componentReady.promise),
    destroy: destroyElement,
    goTo,
    hitTest,
    map,
    toMap,
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
  const dependencies: ArcgisListingsMapDependencies = {
    createMapElement: () => mapElement,
    createWildfireHazardOverlay,
    createZoomElement: () => zoomElement,
    initializeRuntime,
  };

  return {
    componentReady,
    container,
    createWildfireHazardOverlay,
    dependencies,
    destroyElement,
    goTo,
    getWildfireHazardOverlayOptions: () => wildfireHazardOverlayOptions,
    hitTest,
    initializeRuntime,
    mapAdd,
    mapElement,
    mapRemove,
    onDraftCoordinatesChange,
    onError,
    onReady,
    onSelect,
    onWildfireHazardStateChange,
    options,
    overlayDestroy,
    overlaySetVisible,
    ready,
    resolveReady: async () => {
      ready.resolve();
      await settlePromises();
    },
    viewContainer,
    toMap,
    zoomElement,
  };
}

interface ArcgisHarness {
  componentReady: Deferred<void>;
  container: HTMLElement;
  createWildfireHazardOverlay: ReturnType<typeof vi.fn>;
  dependencies: ArcgisListingsMapDependencies;
  destroyElement: ReturnType<typeof vi.fn>;
  goTo: ReturnType<typeof vi.fn>;
  getWildfireHazardOverlayOptions: () =>
    | CreateArcgisWildfireHazardOverlayOptions
    | undefined;
  hitTest: ReturnType<typeof vi.fn>;
  initializeRuntime: ReturnType<typeof vi.fn>;
  mapAdd: ReturnType<typeof vi.fn>;
  mapElement: ReturnType<ArcgisListingsMapDependencies["createMapElement"]>;
  mapRemove: ReturnType<typeof vi.fn>;
  onDraftCoordinatesChange: ReturnType<typeof vi.fn>;
  onError: ReturnType<typeof vi.fn>;
  onReady: ReturnType<typeof vi.fn>;
  onSelect: ReturnType<typeof vi.fn>;
  onWildfireHazardStateChange: ReturnType<typeof vi.fn>;
  options: CreateListingsMapOptions;
  overlayDestroy: ReturnType<typeof vi.fn>;
  overlaySetVisible: ReturnType<typeof vi.fn>;
  ready: Deferred<void>;
  resolveReady: () => Promise<void>;
  toMap: ReturnType<typeof vi.fn>;
  viewContainer: HTMLElement;
  zoomElement: ReturnType<ArcgisListingsMapDependencies["createZoomElement"]>;
}

function getListingsLayer(harness: ArcgisHarness): GraphicsLayer {
  const layer: unknown = harness.mapAdd.mock.calls[0]?.[0];
  expect(layer).toBeInstanceOf(GraphicsLayer);
  return layer as GraphicsLayer;
}

function getDraftLayer(harness: ArcgisHarness): GraphicsLayer {
  const layer: unknown = harness.mapAdd.mock.calls[1]?.[0];
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
