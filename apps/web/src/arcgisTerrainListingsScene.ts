import Graphic, { type GraphicProperties } from "@arcgis/core/Graphic.js";
import Point from "@arcgis/core/geometry/Point.js";
import type ArcgisMap from "@arcgis/core/Map.js";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer.js";
import type {
  ClickEvent,
  PointerMoveEvent,
} from "@arcgis/core/views/input/types.js";
import type {
  GoToOptions3D,
  GoToTarget3D,
} from "@arcgis/core/views/types.js";

import { initializeArcgisRuntime } from "./arcgisRuntime.js";
import {
  createArcgisTerrainWildfireHazardOverlayController,
} from "./arcgisTerrainWildfireHazardOverlay.js";
import type {
  CreateArcgisWildfireHazardOverlayOptions,
} from "./arcgisWildfireHazardOverlay.js";
import type { ListingSummary } from "./listingsApi.js";
import type {
  CreateListingsMap,
  CreateListingsMapOptions,
  ListingsMapDriver,
} from "./listingsMapDriver.js";
import type {
  WildfireHazardOverlayController,
} from "./wildfireHazardOverlay.js";

const INITIAL_CAMERA_POSITION = [-117.58, 33.65, 45_000] as const;
const INITIAL_CAMERA_HEADING = 0;
const INITIAL_CAMERA_TILT = 55;
const FIT_CAMERA_TILT = 58;
const FOCUS_CAMERA_TILT = 62;
const SINGLE_LISTING_ZOOM = 14;
const MIN_MULTI_LISTING_ZOOM = 9.5;
const MAX_MULTI_LISTING_ZOOM = 12.5;
const FOCUS_MIN_ZOOM = 14;
const FOCUS_MAX_ZOOM = 15;
const MULTI_LISTING_REFERENCE_SPAN = 0.08;
const LISTING_LAYER_ID = "terrain-stored-listings";
const LISTING_ELEVATION_OFFSET_METERS = 8;
const DEFAULT_MARKER_COLOR = "#0d6e6e";
const SELECTED_MARKER_COLOR = "#a24f2a";

type ArcgisSceneElement = HTMLElementTagNameMap["arcgis-scene"];
type ArcgisZoomElement = HTMLElementTagNameMap["arcgis-zoom"];

export interface ArcgisTerrainListingsSceneDependencies {
  initializeRuntime: () => void;
  supportsWebGL2: () => boolean;
  createSceneElement: () => ArcgisSceneElement;
  createWildfireHazardOverlay: (
    options: CreateArcgisWildfireHazardOverlayOptions,
  ) => WildfireHazardOverlayController;
  createZoomElement: () => ArcgisZoomElement;
  loadGround: (map: ArcgisMap) => Promise<void>;
}

export class ArcgisTerrainListingsSceneInitializationError extends Error {
  public constructor() {
    super("ArcGIS terrain listings scene is unavailable.");
    this.name = "ArcgisTerrainListingsSceneInitializationError";
  }
}

const defaultDependencies: ArcgisTerrainListingsSceneDependencies = {
  initializeRuntime: initializeArcgisRuntime,
  supportsWebGL2: () => typeof WebGL2RenderingContext !== "undefined",
  createSceneElement: () => document.createElement("arcgis-scene"),
  createWildfireHazardOverlay:
    createArcgisTerrainWildfireHazardOverlayController,
  createZoomElement: () => document.createElement("arcgis-zoom"),
  loadGround: async (map) => {
    await map.ground.load();
    if (map.ground.layers.length === 0) {
      throw new ArcgisTerrainListingsSceneInitializationError();
    }
  },
};

export const createArcgisTerrainListingsScene: CreateListingsMap = (options) =>
  createArcgisTerrainListingsSceneWithDependencies(options, defaultDependencies);

export function createArcgisTerrainListingsSceneWithDependencies(
  options: CreateListingsMapOptions,
  dependencies: ArcgisTerrainListingsSceneDependencies,
): ListingsMapDriver {
  if (!dependencies.supportsWebGL2()) {
    options.onError(new ArcgisTerrainListingsSceneInitializationError());
    return createInertSceneDriver();
  }

  dependencies.initializeRuntime();

  const sceneElement = dependencies.createSceneElement();
  const zoomElement = dependencies.createZoomElement();
  const listingsLayer = new GraphicsLayer({
    elevationInfo: {
      mode: "relative-to-ground",
      offset: LISTING_ELEVATION_OFFSET_METERS,
      unit: "meters",
    },
    id: LISTING_LAYER_ID,
    listMode: "hide",
    screenSizePerspectiveEnabled: false,
    title: "Stored listings",
  });
  const defaultMarkerSymbol = createListingMarkerSymbol(false);
  const selectedMarkerSymbol = createListingMarkerSymbol(true);
  const graphicsByListingId = new Map<string, Graphic>();

  let currentListings: ListingSummary[] = [];
  let currentSelectedListingId: string | null = null;
  let wildfireHazardOverlay: WildfireHazardOverlayController | null = null;
  let wildfireHazardVisible = false;
  let pendingNavigation: PendingNavigation | null = null;
  let ready = false;
  let initializationSettled = false;
  let destroyed = false;
  let layerInstalled = false;
  let clickHitTestSequence = 0;
  let pointerHitTestSequence = 0;
  let navigationSequence = 0;

  sceneElement.className = "arcgis-terrain-listings-scene";
  sceneElement.autoDestroyDisabled = true;
  sceneElement.basemap = "arcgis/navigation";
  sceneElement.ground = "world-elevation";
  sceneElement.viewingMode = "local";
  sceneElement.cameraPosition = [...INITIAL_CAMERA_POSITION];
  sceneElement.cameraHeading = INITIAL_CAMERA_HEADING;
  sceneElement.cameraTilt = INITIAL_CAMERA_TILT;
  sceneElement.popupDisabled = true;
  sceneElement.hideAttribution = false;
  zoomElement.slot = "top-right";
  sceneElement.append(zoomElement);

  const handleLoadError = (): void => reportInitializationError();
  const handleSceneClick = (event: Event): void => {
    if (!ready || destroyed) {
      return;
    }

    const sequence = ++clickHitTestSequence;
    const hitTarget = (event as CustomEvent<ClickEvent>).detail;
    void findListingIdAt(hitTarget)
      .then((listingId) => {
        if (
          destroyed ||
          !ready ||
          sequence !== clickHitTestSequence ||
          listingId === null
        ) {
          return;
        }
        options.onSelect(listingId);
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
          setSceneCursor(listingId === null ? "" : "pointer");
        }
      })
      .catch(() => {
        if (!destroyed && ready && sequence === pointerHitTestSequence) {
          setSceneCursor("");
        }
      });
  };
  const handlePointerLeave = (): void => {
    pointerHitTestSequence += 1;
    setSceneCursor("");
  };

  sceneElement.addEventListener("arcgisLoadError", handleLoadError);
  sceneElement.addEventListener("arcgisViewClick", handleSceneClick);
  sceneElement.addEventListener("arcgisViewPointerMove", handlePointerMove);
  sceneElement.addEventListener("arcgisViewPointerLeave", handlePointerLeave);
  options.container.append(sceneElement);

  void sceneElement
    .viewOnReady()
    .then(async () => {
      const arcgisMap = sceneElement.map;
      if (destroyed || initializationSettled) {
        return;
      }
      if (arcgisMap === null || arcgisMap === undefined) {
        reportInitializationError();
        return;
      }

      await dependencies.loadGround(arcgisMap);
      if (destroyed || initializationSettled) {
        return;
      }

      arcgisMap.add(listingsLayer);
      layerInstalled = true;
      ready = true;
      initializationSettled = true;
      reconcileListingGraphics();
      updateSceneCursor();
      try {
        wildfireHazardOverlay = dependencies.createWildfireHazardOverlay({
          map: arcgisMap,
          onStateChange: options.onWildfireHazardStateChange,
        });
        if (wildfireHazardVisible) {
          void wildfireHazardOverlay.setVisible(true);
        }
      } catch {
        options.onWildfireHazardStateChange({
          status: "error",
          visible: false,
        });
      }

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
        listings: [...listings],
        type: "fit",
      };
      if (!ready) {
        pendingNavigation = navigation;
        return;
      }
      runPendingNavigation(navigation);
    },
    focusListing: (listing) => {
      const navigation: PendingNavigation = { listing, type: "focus" };
      if (!ready) {
        pendingNavigation = navigation;
        return;
      }
      runPendingNavigation(navigation);
    },
    updateDraftMarker: () => {
      // Block 23.5 routes editing to the existing 2D placement workflow.
    },
    setWildfireHazardVisible: async (visible) => {
      wildfireHazardVisible = visible;
      await wildfireHazardOverlay?.setVisible(visible);
    },
    resize: () => {
      // The scene component observes its host size.
    },
    destroy: () => {
      if (destroyed) {
        return;
      }

      destroyed = true;
      clickHitTestSequence += 1;
      pointerHitTestSequence += 1;
      navigationSequence += 1;
      wildfireHazardOverlay?.destroy();
      wildfireHazardOverlay = null;
      sceneElement.removeEventListener("arcgisLoadError", handleLoadError);
      sceneElement.removeEventListener("arcgisViewClick", handleSceneClick);
      sceneElement.removeEventListener(
        "arcgisViewPointerMove",
        handlePointerMove,
      );
      sceneElement.removeEventListener(
        "arcgisViewPointerLeave",
        handlePointerLeave,
      );
      if (layerInstalled) {
        sceneElement.map?.remove(listingsLayer);
      }
      listingsLayer.removeAll();
      graphicsByListingId.clear();
      const componentReady = sceneElement.componentOnReady();
      sceneElement.remove();
      void componentReady
        .then(
          () => sceneElement.destroy(),
          () => sceneElement.destroy(),
        )
        .catch(() => undefined);
    },
  };

  function reportInitializationError(): void {
    if (destroyed || initializationSettled) {
      return;
    }
    initializationSettled = true;
    options.onError(new ArcgisTerrainListingsSceneInitializationError());
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
    const response = await sceneElement.hitTest(hitTarget, {
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
      sceneElement.cameraTilt = FOCUS_CAMERA_TILT;
      const currentZoom = Number.isFinite(sceneElement.zoom)
        ? sceneElement.zoom
        : FOCUS_MIN_ZOOM;
      runNavigation(
        {
          center: [
            navigation.listing.longitude,
            navigation.listing.latitude,
          ],
          zoom: clamp(
            Math.max(currentZoom, FOCUS_MIN_ZOOM),
            FOCUS_MIN_ZOOM,
            FOCUS_MAX_ZOOM,
          ),
        },
        { animate: true },
      );
      return;
    }

    const listings = navigation.listings.filter(hasFiniteCoordinates);
    if (listings.length === 0) {
      return;
    }
    if (listings.length === 1) {
      const listing = listings[0];
      if (listing !== undefined) {
        sceneElement.cameraTilt = FIT_CAMERA_TILT;
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

    const camera = createMultiListingCamera(listings);
    sceneElement.cameraTilt = FIT_CAMERA_TILT;
    runNavigation(camera, { animate: false });
  }

  function runNavigation(
    target: GoToTarget3D,
    navigationOptions: GoToOptions3D,
  ): void {
    const sequence = ++navigationSequence;
    void sceneElement.goTo(target, navigationOptions).catch((error: unknown) => {
      if (
        !destroyed &&
        sequence === navigationSequence &&
        !isAbortError(error)
      ) {
        updateSceneCursor();
      }
    });
  }

  function updateSceneCursor(): void {
    setSceneCursor("");
  }

  function setSceneCursor(cursor: "" | "pointer"): void {
    sceneElement.style.cursor = cursor;
    const viewContainer = sceneElement.view.container;
    if (viewContainer !== null && viewContainer !== undefined) {
      viewContainer.style.cursor = cursor;
    }
  }
}

type PendingNavigation =
  | { listings: ListingSummary[]; type: "fit" }
  | { listing: ListingSummary; type: "focus" };

function createListingMarkerSymbol(
  selected: boolean,
): NonNullable<GraphicProperties["symbol"]> {
  return {
    type: "point-3d",
    symbolLayers: [
      {
        material: {
          color: selected ? SELECTED_MARKER_COLOR : DEFAULT_MARKER_COLOR,
        },
        outline: { color: "#ffffff", size: 2 },
        resource: { primitive: "circle" },
        size: selected ? 18 : 14,
        type: "icon",
      },
    ],
  };
}

function createMultiListingCamera(
  listings: ListingSummary[],
): { center: [number, number]; zoom: number } {
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

  const span = Math.max(xmax - xmin, ymax - ymin);
  const zoom = clamp(
    MAX_MULTI_LISTING_ZOOM -
      Math.log2(Math.max(span, MULTI_LISTING_REFERENCE_SPAN) /
        MULTI_LISTING_REFERENCE_SPAN),
    MIN_MULTI_LISTING_ZOOM,
    MAX_MULTI_LISTING_ZOOM,
  );
  return {
    center: [(xmin + xmax) / 2, (ymin + ymax) / 2],
    zoom,
  };
}

function hasFiniteCoordinates(listing: ListingSummary): boolean {
  return (
    Number.isFinite(listing.latitude) && Number.isFinite(listing.longitude)
  );
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

function createInertSceneDriver(): ListingsMapDriver {
  return {
    updateListings: () => undefined,
    fitToListings: () => undefined,
    focusListing: () => undefined,
    updateDraftMarker: () => undefined,
    setWildfireHazardVisible: async () => undefined,
    resize: () => undefined,
    destroy: () => undefined,
  };
}
