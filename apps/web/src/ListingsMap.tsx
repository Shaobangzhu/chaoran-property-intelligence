import {
  AlertCircle,
  Check,
  Map as MapIcon,
  MapPin,
  Mountain,
  RefreshCw,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { createArcgisListingsMap } from "./arcgisListingsMap.js";
import {
  createLazyArcgisTerrainListingsScene,
} from "./lazyArcgisTerrainListingsScene.js";
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
  createTerrainMap?: CreateListingsMap;
}

export type ListingsMapMode = "2d" | "terrain-3d";

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
  createTerrainMap = createLazyArcgisTerrainListingsScene,
}: ListingsMapProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const twoDimensionalButtonRef = useRef<HTMLButtonElement>(null);
  const driverRef = useRef<ListingsMapDriver | null>(null);
  const listingsRef = useRef(listings);
  const selectedListingIdRef = useRef(selectedListingId);
  const onSelectRef = useRef(onSelect);
  const draftMarkerRef = useRef(draftMarker);
  const wildfireHazardEnabledRef = useRef(false);
  const focusTwoDimensionalButtonRef = useRef(false);
  const [attempt, setAttempt] = useState(0);
  const [mode, setMode] = useState<ListingsMapMode>("2d");
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
  const activeMode = draftMarker === undefined ? mode : "2d";
  const activeCreateMap =
    activeMode === "terrain-3d" ? createTerrainMap : createMap;

  useEffect(() => {
    if (draftMarker !== undefined && mode !== "2d") {
      setMode("2d");
    }
  }, [draftMarker, mode]);

  useEffect(() => {
    if (activeMode === "2d" && focusTwoDimensionalButtonRef.current) {
      focusTwoDimensionalButtonRef.current = false;
      twoDimensionalButtonRef.current?.focus();
    }
  }, [activeMode]);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }

    let active = true;
    let driver: ListingsMapDriver | null = null;
    setStatus("loading");
    setWildfireHazardState({ status: "idle", visible: false });

    try {
      driver = activeCreateMap({
        container,
        onDraftCoordinatesChange: (coordinates) => {
          if (active) {
            draftMarkerRef.current?.onCoordinatesChange(coordinates);
          }
        },
        onWildfireHazardStateChange: (state) => {
          if (active) {
            setWildfireHazardState(state);
            if (state.status === "error") {
              wildfireHazardEnabledRef.current = false;
              setWildfireHazardEnabled(false);
            }
          }
        },
        onSelect: (listingId) => {
          if (active) {
            onSelectRef.current(listingId);
          }
        },
        onReady: () => {
          if (active) {
            setStatus("ready");
            const currentListings = listingsRef.current;
            driver?.fitToListings(currentListings);

            const currentSelection = currentListings.find(
              (listing) => listing.id === selectedListingIdRef.current,
            );
            if (currentSelection !== undefined) {
              driver?.focusListing(currentSelection);
            }

            if (wildfireHazardEnabledRef.current) {
              void driver?.setWildfireHazardVisible(true);
            }
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
  }, [activeCreateMap, attempt]);

  useEffect(() => {
    driverRef.current?.updateListings(listings, selectedListingId);
  }, [listings, selectedListingId]);

  const setWildfireHazardVisibility = (visible: boolean): void => {
    wildfireHazardEnabledRef.current = visible;
    setWildfireHazardEnabled(visible);
    void driverRef.current?.setWildfireHazardVisible(visible);
  };

  const returnToTwoDimensions = (): void => {
    focusTwoDimensionalButtonRef.current = true;
    setMode("2d");
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
          {activeMode === "terrain-3d"
            ? "Loading 3D terrain"
            : "Loading map"}
        </div>
      ) : null}
      {status === "error" ? (
        <div className="map-state map-error" role="alert">
          <AlertCircle aria-hidden="true" size={24} strokeWidth={1.7} />
          <strong>
            {activeMode === "terrain-3d"
              ? "3D terrain unavailable"
              : "Map unavailable"}
          </strong>
          <div className="map-error-actions">
            <button
              className="retry-button map-retry-button"
              type="button"
              onClick={() => setAttempt((value) => value + 1)}
            >
              <RefreshCw aria-hidden="true" size={15} strokeWidth={2} />
              {activeMode === "terrain-3d" ? "Retry 3D" : "Retry map"}
            </button>
            {activeMode === "terrain-3d" ? (
              <button
                className="secondary-button map-return-button"
                type="button"
                onClick={returnToTwoDimensions}
              >
                <MapIcon aria-hidden="true" size={15} strokeWidth={1.9} />
                Return to 2D
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      <div className="map-primary-controls">
        <div className="map-mode-control" role="group" aria-label="Map view">
          <button
            ref={twoDimensionalButtonRef}
            type="button"
            aria-pressed={activeMode === "2d"}
            onClick={() => setMode("2d")}
          >
            <MapIcon aria-hidden="true" size={15} strokeWidth={1.9} />
            2D
          </button>
          <button
            type="button"
            aria-pressed={activeMode === "terrain-3d"}
            disabled={draftMarker !== undefined}
            onClick={() => setMode("terrain-3d")}
          >
            <Mountain aria-hidden="true" size={15} strokeWidth={1.9} />
            3D Terrain
          </button>
        </div>
        {status === "ready" ? (
          <WildfireHazardControl
            enabled={wildfireHazardEnabled}
            state={wildfireHazardState}
            onEnabledChange={setWildfireHazardVisibility}
            onRetry={() => setWildfireHazardVisibility(true)}
            terrainContext={activeMode === "terrain-3d"}
          />
        ) : null}
      </div>
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
