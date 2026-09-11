import {
  AlertCircle,
  Bath,
  BedDouble,
  Building2,
  CalendarDays,
  Database,
  History,
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
import { type ComponentType, useEffect, useRef, useState } from "react";

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
  type CurrentListingInventorySnapshot,
  type InventoryListingSummary,
  type ListingHistoryPageSnapshot,
  type ListingHistoryRequest,
  type ListingLifecycleState,
  type ListingSummary,
  updateManualListing,
} from "./listingsApi.js";

export type ListingsLoader = (
  signal: AbortSignal,
) => Promise<ListingSummary[]>;

export type ManualListingArchiver = (listingId: string) => Promise<void>;

export type CurrentListingInventoryLoader = (
  signal: AbortSignal,
) => Promise<CurrentListingInventorySnapshot | null>;

export type ListingHistoryLoader = (
  query: ListingHistoryRequest,
  signal: AbortSignal,
) => Promise<ListingHistoryPageSnapshot>;

export interface ListingsScreenProps {
  archiveListing?: ManualListingArchiver;
  createListing?: ManualListingCreator;
  loadCurrentInventory?: CurrentListingInventoryLoader;
  loadHistory?: ListingHistoryLoader;
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
  | {
      status: "ready";
      listings: ListingSummary[];
      appliedRevision: number | null;
      refreshedAt: string | null;
      nextCursor: string | null;
    }
  | { status: "error" };

type InventoryView = "current" | "historical";
const historicalLifecycleStates = [
  "out_of_scope",
  "missing",
  "inactive",
  "sold",
] as const satisfies readonly Exclude<ListingLifecycleState, "current">[];

export function ListingsScreen({
  archiveListing = archiveManualListing,
  createListing = createManualListing,
  loadCurrentInventory,
  loadHistory,
  loadListings,
  mapView: MapView = ListingsMap,
  updateListing = updateManualListing,
}: ListingsScreenProps): React.JSX.Element {
  const [requestNumber, setRequestNumber] = useState(0);
  const [state, setState] = useState<ListingsState>({ status: "loading" });
  const [inventoryView, setInventoryView] = useState<InventoryView>("current");
  const [historyFilters, setHistoryFilters] = useState<
    readonly Exclude<ListingLifecycleState, "current">[]
  >(historicalLifecycleStates);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const loadMoreControllerRef = useRef<AbortController | null>(null);
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
    loadMoreControllerRef.current?.abort();
    loadMoreControllerRef.current = null;
    setIsLoadingMore(false);
    setState({ status: "loading" });
    const request =
      inventoryView === "historical"
        ? loadHistory === undefined
          ? Promise.reject(new Error("Historical inventory is unavailable"))
          : loadHistory(
              { lifecycleStates: historyFilters, cursor: null, limit: 25 },
              controller.signal,
            ).then((page) => ({
              appliedRevision: null,
              listings: page.listings,
              nextCursor: page.nextCursor,
              refreshedAt: null,
            }))
        : loadCurrentInventory === undefined
          ? loadListings(controller.signal).then((listings) => ({
              appliedRevision: null,
              listings,
              nextCursor: null,
              refreshedAt: null,
            }))
          : Promise.all([
              loadCurrentInventory(controller.signal),
              loadListings(controller.signal),
            ]).then(([inventory, allStored]) => ({
              appliedRevision: inventory?.appliedRevision ?? null,
              listings: [
                ...allStored.filter((listing) => listing.source === "manual"),
                ...(inventory?.listings ?? []),
              ],
              nextCursor: null,
              refreshedAt: inventory?.refreshedAt ?? null,
            }));

    void request.then(
      (result) => {
        if (!controller.signal.aborted) {
          setState({ ...result, status: "ready" });
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
      loadMoreControllerRef.current?.abort();
    };
  }, [
    historyFilters,
    inventoryView,
    loadCurrentInventory,
    loadHistory,
    loadListings,
    requestNumber,
  ]);

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
            ...current,
            listings: [
              listing,
              ...current.listings.filter((item) => item.id !== listing.id),
            ],
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
              ...current,
              listings: current.listings.filter(
                (listing) => listing.id !== archiveCandidate.id,
              ),
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

  const selectInventoryView = (view: InventoryView): void => {
    if (view === inventoryView || isFormOpen) return;
    setSelectedListingId(null);
    setMobileView("list");
    setWorkspaceNotice(null);
    setInventoryView(view);
  };

  const toggleHistoryFilter = (
    lifecycle: Exclude<ListingLifecycleState, "current">,
  ): void => {
    setHistoryFilters((current) => {
      const next = current.includes(lifecycle)
        ? current.filter((item) => item !== lifecycle)
        : historicalLifecycleStates.filter(
            (item) => item === lifecycle || current.includes(item),
          );
      return next.length === 0 ? current : next;
    });
    setSelectedListingId(null);
  };

  const loadMoreHistory = async (): Promise<void> => {
    if (
      inventoryView !== "historical" ||
      state.status !== "ready" ||
      state.nextCursor === null ||
      loadHistory === undefined ||
      isLoadingMore
    ) {
      return;
    }
    const controller = new AbortController();
    loadMoreControllerRef.current = controller;
    setIsLoadingMore(true);
    try {
      const page = await loadHistory(
        {
          lifecycleStates: historyFilters,
          cursor: state.nextCursor,
          limit: 25,
        },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setState((current) =>
        current.status !== "ready"
          ? current
          : {
              ...current,
              listings: [
                ...current.listings,
                ...page.listings.filter(
                  (listing) =>
                    !current.listings.some((item) => item.id === listing.id),
                ),
              ],
              nextCursor: page.nextCursor,
            },
      );
    } catch {
      if (!controller.signal.aborted) {
        setWorkspaceNotice("More historical listings could not be loaded.");
      }
    } finally {
      if (loadMoreControllerRef.current === controller) {
        loadMoreControllerRef.current = null;
        setIsLoadingMore(false);
      }
    }
  };

  return (
    <main className="workspace">
      <section className="workspace-heading" aria-labelledby="listings-title">
        <div>
          <p className="section-label">Portfolio workspace</p>
          <h1 id="listings-title">Listings</h1>
          <p className="workspace-description">
            Current applied inventory with retained lifecycle history.
          </p>
        </div>
        {state.status === "ready" ? (
          <div className="workspace-heading-actions">
            {state.listings.length > 0 ? (
              <div className="listing-count" aria-live="polite">
                <Database aria-hidden="true" size={17} strokeWidth={1.8} />
                {formatListingCount(state.listings.length, inventoryView)}
              </div>
            ) : null}
            {!isFormOpen && inventoryView === "current" ? (
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

      <div className="inventory-toolbar">
        <div
          className="inventory-view-tabs"
          role="tablist"
          aria-label="Listing inventory view"
        >
          <button
            type="button"
            role="tab"
            aria-selected={inventoryView === "current"}
            disabled={isFormOpen}
            onClick={() => selectInventoryView("current")}
          >
            <Database aria-hidden="true" size={16} />
            Current
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={inventoryView === "historical"}
            disabled={isFormOpen || loadHistory === undefined}
            onClick={() => selectInventoryView("historical")}
          >
            <History aria-hidden="true" size={16} />
            Historical
          </button>
        </div>
        {inventoryView === "current" && state.status === "ready" ? (
          <div className="inventory-freshness" aria-live="polite">
            {state.appliedRevision === null || state.refreshedAt === null ? (
              <span>No completed provider refresh yet</span>
            ) : (
              <>
                <strong>Applied revision {state.appliedRevision}</strong>
                <time dateTime={state.refreshedAt}>
                  Refreshed {formatRefreshTime(state.refreshedAt)}
                </time>
              </>
            )}
          </div>
        ) : null}
      </div>

      {inventoryView === "historical" ? (
        <fieldset className="history-filters">
          <legend>Lifecycle filters</legend>
          {historicalLifecycleStates.map((lifecycle) => (
            <label key={lifecycle}>
              <input
                type="checkbox"
                checked={historyFilters.includes(lifecycle)}
                onChange={() => toggleHistoryFilter(lifecycle)}
              />
              {formatLifecycle(lifecycle)}
            </label>
          ))}
        </fieldset>
      ) : null}

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
        <EmptyState view={inventoryView} />
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
              {inventoryView === "historical" && state.nextCursor !== null ? (
                <button
                  className="secondary-button history-load-more"
                  type="button"
                  disabled={isLoadingMore}
                  onClick={() => void loadMoreHistory()}
                >
                  {isLoadingMore ? (
                    <LoaderCircle className="spin" aria-hidden="true" size={16} />
                  ) : null}
                  {isLoadingMore ? "Loading" : "Load more history"}
                </button>
              ) : null}
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

function EmptyState({ view }: { view: InventoryView }): React.JSX.Element {
  return (
    <section className="read-state message-state">
      <Inbox aria-hidden="true" size={30} strokeWidth={1.6} />
      <h2>{view === "current" ? "No current listings" : "No historical listings"}</h2>
      <p>
        {view === "current"
          ? "Matching properties will appear after a complete refresh, while manual listings remain available here."
          : "No retained listings match the selected lifecycle filters."}
      </p>
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
            {isInventoryListing(listing) &&
            listing.lifecycle.state !== "current" ? (
              <span
                className={`lifecycle-label lifecycle-${listing.lifecycle.state}`}
              >
                {formatLifecycle(listing.lifecycle.state)}
              </span>
            ) : null}
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

function formatListingCount(count: number, view: InventoryView): string {
  return `${count.toLocaleString("en-US")} ${view === "current" ? "current" : "historical"} ${count === 1 ? "listing" : "listings"}`;
}

function isInventoryListing(
  listing: ListingSummary,
): listing is InventoryListingSummary {
  return "lifecycle" in listing;
}

function formatLifecycle(lifecycle: ListingLifecycleState): string {
  switch (lifecycle) {
    case "current":
      return "Current";
    case "out_of_scope":
      return "Out of scope";
    case "missing":
      return "Missing";
    case "inactive":
      return "Inactive";
    case "sold":
      return "Sold";
  }
}

function formatRefreshTime(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
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
