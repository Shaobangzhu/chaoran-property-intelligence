import Graphic from "@arcgis/core/Graphic.js";
import Extent from "@arcgis/core/geometry/Extent.js";
import Point from "@arcgis/core/geometry/Point.js";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer.js";
import PictureMarkerSymbol from "@arcgis/core/symbols/PictureMarkerSymbol.js";
import type { SimpleMarkerSymbolProperties } from "@arcgis/core/symbols/SimpleMarkerSymbol.js";
import type {
  ClickEvent,
  DragEvent,
  PointerMoveEvent,
} from "@arcgis/core/views/input/types.js";
import type {
  GoToOptions2D,
  GoToTarget2D,
} from "@arcgis/core/views/types.js";

import { initializeArcgisRuntime } from "./arcgisRuntime.js";
import type { ListingSummary } from "./listingsApi.js";
import type {
  CreateListingsMap,
  CreateListingsMapOptions,
  DraftMarkerPresentation,
  ListingCoordinates,
  ListingsMapDriver,
} from "./listingsMapDriver.js";

const INITIAL_CENTER = [-117.58, 33.94] as const;
const INITIAL_ZOOM = 10;
const SINGLE_LISTING_ZOOM = 12.5;
const MAX_MULTI_LISTING_ZOOM = 13;
const MULTI_LISTING_PADDING = 56;
const FOCUS_DURATION_MS = 450;
const LISTING_LAYER_ID = "stored-listings";
const DRAFT_LAYER_ID = "draft-listing";
const DEFAULT_MARKER_COLOR = "#0d6e6e";
const SELECTED_MARKER_COLOR = "#a24f2a";
const DRAFT_MARKER_COLOR = "#a24f2a";
const DRAFT_CONFIRMED_COLOR = "#0d6e6e";

type ArcgisMapElement = HTMLElementTagNameMap["arcgis-map"];
type ArcgisZoomElement = HTMLElementTagNameMap["arcgis-zoom"];

export interface ArcgisListingsMapDependencies {
  initializeRuntime: () => void;
  createMapElement: () => ArcgisMapElement;
  createZoomElement: () => ArcgisZoomElement;
}

export class ArcgisListingsMapInitializationError extends Error {
  public constructor() {
    super("ArcGIS listings map initialization failed.");
    this.name = "ArcgisListingsMapInitializationError";
  }
}

const defaultDependencies: ArcgisListingsMapDependencies = {
  initializeRuntime: initializeArcgisRuntime,
  createMapElement: () => document.createElement("arcgis-map"),
  createZoomElement: () => document.createElement("arcgis-zoom"),
};

export const createArcgisListingsMap: CreateListingsMap = (options) =>
  createArcgisListingsMapWithDependencies(options, defaultDependencies);

export function createArcgisListingsMapWithDependencies(
  options: CreateListingsMapOptions,
  dependencies: ArcgisListingsMapDependencies,
): ListingsMapDriver {
  dependencies.initializeRuntime();

  const mapElement = dependencies.createMapElement();
  const zoomElement = dependencies.createZoomElement();
  const listingsLayer = new GraphicsLayer({
    id: LISTING_LAYER_ID,
    listMode: "hide",
    title: "Stored listings",
  });
  const draftLayer = new GraphicsLayer({
    id: DRAFT_LAYER_ID,
    listMode: "hide",
    title: "Draft listing",
  });
  const defaultMarkerSymbol = createListingMarkerSymbol(false);
  const selectedMarkerSymbol = createListingMarkerSymbol(true);
  const draftMarkerSymbol = createDraftMarkerSymbol(false);
  const confirmedDraftMarkerSymbol = createDraftMarkerSymbol(true);
  const graphicsByListingId = new Map<string, Graphic>();

  let currentListings: ListingSummary[] = [];
  let currentSelectedListingId: string | null = null;
  let draftMarkerState: DraftMarkerPresentation | null = null;
  let draftGraphic: Graphic | null = null;
  let pendingNavigation: PendingNavigation | null = null;
  let ready = false;
  let initializationSettled = false;
  let destroyed = false;
  let layersInstalled = false;
  let draggingDraft = false;
  let pointerTarget: InteractiveHit = { type: "background" };
  let pointerHitTestSequence = 0;
  let clickHitTestSequence = 0;
  let dragHitTestSequence = 0;
  let navigationSequence = 0;

  mapElement.className = "arcgis-listings-map";
  mapElement.autoDestroyDisabled = true;
  mapElement.basemap = "arcgis/navigation";
  mapElement.center = [...INITIAL_CENTER];
  mapElement.zoom = INITIAL_ZOOM;
  mapElement.popupDisabled = true;
  mapElement.hideAttribution = false;
  zoomElement.slot = "top-right";
  mapElement.append(zoomElement);

  const handleLoadError = (): void => reportInitializationError();
  const handleMapClick = (event: Event): void => {
    if (!ready || destroyed) {
      return;
    }

    const sequence = ++clickHitTestSequence;
    const hitTarget = (event as CustomEvent<ClickEvent>).detail;
    void findInteractiveHitAt(hitTarget)
      .then((hit) => {
        if (destroyed || !ready || sequence !== clickHitTestSequence) {
          return;
        }
        if (hit.type === "listing") {
          options.onSelect(hit.listingId);
          return;
        }
        if (hit.type === "draft" || draftMarkerState === null) {
          return;
        }

        const coordinates = toListingCoordinates(hitTarget.mapPoint);
        if (coordinates !== null) {
          options.onDraftCoordinatesChange(coordinates);
        }
      })
      .catch(() => undefined);
  };
  const handlePointerMove = (event: Event): void => {
    if (!ready || destroyed) {
      return;
    }

    const sequence = ++pointerHitTestSequence;
    const hitTarget = (event as CustomEvent<PointerMoveEvent>).detail;
    void findInteractiveHitAt(hitTarget)
      .then((hit) => {
        if (!destroyed && ready && sequence === pointerHitTestSequence) {
          pointerTarget = hit;
          updateMapCursor();
        }
      })
      .catch(() => {
        if (!destroyed && ready && sequence === pointerHitTestSequence) {
          pointerTarget = { type: "background" };
          updateMapCursor();
        }
      });
  };
  const handlePointerLeave = (): void => {
    pointerHitTestSequence += 1;
    pointerTarget = { type: "background" };
    updateMapCursor();
  };
  const handleMapDrag = (event: Event): void => {
    if (!ready || destroyed) {
      return;
    }

    const dragEvent = (event as CustomEvent<DragEvent>).detail;
    if (dragEvent.action === "start") {
      if (dragEvent.button !== 0 || draftGraphic === null) {
        return;
      }

      const sequence = ++dragHitTestSequence;
      void dragEvent
        .defer(async () => {
          const hitDraft = await isDraftHitAt(dragEvent);
          if (
            destroyed ||
            !ready ||
            sequence !== dragHitTestSequence ||
            !hitDraft ||
            draftGraphic === null
          ) {
            return;
          }

          dragEvent.stopPropagation();
          draggingDraft = true;
          pointerTarget = { type: "draft" };
          updateMapCursor();
        })
        .catch(() => undefined);
      return;
    }

    if (!draggingDraft || draftGraphic === null) {
      return;
    }

    dragEvent.stopPropagation();
    if (dragEvent.action === "added" || dragEvent.action === "removed") {
      return;
    }

    const coordinates = toListingCoordinates(
      mapElement.toMap({ x: dragEvent.x, y: dragEvent.y }),
    );
    if (coordinates !== null) {
      draftGraphic.geometry = createPoint(coordinates);
    }

    if (dragEvent.action === "end") {
      draggingDraft = false;
      pointerTarget = { type: "draft" };
      updateMapCursor();
      if (coordinates !== null) {
        options.onDraftCoordinatesChange(coordinates);
      }
    }
  };

  mapElement.addEventListener("arcgisLoadError", handleLoadError);
  mapElement.addEventListener("arcgisViewClick", handleMapClick);
  mapElement.addEventListener("arcgisViewDrag", handleMapDrag);
  mapElement.addEventListener("arcgisViewPointerMove", handlePointerMove);
  mapElement.addEventListener("arcgisViewPointerLeave", handlePointerLeave);
  options.container.append(mapElement);

  void mapElement
    .viewOnReady()
    .then(() => {
      if (destroyed || initializationSettled) {
        return;
      }

      const arcgisMap = mapElement.map;
      if (arcgisMap === null || arcgisMap === undefined) {
        reportInitializationError();
        return;
      }

      arcgisMap.add(listingsLayer);
      arcgisMap.add(draftLayer);
      layersInstalled = true;
      ready = true;
      initializationSettled = true;
      reconcileListingGraphics();
      reconcileDraftGraphic();
      updateMapCursor();

      const navigation = pendingNavigation;
      pendingNavigation = null;
      if (navigation !== null) {
        runPendingNavigation(navigation);
      }
      options.onReady();
    })
    .catch(() => reportInitializationError());

  return {
    updateListings: (listings, selectedListingId) => {
      currentListings = [...listings];
      currentSelectedListingId = selectedListingId;
      if (ready) {
        reconcileListingGraphics();
      }
    },
    fitToListings: (listings) => {
      const navigation: PendingNavigation = {
        type: "fit",
        listings: [...listings],
      };
      if (!ready) {
        pendingNavigation = navigation;
        return;
      }
      runPendingNavigation(navigation);
    },
    focusListing: (listing) => {
      const navigation: PendingNavigation = { type: "focus", listing };
      if (!ready) {
        pendingNavigation = navigation;
        return;
      }
      runPendingNavigation(navigation);
    },
    updateDraftMarker: (nextDraftMarker) => {
      draftMarkerState = cloneDraftMarker(nextDraftMarker);
      clickHitTestSequence += 1;
      dragHitTestSequence += 1;
      if (draftMarkerState?.coordinates === null || draftMarkerState === null) {
        draggingDraft = false;
        if (pointerTarget.type === "draft") {
          pointerTarget = { type: "background" };
        }
      }
      if (ready) {
        reconcileDraftGraphic();
        updateMapCursor();
      }
    },
    setWildfireHazardVisible: async () => undefined,
    resize: () => {
      // The map component observes its host size; retain the engine-neutral hook.
    },
    destroy: () => {
      if (destroyed) {
        return;
      }

      destroyed = true;
      pointerHitTestSequence += 1;
      clickHitTestSequence += 1;
      dragHitTestSequence += 1;
      navigationSequence += 1;
      mapElement.removeEventListener("arcgisLoadError", handleLoadError);
      mapElement.removeEventListener("arcgisViewClick", handleMapClick);
      mapElement.removeEventListener("arcgisViewDrag", handleMapDrag);
      mapElement.removeEventListener(
        "arcgisViewPointerMove",
        handlePointerMove,
      );
      mapElement.removeEventListener(
        "arcgisViewPointerLeave",
        handlePointerLeave,
      );
      if (layersInstalled) {
        mapElement.map?.remove(listingsLayer);
        mapElement.map?.remove(draftLayer);
      }
      listingsLayer.removeAll();
      draftLayer.removeAll();
      graphicsByListingId.clear();
      draftGraphic = null;
      mapElement.remove();
      void mapElement.destroy().catch(() => undefined);
    },
  };

  function reportInitializationError(): void {
    if (destroyed || initializationSettled) {
      return;
    }
    initializationSettled = true;
    options.onError(new ArcgisListingsMapInitializationError());
  }

  function reconcileListingGraphics(): void {
    const retainedListingIds = new Set<string>();

    for (const listing of currentListings) {
      retainedListingIds.add(listing.id);
      const geometry = new Point({
        latitude: listing.latitude,
        longitude: listing.longitude,
      });
      const symbol =
        listing.id === currentSelectedListingId
          ? selectedMarkerSymbol
          : defaultMarkerSymbol;
      const existingGraphic = graphicsByListingId.get(listing.id);

      if (existingGraphic === undefined) {
        const graphic = new Graphic({
          attributes: { listingId: listing.id },
          geometry,
          symbol,
        });
        graphicsByListingId.set(listing.id, graphic);
        listingsLayer.add(graphic);
      } else {
        existingGraphic.attributes = { listingId: listing.id };
        existingGraphic.geometry = geometry;
        existingGraphic.symbol = symbol;
      }
    }

    for (const [listingId, graphic] of graphicsByListingId) {
      if (!retainedListingIds.has(listingId)) {
        listingsLayer.remove(graphic);
        graphicsByListingId.delete(listingId);
      }
    }
  }

  function reconcileDraftGraphic(): void {
    const coordinates = draftMarkerState?.coordinates;
    if (coordinates === undefined || coordinates === null) {
      if (draftGraphic !== null) {
        draftLayer.remove(draftGraphic);
        draftGraphic = null;
      }
      return;
    }

    const geometry = createPoint(coordinates);
    const symbol = draftMarkerState?.confirmed === true
      ? confirmedDraftMarkerSymbol
      : draftMarkerSymbol;
    if (draftGraphic === null) {
      draftGraphic = new Graphic({
        attributes: { kind: "draft-listing" },
        geometry,
        symbol,
      });
      draftLayer.add(draftGraphic);
      return;
    }

    draftGraphic.geometry = geometry;
    draftGraphic.symbol = symbol;
  }

  async function findInteractiveHitAt(
    hitTarget: ClickEvent | PointerMoveEvent,
  ): Promise<InteractiveHit> {
    const response = await mapElement.hitTest(hitTarget, {
      include:
        draftGraphic === null
          ? listingsLayer
          : [listingsLayer, draftLayer],
    });
    const listingResult = response.results.find(
      (candidate) =>
        candidate.type === "graphic" && candidate.layer === listingsLayer,
    );
    if (listingResult?.type === "graphic") {
      const attributes: unknown = listingResult.graphic.attributes;
      if (
        typeof attributes === "object" &&
        attributes !== null &&
        "listingId" in attributes
      ) {
        const listingId = (attributes as { listingId?: unknown }).listingId;
        if (typeof listingId === "string") {
          return { listingId, type: "listing" };
        }
      }
    }

    const draftResult = response.results.find(
      (candidate) =>
        candidate.type === "graphic" &&
        candidate.layer === draftLayer &&
        candidate.graphic === draftGraphic,
    );
    return draftResult?.type === "graphic"
      ? { type: "draft" }
      : { type: "background" };
  }

  async function isDraftHitAt(hitTarget: DragEvent): Promise<boolean> {
    const response = await mapElement.hitTest(hitTarget, {
      include: draftLayer,
    });
    return response.results.some(
      (candidate) =>
        candidate.type === "graphic" &&
        candidate.layer === draftLayer &&
        candidate.graphic === draftGraphic,
    );
  }

  function runPendingNavigation(navigation: PendingNavigation): void {
    if (navigation.type === "focus") {
      setZeroPadding();
      const currentZoom = Number.isFinite(mapElement.zoom)
        ? mapElement.zoom
        : INITIAL_ZOOM;
      runNavigation(
        {
          center: [navigation.listing.longitude, navigation.listing.latitude],
          zoom: Math.max(currentZoom, SINGLE_LISTING_ZOOM),
        },
        { animate: true, duration: FOCUS_DURATION_MS },
      );
      return;
    }

    const listings = navigation.listings.filter(
      (listing) =>
        Number.isFinite(listing.latitude) &&
        Number.isFinite(listing.longitude),
    );
    if (listings.length === 0) {
      return;
    }
    if (listings.length === 1) {
      const listing = listings[0];
      if (listing !== undefined) {
        setZeroPadding();
        runNavigation(
          {
            center: [listing.longitude, listing.latitude],
            zoom: SINGLE_LISTING_ZOOM,
          },
          { animate: false },
        );
      }
      return;
    }

    const extent = createListingExtent(listings);
    if (extent.width === 0 && extent.height === 0) {
      const listing = listings[0];
      if (listing !== undefined) {
        setZeroPadding();
        runNavigation(
          {
            center: [listing.longitude, listing.latitude],
            zoom: SINGLE_LISTING_ZOOM,
          },
          { animate: false },
        );
      }
      return;
    }

    mapElement.padding = {
      bottom: MULTI_LISTING_PADDING,
      left: MULTI_LISTING_PADDING,
      right: MULTI_LISTING_PADDING,
      top: MULTI_LISTING_PADDING,
    };
    runNavigation(extent, { animate: false }, () => {
      if (mapElement.zoom > MAX_MULTI_LISTING_ZOOM) {
        mapElement.zoom = MAX_MULTI_LISTING_ZOOM;
      }
      setZeroPadding();
    });
  }

  function runNavigation(
    target: GoToTarget2D,
    navigationOptions: GoToOptions2D,
    onComplete?: () => void,
  ): void {
    const sequence = ++navigationSequence;
    void mapElement
      .goTo(target, navigationOptions)
      .then(() => {
        if (!destroyed && sequence === navigationSequence) {
          onComplete?.();
        }
      })
      .catch((error: unknown) => {
        if (
          !destroyed &&
          sequence === navigationSequence &&
          !isAbortError(error)
        ) {
          onComplete?.();
        }
      });
  }

  function setZeroPadding(): void {
    mapElement.padding = { bottom: 0, left: 0, right: 0, top: 0 };
  }

  function updateMapCursor(): void {
    if (draggingDraft) {
      setMapCursor("grabbing");
      return;
    }
    if (pointerTarget.type === "listing") {
      setMapCursor("pointer");
      return;
    }
    if (pointerTarget.type === "draft" && draftGraphic !== null) {
      setMapCursor("grab");
      return;
    }
    setMapCursor(draftMarkerState === null ? "" : "crosshair");
  }

  function setMapCursor(cursor: MapCursor): void {
    mapElement.style.cursor = cursor;
    const viewContainer = mapElement.view.container;
    if (viewContainer !== null && viewContainer !== undefined) {
      viewContainer.style.cursor = cursor;
    }
  }
}

type PendingNavigation =
  | { type: "fit"; listings: ListingSummary[] }
  | { type: "focus"; listing: ListingSummary };

type InteractiveHit =
  | { type: "background" }
  | { type: "draft" }
  | { listingId: string; type: "listing" };

type MapCursor = "" | "crosshair" | "grab" | "grabbing" | "pointer";

function createListingMarkerSymbol(
  selected: boolean,
): SimpleMarkerSymbolProperties & { type: "simple-marker" } {
  return {
    color: selected ? SELECTED_MARKER_COLOR : DEFAULT_MARKER_COLOR,
    outline: { color: "#ffffff", type: "simple-line", width: "2px" },
    size: selected ? "18px" : "14px",
    style: "circle",
    type: "simple-marker",
  };
}

function createDraftMarkerSymbol(confirmed: boolean): PictureMarkerSymbol {
  const markerPath =
    "M13.5 1C6.6 1 1 6.6 1 13.5C1 22.7 13.5 40 13.5 40S26 22.7 26 13.5C26 6.6 20.4 1 13.5 1Z";
  const confirmationHalo = confirmed
    ? `<path d="${markerPath}" fill="${DRAFT_MARKER_COLOR}" stroke="${DRAFT_CONFIRMED_COLOR}" stroke-width="4"/>`
    : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="27" height="41" viewBox="0 0 27 41">${confirmationHalo}<path d="${markerPath}" fill="${DRAFT_MARKER_COLOR}" stroke="#ffffff" stroke-width="2"/><circle cx="13.5" cy="13.5" r="5" fill="#ffffff"/></svg>`;
  return new PictureMarkerSymbol({
    height: "41px",
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    width: "27px",
    yoffset: "20.5px",
  });
}

function cloneDraftMarker(
  draftMarker: DraftMarkerPresentation | null,
): DraftMarkerPresentation | null {
  if (draftMarker === null) {
    return null;
  }
  return {
    confirmed: draftMarker.confirmed,
    coordinates:
      draftMarker.coordinates === null
        ? null
        : { ...draftMarker.coordinates },
  };
}

function createPoint(coordinates: ListingCoordinates): Point {
  return new Point({
    latitude: coordinates.latitude,
    longitude: coordinates.longitude,
  });
}

function toListingCoordinates(point: Point | null | undefined): ListingCoordinates | null {
  if (point === null || point === undefined) {
    return null;
  }
  const latitude = point.latitude;
  const longitude = point.longitude;
  if (
    typeof latitude !== "number" ||
    typeof longitude !== "number" ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return null;
  }
  return { latitude, longitude };
}

function createListingExtent(listings: ListingSummary[]): Extent {
  let xmin = Number.POSITIVE_INFINITY;
  let ymin = Number.POSITIVE_INFINITY;
  let xmax = Number.NEGATIVE_INFINITY;
  let ymax = Number.NEGATIVE_INFINITY;

  for (const listing of listings) {
    xmin = Math.min(xmin, listing.longitude);
    ymin = Math.min(ymin, listing.latitude);
    xmax = Math.max(xmax, listing.longitude);
    ymax = Math.max(ymax, listing.latitude);
  }

  return new Extent({
    spatialReference: { wkid: 4326 },
    xmax,
    xmin,
    ymax,
    ymin,
  });
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: unknown }).name === "AbortError"
  );
}
