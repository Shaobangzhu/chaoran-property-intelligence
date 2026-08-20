import {
  AlertCircle,
  Bath,
  BedDouble,
  Building2,
  CalendarDays,
  Database,
  Inbox,
  MapPin,
  RefreshCw,
} from "lucide-react";
import { useEffect, useState } from "react";

import type { ListingSummary } from "./listingsApi.js";

export type ListingsLoader = (
  signal: AbortSignal,
) => Promise<ListingSummary[]>;

export interface ListingsScreenProps {
  loadListings: ListingsLoader;
}

type ListingsState =
  | { status: "loading" }
  | { status: "ready"; listings: ListingSummary[] }
  | { status: "error" };

export function ListingsScreen({
  loadListings,
}: ListingsScreenProps): React.JSX.Element {
  const [requestNumber, setRequestNumber] = useState(0);
  const [state, setState] = useState<ListingsState>({ status: "loading" });

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
        {state.status === "ready" && state.listings.length > 0 ? (
          <div className="listing-count" aria-live="polite">
            <Database aria-hidden="true" size={17} strokeWidth={1.8} />
            {formatListingCount(state.listings.length)}
          </div>
        ) : null}
      </section>

      {state.status === "loading" ? <LoadingState /> : null}
      {state.status === "error" ? (
        <ErrorState onRetry={() => setRequestNumber((value) => value + 1)} />
      ) : null}
      {state.status === "ready" && state.listings.length === 0 ? (
        <EmptyState />
      ) : null}
      {state.status === "ready" && state.listings.length > 0 ? (
        <ListingList listings={state.listings} />
      ) : null}
    </main>
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
}: {
  listings: ListingSummary[];
}): React.JSX.Element {
  return (
    <section className="listing-list" aria-label="Stored listings">
      {listings.map((listing) => (
        <ListingRow listing={listing} key={listing.id} />
      ))}
    </section>
  );
}

function ListingRow({ listing }: { listing: ListingSummary }): React.JSX.Element {
  const mlsReference = formatMlsReference(listing);

  return (
    <article className="listing-row">
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
            {listing.propertyType}
            {mlsReference === null ? null : ` · ${mlsReference}`}
          </p>
        </div>
      </div>

      <div className="listing-facts">
        <div className="fact price-fact">
          <span className="fact-label">Price</span>
          <strong>{formatPrice(listing.price)}</strong>
        </div>
        <div className="fact">
          <span className="fact-label">Details</span>
          <span className="inline-facts">
            <span>
              <BedDouble aria-hidden="true" size={16} strokeWidth={1.8} />
              {listing.bedrooms} bd
            </span>
            <span>
              <Bath aria-hidden="true" size={16} strokeWidth={1.8} />
              {listing.bathrooms} ba
            </span>
          </span>
        </div>
        <div className="fact date-fact">
          <span className="fact-label">Listed</span>
          <span>
            <CalendarDays aria-hidden="true" size={15} strokeWidth={1.8} />
            {formatDate(listing.listedDate)}
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
