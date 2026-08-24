import type { ListingSummary } from "./listingsApi.js";
import type { WildfireHazardOverlayState } from "./wildfireHazardOverlay.js";

export interface ListingCoordinates {
  latitude: number;
  longitude: number;
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

export interface CreateListingsMapOptions {
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
