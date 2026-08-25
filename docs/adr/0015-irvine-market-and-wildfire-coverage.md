# ADR 0015: Irvine Market And Wildfire Coverage

## Status

Accepted for staged implementation by Block 27.0. Block 27.1A subsequently
added a fixture-gated Irvine direct-city audit runner and strict CLI without
changing production acquisition or the product-market allowlist. Its safe
preview loads no environment file and makes no request; its real form requires
exact one-request and `irvine-ca` confirmations and remains gated on fresh
authorization. All 75 focused audit regressions, all 116 repository test files
and 1,128 tests, repository-wide typecheck, and the production/AWS build pass.
Block 27.1B then made exactly one authorized real Irvine request without retry.
The valid response was complete at zero rows under the frozen product filters,
so it confirmed request acceptance but could not verify a provider city label;
the coverage gate failed closed. Block 27.1C then added and executed the
separately reviewed provider identity probe. It queries only
`city=Irvine`, `state=CA`, and `status=Active`, deliberately omits all product
filters, requires exact one-request, `irvine-ca`, and
`active-market-identity` confirmations, and reports aggregate identity evidence
only. A saturated 500-row sample is explicitly bounded geography evidence, not
product-inventory completeness. The one authorized request completed without
retry and passed the identity gate: RentCast reported 865 matching Active
listings, the bounded 500-row sample contained 500 Irvine rows and zero invalid
scope rows, and the response was 570,092 bytes in 1,338 ms. The provider
geography gate is cleared, while production Irvine mapping remains unchanged
until the later implementation stages. All 24 new probe tests, all 99 audit
regressions, all 118 repository test files and 1,152 tests, repository-wide
typecheck, and the production/AWS build pass. Block 27.2 then completed the
separately authorized official wildfire audit. The selected current CAL FIRE
incorporated-city boundary resolves exactly one Irvine feature, is
topologically equal to the cached `24_1` geometry, and has normalized SHA-256
`368205802647ca6d9c476682edf8425a9ef781ffda7c4e171697a67920ec8b23`.
City Council Ordinance `25-19`, adopted on 2025-06-24, supports
`locally-adopted` LRA status. Exact current-service counts match the pinned
archive clip: 12 LRA features and 2 SRA features, with no invalid geometry or
area drift. The projected 110-feature successor remains within existing
payload and parse gates. All audit candidates remain ignored; no runtime
artifact, database, production profile, cloud resource, schedule, Telegram
delivery, or deployment changed. Block 27.3 appended Irvine to the
schema-version-1 Domain/API/React allowlist and canonical order while preserving
the six-market default and all existing profiles. The current React disclosure
offers Irvine as an unchecked seventh market. During that isolated stage,
provider acquisition remained deferred to Block 27.4 and the worker failed
closed before any RentCast request when an Irvine selection reached the existing
six-market acquisition map. Eight
focused test files and 205 tests, all 118 repository test files and 1,161 tests,
repository-wide typecheck, and the production/AWS build pass. No external
service, database record, runtime wildfire artifact, production profile, or
deployment changed. Block 27.4 then enabled the reviewed exhaustive worker
mapping: Irvine produces one direct-city area after the five original city
areas and Stevenson Ranch ZIP `91381` in canonical all-market order. Integration
tests prove one, six, and seven sequential request plans; exact Irvine city and
California parameters without fallback geography; provider-data preservation;
shared observation time; downstream overlap reconciliation; and zero partial
persistence, revision advancement, alerts, or Telegram delivery when the
seventh request fails. All five focused test files and 82 tests, all 118
repository test files and 1,169 tests, repository-wide typecheck, and the
production/AWS build pass. No real provider request, production profile,
database record, schedule, wildfire artifact, or deployment changed.

## Context

The application currently supports six product markets: five incorporated
cities acquired through direct RentCast city queries and Stevenson Ranch
acquired through ZIP `91381`. The deterministic wildfire artifact contains the
same five cities as `incorporated-jurisdiction` targets and Stevenson Ranch as a
separately disclosed `market-context` target.

The product now needs Irvine in Orange County as both a listing market and an
authoritative wildfire coverage target. Irvine is an incorporated city, so it
does not need the ZIP/product-label separation used for unincorporated
Stevenson Ranch. Provider geography and wildfire authority nevertheless remain
independent and require separate evidence.

Adding a seventh selected market raises a full worker run from six to seven
RentCast requests. Adding a geographically separate wildfire target also
requires new boundary, designation, payload, viewport, and 2D/3D regression
evidence. Neither change justifies modifying listing eligibility, alert
semantics, CAL FIRE classifications, or the AWS schedule.

## Decision

Append `Irvine` to the supported schema-version-1 product-market allowlist and
canonical order. Do not add it to existing or default profile selections.
Users explicitly opt in by selecting and saving Irvine in the existing Search
Criteria city control.

Subject to the controlled provider audit, map Irvine to one explicit RentCast
city area using exact city `Irvine` and fixed state `CA`. Emit no ZIP, address,
radius, or county parameter. Preserve sequential per-area completeness,
all-or-nothing failure, canonical-address reconciliation, provider listing
values, one shared post-success observation time, new-listing and price-drop
behavior, and zero partial Telegram effects.

Represent Irvine wildfire coverage as an `incorporated-jurisdiction` target.
Use a checksum-pinned official city boundary that resolves exactly one Irvine
feature. Recheck CAL FIRE LRA/SRA source metadata and official City of Irvine
designation/adoption evidence before assigning status or publishing geometry.
Do not derive the boundary or classification from RentCast, ZIP codes, listing
coordinates, map labels, or Orange County as a whole.

Publish a new versioned same-origin artifact and manifest only after the
candidate passes deterministic rebuild, provenance, geometry, severity, area,
checksum, raw/gzip size, and browser-performance gates. Retain the current `r2`
artifact unchanged for rollback. ArcGIS 2D and 3D Terrain consume the same
artifact; terrain remains visual context only.

Keep wildfire rendering independent from listing count. A selected Irvine
market with zero matching listings must still support an Irvine viewport and
display reviewed polygons when the toggle is enabled. Blank space is not a
safety conclusion.

Do not change the database schema, listing record, authentication, manual
listing workflow, showing-list workflow, Telegram format, OpenAI/PDF pipeline,
or AWS schedule.

## Consequences

Positive consequences:

- Irvine becomes an explicit product market with direct provider acquisition
- the map gains reviewed Orange County wildfire context without a live GIS
  runtime dependency
- incorporated-city authority remains distinct from provider geography
- existing profile behavior and six-market defaults remain stable
- prior CAL FIRE severities, listing workflows, and ArcGIS modes stay intact

Tradeoffs:

- a complete seven-market run consumes seven provider requests
- the 50-request planning reference fits at most seven complete such runs with
  one request left before audits, retries, or other usage
- Irvine requires independent provider, boundary, LRA/SRA, designation, and
  browser evidence before enablement
- the static artifact and map extent grow and must remain within existing gates
- rollback requires removing Irvine from saved profiles before restoring a
  runtime whose enum does not recognize it

## Rejected Alternatives

### Add Irvine to every existing profile automatically

Rejected because it would increase provider cost and change acquisition scope
without an explicit user choice.

### Query Irvine through a ZIP, radius, or Orange County request

Rejected because Irvine is an incorporated city supported by the established
direct-city design. Broader or postal geography weakens precision and can miss
or add unrelated listings.

### Reuse RentCast geography as the wildfire boundary

Rejected because provider search geography has no authority over CAL FIRE
classification or city jurisdiction.

### Treat Irvine as a market-context target

Rejected because Irvine is incorporated. The target must retain the stronger
incorporated-jurisdiction role unless the official boundary audit disproves the
premise and this decision is revisited.

### Query a live wildfire service from React

Rejected because it adds runtime availability, origin, credential, consistency,
and 2D/3D release risks that the versioned same-origin artifact avoids.

### Accept partial success when one of seven areas fails

Rejected because incomplete acquisition could corrupt listing and price-drop
state or produce misleading notifications.

### Raise artifact limits if Irvine exceeds them

Rejected. If the combined artifact fails the current 10 MiB raw or 2 MiB gzip
gate, use a separately reviewed regional artifact-loading design instead of
weakening the limit.

## Security And Operations

The RentCast key remains server-side. The real provider audit requires fresh
authorization, exactly one request, no retry, and aggregate-only output.
Official GIS queries and downloads also require fresh authorization and remain
maintainer operations; the browser receives only reviewed same-origin assets.

This ADR does not approve a production worker run, schedule change, profile
mutation, PostgreSQL connection, Telegram delivery, AWS action, ArcGIS account
inspection, migration, deployment, commit, push, or merge.

## Rollout And Rollback

Release the seven-market allowlist, worker mapping, React control, and matching
wildfire asset only after their coordinated gates pass. Irvine remains opt-in.

For rollback, first remove Irvine from saved profiles while the new runtime can
still parse it. Then restore the six-market runtime and retained `r2` artifact.
No database migration or listing repair is expected. Never add an undocumented
provider or wildfire fallback.

## Related Records

- [Block 27 Irvine Market And Wildfire Coverage](../knowledge-base/block-27-irvine-market-and-wildfire-coverage.md)
- [Block 25 Stevenson Ranch Wildfire Coverage](../knowledge-base/block-25-stevenson-ranch-wildfire-coverage.md)
- [Block 26 Five-City Direct Market Coverage](../knowledge-base/block-26-five-city-direct-market-coverage.md)
- [ADR 0013: Typed Wildfire Coverage Targets](0013-typed-wildfire-coverage-targets.md)
- [ADR 0014: Direct Market RentCast Acquisition](0014-direct-market-rentcast-acquisition.md)
