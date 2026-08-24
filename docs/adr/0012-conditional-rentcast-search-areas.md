# ADR 0012: Conditional RentCast Search Areas

## Status

Accepted for Block 24 planning. Runtime implementation and real provider
requests remain separately confirmed sub-blocks.

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

Validate every area independently against the 500-result completeness gate.
Do not pass partial success into the application workflow. Flatten results only
after all required areas succeed, then retain the existing canonical-address
deduplication and conflict checks.

Append Stevenson Ranch to the version-1 Domain enum without migrating or
silently rewriting existing profiles. The operator explicitly opts in by saving
the sixth city; the existing search-revision baseline prevents historical
inventory notifications.

The additional area may double RentCast requests per worker run. Block 24 does
not enable or change the disabled daily AWS schedule. Quota and cadence remain
an operational gate.

## Consequences

Positive consequences:

- Stevenson Ranch obtains a bounded acquisition path
- existing five-city behavior and profiles remain compatible
- request fan-out is per reviewed area, not per city
- a future market can add a reviewed route without changing the HTTP client
- partial provider failure cannot produce partial alerts

Tradeoffs:

- mixed profiles consume two RentCast requests per run
- the source and coverage audit must report per-area completeness
- a 50-request allowance supports at most 25 mixed runs before audits/retries
- the map spans a larger region when both areas have listings

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

