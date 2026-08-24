import { AlertCircle, Check, MapPin, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { createArcgisListingsMap } from "./arcgisListingsMap.js";
import type { ListingSummary } from "./listingsApi.js";
import type {
  CreateListingsMap,
  DraftMarkerPresentation,
  ListingCoordinates,
  ListingsMapDriver,
} from "./listingsMapDriver.js";
import { WildfireHazardControl } from "./WildfireHazardControl.js";
import type { WildfireHazardOverlayState } from "./wildfireHazardOverlay.js";

export type {
  CreateListingsMap,
  CreateListingsMapOptions,
  DraftMarkerPresentation,
  ListingCoordinates,
  ListingsMapDriver,
} from "./listingsMapDriver.js";

export interface ListingsMapProps {
  draftMarker?: DraftMarkerController;
  listings: ListingSummary[];
  selectedListingId: string | null;
  onSelect: (listingId: string) => void;
  createMap?: CreateListingsMap;
}

export interface DraftMarkerController extends DraftMarkerPresentation {
  onConfirm: () => void;
  onCoordinatesChange: (coordinates: ListingCoordinates) => void;
}

export function ListingsMap({
  draftMarker,
  listings,
  selectedListingId,
  onSelect,
  createMap = createArcgisListingsMap,
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
