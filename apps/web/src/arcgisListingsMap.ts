import Graphic from "@arcgis/core/Graphic.js";
import Extent from "@arcgis/core/geometry/Extent.js";
import Point from "@arcgis/core/geometry/Point.js";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer.js";
import type { SimpleMarkerSymbolProperties } from "@arcgis/core/symbols/SimpleMarkerSymbol.js";
import type {
  ClickEvent,
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
  ListingsMapDriver,
} from "./listingsMapDriver.js";

const INITIAL_CENTER = [-117.58, 33.94] as const;
const INITIAL_ZOOM = 10;
const SINGLE_LISTING_ZOOM = 12.5;
const MAX_MULTI_LISTING_ZOOM = 13;
const MULTI_LISTING_PADDING = 56;
const FOCUS_DURATION_MS = 450;
const LISTING_LAYER_ID = "stored-listings";
const DEFAULT_MARKER_COLOR = "#0d6e6e";
const SELECTED_MARKER_COLOR = "#a24f2a";

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
  const defaultMarkerSymbol = createListingMarkerSymbol(false);
  const selectedMarkerSymbol = createListingMarkerSymbol(true);
  const graphicsByListingId = new Map<string, Graphic>();

  let currentListings: ListingSummary[] = [];
  let currentSelectedListingId: string | null = null;
  let pendingNavigation: PendingNavigation | null = null;
  let ready = false;
  let initializationSettled = false;
  let destroyed = false;
  let layerInstalled = false;
  let pointerHitTestSequence = 0;
  let clickHitTestSequence = 0;
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
    void findListingIdAt(hitTarget)
      .then((listingId) => {
        if (
          !destroyed &&
          ready &&
          sequence === clickHitTestSequence &&
          listingId !== null
        ) {
          options.onSelect(listingId);
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
    void findListingIdAt(hitTarget)
      .then((listingId) => {
        if (!destroyed && ready && sequence === pointerHitTestSequence) {
          setMapCursor(listingId === null ? "" : "pointer");
        }
      })
      .catch(() => {
        if (!destroyed && ready && sequence === pointerHitTestSequence) {
          setMapCursor("");
        }
      });
  };
  const handlePointerLeave = (): void => {
    pointerHitTestSequence += 1;
    setMapCursor("");
  };

  mapElement.addEventListener("arcgisLoadError", handleLoadError);
  mapElement.addEventListener("arcgisViewClick", handleMapClick);
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
      layerInstalled = true;
      ready = true;
      initializationSettled = true;
      reconcileListingGraphics();

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
    updateDraftMarker: () => undefined,
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
      navigationSequence += 1;
      mapElement.removeEventListener("arcgisLoadError", handleLoadError);
      mapElement.removeEventListener("arcgisViewClick", handleMapClick);
      mapElement.removeEventListener(
        "arcgisViewPointerMove",
        handlePointerMove,
      );
      mapElement.removeEventListener(
        "arcgisViewPointerLeave",
        handlePointerLeave,
      );
      if (layerInstalled) {
        mapElement.map?.remove(listingsLayer);
      }
      listingsLayer.removeAll();
      graphicsByListingId.clear();
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

  async function findListingIdAt(
    hitTarget: ClickEvent | PointerMoveEvent,
  ): Promise<string | null> {
    const response = await mapElement.hitTest(hitTarget, {
      include: listingsLayer,
    });
    const result = response.results.find(
      (candidate) =>
        candidate.type === "graphic" && candidate.layer === listingsLayer,
    );
    if (result?.type !== "graphic") {
      return null;
    }

    const attributes: unknown = result.graphic.attributes;
    if (
      typeof attributes !== "object" ||
      attributes === null ||
      !("listingId" in attributes)
    ) {
      return null;
    }
    const listingId = (attributes as { listingId?: unknown }).listingId;
    return typeof listingId === "string" ? listingId : null;
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

  function setMapCursor(cursor: "" | "pointer"): void {
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
