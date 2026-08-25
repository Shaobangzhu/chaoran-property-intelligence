# ADR 0009: Persisted Listing Search Criteria

## Status

Accepted for Block 21 implementation. This ADR records architecture only. It
does not authorize a database migration, provider request, deployment, or AWS
operation.

## Context

The listing-alert boundary currently hard-codes California, active status, one
property type, five cities, a price range, and minimum bedroom and bathroom
counts in three places:

- the Domain predicate that decides acquisition and new-listing eligibility
- the RentCast sale-listings URL builder
- the production worker composition root

The authenticated React application cannot inspect or update those values. A
front-end-only filter would be incorrect because the scheduled worker, not the
browser, owns provider acquisition and Telegram alerts.

Block 20 also requires acquisition to remain broader than new-listing
eligibility: a tracked property must still produce a price-drop alert after it
falls below the configured minimum price. Any dynamic criteria design must
preserve that distinction.

## Decision

### One revisioned primary profile

Persist one server-owned `primary` listing-search profile for the current
single-agent, single-worker product. The profile contains:

- a versioned, strictly validated criteria document
- an administrator-edit revision
- the latest revision silently baselined by the worker
- update time and optional administrator identity

The application and PostgreSQL packages expose repository ports around this
profile. They do not expose JSONB or SQL shapes to React, the API, Domain, or
worker composition.

The first migration seeds the exact current behavior so deploying Block 21
without editing the form does not change provider scope or alerts.

### Fixed server invariants

`state = CA` and `status = Active` remain server-owned invariants. They are
part of the effective Domain criteria and RentCast request, but they are not
editable fields or hidden browser inputs.

The editable version-1 criteria are:

- one required RentCast property type
- required minimum and maximum whole-dollar prices
- required minimum bedrooms
- required minimum bathrooms
- one to five selected cities from the existing bounded city set

The version-1 property type is a single-select field. RentCast currently
supports pipe-delimited multi-value property types, so a later version can add
multi-select without multiplying provider requests. That expansion is not
silently included in Block 21.

### One provider request

Keep the accepted one-request regional acquisition strategy. The provider
request contains the fixed state/status, selected property type, maximum price,
minimum bedrooms, and minimum bathrooms. It deliberately omits minimum price
so Block 20 can continue observing tracked properties below the new-listing
floor.

RentCast does not document `city` as a multi-value parameter. The selected
one-to-five cities are therefore enforced by the Domain predicate after the
single regional response, not by issuing one request per city.

Production requests must request total-count metadata and reject an incomplete
page above the 500-record cap before changing listing, observation, or event
state. A criteria save itself performs no provider request.

### Revision baseline

Saving a changed profile increments its revision but does not immediately call
RentCast. On the next worker execution, an unapplied revision triggers one
normal provider request and a silent baseline of the current listings eligible
under the new criteria. This prevents a widened search from sending a burst of
`new-listing` alerts for existing market inventory.

Existing durable pending events are not deleted or rewritten. Existing stored
listing snapshots and manual listings are not removed. Once the revision is
baselined, later runs resume ordinary new-listing and price-drop detection.

The profile revision is marked applied only in the same database transaction
that commits its baseline. A provider, validation, cap, or database failure
leaves the revision unapplied and creates no partial alert state.

The implemented transaction locks the primary profile and candidate addresses,
then writes full-criteria inventory plus candidates that already have a price
observation. This keeps tracked below-minimum properties comparison-ready
without starting observation history for a newly discovered below-minimum
address. The transaction also establishes the global price-baseline marker and
does not mutate alert events. Existing pending events are delivered only after
the baseline commits; a notification failure leaves them pending and does not
reopen the applied revision.

### Authenticated API and React workspace

Expose administrator-only `GET` and `PUT` endpoints under
`/api/listing-search-criteria`. The update requires the expected revision and
uses optimistic concurrency. State and status are not accepted from the
browser.

Add a first-level authenticated React workspace named `Search Criteria`. It
loads the saved profile and offers one property-type select, two currency
inputs, minimum bedroom and bathroom selects, and a city disclosure menu with
checkboxes. It is persistent alert configuration, not a client-side filter for
the existing listing snapshot view.

## Consequences

- The browser, API, worker, and Domain use one authoritative criteria contract.
- Criteria remain typed and versioned while JSONB avoids coupling future
  complex criteria to the first physical column layout.
- The original one-request monthly quota boundary was preserved through Block
  21, but ADR 0014 supersedes it with one explicit request per selected market.
- Criteria changes become auditable and concurrency-safe.
- A widened search does not create a Telegram flood.
- Saved changes are not immediate; the next worker run owns provider
  acquisition and revision baseline.
- Supporting multiple profiles, client-specific alerts, multi-select property
  types, arbitrary California cities, or immediate preview requests requires a
  separately planned version.
