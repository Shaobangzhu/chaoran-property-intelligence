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

## Create Boundary

Block 17.2 adds `CreateManualListing` and a dedicated
`ManualListingRepositoryPort`. The use case receives an actor user ID separately
from the editable draft. Block 17.3 must derive that actor from the verified JWT
subject; it must never copy ownership from an HTTP body.

The editable draft contains address components, confirmed coordinates, optional
property facts, optional MLS references, `Active` or `Pending` status, optional
listed date, and notes. The domain normalizer:

- trims bounded strings and converts blank optional values to null
- accepts only California records and valid five-digit or ZIP+4 codes
- requires finite in-range coordinates
- bounds bedrooms and bathrooms from zero through 100
- accepts only nonnegative integer prices within PostgreSQL integer range
- validates real `YYYY-MM-DD` listed dates and bounds notes at 4,000 characters
- derives the formatted address, manual source, null provider ID, discovery
  timestamp, and last-seen date

The use case validates the actor UUID, obtains a UUID and one timestamp from
injected server dependencies, and supplies identical create/update timestamps
to persistence. Semantic input failures use `InvalidManualListingError`, which
identifies only the invalid field and never includes submitted values.

`PostgresManualListingRepository` is separate from the RentCast alert-worker
repository. It inserts `manual:<UUID>` as the internal deduplication key,
`not_applicable` notification state, null archive state, owner, notes, and
server timestamps in one parameterized statement. It parses the returned row
into `ManualListingRecord`. This block does not compose the adapter into an API
process or apply migration 004.

## HTTP Create Contract

Block 17.3 adds the administrator-only endpoint:

```text
POST /api/listings/manual
```

The request pipeline is ordered as follows:

```text
origin verification
-> exact unsafe-request Origin check
-> session authentication
-> admin authorization
-> bounded JSON parsing
-> strict DTO parsing
-> CreateManualListing
```

Authentication and authorization therefore run before parsing a manual-listing
body. An unauthenticated malformed request returns `401`, a non-admin request
returns `403`, and neither consumes use-case or JSON parsing work. Login keeps
its existing failed-attempt limiter before its own JSON parser.

The manual DTO allows only editable draft fields. Unknown fields, including
identity, source, owner, formatted address, and timestamp fields, produce the
same bounded `400 INVALID_REQUEST` response as malformed or incorrectly typed
JSON. The login body remains limited to 4 KiB. Manual listing JSON is limited to
8 KiB so a valid 4,000-character note plus the other bounded fields fits.

Domain validation errors produce `400 INVALID_MANUAL_LISTING` with only the
invalid field name. An invalid authenticated actor ID is a server invariant
failure and uses the generic credential-free `500` response. Successful writes
return `201` with the existing `ListingSummaryDto`; owner, notes,
deduplication/notification state, and persistence timestamps are not exposed.
The API emits only a request-ID-bearing `api.listings.manual.created` event.

The API entrypoint composes `CreateManualListing` with
`PostgresManualListingRepository`, `randomUUID`, and a server clock. Its existing
startup sequence runs bundled migrations before listening, so migration 004
will be applied when this API version is next started against a database. Block
17.3 tests and builds do not start the entrypoint or connect to PostgreSQL.

## Browser Create Workflow

Block 17.4 adds one creation mode to the existing authenticated listings
workspace. The browser form sends only the HTTP create contract's editable
fields. It does not accept identity, ownership, source, formatted address,
notification state, archive metadata, or server timestamps.

The map driver maintains a draggable draft marker separately from the stored
listing GeoJSON source. Clicking an unoccupied map location or completing a drag
reports finite MapLibre coordinates to React. Every coordinate change clears the
confirmation flag, and the save action remains disabled until the current marker
position is explicitly confirmed. MapLibre/OpenFreeMap remains a display and
coordinate-selection dependency, not a geocoder.

The typed client uses same-origin credentials and validates the returned
`ListingSummaryDto` before adding it to local workspace state. Bounded
`INVALID_MANUAL_LISTING` fields mark the matching control; malformed requests use
form-level feedback; `401` enters the existing signed-out state. The returned
listing is the authoritative browser value after creation and immediately shares
the existing list, selection, and map behavior.

## Update And Archive Boundary

Block 17.5 adds the administrator-only commands:

```text
PATCH /api/listings/:id
POST /api/listings/:id/archive
```

Both commands run behind exact Origin verification, session authentication, and
admin authorization. Patch parsing uses the existing 8 KiB manual-listing limit,
requires a non-empty body, and accepts only editable draft fields. Identity,
source, ownership, formatted address, discovery timestamps, notification state,
and lifecycle metadata remain server-controlled. Omitted fields preserve their
current values; explicit null clears nullable fields. Missing, archived, and
RentCast IDs intentionally share one bounded `404` result.

The application reloads the active manual record before update, normalizes the
merged draft, and passes one server timestamp to persistence. PostgreSQL updates
only editable columns plus `updated_at`. Archive sets `archived_at` and
`updated_at` in one `UPDATE`; it never deletes history. The default listing query
uses `archived_at IS NULL`.

The browser exposes edit and archive actions only for a selected manual record.
Edit reuses the creation form and marker confirmation behavior. Notes remain
private in the read contract, so they are preserved by default and can only be
replaced or cleared through an explicit choice. Archive requires inline
confirmation and removes the successful record from active list and map state.
Mutation-time session expiry enters the existing signed-out state.

## Consequences

- one read and map contract supports both listing sources
- TypeScript preserves stronger RentCast guarantees for the worker
- manual creation must derive ownership from the authenticated JWT subject
- HTTP handlers cannot choose listing identity, source, owner, or timestamps
- malformed unauthenticated writes do not receive body-parser precedence over
  authentication
- archive history can remain in the same table without overloading listing
  status
- later writes must update `updated_at` explicitly until a trigger is justified
