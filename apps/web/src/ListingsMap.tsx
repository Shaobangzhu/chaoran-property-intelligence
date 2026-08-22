import { AlertCircle, Check, MapPin, RefreshCw } from "lucide-react";
import {
  GeoJSONSource,
  LngLatBounds,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  setWorkerUrl,
} from "maplibre-gl";
import mapLibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { useEffect, useRef, useState } from "react";

import { listingsToFeatureCollection } from "./listingGeoJson.js";
import type { ListingSummary } from "./listingsApi.js";
import { WildfireHazardControl } from "./WildfireHazardControl.js";
import {
  createMapLibreWildfireHazardMapAdapter,
  createWildfireHazardOverlayController,
  type WildfireHazardOverlayController,
  type WildfireHazardOverlayState,
} from "./wildfireHazardOverlay.js";

const LISTINGS_SOURCE_ID = "stored-listings";
const LISTINGS_LAYER_ID = "stored-listing-points";
const OPEN_FREE_MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";

setWorkerUrl(mapLibreWorkerUrl);

export interface ListingsMapProps {
  draftMarker?: DraftMarkerController;
  listings: ListingSummary[];
  selectedListingId: string | null;
  onSelect: (listingId: string) => void;
  createMap?: CreateListingsMap;
}

export interface ListingCoordinates {
  latitude: number;
  longitude: number;
}

export interface DraftMarkerController extends DraftMarkerPresentation {
  onConfirm: () => void;
  onCoordinatesChange: (coordinates: ListingCoordinates) => void;
}

export interface DraftMarkerPresentation {
  confirmed: boolean;
  coordinates: ListingCoordinates | null;
}

export interface ListingsMapDriver {
  updateListings: (
    listings: ListingSummary[],
    selectedListingId: string | null,
  ) => void;
  fitToListings: (listings: ListingSummary[]) => void;
  focusListing: (listing: ListingSummary) => void;
  updateDraftMarker: (draftMarker: DraftMarkerPresentation | null) => void;
  setWildfireHazardVisible: (visible: boolean) => Promise<void>;
  resize: () => void;
  destroy: () => void;
}

interface CreateListingsMapOptions {
  container: HTMLElement;
  onSelect: (listingId: string) => void;
  onDraftCoordinatesChange: (coordinates: ListingCoordinates) => void;
  onWildfireHazardStateChange: (
    state: WildfireHazardOverlayState,
  ) => void;
  onReady: () => void;
  onError: (error: unknown) => void;
}

export type CreateListingsMap = (
  options: CreateListingsMapOptions,
) => ListingsMapDriver;

export function ListingsMap({
  draftMarker,
  listings,
  selectedListingId,
  onSelect,
  createMap = createMapLibreListingsMap,
}: ListingsMapProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const driverRef = useRef<ListingsMapDriver | null>(null);
  const listingsRef = useRef(listings);
  const selectedListingIdRef = useRef(selectedListingId);
  const onSelectRef = useRef(onSelect);
  const draftMarkerRef = useRef(draftMarker);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [wildfireHazardEnabled, setWildfireHazardEnabled] = useState(false);
  const [wildfireHazardState, setWildfireHazardState] =
    useState<WildfireHazardOverlayState>({
      status: "idle",
      visible: false,
    });

  listingsRef.current = listings;
  selectedListingIdRef.current = selectedListingId;
  onSelectRef.current = onSelect;
  draftMarkerRef.current = draftMarker;

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }

    let active = true;
    let driver: ListingsMapDriver | null = null;
    setStatus("loading");
    setWildfireHazardEnabled(false);
    setWildfireHazardState({ status: "idle", visible: false });

    try {
      driver = createMap({
        container,
        onDraftCoordinatesChange: (coordinates) =>
          draftMarkerRef.current?.onCoordinatesChange(coordinates),
        onWildfireHazardStateChange: (state) => {
          if (active) {
            setWildfireHazardState(state);
            if (state.status === "error") {
              setWildfireHazardEnabled(false);
            }
          }
        },
        onSelect: (listingId) => onSelectRef.current(listingId),
        onReady: () => {
          if (active) {
            setStatus("ready");
            driver?.fitToListings(listingsRef.current);
          }
        },
        onError: () => {
          if (active) {
            setStatus("error");
          }
        },
      });
      driverRef.current = driver;
      driver.updateListings(
        listingsRef.current,
        selectedListingIdRef.current,
      );
      driver.updateDraftMarker(toDraftMarkerPresentation(draftMarkerRef.current));
    } catch {
      setStatus("error");
    }

    const resizeMap = (): void => driver?.resize();
    window.addEventListener("resize", resizeMap);
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => driver?.resize());
    resizeObserver?.observe(container);

    return () => {
      active = false;
      window.removeEventListener("resize", resizeMap);
      resizeObserver?.disconnect();
      driver?.destroy();
      if (driverRef.current === driver) {
        driverRef.current = null;
      }
    };
  }, [attempt, createMap]);

  useEffect(() => {
    driverRef.current?.updateListings(listings, selectedListingId);
  }, [listings, selectedListingId]);

  const setWildfireHazardVisibility = (visible: boolean): void => {
    setWildfireHazardEnabled(visible);
    void driverRef.current?.setWildfireHazardVisible(visible);
  };

  useEffect(() => {
    driverRef.current?.updateDraftMarker(
      toDraftMarkerPresentation(draftMarker),
    );
  }, [draftMarker]);

  useEffect(() => {
    if (selectedListingId === null) {
      return;
    }

    const selectedListing = listings.find(
      (listing) => listing.id === selectedListingId,
    );
    if (selectedListing !== undefined) {
      driverRef.current?.focusListing(selectedListing);
    }
  }, [listings, selectedListingId]);

  return (
    <section className="listings-map" aria-label="Listings map">
      <div className="map-canvas" ref={containerRef} />
      {status === "loading" ? (
        <div className="map-state" role="status">
          Loading map
        </div>
      ) : null}
      {status === "error" ? (
        <div className="map-state map-error" role="alert">
          <AlertCircle aria-hidden="true" size={24} strokeWidth={1.7} />
          <strong>Map unavailable</strong>
          <button
            className="retry-button map-retry-button"
            type="button"
            onClick={() => setAttempt((value) => value + 1)}
          >
            <RefreshCw aria-hidden="true" size={15} strokeWidth={2} />
            Retry map
          </button>
        </div>
      ) : null}
      {status === "ready" ? (
        <WildfireHazardControl
          enabled={wildfireHazardEnabled}
          state={wildfireHazardState}
          onEnabledChange={setWildfireHazardVisibility}
          onRetry={() => setWildfireHazardVisibility(true)}
        />
      ) : null}
      {status === "ready" && draftMarker !== undefined ? (
        <div className="draft-marker-controls" aria-live="polite">
          <div className="draft-marker-status">
            <MapPin aria-hidden="true" size={18} />
            <span>
              {draftMarker.coordinates === null
                ? "Click map to place marker"
                : formatCoordinates(draftMarker.coordinates)}
            </span>
          </div>
          <button
            className="map-confirm-button"
            type="button"
            disabled={draftMarker.coordinates === null || draftMarker.confirmed}
            onClick={draftMarker.onConfirm}
          >
            <Check aria-hidden="true" size={16} />
            {draftMarker.confirmed ? "Marker confirmed" : "Confirm marker"}
          </button>
        </div>
      ) : null}
    </section>
  );
}

export const createMapLibreListingsMap: CreateListingsMap = ({
  container,
  onDraftCoordinatesChange,
  onSelect,
  onWildfireHazardStateChange,
  onReady,
  onError,
}) => {
  let ready = false;
  let collection = listingsToFeatureCollection([], null);
  let draftMarkerState: DraftMarkerPresentation | null = null;
  let draftMarker: Marker | null = null;
  let wildfireHazardOverlay: WildfireHazardOverlayController | null = null;
  let wildfireHazardVisible = false;
  const map = new MapLibreMap({
    center: [-117.58, 33.94],
    container,
    style: OPEN_FREE_MAP_STYLE,
    zoom: 10,
  });

  map.addControl(new NavigationControl({ showCompass: false }), "top-right");

  map.on("load", () => {
    map.addSource(LISTINGS_SOURCE_ID, {
      type: "geojson",
      data: collection,
    });
    map.addLayer({
      id: LISTINGS_LAYER_ID,
      type: "circle",
      source: LISTINGS_SOURCE_ID,
      paint: {
        "circle-color": [
          "case",
          ["boolean", ["get", "selected"], false],
          "#a24f2a",
          "#0d6e6e",
        ],
        "circle-radius": [
          "case",
          ["boolean", ["get", "selected"], false],
          9,
          7,
        ],
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2,
      },
    });

    wildfireHazardOverlay = createWildfireHazardOverlayController({
      beforeLayerId: LISTINGS_LAYER_ID,
      map: createMapLibreWildfireHazardMapAdapter(map),
      onStateChange: onWildfireHazardStateChange,
    });
    if (wildfireHazardVisible) {
      void wildfireHazardOverlay.setVisible(true);
    }

    map.on("click", LISTINGS_LAYER_ID, (event) => {
      const listingId = event.features?.[0]?.properties.id;
      if (typeof listingId === "string") {
        onSelect(listingId);
      }
    });
    map.on("mouseenter", LISTINGS_LAYER_ID, () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", LISTINGS_LAYER_ID, () => {
      updateCanvasCursor();
    });

    map.on("click", (event) => {
      if (draftMarkerState === null) {
        return;
      }
      const listingFeatures = map.queryRenderedFeatures(event.point, {
        layers: [LISTINGS_LAYER_ID],
      });
      if (listingFeatures.length > 0) {
        return;
      }
      onDraftCoordinatesChange({
        latitude: event.lngLat.lat,
        longitude: event.lngLat.lng,
      });
    });

    ready = true;
    renderDraftMarker();
    updateCanvasCursor();
    onReady();
  });

  map.on("error", (event) => {
    if (!ready) {
      onError(event.error);
    }
  });

  return {
    updateListings: (listings, selectedListingId) => {
      collection = listingsToFeatureCollection(listings, selectedListingId);
      if (ready) {
        const source = map.getSource(LISTINGS_SOURCE_ID);
        if (source instanceof GeoJSONSource) {
          source.setData(collection);
        }
      }
    },
    fitToListings: (listings) => {
      if (listings.length === 0) {
        return;
      }
      if (listings.length === 1) {
        const listing = listings[0];
        if (listing !== undefined) {
          map.easeTo({
            center: [listing.longitude, listing.latitude],
            duration: 0,
            zoom: 12.5,
          });
        }
        return;
      }

      const bounds = new LngLatBounds();
      for (const listing of listings) {
        bounds.extend([listing.longitude, listing.latitude]);
      }
      map.fitBounds(bounds, { duration: 0, maxZoom: 13, padding: 56 });
    },
    focusListing: (listing) => {
      map.easeTo({
        center: [listing.longitude, listing.latitude],
        duration: 450,
        zoom: Math.max(map.getZoom(), 12.5),
      });
    },
    updateDraftMarker: (nextDraftMarker) => {
      draftMarkerState = nextDraftMarker;
      if (ready) {
        renderDraftMarker();
        updateCanvasCursor();
      }
    },
    setWildfireHazardVisible: async (visible) => {
      wildfireHazardVisible = visible;
      await wildfireHazardOverlay?.setVisible(visible);
    },
    resize: () => map.resize(),
    destroy: () => {
      wildfireHazardOverlay?.destroy();
      draftMarker?.remove();
      map.remove();
    },
  };

  function renderDraftMarker(): void {
    const coordinates = draftMarkerState?.coordinates;
    if (coordinates === undefined || coordinates === null) {
      draftMarker?.remove();
      draftMarker = null;
      return;
    }

    if (draftMarker === null) {
      draftMarker = new Marker({ color: "#a24f2a", draggable: true })
        .setLngLat([coordinates.longitude, coordinates.latitude])
        .addTo(map);
      draftMarker.on("dragend", () => {
        const position = draftMarker?.getLngLat();
        if (position !== undefined) {
          onDraftCoordinatesChange({
            latitude: position.lat,
            longitude: position.lng,
          });
        }
      });
    } else {
      draftMarker.setLngLat([coordinates.longitude, coordinates.latitude]);
    }
    draftMarker
      .getElement()
      .classList.toggle("is-confirmed", draftMarkerState?.confirmed === true);
  }

  function updateCanvasCursor(): void {
    map.getCanvas().style.cursor =
      draftMarkerState === null ? "" : "crosshair";
  }
};

function toDraftMarkerPresentation(
  draftMarker: DraftMarkerController | undefined,
): DraftMarkerPresentation | null {
  return draftMarker === undefined
    ? null
    : {
        confirmed: draftMarker.confirmed,
        coordinates: draftMarker.coordinates,
      };
}

function formatCoordinates(coordinates: ListingCoordinates): string {
  return `${coordinates.latitude.toFixed(6)}, ${coordinates.longitude.toFixed(6)}`;
}
