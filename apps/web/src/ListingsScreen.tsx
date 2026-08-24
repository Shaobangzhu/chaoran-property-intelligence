import {
  AlertCircle,
  Bath,
  BedDouble,
  Building2,
  CalendarDays,
  Database,
  Inbox,
  List,
  LoaderCircle,
  Map,
  MapPin,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { type ComponentType, useEffect, useState } from "react";

import {
  ListingsMap,
  type ListingCoordinates,
  type ListingsMapProps,
} from "./ListingsMap.js";
import {
  ManualListingForm,
  type ManualListingCreator,
  type ManualListingUpdater,
} from "./ManualListingForm.js";
import {
  archiveManualListing,
  createManualListing,
  type ListingSummary,
  updateManualListing,
} from "./listingsApi.js";

export type ListingsLoader = (
  signal: AbortSignal,
) => Promise<ListingSummary[]>;

export type ManualListingArchiver = (listingId: string) => Promise<void>;

export interface ListingsScreenProps {
  archiveListing?: ManualListingArchiver;
  createListing?: ManualListingCreator;
  loadListings: ListingsLoader;
  mapView?: ComponentType<ListingsMapViewProps>;
  updateListing?: ManualListingUpdater;
}

export type ListingsMapViewProps = Omit<
  ListingsMapProps,
  "createMap" | "createTerrainMap"
>;

type ListingsState =
  | { status: "loading" }
  | { status: "ready"; listings: ListingSummary[] }
  | { status: "error" };

export function ListingsScreen({
  archiveListing = archiveManualListing,
  createListing = createManualListing,
  loadListings,
  mapView: MapView = ListingsMap,
  updateListing = updateManualListing,
}: ListingsScreenProps): React.JSX.Element {
  const [requestNumber, setRequestNumber] = useState(0);
  const [state, setState] = useState<ListingsState>({ status: "loading" });
  const [selectedListingId, setSelectedListingId] = useState<string | null>(
    null,
  );
  const [mobileView, setMobileView] = useState<"list" | "map">("list");
  const [isCreating, setIsCreating] = useState(false);
  const [editingListing, setEditingListing] = useState<ListingSummary | null>(
    null,
  );
  const [archiveCandidate, setArchiveCandidate] =
    useState<ListingSummary | null>(null);
  const [archiveState, setArchiveState] = useState<
    "idle" | "submitting" | "unavailable"
  >("idle");
  const [draftCoordinates, setDraftCoordinates] =
    useState<ListingCoordinates | null>(null);
  const [markerConfirmed, setMarkerConfirmed] = useState(false);
  const [workspaceNotice, setWorkspaceNotice] = useState<string | null>(null);
  const isFormOpen = isCreating || editingListing !== null;
  const selectedListing =
    state.status === "ready"
      ? (state.listings.find((listing) => listing.id === selectedListingId) ??
        null)
      : null;

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });

    void loadListings(controller.signal).then(
      (listings) => {
        if (!controller.signal.aborted) {
          setState({ listings, status: "ready" });
        }
      },
      () => {
        if (!controller.signal.aborted) {
          setState({ status: "error" });
        }
      },
    );

    return () => {
      controller.abort();
    };
  }, [loadListings, requestNumber]);

  const startCreation = (): void => {
    setDraftCoordinates(null);
    setMarkerConfirmed(false);
    setWorkspaceNotice(null);
    setSelectedListingId(null);
    setMobileView("list");
    setEditingListing(null);
    setIsCreating(true);
  };

  const cancelForm = (): void => {
    setDraftCoordinates(null);
    setMarkerConfirmed(false);
    setMobileView("list");
    setIsCreating(false);
    setEditingListing(null);
  };

  const handleCreated = (listing: ListingSummary): void => {
    setState((current) =>
      current.status === "ready"
        ? {
            listings: [
              listing,
              ...current.listings.filter((item) => item.id !== listing.id),
            ],
            status: "ready",
          }
        : current,
    );
    setSelectedListingId(listing.id);
    setDraftCoordinates(null);
    setMarkerConfirmed(false);
    setMobileView("list");
    setIsCreating(false);
    setEditingListing(null);
    setWorkspaceNotice(
      editingListing === null ? "Listing created." : "Listing updated.",
    );
  };

  const startEditing = (listing: ListingSummary): void => {
    setDraftCoordinates({
      latitude: listing.latitude,
      longitude: listing.longitude,
    });
    setMarkerConfirmed(true);
    setWorkspaceNotice(null);
    setMobileView("list");
    setIsCreating(false);
    setEditingListing(listing);
  };

  const handleArchive = async (): Promise<void> => {
    if (archiveCandidate === null || archiveState === "submitting") return;

    setArchiveState("submitting");
    try {
      await archiveListing(archiveCandidate.id);
      setState((current) =>
        current.status === "ready"
          ? {
              listings: current.listings.filter(
                (listing) => listing.id !== archiveCandidate.id,
              ),
              status: "ready",
            }
          : current,
      );
      setSelectedListingId(null);
      setArchiveCandidate(null);
      setArchiveState("idle");
      setWorkspaceNotice("Listing archived.");
    } catch {
      setArchiveState("unavailable");
    }
  };

  return (
    <main className="workspace">
      <section className="workspace-heading" aria-labelledby="listings-title">
        <div>
          <p className="section-label">Portfolio workspace</p>
          <h1 id="listings-title">Listings</h1>
          <p className="workspace-description">
            Stored snapshots from the property alert workflow.
          </p>
        </div>
        {state.status === "ready" ? (
          <div className="workspace-heading-actions">
            {state.listings.length > 0 ? (
              <div className="listing-count" aria-live="polite">
                <Database aria-hidden="true" size={17} strokeWidth={1.8} />
                {formatListingCount(state.listings.length)}
              </div>
            ) : null}
            {!isFormOpen ? (
              <button
                className="primary-button add-listing-button"
                type="button"
                onClick={startCreation}
              >
                <Plus aria-hidden="true" size={17} />
                Add listing
              </button>
            ) : null}
          </div>
        ) : null}
      </section>

      {workspaceNotice === null ? null : (
        <p className="workspace-notice" role="status">
          {workspaceNotice}
        </p>
      )}

      {state.status === "loading" ? <LoadingState /> : null}
      {state.status === "error" ? (
        <ErrorState onRetry={() => setRequestNumber((value) => value + 1)} />
      ) : null}
      {state.status === "ready" &&
      state.listings.length === 0 &&
      !isFormOpen ? (
        <EmptyState />
      ) : null}
      {state.status === "ready" && isFormOpen ? (
        <>
          <div
            className="mobile-view-control"
            role="group"
            aria-label="Listing editor view"
          >
            <button
              type="button"
              aria-label="Details"
              aria-pressed={mobileView === "list"}
              onClick={() => setMobileView("list")}
            >
              <List aria-hidden="true" size={16} strokeWidth={2} />
              Details
            </button>
            <button
              type="button"
              aria-label="Map"
              aria-pressed={mobileView === "map"}
              onClick={() => setMobileView("map")}
            >
              <Map aria-hidden="true" size={16} strokeWidth={2} />
              Map
            </button>
          </div>
          <div
            className={`list-map-workspace create-listing-workspace mobile-mode-${mobileView}`}
          >
            <div className="list-panel manual-listing-scroll">
              <ManualListingForm
                coordinates={draftCoordinates}
                createListing={createListing}
                {...(editingListing === null
                  ? {}
                  : { initialListing: editingListing })}
                markerConfirmed={markerConfirmed}
                onCancel={cancelForm}
                onSaved={handleCreated}
                onShowMap={() => setMobileView("map")}
                updateListing={updateListing}
              />
            </div>
            <div className="map-panel">
              <MapView
                draftMarker={{
                  confirmed: markerConfirmed,
                  coordinates: draftCoordinates,
                  onConfirm: () => {
                    if (draftCoordinates !== null) {
                      setMarkerConfirmed(true);
                    }
                  },
                  onCoordinatesChange: (coordinates) => {
                    setDraftCoordinates(coordinates);
                    setMarkerConfirmed(false);
                  },
                }}
                listings={state.listings}
                selectedListingId={null}
                onSelect={() => undefined}
              />
            </div>
          </div>
        </>
      ) : null}
      {state.status === "ready" &&
      state.listings.length > 0 &&
      !isFormOpen ? (
        <>
          <div
            className="mobile-view-control"
            role="group"
            aria-label="Listing view"
          >
            <button
              type="button"
              aria-label="List view"
              aria-pressed={mobileView === "list"}
              onClick={() => setMobileView("list")}
            >
              <List aria-hidden="true" size={16} strokeWidth={2} />
              List
            </button>
            <button
              type="button"
              aria-label="Map view"
              aria-pressed={mobileView === "map"}
              onClick={() => setMobileView("map")}
            >
              <Map aria-hidden="true" size={16} strokeWidth={2} />
              Map
            </button>
          </div>
          <div className={`list-map-workspace mobile-mode-${mobileView}`}>
            <div className="list-panel">
              {selectedListing?.source === "manual" ? (
                <ManualListingActions
                  archiveCandidate={archiveCandidate}
                  archiveState={archiveState}
                  listing={selectedListing}
                  onArchive={() => {
                    setArchiveCandidate(selectedListing);
                    setArchiveState("idle");
                  }}
                  onCancelArchive={() => {
                    setArchiveCandidate(null);
                    setArchiveState("idle");
                  }}
                  onConfirmArchive={() => void handleArchive()}
                  onEdit={() => startEditing(selectedListing)}
                />
              ) : null}
              <ListingList
                listings={state.listings}
                onSelect={setSelectedListingId}
                selectedListingId={selectedListingId}
              />
            </div>
            <div className="map-panel">
              <MapView
                listings={state.listings}
                selectedListingId={selectedListingId}
                onSelect={(listingId) => {
                  setSelectedListingId(listingId);
                  setMobileView("list");
                }}
              />
            </div>
          </div>
        </>
      ) : null}
    </main>
  );
}

function ManualListingActions({
  archiveCandidate,
  archiveState,
  listing,
  onArchive,
  onCancelArchive,
  onConfirmArchive,
  onEdit,
}: {
  archiveCandidate: ListingSummary | null;
  archiveState: "idle" | "submitting" | "unavailable";
  listing: ListingSummary;
  onArchive: () => void;
  onCancelArchive: () => void;
  onConfirmArchive: () => void;
  onEdit: () => void;
}): React.JSX.Element {
  const confirmingArchive = archiveCandidate?.id === listing.id;

  return (
    <section className="manual-listing-actions" aria-label="Manual listing actions">
      {confirmingArchive ? (
        <div
          className="archive-confirmation"
          role="alertdialog"
          aria-labelledby="archive-confirmation-title"
        >
          <div>
            <strong id="archive-confirmation-title">Archive manual listing</strong>
            <span>{listing.addressLine1} will leave the active workspace.</span>
          </div>
          {archiveState === "unavailable" ? (
            <p role="alert">The listing could not be archived. Try again.</p>
          ) : null}
          <div className="archive-confirmation-actions">
            <button
              className="secondary-button"
              type="button"
              disabled={archiveState === "submitting"}
              onClick={onCancelArchive}
            >
              Cancel
            </button>
            <button
              className="danger-button"
              type="button"
              disabled={archiveState === "submitting"}
              onClick={onConfirmArchive}
            >
              {archiveState === "submitting" ? (
                <LoaderCircle className="spin" aria-hidden="true" size={16} />
              ) : (
                <Trash2 aria-hidden="true" size={16} />
              )}
              {archiveState === "submitting" ? "Archiving" : "Confirm archive"}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div>
            <strong>Manual listing</strong>
            <span>{listing.formattedAddress}</span>
          </div>
          <div className="manual-listing-action-buttons">
            <button
              className="secondary-button"
              type="button"
              aria-label="Edit listing"
              onClick={onEdit}
            >
              <Pencil aria-hidden="true" size={16} />
              Edit
            </button>
            <button
              className="secondary-button archive-button"
              type="button"
              aria-label="Archive listing"
              onClick={onArchive}
            >
              <Trash2 aria-hidden="true" size={16} />
              Archive
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function LoadingState(): React.JSX.Element {
  return (
    <section
      className="read-state loading-state"
      role="status"
      aria-label="Loading listings"
    >
      <span className="visually-hidden">Loading listings</span>
      {[0, 1, 2].map((item) => (
        <div className="listing-skeleton" aria-hidden="true" key={item}>
          <div className="skeleton-icon" />
          <div className="skeleton-copy">
            <div className="skeleton-line skeleton-line-strong" />
            <div className="skeleton-line" />
          </div>
          <div className="skeleton-price" />
        </div>
      ))}
    </section>
  );
}

function EmptyState(): React.JSX.Element {
  return (
    <section className="read-state message-state">
      <Inbox aria-hidden="true" size={30} strokeWidth={1.6} />
      <h2>No stored listings</h2>
      <p>New matching properties will appear here after they are stored.</p>
    </section>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }): React.JSX.Element {
  return (
    <section className="read-state message-state error-state" role="alert">
      <AlertCircle aria-hidden="true" size={30} strokeWidth={1.7} />
      <h2>Listings unavailable</h2>
      <p>The saved property data could not be loaded.</p>
      <button className="retry-button" type="button" onClick={onRetry}>
        <RefreshCw aria-hidden="true" size={16} strokeWidth={2} />
        Retry
      </button>
    </section>
  );
}

function ListingList({
  listings,
  selectedListingId,
  onSelect,
}: {
  listings: ListingSummary[];
  selectedListingId: string | null;
  onSelect: (listingId: string) => void;
}): React.JSX.Element {
  return (
    <section className="listing-list" aria-label="Stored listings">
      {listings.map((listing) => (
        <ListingRow
          isSelected={listing.id === selectedListingId}
          listing={listing}
          key={listing.id}
          onSelect={onSelect}
        />
      ))}
    </section>
  );
}

function ListingRow({
  isSelected,
  listing,
  onSelect,
}: {
  isSelected: boolean;
  listing: ListingSummary;
  onSelect: (listingId: string) => void;
}): React.JSX.Element {
  const mlsReference = formatMlsReference(listing);

  return (
    <article
      aria-label={listing.formattedAddress}
      aria-pressed={isSelected}
      className={`listing-row${isSelected ? " is-selected" : ""}`}
      role="button"
      tabIndex={0}
      onClick={() => onSelect(listing.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(listing.id);
        }
      }}
    >
      <div className="listing-address">
        <div className="property-icon" aria-hidden="true">
          <Building2 size={20} strokeWidth={1.8} />
        </div>
        <div className="address-copy">
          <div className="address-heading">
            <h2>{listing.addressLine1}</h2>
            <span className="status-label">{listing.status}</span>
          </div>
          {listing.addressLine2 === null ? null : (
            <p>{listing.addressLine2}</p>
          )}
          <p className="location-line">
            <MapPin aria-hidden="true" size={14} strokeWidth={1.8} />
            {listing.city}, {listing.state} {listing.zipCode}
          </p>
          <p className="property-reference">
            {formatPropertyReference(listing, mlsReference)}
          </p>
        </div>
      </div>

      <div className="listing-facts">
        <div className="fact price-fact">
          <span className="fact-label">Price</span>
          <strong>
            {listing.price === null
              ? "Not provided"
              : formatPrice(listing.price)}
          </strong>
        </div>
        <div className="fact">
          <span className="fact-label">Details</span>
          {listing.bedrooms === null && listing.bathrooms === null ? (
            <span>Not provided</span>
          ) : (
            <span className="inline-facts">
              {listing.bedrooms === null ? null : (
                <span>
                  <BedDouble aria-hidden="true" size={16} strokeWidth={1.8} />
                  {listing.bedrooms} bd
                </span>
              )}
              {listing.bathrooms === null ? null : (
                <span>
                  <Bath aria-hidden="true" size={16} strokeWidth={1.8} />
                  {listing.bathrooms} ba
                </span>
              )}
            </span>
          )}
        </div>
        <div className="fact date-fact">
          <span className="fact-label">Listed</span>
          <span>
            <CalendarDays aria-hidden="true" size={15} strokeWidth={1.8} />
            {listing.listedDate === null
              ? "Not provided"
              : formatDate(listing.listedDate)}
          </span>
        </div>
      </div>
    </article>
  );
}

function formatListingCount(count: number): string {
  return `${count.toLocaleString("en-US")} stored ${count === 1 ? "listing" : "listings"}`;
}

function formatPrice(price: number): string {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 0,
    style: "currency",
  }).format(price);
}

function formatDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (match === null) {
    return date;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsedDate = new Date(Date.UTC(year, month - 1, day));
  if (
    parsedDate.getUTCFullYear() !== year ||
    parsedDate.getUTCMonth() !== month - 1 ||
    parsedDate.getUTCDate() !== day
  ) {
    return date;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
    year: "numeric",
  }).format(parsedDate);
}

function formatMlsReference(listing: ListingSummary): string | null {
  if (listing.mlsName === null && listing.mlsNumber === null) {
    return null;
  }
  if (listing.mlsName === null) {
    return `MLS #${listing.mlsNumber}`;
  }
  if (listing.mlsNumber === null) {
    return listing.mlsName;
  }

  return `${listing.mlsName} #${listing.mlsNumber}`;
}

function formatPropertyReference(
  listing: ListingSummary,
  mlsReference: string | null,
): string {
  const propertyType = listing.propertyType ?? "Property type not provided";
  return mlsReference === null
    ? propertyType
    : `${propertyType} · ${mlsReference}`;
}
