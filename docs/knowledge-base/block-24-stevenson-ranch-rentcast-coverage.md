# Block 24: Stevenson Ranch RentCast Coverage

## Status

Block 24.0 is complete in documentation only on
`feat/add-new-city-stevensonranch`. The product boundary, provider acquisition
model, quota impact, compatibility rules, failure behavior, implementation
sequence, and acceptance gates are planned. No runtime source, persisted search
profile, database, provider request, Telegram message, AWS resource, schedule,
or deployment changed.

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
      readonly kind: "zip-code";
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
still require an exact selected city value, `CA`, `Active`, the selected
property type, maximum price, minimum bedrooms, and minimum bathrooms. Minimum
price remains a new-listing notification threshold rather than a provider
acquisition floor so later price drops below that threshold remain observable.

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

### Block 24.2: Domain and profile compatibility

- append `Stevenson Ranch` to `listingSearchCities`
- retain criteria schema version 1
- verify old five-city JSON remains valid and canonical
- verify one-to-six validation, duplicate rejection, default freezing, Domain
  acquisition, and new-listing/price-drop semantics
- add no migration and do not mutate an existing profile

### Block 24.3: Typed RentCast geography

- add the radius/ZIP search-area union to `packages/rentcast`
- remove the hidden hard-coded geography from URL construction
- create exact radius and ZIP query parameters through `URLSearchParams`
- preserve filters, 500 limit, total count, timeout, parser, and key header
- add URL, validation, timeout, HTTP, and response tests without a real request

### Block 24.4: Conditional multi-area source

- map selected cities to one or two reviewed acquisition areas
- fetch required pages sequentially and validate each page independently
- flatten only after all required requests succeed
- preserve canonical-address reconciliation and conflict behavior
- fail closed on one-area timeout, HTTP failure, invalid JSON, or incomplete page

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
- final Domain eligibility requires exact selected city, CA, and Active status
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

