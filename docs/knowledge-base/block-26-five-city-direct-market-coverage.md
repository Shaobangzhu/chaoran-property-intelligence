# Block 26: Five-City Direct Market Coverage

## Status

Blocks 26.0 through 26.5 are complete on
`refactor/five-city-direct-market-coverage`. Block 26.0 froze the product,
provider geography, hazard authority, request-count, failure, compatibility,
security, rollout, rollback, test, and acceptance boundaries. Block 26.1A
added an isolated, fixture-gated five-city audit entrypoint without changing
production acquisition. Block 26.1B used that guarded entrypoint for the
authorized five-request provider audit and recorded aggregate-only evidence.
Block 26.2 added the strict typed city-area client contract and removed
implicit client-level geography defaults without changing worker area mapping.
Block 26.3 replaced the active product-market selector and production
composition expectations with canonical direct-market areas. Block 26.4
removed the source-level Brea fallback and completed fake-provider production
workflow integration for sequential acquisition, completeness, overlap,
provider-city preservation, and zero-partial-effect failure behavior.
Block 26.5 retired the old Brea-default audit path, retained separately guarded
five-direct-city and ZIP `91381` audits, and made request cost and quota planning
visible in command output and operations guidance.

Block 26.1B read only the existing server-side RentCast key and made exactly
five sequential requests with no retry. No credential value, raw response,
request URL, request header, or street address was recorded. No database,
production acquisition profile, wildfire artifact, AWS resource, schedule,
Telegram delivery, or deployment changed.

## Purpose

Remove the legacy RentCast acquisition dependency on a 20-mile radius centered
at `1065 Brea Mall, Brea, CA 92821` for these five product markets:

- Chino
- Chino Hills
- Eastvale
- Corona
- Jurupa Valley

Each incorporated city must be acquired through its own direct RentCast city
query. Stevenson Ranch remains the separately reviewed ZIP `91381` product
market introduced by Block 24.

The change improves provider-area precision. It does not redesign Search
Criteria, alter listing eligibility, backfill historical inventory, create a
new wildfire model, or change authoritative CAL FIRE classifications.

## Accepted Product Behavior

1. Selecting one of the five incorporated cities requires one RentCast
   `city + state=CA` request for that city.
2. Selecting multiple incorporated cities requires one request per selected
   city, in canonical product-market order.
3. Selecting Stevenson Ranch requires the existing ZIP `91381` request. Its
   RentCast provider city remains unchanged, including the audited `Valencia`
   value.
4. A profile containing all six markets requires six provider requests.
5. The Brea address and 20-mile radius are not used by production composition,
   source defaults, or the successor coverage-audit path.
6. Existing California, Active, property-type, maximum-price, bedroom, and
   bathroom provider filters remain unchanged. The current Domain layer remains
   responsible for the minimum-price and final market eligibility checks.
7. Every required page must pass its independent completeness gate before any
   listing is returned to the application workflow.
8. One required-area failure produces no partial persistence, price
   observation, alert transition, or Telegram notification.
9. Overlapping provider rows retain the existing canonical-address
   reconciliation and conflict checks. React continues to expose one stored
   listing record per canonical address.
10. Saving Search Criteria changes the next worker acquisition profile. It does
    not immediately fetch RentCast data, delete existing stored snapshots, or
    synthesize listings in the browser.

## Provider Geography Contract

RentCast's sale-listings API supports direct city/state queries. Block 26 adds
an explicit city variant to the existing typed provider geography:

```ts
type RentCastSaleListingsSearchArea =
  | {
      readonly kind: "city";
      readonly city: string;
    }
  | {
      readonly kind: "radius";
      readonly address: string;
      readonly radiusMiles: number;
    }
  | {
      readonly kind: "zip";
      readonly zipCode: string;
    };
```

The city variant emits `city=<reviewed city>` and the existing fixed
`state=CA`. It emits neither `address`, `radius`, nor `zipCode`. ZIP and radius
variants retain their mutually exclusive parameter contracts for reviewed
uses, but no production default may silently select Brea.

The five city names are case-sensitive provider inputs and must be audited
before production composition changes:

| Product market | Planned provider area |
| --- | --- |
| Chino | `city=Chino&state=CA` |
| Chino Hills | `city=Chino Hills&state=CA` |
| Eastvale | `city=Eastvale&state=CA` |
| Corona | `city=Corona&state=CA` |
| Jurupa Valley | `city=Jurupa Valley&state=CA` |
| Stevenson Ranch | `zipCode=91381` with provider city preserved |

A city query is preferred over one ZIP per incorporated city because several
supported cities span multiple postal codes. Block 26 must not introduce an
incomplete hand-maintained ZIP allowlist.

## Area Selection And Failure Semantics

The pure worker mapping projects selected product markets to explicit provider
areas in `listingSearchCities` order. It returns exactly one area for each
selected market:

- the five incorporated cities map to city areas
- Stevenson Ranch maps to ZIP `91381`
- an empty, duplicate, or unsupported market set fails before provider access

The source executes areas sequentially. For each page it validates:

- successful HTTP and schema parsing
- a valid `X-Total-Count`
- `totalCount < 500`
- returned-row count consistent with `totalCount`

The source flattens pages only after all selected areas pass. Existing
canonical-address reconciliation then resolves overlap. The shared observation
time is read only after the final successful page, so a partial run cannot
advance price-drop state.

No automatic retry is added in this block. A retry would consume quota and must
be a separately reviewed operational decision.

## Wildfire Coverage Boundary

The Brea radius has never selected, clipped, or classified wildfire data.
Block 25 already publishes a deterministic same-origin artifact with six typed
coverage targets:

- Chino, Chino Hills, Eastvale, Corona, and Jurupa Valley are
  `incorporated-jurisdiction` targets clipped to their reviewed city boundaries
- Stevenson Ranch is a `market-context` target clipped to its reviewed Census
  Designated Place boundary

Block 26 therefore does not download CAL FIRE data, rebuild the artifact,
change a boundary, or convert the five cities to ZIP/CDP market contexts. Their
incorporated-jurisdiction coverage is more authoritative than the Stevenson
Ranch delivery context and must remain unchanged.

ArcGIS 2D and 3D Terrain continue to load the existing versioned artifact
independently from listing count. Acceptance must prove that each of the five
city hazard areas remains visible when the toggle is enabled, including when a
selected market currently has no matching listing. Search Criteria and
RentCast responses do not select, infer, or alter hazard classifications.

## Request Quota And Cost Gate

Successful RentCast requests count independently. The request matrix becomes:

| Selected markets | Requests per worker run |
| --- | ---: |
| One incorporated city | 1 |
| Five incorporated cities | 5 |
| Stevenson Ranch only | 1 |
| Five incorporated cities plus Stevenson Ranch | 6 |

Using 50 requests as a monthly planning reference, five-city runs permit at
most 10 complete runs and six-market runs permit at most 8 complete runs with 2
requests left, before audits, manual calls, or retries. This arithmetic does not
assert the account's current plan or remaining quota. A weekly six-market
cadence would use approximately 24 requests in a four-run month, but Block 26
does not approve, enable, or change an AWS schedule.

Production enablement must review the actual subscription, remaining monthly
quota, audit consumption, intended cadence, and overage policy together. The
implementation must not hide request fan-out behind one logical worker run.

## Compatibility

The Domain search-criteria schema remains version 1. The six existing product
market labels, profile revision behavior, API DTOs, React form, authentication,
manual listings, persisted listing model, price-drop workflow, Telegram format,
showing-list workflow, and ArcGIS presentation remain compatible.

Existing profiles require no migration. Their next worker run uses the new
area mapping after deployment. Existing stored snapshots are retained and age
out only through existing application behavior; Block 26 does not purge or
rewrite them.

Historical Block 24 documentation remains an accurate record of the prior Brea
design. ADR 0014 supersedes only the active acquisition and audit-default parts
of ADR 0012. The Stevenson Ranch ZIP decision and provider-data-preservation
rules remain accepted.

## Security And Operations

- `RENTCAST_API_KEY` remains server-side in the existing request header.
- Browser code receives no RentCast credential or provider endpoint.
- Audit output must not contain API keys, request headers, raw responses,
  street addresses, or full request URLs.
- Block 26.1B used fresh explicit authorization before reading only the
  RentCast key from `.env.local` and making five real city requests.
- Tests and implementation use fixtures and fake HTTP adapters by default.
- No PostgreSQL, Telegram, AWS, ArcGIS-account, CAL FIRE, Census, or county GIS
  access is needed before the separately authorized acceptance stages.
- No migration, deployment, schedule change, or production worker execution is
  implied by code completion.

## Implementation Plan

### Block 26.0: Documentation and architecture

- freeze product and provider geography semantics
- add ADR 0014 and mark ADR 0012 partially superseded
- document request quota, failure atomicity, wildfire independence, rollout,
  rollback, and acceptance
- add the Block 26 roadmap

Status: complete in documentation only.

### Block 26.1A: Fixture-gated city audit tooling

- add strict city-area audit fixtures and summary contracts
- require an explicit reviewed market list and explicit execute flag
- report each area's total count, returned count, result-limit margin,
  completeness, provider-city distribution, bytes, and elapsed time
- prove dry-run behavior makes zero provider requests
- avoid logging raw listings, addresses, credentials, or request URLs

This sub-block does not read `.env.local` or call RentCast.

Status: complete. The isolated audit runner constructs exactly five sequential
`city + state=CA` URLs in the frozen market order and validates the existing
Single Family, Active, maximum-price, bedroom, bathroom, 500-row, and
`X-Total-Count` contracts. It emits only aggregate per-city and combined
counts, provider-city distributions, price ranges, response sizes, timings,
and completeness results. It does not retain or print listing addresses.

The CLI requires both exact arguments before it reads `RENTCAST_API_KEY` or
calls `fetch`:

```text
--execute-five-requests
--markets=chino,chino-hills,eastvale,corona,jurupa-valley
```

The non-executing package command intentionally omits `.env.local`, prints the
guarded usage, confirms that no request was made, and exits nonzero. The future
execution command loads `.env.local` only after the repository owner chooses
the explicitly named five-request script. No retry or partial summary is
implemented.

Twenty-four focused runner and command tests pass, including canonical request
order, mutually exclusive geography parameters, aggregate-only output, exact
double confirmation, missing-key validation, provider-city mismatch,
500-result failure, invalid total-count headers, fixed-filter violations,
invalid schema, later-area failure, no retry, and API-key redaction. The full
repository gate passes 116 test files and 1,096 tests,
root typecheck, and production/AWS build. The existing ArcGIS chunk-size
warning is unchanged. No real request was made and Block 26.1B remains gated
on fresh explicit authorization.

### Block 26.1B: Controlled real provider audit

- request fresh authorization to read only `RENTCAST_API_KEY`
- execute exactly five direct city audit requests, with no automatic retry
- record aggregate, non-address evidence in this document
- stop before implementation if a city label is unsupported, unexpectedly
  broad, incomplete at 500 rows, or inconsistent with provider city values

Status: complete on August 25, 2026. After explicit authorization, the guarded
command made exactly five sequential requests in canonical market order with
no retry. All five areas passed exact provider-city, fixed-filter, schema, and
completeness gates:

| Direct city area | Total | Returned | Limit margin | Returned price range | Body bytes | Elapsed ms |
| --- | ---: | ---: | ---: | --- | ---: | ---: |
| Chino | 22 | 22 | 478 | $599,000-$850,000 | 25,120 | 453 |
| Chino Hills | 1 | 1 | 499 | $825,888-$825,888 | 1,242 | 241 |
| Eastvale | 2 | 2 | 498 | $795,000-$850,000 | 2,180 | 235 |
| Corona | 64 | 64 | 436 | $648,888-$850,000 | 74,116 | 191 |
| Jurupa Valley | 23 | 23 | 477 | $575,000-$850,000 | 25,403 | 149 |

The combined result was 112 total and returned rows, zero fixed-filter
violations, a 2,388-row margin against the combined 2,500 capacity, 128,061
response-body bytes, and 1,269 milliseconds of provider elapsed time. Provider
city counts were exactly Chino 22, Chino Hills 1, Eastvale 2, Corona 64, and
Jurupa Valley 23. Every returned page was complete.

The audit consumed five authorized provider requests. It did not change the
production request profile, persist listings, mutate criteria, send Telegram,
access AWS, or publish runtime artifacts. The evidence clears the direct-city
provider gate for Block 26.2; it does not itself enable production behavior.

### Block 26.2: Typed city search-area contract

- add and strictly validate the `city` search-area variant
- emit mutually exclusive city parameters with fixed California state
- remove optional or implicit Brea defaults from production-facing client calls
- retain radius support only for explicit reviewed maintenance or rollback use
- add URL, validation, immutability, timeout, parser, and redaction tests

Status: complete. The RentCast package now exports
`RentCastCitySearchArea` and includes it in the strict search-area union. A city
area contains only `kind: "city"` and a provider city string. The client trims
outer whitespace, preserves provider case and internal spacing, rejects empty
or control-character city values, and rejects runtime objects that combine
city, ZIP, or radius geography fields.

City requests emit `city=<provider city>` and fixed `state=CA`; they emit no
`address`, `radius`, or `zipCode`. Radius and ZIP requests retain their existing
query contracts and now receive the same conflicting-geography validation.
Validation completes before `fetch`, and normalization creates a frozen copy
without mutating caller input.

Both `RentCastListingsPort.searchSaleListings` and the concrete coverage-audit
method now require an explicit search area. The client no longer defaults an
omitted geography to Brea. The legacy Brea radius constant remains available
only as an explicit area while Block 26 is staged; the worker still selects it
explicitly until Block 26.3 replaces market mapping and Block 26.4 integrates
that mapping into production composition.

The package regression suite covers explicit city, radius, and ZIP URLs,
mutually exclusive parameters, invalid and hybrid runtime input, caller-input
immutability, fixed filters, response parsing, total-count handling, timeout,
and credential-safe HTTP errors. All 39 focused client tests pass. The full
repository gate passes 116 test files and 1,104 tests, root typecheck, and the
production/AWS build. The existing ArcGIS bundle-size output is unchanged. No
environment file was read and no real provider request was made in Block 26.2.

### Block 26.3: Market-to-area mapping

- map each selected incorporated city to one direct city area
- preserve Stevenson Ranch ZIP `91381`
- preserve canonical order independent of input order
- reject empty, duplicate, and unsupported markets before provider access
- replace Brea-based unit and production-composition expectations

Status: complete. The active worker selector now owns one explicit frozen
provider area for every Domain product market:

| Product market | Selected provider area |
| --- | --- |
| Chino | `city=Chino&state=CA` |
| Chino Hills | `city=Chino Hills&state=CA` |
| Eastvale | `city=Eastvale&state=CA` |
| Corona | `city=Corona&state=CA` |
| Jurupa Valley | `city=Jurupa Valley&state=CA` |
| Stevenson Ranch | `zipCode=91381` |

The selector validates that input is a non-empty array of unique supported
markets. Empty, duplicate, unsupported, null, or otherwise malformed runtime
values throw `InvalidRentCastSearchMarketsError` before client or provider
access. It projects selected markets through `listingSearchCities`, so output
order is canonical regardless of form or persistence input order. The returned
array and every reusable area are frozen, and caller input is not mutated.

One incorporated market produces one city area, all five incorporated markets
produce five city areas, and all six markets produce those five areas followed
by ZIP `91381`. The selector no longer imports or returns the Brea radius.
`runProduction` already consumes this selector, so its composed source options
now contain the direct areas. No worker was executed and no provider, database,
Telegram, AWS, or deployment operation occurred in Block 26.3.

Twenty-six focused mapping, production-composition, and existing workflow
integration tests pass, including single, five-market, Stevenson-only, mixed,
six-market, canonical-order, duplicate, unsupported, malformed, frozen-output,
input-immutability, revision-baseline, overlap, and failed-later-area coverage.
The full repository gate passes 116 test files and 1,106 tests, root typecheck,
and the production/AWS build. The existing ArcGIS chunk-size warning is
unchanged. Deeper source paging, all-or-nothing acquisition, overlap
reconciliation, observation time, persistence, and notification integration
acceptance was reserved for Block 26.4.

### Block 26.4: Source and production integration

- wire persisted criteria to the direct-market area list
- preserve sequential all-or-nothing reads and per-area 500-row gates
- preserve canonical-address overlap reconciliation and price-drop behavior
- prove one failed area causes no persistence or Telegram effects
- prove provider city values remain unchanged end to end

Status: complete. `RentCastListingSourceOptions.searchAreas` is now required,
and the source rejects missing or empty runtime area lists instead of selecting
the legacy Brea radius. Every production construction path supplies an explicit
area list derived from the normalized persisted profile. The source still
executes areas sequentially, validates each page before retaining it, reads one
shared observation time only after every area succeeds, and returns the
flattened normalized rows only after the complete selected-market set passes.

Six-market source tests verify canonical Chino, Chino Hills, Eastvale, Corona,
Jurupa Valley, then ZIP `91381` request order. A provider failure on request six
does not return or normalize the first five pages and does not read the source
clock. Separate later-area tests preserve the strict `totalCount <= 500` and
`listings.length === totalCount` gates. Equivalent overlapping provider rows
remain available to the application layer for canonical-address
reconciliation.

Production workflow integration now exercises a six-market profile whose ZIP
`91381` request fails after five valid direct-city pages. The workflow closes
the database but makes no repository call, does not advance the search-profile
revision, does not create a listing snapshot or alert event, does not read the
observation clock, and does not issue a Telegram request. Existing integration
coverage continues to collapse equivalent direct-city/ZIP overlap into one
record, persist the audited provider city `Valencia` unchanged, and deliver a
tracked below-floor price drop with both prices.

Twenty-six focused source, production-composition, local-adapter, and workflow
integration tests pass. The full repository gate passes all 116 test files and
1,107 tests, root typecheck, and the production/AWS build. The existing ArcGIS
chunk-size warning is unchanged. No environment file was read; no real
RentCast, PostgreSQL, Telegram, or AWS call was made; and no migration,
schedule, wildfire artifact, deployment, or production data changed in Block
26.4.

### Block 26.5: Audit and operational integration

Status: complete. The legacy `rentcast:coverage-audit` package scripts and their
Brea-default runner, command, CLI, and tests are removed. Two successor paths
remain:

```bash
# Safe previews: no .env.local load and no provider request
pnpm rentcast:five-city-direct-coverage-audit
pnpm rentcast:stevenson-ranch-coverage-audit

# Real requests: separately reviewed and explicitly confirmed
pnpm rentcast:five-city-direct-coverage-audit:execute-five-requests
pnpm rentcast:stevenson-ranch-coverage-audit:execute-one-request
```

The first real command requires the exact five-request flag and canonical five
market list. The second requires the exact one-request flag and reviewed
`stevenson-ranch-91381` market token. Invalid or incomplete confirmations exit
before `fetch`. There is no ordinary six-request command; auditing all six
markets requires separately approving and running 5 + 1.

Both aggregate-only summaries report requests completed, audit request cost, a
50-request monthly planning reference, and the 5/6-request production cost.
They do not claim the current account plan or remaining balance and instruct the
operator to verify both before execution. README, AWS design guidance,
production readiness/baseline runbooks, roadmap, and ADRs now use the direct
market request model. Historical Block 20 and Block 24 Brea results remain
identified as historical evidence rather than executable guidance.

All 48 focused successor-audit tests pass. The complete repository gate passes
all 114 test files and 1,096 tests, root typecheck, and the production/AWS
build. The existing ArcGIS chunk-size advisory is unchanged.

No environment file was read and no real RentCast, PostgreSQL, Telegram, AWS,
schedule, deployment, migration, profile, or production-data operation occurred
in Block 26.5.

### Block 26.6: Wildfire and web regression acceptance

- verify the existing six-target artifact and manifest remain byte-for-byte
  unchanged unless a defect requires a separately approved correction
- verify all five incorporated-city polygons in ArcGIS 2D and 3D
- verify zero matching listings do not disable the overlay
- verify opacity, classification colors, marker ordering, provenance,
  disclosures, retry, responsive layout, and teardown remain unchanged
- confirm Search Criteria has no unintended redesign or schema change

### Block 26.7: Final integration and release gate

- run fixture-based one-, five-, and six-market production integrations
- run focused and repository-wide tests, typecheck, builds, and security review
- complete desktop/mobile browser acceptance and Console/Network checks
- reconcile request counts, rollback behavior, and final branch diff
- write the as-built record and leave commit, push, PR, merge, schedule, and
  deployment under repository-owner control

Every executable sub-block requires a fresh explanation and explicit
confirmation.

## Acceptance Criteria

Block 26 is complete only when:

1. no production or successor audit path uses the Brea radius implicitly
2. each selected incorporated city produces one direct city request
3. Stevenson Ranch still produces ZIP `91381` and preserves provider city
4. one, five, and six selected markets produce exactly 1, 5, and 6 requests
5. each page independently passes the strict 500-result completeness gate
6. any required-area failure causes no partial state or Telegram delivery
7. canonical overlap still yields one React listing record
8. new-listing and price-drop behavior remain unchanged
9. old schema-version-1 profiles remain valid without migration
10. existing wildfire artifact, classifications, target roles, and 2D/3D
    presentation remain authoritative and independent from listing count
11. quota and schedule implications are visible in docs and command output
12. tests, typecheck, builds, browser acceptance, and security review pass
13. no unintended credential, database, AWS, schedule, migration, or deployment
    change is present

## Rollback

Before deployment, discard or revert the Block 26 branch. After deployment,
revert the Block 26 runtime release to restore the prior Brea-plus-ZIP area
selection. No database migration or data repair is required.

Rollback does not alter the Block 25 wildfire artifact. If direct city queries
expose an incomplete or provider-incompatible market, stop the worker rather
than silently falling back to Brea. Any temporary fallback requires a separate
documented operational decision.

## References

- [RentCast Sale Listings API](https://developers.rentcast.io/reference/sale-listings)
- [RentCast Search Queries](https://developers.rentcast.io/reference/search-queries)
- [RentCast Billing and Pricing](https://developers.rentcast.io/reference/billing-and-pricing)
- [Block 24 Stevenson Ranch RentCast Coverage](block-24-stevenson-ranch-rentcast-coverage.md)
- [Block 25 Stevenson Ranch Wildfire Coverage](block-25-stevenson-ranch-wildfire-coverage.md)
- [ADR 0012: Conditional RentCast Search Areas](../adr/0012-conditional-rentcast-search-areas.md)
- [ADR 0013: Typed Wildfire Coverage Targets](../adr/0013-typed-wildfire-coverage-targets.md)
- [ADR 0014: Direct Market RentCast Acquisition](../adr/0014-direct-market-rentcast-acquisition.md)
