# ADR 0014: Direct Market RentCast Acquisition

## Status

Accepted for implementation by Block 26.0. This ADR supersedes the active
five-city Brea-radius selection and default-audit decisions in ADR 0012. It does
not supersede ADR 0012's ZIP `91381` Stevenson Ranch mapping, provider-data
preservation, per-area completeness, all-or-nothing failure, or
canonical-address reconciliation decisions.

No runtime implementation or provider audit occurred in Block 26.0.
Block 26.1A subsequently added an isolated fixture-gated audit runner and an
exact double-confirmation CLI. It does not change the RentCast package, source,
market mapping, or production composition, and no real provider request was
made. Block 26.1B then used that isolated path, with fresh authorization, to
make exactly five sequential real requests without retry. All five direct city
areas passed provider-city, fixed-filter, schema, and completeness gates; 112
matching rows were returned in total, with zero filter violations and no area
near its 500-row limit. At that stage, production composition remained
unchanged pending the implementation blocks.

Block 26.2 implements the package-level city search-area contract. RentCast
client methods now require an explicit area, city requests emit only city and
fixed California geography, and conflicting city/ZIP/radius runtime fields are
rejected before provider access. At the end of that stage, the explicit legacy
Brea area remained in the worker pending the separately reviewed market mapping
and production integration stages; it was no longer an implicit client
fallback.

Block 26.3 implements the accepted product-market mapping in the active worker
selector. The five incorporated markets now compose one direct city area each
in Domain canonical order, and Stevenson Ranch remains ZIP `91381`. The
selector rejects empty, duplicate, unsupported, and malformed runtime input
before provider access. Production composition now receives direct areas, but
no worker execution, provider call, schedule change, or deployment occurred in
this stage. Source-level atomicity and alert workflow integration remained
gated until Block 26.4.

Block 26.4 completes the source and production workflow integration. The source
now requires an explicit non-empty area list and cannot fall back to Brea.
Fixture-backed six-market tests preserve canonical sequential acquisition,
per-area completeness, one shared post-success observation time,
canonical-address overlap handling, tracked price-drop behavior, and provider
city `Valencia`. A failure on the sixth required request produces no partial
persistence, revision advancement, listing snapshot, alert event, clock read,
or Telegram request. No real provider, database, Telegram, AWS, schedule, or
deployment operation occurred in this stage.

Block 26.5 retires the legacy Brea-default audit executable and package scripts.
The supported successor paths are separately guarded five-direct-city and ZIP
`91381` audits. Their safe previews load no environment file; their real forms
require exact request-count and market confirmations. No ordinary combined
six-request command exists. Aggregate output discloses actual audit request
cost plus the 50-request planning reference and tells operators to verify the
current account plan and usage before execution.

## Context

The application supports Chino, Chino Hills, Eastvale, Corona, Jurupa Valley,
and Stevenson Ranch as product listing markets. Before Block 26, the first five
markets were acquired through one RentCast sale-listings request within 20
miles of `1065 Brea Mall, Brea, CA 92821`; Domain city matching later removed
non-selected locations. Stevenson Ranch was separately acquired by ZIP `91381`
because RentCast labels matching listings `Valencia`.

The regional Brea radius is not the product boundary for any supported city.
It can omit listings in a selected city near or beyond the circle edge and can
retrieve unrelated cities that are discarded after consuming response
capacity. The product now requires each of the five incorporated cities to have
direct provider acquisition independent from Brea.

RentCast supports city/state sale-listing queries. A direct city query avoids a
large shared radius and avoids maintaining incomplete ZIP lists for cities with
multiple postal codes. City parameters are case-sensitive, so the five exact
provider inputs require a controlled audit before production integration.

The current provider contract returns at most 500 rows per page. The source
already enforces per-area completeness, sequential all-or-nothing acquisition,
and post-fetch canonical-address reconciliation. Those safety properties must
remain intact as request fan-out increases.

The wildfire artifact is unrelated to the Brea radius. The five incorporated
cities already use reviewed city boundaries; Stevenson Ranch uses a separately
reviewed market-context boundary under ADR 0013.

## Decision

Add a strict `city` variant to `RentCastSaleListingsSearchArea`. It emits the
reviewed city name and fixed California state and emits no radius, address, or
ZIP parameter.

Map each selected product market to exactly one explicit area:

- Chino -> city `Chino`
- Chino Hills -> city `Chino Hills`
- Eastvale -> city `Eastvale`
- Corona -> city `Corona`
- Jurupa Valley -> city `Jurupa Valley`
- Stevenson Ranch -> ZIP `91381`

Return areas in canonical Domain market order. Reject empty, duplicate, and
unsupported market input before network access.

Remove the Brea radius as an implicit client, source, production-composition,
or successor-audit default. Radius queries may remain as an explicit typed
capability for reviewed maintenance or rollback use, but production must never
silently fall back to Brea when a city query fails.

Execute required areas sequentially. Validate every page independently against
the existing strict completeness gate, and return no rows unless every selected
area succeeds. Read the shared observation time only after final success, then
run the existing canonical-address reconciliation and conflict checks.

Preserve the existing Domain eligibility rules. The five incorporated markets
continue to match exact provider city values. Stevenson Ranch continues to
match ZIP `91381`, and the listing's provider city remains unchanged throughout
normalization, persistence, notification, API, and React display.

Do not change the search-criteria schema, React controls, database, alert
semantics, minimum-price Domain gate, listing record ownership, or AWS schedule.
Saving criteria affects the next worker run and does not backfill stored
inventory.

Do not change wildfire geometry or target kinds. The five cities retain exact
`incorporated-jurisdiction` coverage and Stevenson Ranch retains
`market-context` coverage. Hazard rendering remains independent from listings
and provider geography.

## Consequences

Positive consequences:

- each incorporated city is acquired directly rather than incidentally through
  a Brea-centered circle
- city coverage no longer depends on distance from Brea
- unrelated regional listings no longer consume the same response page
- no multi-ZIP market maintenance is introduced
- provider listing data and existing alert semantics remain unchanged
- wildfire authority and listing-provider geography stay independent

Tradeoffs:

- five original markets now consume five requests instead of one per run
- all six markets consume six requests instead of two
- a 50-request planning reference supports at most 10 five-market runs or 8
  six-market runs before audits, retries, and other use; actual plan and usage
  still require verification
- one city-area failure fails the complete selected-market run
- case-sensitive provider city inputs require controlled audit evidence
- tests and operational output must make request fan-out explicit

## Rejected Alternatives

### Expand or move the shared radius

Rejected because another circle still does not represent five city boundaries,
can omit edge locations, and consumes capacity with unrelated markets.

### Use one ZIP per city

Rejected because several supported cities span multiple ZIP codes. One ZIP
would miss listings, while a hand-maintained multi-ZIP mapping would multiply
requests and require ongoing postal-boundary maintenance.

### Use one statewide request and filter locally

Rejected because it is incompatible with the 500-row completeness gate and
would retrieve a large amount of irrelevant inventory.

### Keep Brea as an automatic fallback

Rejected because fallback would silently restore the coverage ambiguity this
decision removes and could produce inconsistent price observations between
runs.

### Accept partial city success

Rejected because missing one selected city could silently alter new-listing and
price-drop state and produce misleading Telegram output.

### Convert city wildfire targets to market-context boundaries

Rejected because the five cities already have more authoritative incorporated
jurisdiction boundaries. The listing acquisition change does not justify
weakening CAL FIRE provenance.

## Security And Operations

The RentCast key remains server-side in the existing header. No raw listing,
street address, credential, full request URL, or request header may appear in
audit output. The Block 26.1B five-city real audit used fresh explicit
authorization, made exactly five requests with no automatic retry, and emitted
aggregate evidence only.

Request cadence and subscription cost are deployment gates. This decision does
not enable a schedule, run a production worker, deploy AWS resources, mutate a
profile, connect to PostgreSQL, or send Telegram notifications.

The five-city audit costs exactly 5 requests and the Stevenson Ranch audit
costs exactly 1. Auditing all six requires two separately approved commands.
At the 50-request planning reference, production supports at most 10 five-market
runs or 8 six-market runs before audits, retries, and other usage. These figures
are planning arithmetic, not an assertion about the account's current quota or
remaining balance.

## Rollback

Revert the Block 26 runtime release to restore ADR 0012's prior Brea-plus-ZIP
selection. The search-criteria schema and stored records require no migration or
repair. The wildfire artifact remains unchanged.

Do not implement an undocumented runtime fallback. A temporary provider-area
exception must be recorded and tested as a new decision.

## References

- [Block 26 Five-City Direct Market Coverage](../knowledge-base/block-26-five-city-direct-market-coverage.md)
- [ADR 0012: Conditional RentCast Search Areas](0012-conditional-rentcast-search-areas.md)
- [ADR 0013: Typed Wildfire Coverage Targets](0013-typed-wildfire-coverage-targets.md)
- [RentCast Sale Listings API](https://developers.rentcast.io/reference/sale-listings)
- [RentCast Search Queries](https://developers.rentcast.io/reference/search-queries)
- [RentCast Billing and Pricing](https://developers.rentcast.io/reference/billing-and-pricing)
