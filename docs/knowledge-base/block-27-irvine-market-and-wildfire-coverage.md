# Block 27: Irvine Market And Wildfire Coverage

## Status

Blocks 27.0 through 27.8 are complete on `feat/add-city-of-Irvine`. Irvine is
an opt-in seventh schema-version-1 market mapped to one exact RentCast
direct-city area. The existing six-market default, provider-owned listing
fields, all-or-nothing acquisition, alert behavior, and one-record-per-property
contract remain unchanged. The reviewed Irvine incorporated-city boundary and
City Council Ordinance `25-19` evidence now extend the deterministic wildfire
artifact to seven targets without altering CAL FIRE classifications. ArcGIS 2D
and 3D Terrain consume the same versioned `r3` artifact, while the prior `r2`
and five-city artifacts remain unchanged rollback assets.

The final release gate reproduced the public artifact and manifest byte for
byte with the offline, network-disabled, digest-pinned GDAL pipeline. All 118
repository test files and 1,170 tests, repository-wide typecheck, focused
security and compatibility tests, and an isolated production web build with a
synthetic ArcGIS key pass. The branch does not change a migration, AWS
infrastructure or schedule, CI workflow, CSP boundary, credential, database
record, saved search profile, Telegram delivery, deployment, push, PR, or
merge.

Every executable sub-block requires a fresh explanation and explicit
confirmation.

## Purpose

Add `Irvine` in Orange County as a selectable listing market and as a reviewed
CAL FIRE Fire Hazard Severity Zone coverage target.

The listing side extends the direct-market acquisition model established by
Block 26. The wildfire side extends the deterministic, same-origin artifact
established by Blocks 19, 25, and 26. The work does not create a new hazard
model, reinterpret a CAL FIRE classification, estimate parcel risk, or infer
that blank map space is safe.

## Accepted Product Behavior

1. Search Criteria displays `Irvine` as a seventh selectable market.
2. Irvine is opt-in. Existing schema-version-1 profiles and the default market
   selection remain the six pre-Irvine markets until a user explicitly selects
   and saves Irvine.
3. The canonical market order retains the existing six entries and appends
   Irvine, avoiding an unrelated reorder of saved or displayed values.
4. Selecting Irvine maps to one reviewed RentCast direct-city request using
   `city=Irvine` and the existing fixed `state=CA`.
5. Selecting all seven markets maps to seven sequential provider requests.
6. Every selected area must pass the existing independent completeness gate
   before the run returns any listing rows.
7. A failure in Irvine or any other required area causes no partial listing
   persistence, search-profile revision advancement, alert transition, price
   observation, or Telegram delivery.
8. Provider listing fields, including `city`, are preserved. The application
   must not rewrite provider data merely to satisfy product-market matching.
9. Existing canonical-address reconciliation, new-listing behavior, price-drop
   behavior, and one stored React record per property remain unchanged.
10. Saving Irvine changes the next worker acquisition profile. It does not
    immediately call RentCast, synthesize a listing, or remove stored snapshots.
11. Irvine wildfire polygons load independently from listing count. Selecting
    Irvine and enabling the overlay must show reviewed coverage even when no
    stored listing matches current criteria.
12. ArcGIS 2D and 3D Terrain use the same authoritative artifact, severity
    renderer, layer order, provenance, disclosures, and lifecycle behavior.

## Provider Geography Contract

Irvine is an incorporated California city and follows the direct-city pattern,
not the Stevenson Ranch ZIP/CDP exception:

| Product market | Planned provider area | Product eligibility |
| --- | --- | --- |
| Irvine | `city=Irvine&state=CA` | Exact reviewed Irvine market mapping |

Block 27.1B must verify the provider's real response before production mapping
is enabled. The audit must stop if the query is unsupported, unexpectedly
broad, incomplete at the 500-row boundary, violates fixed filters, or returns a
provider-city distribution that cannot support a deterministic market rule.
No ZIP list, radius fallback, or Orange County-wide fallback may be introduced
silently.

The worker maps selected markets in Domain canonical order. Irvine is appended
after the existing six markets so Block 27 does not reorder their requests.
Required areas continue to execute sequentially without automatic retry. A
retry consumes quota and remains a separately reviewed operational decision.

## Wildfire Authority And Geography

Irvine is planned as an `incorporated-jurisdiction` target with stable target ID
`irvine`. Its clip boundary must come from a checksum-pinned official
incorporated-city boundary whose selector resolves exactly one Irvine feature.
ZIP codes, RentCast results, map labels, listing coordinates, and Orange County
as a whole are not acceptable substitutes for the city jurisdiction boundary.

CAL FIRE / Office of the State Fire Marshal remains the classification
authority. The artifact may display only the official supported severities:

- `Moderate`
- `High`
- `Very High`

`NonWildland` remains excluded. LRA and SRA responsibility-area values remain
source data, not application inference. Block 27.2 rechecked the pinned CAL
FIRE source metadata, calculated bounded Irvine intersections, and verified
City Council Ordinance `25-19`. Irvine LRA features therefore use
`locally-adopted`; SRA features retain source status `effective`. Orange County
sources may supplement provenance but do not replace the City or CAL FIRE
authority record. This resolves the status deliberately left open in Block
27.0.

The build must retain exact clipping, geometry repair, invalid-geometry checks,
per-target area reconciliation, severity allowlisting, deterministic rebuilds,
and the existing 10 MiB raw / 2 MiB gzip publication limits. The expected
successor name is `fhsz-supported-markets-2025.1-r3.geojson`, subject to the
source audit. The current `r2` artifact remains a rollback asset and must never
be overwritten with different bytes.

The browser continues to fetch only a versioned same-origin artifact. It must
not call CAL FIRE, the City of Irvine, Orange County, or another GIS service at
runtime. Terrain remains visual context only and does not alter severity,
geometry, designation status, or listing eligibility.

## Zero-Listing Map Contract

Wildfire visibility is not derived from RentCast rows. When Irvine is selected
but has no stored listing matching the active criteria, the map must still be
able to frame the reviewed Irvine market context and render its published
hazard geometry. Search Criteria may influence the viewpoint but never selects,
generates, or classifies wildfire polygons.

Blank areas may represent land outside the published coverage, excluded source
features, or no intersecting official polygon. They must not be labeled as no
hazard, low risk, insurable, or safe.

## Request Quota And Cost Gate

Successful RentCast requests count independently:

| Selected markets | Requests per worker run |
| --- | ---: |
| Irvine only | 1 |
| Existing five incorporated cities | 5 |
| Existing six markets including Stevenson Ranch | 6 |
| All seven markets including Irvine | 7 |

Using 50 requests only as the existing monthly planning reference, at most
seven complete seven-market runs fit, leaving one request before audits,
retries, or other usage. Four weekly seven-market runs use approximately 28
requests in a four-run month. The controlled Irvine audit consumes one request.
These figures do not assert the current RentCast subscription, remaining quota,
renewal date, or overage policy.

Production enablement must review the real account plan, current usage, intended
cadence, audit consumption, and failure policy. Block 27 does not approve or
change an AWS schedule.

## Compatibility And Data Ownership

The listing-search-criteria schema remains version 1. Adding an allowlisted
market does not require a database migration, but code must not make Irvine a
silent member of existing or newly initialized default profiles. Irvine appears
unchecked until explicitly selected and saved.

The API DTO, Domain validation, React form, worker selector, production
composition, tests, and operations guidance must agree on the same seven-value
allowlist and canonical order. State remains California and status remains
Active without adding controls for either.

Listing records continue to own provider data. Wildfire targets continue to own
reviewed display geography. No city-boundary or hazard property is written into
a listing merely because its coordinate appears nearby or inside a polygon.

## Security And Side-Effect Boundaries

- `RENTCAST_API_KEY` remains server-side and is never sent to React.
- Fixture and fake-adapter tests are the default for implementation stages.
- Block 27.1B requires fresh authorization before reading only the existing
  RentCast key and making exactly one real Irvine request without retry.
- Real audit output is aggregate-only. It must omit credentials, headers, full
  request URLs, raw responses, and street addresses.
- Block 27.2 requires fresh authorization before official metadata, bounded
  geometry, count, or evidence requests and before any download.
- Any downloaded candidate remains under the ignored
  `.cache/wildfire-hazard` path, is capped at 50 MB, and is not a runtime asset.
- Local spatial processing uses only the existing pinned GDAL image. If it is
  unavailable, the stage stops rather than pulling an image automatically.
- No PostgreSQL, Telegram, AWS, ArcGIS account dashboard, migration, schedule,
  production profile, deployment, or production worker action is implied.

## Implementation Plan

### Block 27.0: Documentation And Architecture

- freeze product, provider, authority, quota, compatibility, security, rollout,
  rollback, test, and acceptance contracts
- add ADR 0015 and the Block 27 roadmap
- leave all runtime and external systems unchanged

Status: complete in documentation only.

### Block 27.1A: Fixture-Gated Irvine Provider Audit

- add an isolated Irvine direct-city audit fixture and aggregate summary
- require an exact one-request execution flag and reviewed Irvine market token
- prove the safe command does not load `.env.local` or call `fetch`
- test fixed filters, provider-city distribution, 500-row completeness,
  redaction, no retry, and invalid confirmation behavior

Status: complete. The Irvine runner reuses the same strict direct-city request,
schema, fixed-filter, count, and completeness core as the five-city audit. It
constructs one `city=Irvine&state=CA` request with the existing Active, Single
Family, maximum-price, bedroom, bathroom, 500-row, and `X-Total-Count` gates. It
emits only aggregate counts, completeness, capacity, price range, response
bytes, elapsed time, request cost, and quota-planning evidence.

The CLI requires both exact arguments before it can read the key or call
`fetch`:

```text
--execute-one-request
--market=irvine-ca
```

The safe command intentionally omits `.env.local`, prints guarded usage,
confirms that no request was made, and exits nonzero:

```bash
pnpm rentcast:irvine-coverage-audit
```

The real form is present for Block 27.1B but must not be run without fresh
explicit authorization:

```bash
pnpm rentcast:irvine-coverage-audit:execute-one-request
```

Eighteen focused runner tests and nine command tests cover exact mutually
exclusive geography, fixed filters, aggregate-only output, price and count
summaries, zero-result failure, provider-city mismatch, incomplete and
500-row pages, invalid total counts and schema, missing credentials, strict
argument order, extra arguments, no retry, API-key redaction, and full RentCast
URL redaction. Together with the existing five-city and Stevenson Ranch audit
regressions, all 75 focused tests pass.

The complete repository gate passes all 116 test files and 1,128 tests,
repository-wide typecheck, and the production/AWS build. The existing ArcGIS
chunk-size advisory is unchanged. No environment file was read and no real
RentCast, PostgreSQL, Telegram, GIS, ArcGIS-account, AWS, schedule, artifact,
profile, migration, or deployment action occurred.

### Block 27.1B: Controlled Real RentCast Audit

- request fresh authorization to read only `RENTCAST_API_KEY`
- make exactly one Irvine direct-city request without retry
- record aggregate count, provider-city distribution, capacity margin, returned
  price range, response bytes, elapsed time, and completeness evidence
- stop before production mapping if the provider geography is not defensible

Status: authorized request complete with a failed coverage gate on August 25,
2026. The guarded command read only the existing server-side key and made
exactly one direct-city request with no retry. RentCast returned a successful,
schema-valid, complete zero-row page for the frozen product filters:

| Evidence | Result |
| --- | ---: |
| Requests completed | 1 |
| Total matching listings | 0 |
| Returned listings | 0 |
| Result-limit margin | 500 |
| Returned page complete | yes |
| Invalid filter rows | 0 |
| Provider city counts | `{}` |
| Expected city verified | no |
| Response body bytes | 2 |
| Provider elapsed milliseconds | 651 |
| Coverage gate | FAIL |

The response proves that the exact request was accepted and that no current
listing satisfies the frozen Single Family, Active, maximum-price, bedroom,
and bathroom filters. It does not prove which provider city label a future
matching row will carry. Zero inventory is not evidence that Irvine is an
unsupported market, but it is also not sufficient evidence to enable exact
city matching in production.

No retry or wider request was made. No raw response, street address, full URL,
header, or credential was recorded. The audit did not change production
acquisition, criteria, listings, PostgreSQL, Telegram, AWS, schedules, wildfire
data, or deployment state. At the end of 27.1B, Blocks 27.3 and 27.4 remained
gated on a separately reviewed provider identity probe; Block 27.1C subsequently
cleared that provider-geography gate.

### Block 27.1C: Controlled Irvine Provider Identity Probe

- define and test a wider but bounded Irvine identity request separately from
  the zero-row product-filter request
- preserve exact `city=Irvine`, fixed California and Active status, aggregate
  output, redaction, one-request confirmation, timeout, and no retry
- report total count, returned sample count, provider-city distribution,
  response bytes, elapsed time, and whether every returned row identifies
  Irvine
- treat the probe as geography evidence only; do not change product filters or
  claim product inventory completeness from a broad sample
- require fresh explicit authorization before one real request

Status: complete. The probe sends one exact `city=Irvine`, `state=CA`,
`status=Active` request with
`limit=500` and `includeTotalCount=true`. It emits no property type, price,
bedroom, bathroom, ZIP, address, radius, or county parameter.

The identity gate requires at least one returned row, exact Irvine provider
city on every returned row, fixed California and Active scope, and a returned
row count equal to `min(X-Total-Count, 500)`. A total below 500 can therefore be
fully returned; a total of 500 or more can provide a complete bounded identity
sample while explicitly reporting that not all matching rows were returned.
Neither case alters or replaces the product filters.

The CLI requires all three exact arguments before reading the key or calling
`fetch`:

```text
--execute-one-request
--market=irvine-ca
--probe=active-market-identity
```

The safe command omits `.env.local`, exits nonzero before `fetch`, and confirms
that no request was made:

```bash
pnpm rentcast:irvine-provider-identity-probe
```

The protected real form was executed once after fresh explicit authorization:

```bash
pnpm rentcast:irvine-provider-identity-probe:execute-one-request
```

Fourteen runner tests and ten command tests cover exact request scope, omitted
product and alternate-geography parameters, complete and saturated samples,
zero rows, incomplete samples, provider-city mismatch, state/status violations,
invalid total counts and schema, strict three-token confirmation and order,
extra arguments, missing key, no retry, aggregate-only output, and secret/full
URL redaction. All 24 new focused tests and all 99 RentCast audit regressions
pass.

The complete repository gate passes all 118 test files and 1,152 tests,
repository-wide typecheck, and the production/AWS build. The existing ArcGIS
chunk-size advisory is unchanged. During fixture-tooling verification before
authorization, no environment file was read and no real RentCast, PostgreSQL,
Telegram, GIS, ArcGIS-account, AWS, schedule, artifact, profile, migration, or
deployment action occurred.

The one authorized real request completed successfully without retry and
consumed one RentCast request. RentCast reported 865 matching Active listings;
the probe returned the expected bounded sample of 500 rows, all 500 carried
provider city `Irvine`, and zero rows violated the California/Active scope. The
sample reached the 500-row limit, so `allMatchingRowsReturned=no` and the result
is provider-geography evidence only, not product-inventory completeness. The
response body was 570,092 bytes and provider elapsed time was 1,338 ms. No API
key, full request URL, request header, raw response, or street address was
logged. No production filters, acquisition profile, database, Telegram, AWS,
GIS artifact, schedule, migration, or deployment state changed.

### Block 27.2: Official Irvine Wildfire Audit

**Complete:** the separately authorized audit used read-only official requests
and the already-installed digest-pinned GDAL `3.13.2` image with container
networking disabled. It did not read `.env.local`, call RentCast, PostgreSQL,
Telegram, AWS, or an ArcGIS account, retain listing addresses, or publish a
runtime artifact. Downloaded evidence and generated candidates remain ignored
under `.cache/wildfire-hazard/audit/block-27-2`; the directory measured about
4.7 MiB, below the authorized 50 MB cap.

The current CAL FIRE `City Boundaries` service returned exactly one Irvine,
Orange County feature. Its normalized candidate is 39,079 bytes with SHA-256
`368205802647ca6d9c476682edf8425a9ef781ffda7c4e171697a67920ec8b23`,
is valid, has EPSG:3310 area `170,869,605.704035 m2`, and bounds
`[-117.868766, 33.599396, -117.678038, 33.773657]`. The current geometry and
the cached official `24_1` Irvine geometry are topologically equal with equal
area, so the candidate preserves the established incorporated-city source
semantics.

The CAL FIRE jurisdiction layer returns one qualifying `Incorporated City`
record for Irvine. Its contact workflow status is not used as adoption proof.
The City of Irvine introduced Ordinance `25-19` on 2025-06-10 and adopted it on
2025-06-24. The ordinance repeals Ordinance `12-03`, designates Moderate, High,
and Very High zones from the 2025 map, and takes effect 30 days after adoption.
It is the evidence for Irvine LRA status `locally-adopted`; SRA remains
`effective`.

Exact polygon queries against the current CAL FIRE feature services and local
hard clips from the checksum-pinned archives agree:

| Responsibility area | Moderate | High | Very High | Features | Area (m2) | Invalid | Repair drift |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| LRA | 4 | 4 | 4 | 12 | 65,497,365.692 | 0 | 0 |
| SRA | 0 | 0 | 2 | 2 | 17,014.666 | 0 | 0 |
| Combined | 4 | 4 | 6 | 14 | 65,514,380.358 | 0 | 0 |

LRA and SRA touch at two feature pairs but have zero overlapping area. The
supported geometry covers about 38.342% of the city boundary. Blank Irvine
areas remain unclassified display space, not a conclusion of no hazard.

The Irvine-only runtime-shaped candidate contains 14 features, 8,256
coordinates, 62 rings, bounds
`[-117.8537862, 33.5993963, -117.6780379, 33.773657]`, 215,910 raw bytes, and
61,665 gzip bytes. Rebuilding the current six-target artifact plus Irvine with
the existing artifact builder projects 110 features, 52,460 coordinates,
1,374,114 raw bytes, and 354,030 gzip bytes. That uses about 13.10% of the
10 MiB raw limit and 16.88% of the 2 MiB gzip limit. On Node `24.19.0`, 200
warm-cache JSON parses averaged 2.990 ms with p95 3.438 ms. This is audit
evidence only; Block 27.5 must reproduce it through the reviewed pipeline
before publication.

Official evidence:

- [CAL FIRE / OSFM Fire Hazard Severity Zones](https://osfm.fire.ca.gov/what-we-do/community-wildfire-preparedness-and-mitigation/fire-hazard-severity-zones)
- [CAL FIRE 2025 LRA feature layer](https://services1.arcgis.com/jUJYIo9tSA7EHvfZ/ArcGIS/rest/services/FHSALRA25_v1_All/FeatureServer/0)
- [CAL FIRE 2023 SRA feature layer](https://services1.arcgis.com/jUJYIo9tSA7EHvfZ/ArcGIS/rest/services/FHSZSRA_23_3/FeatureServer/0)
- [CAL FIRE California Incorporated Cities](https://lab.data.ca.gov/dataset/california-incorporated-cities)
- [City of Irvine Ordinance 25-19](https://irvine.granicus.com/MetaViewer.php?event_id=2641&meta_id=167078&view_id=)
- [City of Irvine current LRA GIS layer](https://gis.cityofirvine.org/arcgis/rest/services/ParcelClariti/MapServer/160)

### Block 27.3: Domain, API, And React Market Support

- append Irvine to the schema-version-1 allowlist and canonical order
- keep pre-Irvine defaults and saved profiles unchanged
- add Irvine to the existing city checkbox control without redesign
- preserve validation, optimistic revision behavior, authentication, and API
  error handling
- add compatibility and accessibility tests

Status: complete. `Irvine` is the seventh and final value in the current
schema-version-1 canonical market order. The default criteria still contain the
six pre-Irvine markets, so old profiles and newly initialized defaults do not
silently opt in. Domain normalization, Application revision handling, the API
DTO and authenticated endpoint, the browser client, and the React checkbox
control all accept Irvine and preserve canonical order. The existing disclosure
now describes a one-to-seven selection range without changing its interaction
or layout.

During the isolated 27.3 stage, the acquisition map remained deliberately
partial. An Irvine selection threw the existing bounded invalid-market error
before any provider request and never fell back to ZIP, radius, address, county,
or another city. Block 27.4 replaces that temporary guard with the reviewed
direct-city mapping.

Eight focused test files and 205 tests cover the allowlist, unchanged defaults,
exact-city matching, revision adoption, API canonicalization and authentication,
browser parsing, checkbox accessibility, and the worker fail-closed boundary.
The complete repository gate passes all 118 test files and 1,161 tests,
repository-wide typecheck, and the production/AWS build. The existing ArcGIS
chunk-size advisory is unchanged. No external service was called and no runtime
wildfire artifact or production profile changed.

### Block 27.4: Worker Acquisition Integration

- map Irvine to one direct city area with no ZIP, radius, or county fallback
- preserve sequential all-or-nothing acquisition and per-area completeness
- prove 1-, 6-, and 7-market request counts and canonical order
- preserve overlap reconciliation, provider data, observation time, alert
  behavior, and zero partial Telegram effects

Status: complete. The reviewed Irvine product market maps to exactly one
RentCast search area `{ kind: "city", city: "Irvine" }`. The request client
emits `city=Irvine` with fixed `state=CA` and no ZIP, address, radius, or county
fallback. Canonical all-market acquisition order is Chino, Chino Hills,
Eastvale, Corona, Jurupa Valley, Stevenson Ranch ZIP `91381`, then Irvine.

Focused selector, source, production-composition, workflow-integration, and
Domain-filter tests prove Irvine-only uses one request, the six incorporated
cities use six direct-city requests, the pre-Irvine profile still uses six
requests, and all seven markets use seven sequential requests. Each area must
return a complete page before the source reads the shared observation clock or
returns any rows. If the seventh Irvine request fails or is incomplete, no
earlier row is normalized, persisted, observed, alerted, or sent to Telegram;
the criteria revision remains unapplied. Existing cross-area canonical-address
reconciliation and price-drop/new-listing behavior remain unchanged. Provider
city values remain provider-owned, including `Valencia` for ZIP `91381` and
`Irvine` for the reviewed direct-city response.

All five focused test files and 82 tests pass. The complete repository gate
passes all 118 test files and 1,169 tests, repository-wide typecheck, and the
production/AWS build. The existing ArcGIS chunk-size advisory is unchanged. No
real RentCast request or other external service call occurred, and no database,
production profile, schedule, deployment, or wildfire runtime artifact changed.

### Block 27.5: Deterministic Seven-Target Wildfire Artifact

- add the checksum-pinned Irvine boundary snapshot and selector
- stage the seven-target candidate with the existing offline pipeline
- reconcile target and combined provenance, geometry, counts, severities, area,
  checksum, size, and deterministic rebuilds
- retain the current public artifact and enforce a publication lock

**Complete:** the repository now tracks the separately reviewed, normalized
Irvine incorporated-city boundary at
`tools/wildfire-hazard/sources/irvine-city-boundary-2026-08-25.geojson`.
The one-feature snapshot is 39,079 bytes with SHA-256
`368205802647ca6d9c476682edf8425a9ef781ffda7c4e171697a67920ec8b23`;
selector `CITY=Irvine` resolves exactly once. Its provenance records the
80,713-byte official upstream response checksum and the Block 27.2 finding
that the selected current geometry is topologically equal to official `24_1`.
Irvine is the seventh typed target, remains an
`incorporated-jurisdiction`, uses City Ordinance `25-19` as
`locally-adopted` LRA evidence, and has no product selector.

Two independent offline builds used Node `24.19.0`, the already-installed
digest-pinned GDAL `3.13.2` image, and container networking `none`. The staged
`fhsz-supported-markets-2025.1-r3.geojson` and schema-version-2 manifest were
byte-for-byte identical across both builds:

| Candidate metric | Result |
| --- | ---: |
| Artifact SHA-256 | `766a643e69b99c3d1e6442c94f2480a97c19a116fdb8b06c757045043fdf6427` |
| Manifest SHA-256 | `f521440a4f632e9b14b931bf145fab9b257843086db63495be538794d4f536f3` |
| Features / coordinates | 110 / 52,460 |
| Moderate / High / Very High | 33 / 38 / 39 |
| LRA / SRA | 83 / 27 |
| Raw / gzip bytes | 1,374,114 / 354,030 |
| Bounds | `[-118.622305, 33.5993963, -117.3673113, 34.417989]` |
| Invalid output geometry / normalization area drift | 0 / 0 |

The candidate uses 13.10% of the 10 MiB raw limit and 16.88% of the 2 MiB
gzip limit. Combined eligible area is `273,369,541.738 m2`. Irvine contributes
14 features and `65,514,371.608 m2`: 4 Moderate
(`5,637,434.955 m2`), 4 High (`17,279,370.955 m2`), and 6 Very High
(`42,597,565.698 m2`), with zero invalid geometry. The small difference from
the Block 27.2 current-service area is the reviewed pipeline's seven-decimal
clip/normalization path; feature and severity counts are unchanged and final
normalization area drift is zero.

Publication remains deliberately locked until Block 27.6. An attempted
`wildfire:data:build` fails closed before GDAL work. No `r3` file or successor
manifest was written under `apps/web/public`; the public `r2` artifact and
manifest retain SHA-256
`7d8486b94ef6802ab5866d17b0a591634dfe3e16843ef58a21143a43df5e09fd`
and `e926c7de239970180fdc52aaa55a850cf6bd58686518c2576f94fd7fe8b95366`.
The React loader therefore remains on `r2` until coordinated publication and
integration in Block 27.6.

All three focused wildfire test files and 26 tests pass, including tracked
boundary byte/checksum verification and the unchanged public `r2` regression.
The complete repository gate passes all 118 test files and 1,170 tests,
repository-wide typecheck, and the production/AWS build. The existing ArcGIS
chunk-size advisory is unchanged. No environment file, real provider, database,
cloud account, Telegram delivery, production profile, schedule, deployment,
or public runtime artifact changed.

### Block 27.6: Artifact Publication And ArcGIS Integration

- publish the reviewed versioned artifact and manifest without overwriting `r2`
- update the shared 2D/3D loader, metadata, provenance, and disclosures
- preserve colors, opacity, marker ordering, lazy load, Abort, retry, teardown,
  CSP, and terrain-context semantics
- prove Irvine hazard coverage remains visible with zero matching listings

**Complete:** the reviewed offline publication path generated and committed
`fhsz-supported-markets-2025.1-r3.geojson` plus its schema-version-2 manifest.
The public bytes exactly match both deterministic Block 27.5 staging builds:
artifact SHA-256
`766a643e69b99c3d1e6442c94f2480a97c19a116fdb8b06c757045043fdf6427`
and manifest SHA-256
`f521440a4f632e9b14b931bf145fab9b257843086db63495be538794d4f536f3`.
The prior `r2` rollback artifact remains present and unchanged at SHA-256
`7d8486b94ef6802ab5866d17b0a591634dfe3e16843ef58a21143a43df5e09fd`;
the earlier five-city asset is also retained.

The shared same-origin artifact URL now points to `r3`, so ArcGIS 2D and 3D
Terrain consume the same 110-feature collection and seven-target manifest.
The generic schema-v2 metadata parser exposes Irvine as an
`incorporated-jurisdiction` with `locally-adopted` status, source
`irvine-city-boundary`, and evidence `irvine-ordinance-25-19`. The visible
legend includes Irvine in the adopted-city sentence while preserving the
Stevenson Ranch market-context and ZIP disclosure, CAL FIRE source versions,
blank-area warning, and terrain-is-context-only warning.

No renderer implementation changed. The three severity colors and opacity,
ground draping, popup/legend suppression, hazard-before-listing layer order,
lazy loading, metadata-before-geometry gate, Abort handling, retry, rollback,
mode-switch preservation, and teardown remain covered by existing tests. A
zero-listing `ListingsMap` test now also proves the overlay can load in 2D,
survive a switch to 3D Terrain, and expose Irvine provenance independently of
listing markers. The artifact and manifest remain same-origin, so no CSP or
network allowlist change was required.

All eight focused publication, metadata, control, lifecycle, 2D/3D renderer,
and zero-listing integration test files and 58 tests pass. Browser visual,
Console, Network, WebGL, and responsive acceptance remain deliberately assigned
to Block 27.7. The complete repository gate also passes all 118 test files and
1,170 tests, repository-wide typecheck, and the production/AWS build. The
existing ArcGIS chunk-size advisory is unchanged. No environment file, real
provider, database, cloud account, production profile, schedule, Telegram
delivery, or deployment changed.

### Block 27.7: Automated And Browser Acceptance

- run focused and repository-wide tests, typecheck, production build, and AWS
  infrastructure build
- verify desktop and mobile 2D/3D rendering, viewport, controls, legend,
  provenance, disclosures, markers, Console, Network, WebGL, and teardown
- verify all six previous markets remain unchanged
- use real local or external services only with fresh explicit authorization

**Complete on 2026-08-25:** all 118 repository test files and 1,170 tests,
repository-wide typecheck, and the production/AWS build pass. The only build
advisory is the existing ArcGIS large-chunk warning.

Authorized local acceptance used the existing `.env.local` without printing
values, the loopback PostgreSQL database for login and read-only API requests,
and the existing ArcGIS browser key for normal basemap and Terrain3D traffic.
No profile was saved and no RentCast, Telegram, AWS-account, schedule,
deployment, migration, or production-data action occurred. Read-only loopback
probes returned HTTP 200 for `/api/health`, the 1,374,114-byte `r3` GeoJSON,
and the 16,199-byte manifest.

Desktop `1440 x 900` acceptance covered the Irvine viewport with zero Irvine
listings, transparent Moderate/High/Very High polygons, the full seven-target
legend and provenance, and a selected Corona listing whose marker remained
above the hazard layer. Switching to 3D Terrain preserved the overlay,
selection, marker ordering, ground draping, zoom controls, and the explicit
terrain-is-context-only disclosure. The current saved profile still has the
six predecessor markets selected and Irvine unchecked, proving Irvine remains
opt-in without modifying the profile.

Mobile `390 x 844` acceptance covered List/Map switching, 2D and 3D Terrain,
wildfire off/on, zoom, responsive controls, readable disclosures, nonblank
basemap/terrain output, and listing markers. Document and body width both
equaled the 390-pixel viewport in both map modes, with no horizontal overflow.
Navigating away after desktop and mobile 3D use left zero `canvas`,
`arcgis-map`, and `arcgis-scene` elements each time.

The interaction window produced no CSP, authorization, GeoJSON, Terrain3D,
WebGL, or application failure. It did record two ArcGIS map-component basemap
`AbortError: Aborted` messages when a still-loading map was replaced during
mode or view teardown. Both were bounded cancellation logs already associated
with the documented component-disposal behavior: the destination mode loaded,
remained interactive, and released all map elements. No other Console warning
or error appeared.

### Block 27.8: Final Release Gate

- review the final diff, secrets, artifact hashes, payload limits, CSP, request
  quota, compatibility, rollout, rollback, and as-built documentation
- verify no unintended migration, schedule, infrastructure, credential,
  production-data, Telegram, or deployment change
- leave commit, push, PR, merge, production profile edits, and deployment under
  repository-owner control

**Complete on 2026-08-25:** the final `main...HEAD` review covers 10 Block 27
commits and 44 changed paths with 3,331 insertions and 144 deletions. The diff
is limited to the Irvine market contracts, guarded audit/acquisition tooling,
wildfire pipeline/source/artifacts, ArcGIS web integration, tests, package
scripts, and documentation. It contains no migration, tracked environment
file, dependency-lock change, CI workflow, AWS infrastructure/runtime,
authentication/session boundary, PostgreSQL adapter, Telegram adapter,
OpenAI/PDF/S3 path, Dockerfile, schedule, or deployment change. The final
whitespace check passes.

The final secret scan found no private key, AWS access-key ID, OpenAI key,
Telegram bot-token shape, or direct assignment to the ArcGIS, RentCast,
OpenAI, Telegram, or JWT credential variables in the branch diff. The Irvine
coverage and provider-identity commands still require their exact reviewed
execution tokens before reading the server-side key or calling `fetch`; invalid
or preview invocation remains request-free, and errors redact both the key and
full RentCast URL. Browser CSP files and infrastructure security headers are
unchanged because the runtime still loads a same-origin artifact through the
existing ArcGIS allowlist.

The already-installed GDAL image resolved to the configured multi-platform
digest. A fresh `wildfire:data:stage` run used cached checksum-pinned official
inputs, `--offline`, and Docker networking `none`. It reproduced 110 features,
1,374,114 raw bytes, 354,030 gzip bytes, and artifact SHA-256
`766a643e69b99c3d1e6442c94f2480a97c19a116fdb8b06c757045043fdf6427`.
The staged artifact and schema-version-2 manifest are byte-for-byte equal to
the public files; the manifest remains SHA-256
`f521440a4f632e9b14b931bf145fab9b257843086db63495be538794d4f536f3`.
The retained `r2` and five-city assets remain unchanged at SHA-256
`7d8486b94ef6802ab5866d17b0a591634dfe3e16843ef58a21143a43df5e09fd`
and `d02baebe5e5b1ddaab3b81c0fcff4e973c3cd363b645432712e9609d15e1863f`.

Focused release tests pass 293/293. The complete repository gate passes all
118 test files and 1,170 tests plus repository-wide runtime, web, and AWS
typecheck. A production Vite build also passes from an isolated temporary web
copy containing no `.env*` file and using only a synthetic ArcGIS browser key;
the key appears in the expected application bundle, while `MapLibre` and
`OpenFreeMap` do not appear in the output. The existing ArcGIS large-chunk
advisory is unchanged.

Quota and compatibility remain explicit: Irvine-only acquisition costs one
successful provider request, all seven markets cost seven, and 50 requests is
only a planning reference that must be reconciled against the live account
before operation. Irvine remains unchecked in defaults and existing profiles;
rollback first removes Irvine from saved profiles, then restores the retained
six-market runtime and `r2` artifact. No external API, `.env.local`, database,
cloud account, Telegram delivery, production profile, schedule, publication,
commit, push, PR, merge, or deployment action occurred during 27.8.

## Acceptance Criteria

Block 27 is complete only when:

1. Irvine is a selectable but opt-in schema-version-1 market.
2. Existing profiles and default selections do not silently acquire Irvine.
3. Irvine produces exactly one reviewed direct-city RentCast request.
4. All seven markets produce exactly seven requests in canonical order.
5. No Irvine request emits ZIP, address, radius, or county fallback geography.
6. Every selected area passes the strict independent completeness gate.
7. Any required-area failure produces no partial application or Telegram effect.
8. Provider listing values, overlap reconciliation, alert semantics, and one
   React record per canonical property remain unchanged.
9. Irvine uses one reviewed incorporated-jurisdiction boundary and official
   designation evidence.
10. The artifact preserves exact CAL FIRE severities and responsibility areas,
    excludes `NonWildland`, and passes geometry, area, checksum, and size gates.
11. Irvine coverage renders in both ArcGIS modes independently from listings.
12. Terrain and blank-area disclosures remain accurate and non-predictive.
13. All six existing market and wildfire targets pass regression acceptance.
14. Quota fan-out and operational cost are visible in docs and guarded output.
15. Tests, typecheck, builds, browser acceptance, security review, and final
    diff review pass without an unintended external side effect.

## Rollout

Deploy the Domain/API/React/worker support and the matching versioned wildfire
asset as one reviewed release. After deployment, Irvine remains inactive for
existing profiles until the user selects and saves it. The next scheduled or
manual worker run establishes the existing revision baseline behavior; Block 27
does not authorize running that worker or changing its cadence.

## Rollback

Before deployment, discard or revert the Block 27 branch. After deployment,
first remove Irvine from any saved profile and save the revised criteria before
rolling back to a runtime whose allowlist does not recognize Irvine. Then revert
the runtime/static release to the prior six-market code and `r2` wildfire
artifact. No database migration or listing-data repair is expected.

Do not silently map Irvine to another city, ZIP, radius, county, old artifact,
or live GIS service during rollback. If provider or wildfire evidence fails a
gate, leave Irvine disabled and preserve the six-market release.

## References

- [Block 25 Stevenson Ranch Wildfire Coverage](block-25-stevenson-ranch-wildfire-coverage.md)
- [Block 26 Five-City Direct Market Coverage](block-26-five-city-direct-market-coverage.md)
- [ADR 0013: Typed Wildfire Coverage Targets](../adr/0013-typed-wildfire-coverage-targets.md)
- [ADR 0014: Direct Market RentCast Acquisition](../adr/0014-direct-market-rentcast-acquisition.md)
- [ADR 0015: Irvine Market And Wildfire Coverage](../adr/0015-irvine-market-and-wildfire-coverage.md)
