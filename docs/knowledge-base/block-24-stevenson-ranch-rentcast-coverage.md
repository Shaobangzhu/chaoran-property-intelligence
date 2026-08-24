# Block 24: Stevenson Ranch RentCast Coverage

## Status

Block 24.0 is complete in documentation only on
`feat/add-new-city-stevensonranch`. Block 24.1A and 24.1B are complete. The
fixture-gated second audit proved that RentCast classifies every matching ZIP
`91381` listing as `Valencia`, not `Stevenson Ranch`; the expected-city gate
therefore failed closed. The product/domain decision is now accepted:
`Stevenson Ranch` remains the selectable market, eligibility uses ZIP `91381`,
and provider city `Valencia` remains unchanged. Blocks 24.2 through 24.4 are
complete: the version-1 Domain market set now contains six choices, the shared
matcher applies exact-city semantics to the original five markets and ZIP
semantics to Stevenson Ranch, the RentCast client accepts typed radius or ZIP
search areas, and the worker source supports sequential, all-or-nothing reads
across one or two selected areas. Production composition still omits explicit
areas and therefore retains the Brea default until Block 24.5. No persisted
search profile, database, Telegram message, AWS resource, schedule, real
provider request, or deployment changed in Block 24.4.

Every executable sub-block requires a fresh explanation and explicit
confirmation.

## Product Requirement

Add `Stevenson Ranch` to the authenticated listing-search city choices and make
RentCast acquisition capable of returning active sale listings in ZIP code
`91381`, California.

The feature must preserve:

- California-only and Active-only acquisition
- the seven existing property-type choices
- configurable price, bedroom, bathroom, and city criteria
- new-listing and price-drop alert semantics
- one current React listing record per canonical property address
- search-revision silent baseline behavior
- bounded provider pages and fail-closed notification delivery

## Current Constraint

The production RentCast adapter currently sends one regional request centered
on `1065 Brea Mall, Brea, CA 92821` with a 20-mile radius. Domain filtering then
keeps Chino, Chino Hills, Eastvale, Corona, and Jurupa Valley according to the
persisted search profile.

Stevenson Ranch is outside that acquisition area. Adding only a Domain enum or
React checkbox would expose a selectable value that the provider request cannot
retrieve. Expanding the single radius enough to include both regions would also
pull a much larger Southern California market into one 500-result page and
would weaken the existing completeness gate.

RentCast's official sale-listings reference supports a five-digit `zipCode`
query. Block 24 therefore adds a separately bounded `91381` provider area rather
than expanding the existing radius.

Official provider reference:
[RentCast sale listings](https://developers.rentcast.io/reference/sale-listings).

## Accepted Acquisition Model

### Supported product markets

Append `Stevenson Ranch` to the canonical supported-city order:

1. `Chino`
2. `Chino Hills`
3. `Eastvale`
4. `Corona`
5. `Jurupa Valley`
6. `Stevenson Ranch`

The public criteria schema remains version 1. Adding a supported enum value is
backward-compatible with existing five-city JSON. No database migration or
automatic persisted-profile rewrite is required.

For schema-version compatibility, the existing `cities` JSON field and
`ListingSearchCity` TypeScript name remain in place, but their values are
product-market labels. They do not authorize rewriting a listing's provider
city. The original five labels match exact city values; `Stevenson Ranch`
matches ZIP `91381` while the listing continues to expose `Valencia`.

New default profiles may include all six supported cities. An existing profile
continues to contain its currently saved city selection until the operator
explicitly selects `Stevenson Ranch` and saves. That save increments the search
revision. The next worker run applies the existing silent revision baseline so
historical Stevenson Ranch inventory does not create a notification burst.

### Conditional provider areas

Introduce an explicit provider geography contract instead of retaining a
hard-coded URL inside the HTTP client:

```ts
type RentCastSaleListingsSearchArea =
  | {
      readonly kind: "radius";
      readonly address: "1065 Brea Mall, Brea, CA 92821";
      readonly radiusMiles: 20;
    }
  | {
      readonly kind: "zip";
      readonly zipCode: "91381";
    };
```

Production routing is selected from the persisted cities:

| Selected markets | Provider requests |
| --- | ---: |
| one or more of the existing five only | 1 radius request |
| Stevenson Ranch only | 1 ZIP request |
| existing region plus Stevenson Ranch | 2 requests |

This is one request per acquisition area, not one request per city. The design
can add another reviewed area later without coupling Domain city selection to
ad hoc URL construction.

The worker executes required areas sequentially to avoid an unnecessary
provider-rate burst. Each response independently must satisfy the existing
complete-page checks:

- `totalCount` must not exceed the 500-result limit
- returned length must equal `totalCount`
- every listing must pass the strict provider response parser
- timeout and Abort remain bounded per request

Only after every required area succeeds are listings flattened into the
existing application workflow. Existing canonical-address reconciliation owns
deduplication and rejects conflicting observations. If any area fails, the
entire source read fails before listing transitions or Telegram delivery; the
application does not accept partial regional success.

### Provider and Domain filtering

The ZIP request is an acquisition boundary, not final eligibility. Domain rules
apply an explicit product-market matcher: the original five markets require an
exact selected city value, while `Stevenson Ranch` requires ZIP `91381` and
does not rewrite or require an identical provider city. State remains `CA`,
status remains `Active`, and property type, maximum price, minimum bedrooms,
and minimum bathrooms remain required. Minimum price remains a new-listing
notification threshold rather than a provider acquisition floor so later
price drops below that threshold remain observable.

Block 24.1 must confirm with one separately authorized real request that
RentCast returns the expected `city` value for ZIP `91381`. If the provider uses
a different city label, implementation stops for a requirement decision; it
must not silently alias another municipality to Stevenson Ranch.

## Quota And Cost Boundary

The existing worker consumes one RentCast request per run. A profile combining
the existing region with Stevenson Ranch consumes two. A 50-request monthly
allowance therefore permits at most 25 two-area runs before manual audits and
retries are considered. The currently defined daily AWS schedule remains
disabled and is not enabled or modified by Block 24.

Provider request count, audit requests, retries, and any future schedule cadence
must be reviewed together before production enablement. Block 24 does not hide
the additional request behind a larger radius or partial-result behavior.

## React And API Behavior

The Search Criteria screen continues to derive checkboxes from the Domain
canonical list. Its copy changes from one-to-five to one-to-six selection. The
disclosure label remains count-based, and keyboard, Escape, click-away, focus,
error, dirty-state, reset, conflict, and responsive behavior remain unchanged.

The API continues to expose the same criteria DTO and revision protocol. It
accepts the sixth enum value through the shared strict Domain parser. Existing
five-city profiles remain readable and writable. Unknown cities, duplicates,
an empty selection, and more than six entries remain invalid.

## Map And CAL FIRE Boundary

Listings returned for Stevenson Ranch use the existing ArcGIS 2D and optional
3D rendering paths. Fit, selection, and single-record behavior must continue to
work across the larger two-region extent.

Block 24 does not expand, rebuild, rename, or reinterpret the tracked five-city
CAL FIRE artifact. A Stevenson Ranch listing may appear in a blank hazard area;
the current disclosure that blank areas may be outside mapped hazard zones
remains authoritative. Adding Los Angeles County or Stevenson Ranch CAL FIRE
coverage requires a separate data-provenance block.

## Security And Privacy

- keep `RENTCAST_API_KEY` in the existing request header
- never log the key, complete request headers, raw response, or street address
- record only bounded aggregate audit evidence
- preserve HTTPS, timeout, Abort, strict JSON parsing, and safe errors
- do not add browser access to RentCast
- do not mutate Secrets Manager, GitHub secrets, or environment files
- do not call PostgreSQL, Telegram, AWS, or RentCast without explicit approval

## Planned Implementation

### Block 24.0: Documentation and architecture

- freeze the six-market requirement and non-goals
- accept conditional multi-area provider acquisition
- record compatibility, quota, failure, rollout, and rollback behavior
- add ADR 0012 and roadmap entries

### Block 24.1: Provider contract and controlled coverage audit

- verify the official `zipCode` request contract
- add no production wiring
- after separate authorization, execute exactly one real `91381` request with
  the current filters and API key
- record only status, totals, 500-cap margin, response bytes, latency, returned
  city labels, and bounded property-type/status counts
- stop if the page is incomplete or the city label is incompatible

#### Audit record: 2026-08-24

The official RentCast sale-listings reference was checked immediately before
execution. It documents `zipCode` as a five-digit ZIP search parameter and
supports the selected sale-listing filters and numeric ranges used by this
project.

After explicit authorization, one request was sent with this bounded profile:

```text
zipCode=91381
state=CA
status=Active
propertyType=Single Family
price=*:850000
bedrooms=4:
bathrooms=2.5:
limit=500
includeTotalCount=true
```

The request returned a successful 2xx response and a JSON array that parsed
successfully. The aggregate-only validator then stopped while validating
`X-Total-Count`: its numeric regular expression was over-escaped and matched a
literal `\d` sequence instead of decimal digits. The process intentionally did
not persist the raw response, so totals, response bytes, latency, city labels,
property-type counts, and status counts cannot be reconstructed.

This is an audit-tool failure, not evidence that the provider omitted the
header or returned an incompatible city. The result is **inconclusive** and
Block 24.1 is not complete. Exactly one provider request was consumed, no retry
was made, and no API key, request header, raw response, listing identifier, MLS
number, or street address was logged or stored.

A second real request requires a new explanation and explicit authorization.
Before any second request, the corrected aggregate validator must pass local
fixtures for numeric total-count headers, zero results, incompatible city
labels, incomplete pages, and successful Stevenson Ranch coverage. Production
wiring remains unchanged.

#### Block 24.1A: Fixture-gated audit tool

Block 24.1A adds an isolated maintenance entrypoint under `apps/alert-worker`.
It is compiled with the worker package but is not imported by the production
worker, API, or scheduled composition. Its URL is built through
`URLSearchParams`, uses only the bounded profile above, sends the API key only
in `X-Api-Key`, applies a 30-second Abort timeout, and has no retry path.

The command refuses execution unless its only argument is
`--execute-one-request`. The safe no-flag entrypoint is:

```bash
pnpm rentcast:stevenson-ranch-coverage-audit
```

The separately controlled real-request entrypoint was used once in Block 24.1B:

```bash
pnpm rentcast:stevenson-ranch-coverage-audit:execute-one-request
```

The aggregate parser reads only the fields needed to prove ZIP, city, state,
status, property type, price, bedroom, and bathroom compatibility. Output is
limited to counts, completeness flags, response bytes, and elapsed time. It
does not emit the request URL, API key, raw response, address, listing ID, or
MLS data.

The no-network fixture suite proves:

- the exact ZIP request and absence of radius/address and minimum-price inputs
- decimal `X-Total-Count` acceptance and malformed/missing-header rejection
- fail-closed zero-result, incompatible-city, incompatible-ZIP, incomplete-page,
  500-result, filter-drift, and schema behavior
- successful aggregate counts without raw listing disclosure
- configuration validation before fetch
- explicit CLI authorization, exactly-one-fetch behavior, no retry, and API-key
  redaction

Block 24.1A did not make a provider request and did not change the production
request profile. At that point Block 24.1 remained incomplete pending the
separately authorized 24.1B result recorded below.

Verification completed on 2026-08-24:

- 23 targeted audit runner/command fixtures passed
- the full repository suite passed: 112 files and 996 tests
- root typecheck passed
- the alert-worker production build passed
- the built CLI rejected a no-flag invocation before configuration or fetch
- `git diff --check` passed
- the security diff found no environment-file, production composition, worker
  entrypoint, database, AWS, Telegram, or existing RentCast client change

#### Block 24.1B: Controlled provider result

After new explicit authorization on 2026-08-24, the fixture-gated command made
exactly one real request with the bounded `91381` profile. It did not retry.
The aggregate result was:

| Gate | Result |
| --- | --- |
| Total matching listings | 17 |
| Returned listings | 17 |
| Result limit / margin | 500 / 483 |
| Returned page complete | Yes |
| Expected ZIP `91381` verified | Yes, 17 |
| Expected city `Stevenson Ranch` verified | **No** |
| Returned city labels | `Valencia`: 17 |
| Property types | `Single Family`: 17 |
| Status values | `Active`: 17 |
| Invalid filter rows | 0 |
| Response body bytes | 18,482 |
| Request latency | 269 ms |
| Coverage gate | **FAIL** |

The provider page is complete, below the result cap, and compatible with every
filter except the required city label. This is a conclusive provider-contract
result: RentCast represents ZIP `91381` with city `Valencia`. The command exited
with code 1 as designed. It emitted no API key, request URL, raw response,
street address, listing ID, or MLS data.

Block 24.1 is complete as a controlled audit. The accepted product decision
keeps `Stevenson Ranch` as the market label, defines its eligibility by ZIP
`91381`, and preserves `Valencia` as the RentCast listing city. This is an
explicit market mapping, not a silent provider-data alias. No additional
provider request is needed for this decision.

### Block 24.2: Domain and profile compatibility

**Complete.** The implementation:

- appended `Stevenson Ranch` to `listingSearchCities`
- retained criteria schema version 1
- defined explicit product-market eligibility: exact city for the original five
  markets and ZIP `91381` for Stevenson Ranch
- retained the provider listing city without normalization or display rewriting
- verified old five-city JSON remains valid and canonical
- verified one-to-six validation, duplicate rejection, default freezing, Domain
  acquisition, and new-listing/price-drop semantics
- added no migration and did not mutate an existing profile

As built, the shared Domain matcher accepts a provider listing for the
Stevenson Ranch market only when its untouched city is non-null and its ZIP is
exactly `91381`. Listings in the original five markets continue to require an
exact city match. Acquisition and price-drop filtering now pass both city and
ZIP into that matcher, while downstream listing records continue to expose the
provider city unchanged.

The current API DTO accepts the sixth version-1 market, and the React criteria
control renders all six choices with one-to-six selection copy. A saved legacy
five-market profile still contains and selects only its original five values;
there is no migration or implicit opt-in.

Verification completed for this sub-block:

- 120 targeted Domain, API DTO, and React tests passed
- all 112 test files and all 1009 tests passed
- root `pnpm typecheck` passed, including runtime, web, and AWS infrastructure
- root `pnpm build` passed, including the production web bundle
- no RentCast request or other external side effect occurred

### Block 24.3: Typed RentCast geography

**Complete.** The implementation:

- added and exported discriminated radius/ZIP search-area types from
  `packages/rentcast`
- exported the existing Brea address and 20-mile radius as the frozen default
  area, preserving all existing callers and production request geography
- moved geography projection out of hidden URL literals and into the typed
  request contract
- emits only `address` and `radius` for radius areas, or only `zipCode` for ZIP
  areas
- rejects blank radius addresses, non-positive or non-integer radii, malformed
  ZIP values, unknown area kinds, and non-object areas before `fetch`
- preserved CA, Active, property filters, 500 limit, total-count header,
  timeout, response parser, response-size accounting, and `X-Api-Key` behavior

The regular client and isolated coverage-audit method both accept an optional
typed area after their existing criteria argument. Omitting it resolves to the
exported Brea default. This compatibility boundary lets Block 24.4 pass one or
two explicit areas without changing the HTTP client again.

Verification completed for this sub-block:

- 32 RentCast client tests passed, including 10 new geography-contract tests
- 42 targeted RentCast and directly dependent worker/integration tests passed
- all 112 test files and all 1019 tests passed
- root `pnpm typecheck` passed, including runtime, web, and AWS infrastructure
- root `pnpm build` passed, including the production web bundle
- no real RentCast request or other external side effect occurred

### Block 24.4: Conditional multi-area source

**Complete.** The implementation:

- added a pure product-market-to-provider-area mapping in the worker
- maps any original market selection to the existing Brea radius exactly once
- maps Stevenson Ranch to ZIP `91381` and returns stable Brea-then-ZIP order for
  mixed selections
- rejects empty or unsupported runtime market selections before provider access
- lets the source accept one or more explicit typed areas while preserving Brea
  as the compatibility default when the option is omitted
- fetches required areas sequentially and validates each page independently
- retains every complete page in memory and normalizes/returns listings only
  after all required areas succeed
- reads one shared observation timestamp only after all pages have passed
- preserves raw duplicate observations for the existing Application canonical-
  address reconciliation to collapse or reject as appropriate
- fails the whole source read when a later area has a provider, parse,
  completeness, or result-limit failure, without returning the earlier page

Production composition does not yet pass persisted markets into this mapping.
That wiring remains Block 24.5, so the current production worker still makes
the same single Brea request. This boundary proves the multi-area source before
changing the production request count.

Verification completed for this sub-block:

- 18 market-mapping and multi-area source tests passed
- 46 targeted worker, Application reconciliation, and integration tests passed
- all 113 test files and all 1034 tests passed
- root `pnpm typecheck` passed, including runtime, web, and AWS infrastructure
- root `pnpm build` passed, including the production web bundle
- no real RentCast request or other external side effect occurred

### Block 24.5: Production composition and audit reporting

- project the persisted profile into conditional provider areas
- update coverage audit summaries to report each area and combined totals
- prove existing-only, Stevenson-only, and mixed request counts
- preserve silent revision baseline and no-partial-notification behavior
- keep AWS schedules and provider credentials unchanged

### Block 24.6: API and React city selection

- expose the sixth shared Domain option through the current API DTO
- update selection copy and tests from one-to-five to one-to-six
- verify existing profiles remain unchanged until explicitly saved
- verify saving Stevenson Ranch increments revision without duplicating listings
- run desktop/mobile accessibility and layout acceptance

### Block 24.7: Integration and final gate

- run full tests, root typecheck, production builds, and diff/security checks
- run a fake two-area worker integration with overlap and failure cases
- run local authenticated API/React acceptance
- verify ArcGIS two-region fit and the CAL FIRE blank-area disclosure
- record quota and rollout instructions
- update ADR, knowledge base, and roadmap as built
- leave deployment, schedule enablement, real worker execution, Telegram, and
  production profile mutation to separately approved operations

## Expected Files

- `packages/domain/src/listingSearchCriteria.ts`
- `packages/domain/src/listingSearchCriteria.test.ts`
- `packages/domain/src/cityFilter.ts`
- `packages/domain/src/listingFilter.test.ts`
- `packages/rentcast/src/rentCastSaleListingsClient.ts`
- `packages/rentcast/src/rentCastSaleListingsClient.test.ts`
- `apps/alert-worker/src/rentCastListingSource.ts`
- `apps/alert-worker/src/rentCastListingSource.test.ts`
- `apps/alert-worker/src/rentCastSearchAreas.ts`
- `apps/alert-worker/src/rentCastSearchAreas.test.ts`
- `apps/alert-worker/src/runProduction.ts`
- `apps/alert-worker/src/runProduction.test.ts`
- `apps/alert-worker/src/runRentCastCoverageAudit.ts`
- `apps/alert-worker/src/runRentCastCoverageAudit.test.ts`
- `apps/web/src/SearchCriteriaScreen.tsx`
- `apps/web/src/SearchCriteriaScreen.test.tsx`
- focused API/application integration tests as required
- `docs/adr/0012-conditional-rentcast-search-areas.md`
- `docs/knowledge-base/block-24-stevenson-ranch-rentcast-coverage.md`
- `docs/roadmap.md`

## Completion Criteria

Block 24 is complete only when:

- Stevenson Ranch is a selectable sixth market
- existing five-city profiles remain valid and unchanged until saved
- ZIP `91381` coverage is supported by a typed, tested provider request
- existing-only and Stevenson-only selections issue one request
- mixed selections issue exactly two sequential requests
- each page independently passes the 500-result completeness gate
- one required-area failure produces no partial transitions or Telegram send
- final Domain eligibility requires an exact selected market match (city for
  the original five or ZIP `91381` for Stevenson Ranch), CA, and Active status
- revision baseline prevents historical Stevenson Ranch notification noise
- React retains one listing record per canonical address
- ArcGIS renders the broader listing extent without changing CAL FIRE semantics
- request-count and monthly-quota impact are documented
- full tests, typecheck, builds, browser acceptance, and security review pass
- no unintended migration, AWS, schedule, credential, or deployment change is
  present

## Rollback

Before deployment, discard or revert Block 24. After a code deployment, revert
Block 24 and save a profile without Stevenson Ranch if it had been selected.
The criteria schema remains version 1, so old five-city JSON requires no data
repair. No cloud resource or database migration is part of this feature.
