# ADR 0012: Conditional RentCast Search Areas

## Status

Accepted. The Block 24.1B provider audit confirmed that ZIP `91381` listings
are labeled `Valencia` by RentCast. The product decision keeps `Stevenson
Ranch` as the selectable market, matches that market by ZIP, and preserves the
provider city unchanged. Block 24.3 implements the typed radius/ZIP client
contract and exports the existing Brea radius as its compatible default. Block
24.4 implements pure market-to-area selection and sequential, all-or-nothing
multi-area source reads. Block 24.5 wires the normalized persisted profile into
that selection for production composition. Existing profiles therefore retain
their saved request area, while an explicit Stevenson Ranch selection adds the
reviewed ZIP area without changing provider listing data. Block 24.6 verifies
that the bounded authenticated API and React criteria UI preserve a legacy
five-market profile until the operator explicitly selects and saves Stevenson
Ranch; that save serializes canonical markets and advances the profile revision
exactly once without changing the applied alert baseline. Block 24.7 proves the
production composition end to end with fake HTTP adapters: stable Brea-then-ZIP
requests, canonical-address overlap reconciliation, quiet revision baseline,
provider-city preservation, and no partial persistence or Telegram delivery
when the second area fails. Automated 2D and 3D ArcGIS tests also prove the
cross-region viewpoint while leaving CAL FIRE scope and classifications
unchanged. The operator completed the logged-in local criteria flow, explicitly
saved Stevenson Ranch, verified the resulting Listings and map behavior, and
accepted Block 24 for merge. The CAL FIRE blank-area disclosure remains
authoritative because the artifact is still intentionally limited to the
reviewed five-city scope.

## Context

The product currently supports five Inland Empire listing markets while the
RentCast client acquires one 20-mile-radius page centered in Brea. Domain city
filtering narrows that regional response. Stevenson Ranch, CA 91381 is outside
the existing area, so adding a UI enum alone cannot provide coverage.

RentCast limits the sale-listings response to 500 results and exposes total
count. One much larger Southern California radius risks an incomplete page and
would couple unrelated markets. RentCast's official sale-listings contract
supports a five-digit ZIP-code filter.

## Decision

Represent provider geography explicitly as a typed radius or ZIP search area.
Keep the existing Brea radius for the original five cities and add ZIP `91381`
for Stevenson Ranch. Select required areas from the persisted Domain cities:
one request for either area alone and two sequential requests for a mixed
profile.

The RentCast client accepts the typed area independently from its property
criteria. Radius requests emit only `address` and `radius`; ZIP requests emit
only `zipCode`. Both retain the existing California, Active, property filter,
500-result, total-count, timeout, parser, and API-key-header contracts.

Validate every area independently against the 500-result completeness gate.
Do not pass partial success into the application workflow. Flatten results only
after all required areas succeed, then retain the existing canonical-address
deduplication and conflict checks.

Select areas through a pure worker mapping. Any original market selects the
Brea radius, Stevenson Ranch selects ZIP `91381`, and a mixed selection returns
the Brea area followed by the ZIP area. The source fetches in that stable order,
validates each page before continuing, and reads the shared observation time
only after every page succeeds. An empty or unsupported runtime market set and
an explicitly empty source-area list fail before provider access.

Append Stevenson Ranch to the version-1 Domain enum without migrating or
silently rewriting existing profiles. The operator explicitly opts in by saving
the sixth city; the existing search-revision baseline prevents historical
inventory notifications.

Treat the version-1 `cities` values as product-market labels for compatibility,
not as an assertion that every provider listing has an identical `city` field.
The original five markets continue to match by exact city. The `Stevenson
Ranch` market matches ZIP `91381`; a matching RentCast listing keeps its
provider city, currently `Valencia`, throughout normalization, persistence,
notifications, API DTOs, and React display. Market selection and listing-city
display are separate concerns.

The additional area may double RentCast requests per worker run. Block 24 does
not enable or change the disabled daily AWS schedule. Quota and cadence remain
an operational gate. With a 50-request allowance, mixed profiles support at
most 25 runs before audits, retries, or other provider use; a daily mixed
schedule is therefore not approved by this decision.

Coverage audit reporting accepts an explicit reviewed area list, executes it
sequentially, reports completeness and capacity per area, and labels summed
provider rows as pre-reconciliation totals. The existing guarded audit command
continues to default to the single Brea area, so its one-request authorization
contract is not silently widened.

## Consequences

Positive consequences:

- Stevenson Ranch obtains a bounded acquisition path
- existing five-city behavior and profiles remain compatible
- request fan-out is per reviewed area, not per city
- a future market can add a reviewed route without changing the HTTP client
- partial provider failure cannot produce partial alerts
- provider data is not rewritten to imitate the product-market label

Tradeoffs:

- mixed profiles consume two RentCast requests per run
- the source and coverage audit must report per-area completeness
- a 50-request allowance supports at most 25 mixed runs before audits/retries
- the map spans a larger region when both areas have listings
- the legacy `cities` schema field now represents supported market labels, so
  new matching rules must be explicit and tested rather than inferred from the
  field name

## Rejected Alternatives

### Add only the city enum

Rejected because the current provider radius cannot acquire Stevenson Ranch.

### Expand the existing radius

Rejected because it pulls a much larger market into a single 500-result page
and weakens completeness guarantees.

### Send one request for every selected city

Rejected because it multiplies quota consumption up to six requests per run
and discards the existing bounded regional strategy.

### Accept partial area success

Rejected because missing one selected region could silently alter alerts and
price observations.

### Rewrite RentCast city to Stevenson Ranch

Rejected because normalization must preserve provider listing data. Product
market eligibility is expressed by the reviewed ZIP mapping instead.

### Expand CAL FIRE coverage in the same block

Rejected because provider listing acquisition and authoritative hazard-data
provenance are independent changes. The tracked five-city CAL FIRE artifact
remains unchanged.

## Security And Operations

The API key remains server-side in the existing header. No raw listing body,
street address, credential, or complete request header is logged. A real ZIP
coverage audit requires explicit approval. Database migration, profile
mutation, Telegram delivery, AWS deployment, and schedule enablement are out of
scope without separate authorization.

## Rollback

Revert Block 24 and remove Stevenson Ranch from any explicitly saved profile.
Schema version 1 and old five-city profiles remain valid, so no migration or
data repair is required.
