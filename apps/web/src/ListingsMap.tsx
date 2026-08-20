import { AlertCircle, RefreshCw } from "lucide-react";
import {
  GeoJSONSource,
  LngLatBounds,
  Map as MapLibreMap,
  NavigationControl,
  setWorkerUrl,
} from "maplibre-gl";
import mapLibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { useEffect, useRef, useState } from "react";

import { listingsToFeatureCollection } from "./listingGeoJson.js";
import type { ListingSummary } from "./listingsApi.js";

const LISTINGS_SOURCE_ID = "stored-listings";
const LISTINGS_LAYER_ID = "stored-listing-points";
const OPEN_FREE_MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";

setWorkerUrl(mapLibreWorkerUrl);

export interface ListingsMapProps {
  listings: ListingSummary[];
  selectedListingId: string | null;
  onSelect: (listingId: string) => void;
  createMap?: CreateListingsMap;
}

export interface ListingsMapDriver {
  updateListings: (
    listings: ListingSummary[],
    selectedListingId: string | null,
  ) => void;
  fitToListings: (listings: ListingSummary[]) => void;
  focusListing: (listing: ListingSummary) => void;
  resize: () => void;
  destroy: () => void;
}

interface CreateListingsMapOptions {
  container: HTMLElement;
  onSelect: (listingId: string) => void;
  onReady: () => void;
  onError: (error: unknown) => void;
}

export type CreateListingsMap = (
  options: CreateListingsMapOptions,
) => ListingsMapDriver;

export function ListingsMap({
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
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );

  listingsRef.current = listings;
  selectedListingIdRef.current = selectedListingId;
  onSelectRef.current = onSelect;

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }

    let active = true;
    let driver: ListingsMapDriver | null = null;
    setStatus("loading");

    try {
      driver = createMap({
        container,
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
    </section>
  );
}

export const createMapLibreListingsMap: CreateListingsMap = ({
  container,
  onSelect,
  onReady,
  onError,
}) => {
  let ready = false;
  let collection = listingsToFeatureCollection([], null);
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
      map.getCanvas().style.cursor = "";
    });

    ready = true;
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
    resize: () => map.resize(),
    destroy: () => map.remove(),
  };
};
