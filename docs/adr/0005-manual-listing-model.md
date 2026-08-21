# ADR 0005: Manual Listing Model

## Status

Accepted

## Context

The RentCast alert worker originally owned the only persisted listing shape.
Its records always have a provider identity, complete search facts, and a
notification lifecycle. Block 17 adds administrator-entered properties that
may begin with only confirmed address data and coordinates.

A separate manual-listing aggregate would duplicate read, map, and future
showing-list behavior. Simply adding `"manual"` to the source type would also
leave PostgreSQL constraints that reject every valid manual record.

## Decision

Use one discriminated normalized listing model:

```ts
type ListingSource = "rentcast" | "manual";
type NormalizedListing =
  | RentCastNormalizedListing
  | ManualNormalizedListing;
```

RentCast listings retain a required source ID, property type, bedrooms,
bathrooms, price, and listed date. Manual listings have no provider source ID
and may leave those property facts null. Both variants require normalized
address fields, finite coordinates, status, and server timestamps.

The alert-worker ports accept `RentCastNormalizedListing`, not the wider union.
This keeps ingestion, deduplication, criteria evaluation, and Telegram delivery
from accidentally processing administrator-entered records.

Migration `004_support_manual_listings.sql` extends the existing `listings`
table rather than creating a second table. It:

- permits `rentcast` and `manual` sources while preserving complete RentCast
  facts
- adds `created_by_user_id`, bounded notes, archive metadata, and server
  timestamps
- requires manual ownership and prohibits a provider source ID on manual rows
- reserves `notification_status = 'not_applicable'` for manual rows
- enforces coordinate ranges and nonnegative optional numeric facts
- keeps `deduplication_key` internal; a future manual create adapter uses the
  server UUID rather than silently merging similar addresses

`created_by_user_id`, notes, archive state, and persistence timestamps are
record metadata. They are not provider-normalized facts and are not yet exposed
by the shared listing summary. Block 17.2 owns the create port and persistence
command; Block 17.5 owns edit and archive commands and active-query filtering.

## Read Contract

RentCast and manual rows use the existing `GET /api/listings` path. The property
type, bedrooms, bathrooms, price, and listed date fields are nullable in the
API and browser contracts. The current UI states that absent values were not
provided and never substitutes zero or an inferred fact.

Rows remain ordered by listed date descending with null dates last and UUID as
the deterministic tie breaker.

## Operational Boundary

Block 17.1 adds a bundled migration but does not run it against local or AWS
PostgreSQL. Applying migration 004 is a separately confirmed operational step.
This block adds no write endpoint, repository command, form, geocoder, external
API call, permanent deletion, or AWS resource.

## Consequences

- one read and map contract supports both listing sources
- TypeScript preserves stronger RentCast guarantees for the worker
- manual creation must derive ownership from the authenticated JWT subject
- archive history can remain in the same table without overloading listing
  status
- later writes must update `updated_at` explicitly until a trigger is justified
