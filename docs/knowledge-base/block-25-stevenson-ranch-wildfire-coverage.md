# Block 25: Stevenson Ranch Wildfire Coverage

## Status

Blocks 25.0 through 25.2 are complete on
`feature/stevenson-ranch-wildfire-coverage`. Block 25.0 froze the product,
authority, geography, artifact, compatibility, security, cost, rollback, test,
and acceptance boundaries. Block 25.1 completed the separately authorized
official-source, boundary, jurisdiction, spatial, geometry, size, and parse
audit described below. Block 25.2 implemented the typed coverage-target and
manifest schema version 2 contracts without publishing new runtime data.

Block 25.1 used only public official sources and the existing checksum-pinned
CAL FIRE archives. Audit candidates and responses remain under the ignored
`.cache/wildfire-hazard` directory. No production artifact was rebuilt, and no
runtime source, environment file, secret, database, AWS resource, RentCast
request, Telegram delivery, or deployment changed. Every remaining executable
sub-block still requires a fresh explanation and explicit confirmation.

## Purpose

Extend the existing authoritative CAL FIRE / Office of the State Fire Marshal
Fire Hazard Severity Zone overlay so that the Stevenson Ranch product market
has reviewed hazard coverage even when no matching listing is present.

This is a data-provenance and coverage extension. It is not a new hazard model,
not a parcel determination, and not a change to the existing map experience.
The application must continue to display only the official source classes:

- `Moderate`
- `High`
- `Very High`

The application must not derive, lower, raise, interpolate, or predict a
classification from ZIP, address, listing, terrain, distance, slope, weather,
vegetation, or any other application data.

## Product Requirement

The accepted behavior is:

1. `Stevenson Ranch` remains the user-facing listing market introduced by Block
   24.
2. ZIP `91381` remains that market's RentCast eligibility selector; RentCast's
   provider city remains unchanged.
3. Turning on `Wildfire hazard zones` while viewing the Stevenson Ranch market
   displays reviewed CAL FIRE FHSZ geometry for the supported context, even if
   zero stored listings match the active search criteria.
4. Existing Chino, Chino Hills, Corona, Eastvale, and Jurupa Valley coverage and
   styling remain unchanged.
5. ArcGIS 2D and optional 3D Terrain use the same validated artifact and source
   classifications.
6. Blank areas continue to mean only that no published polygon is visible at
   that location. They are not evidence of no wildfire hazard.

## Geographic And Legal Model

### Product market is not jurisdiction

Stevenson Ranch is an unincorporated Los Angeles County community. It is not an
incorporated city. ZIP `91381` is a listing-market selector and postal context,
not a legal FHSZ jurisdiction or a CAL FIRE classification boundary.

Block 25 must therefore keep three concepts separate:

- `product market`: the operator-facing `Stevenson Ranch` choice
- `coverage boundary`: the reviewed geometry used to bound the display artifact
- `hazard authority`: CAL FIRE / OSFM for the source classification, plus the
  responsible local agency for any adopted LRA designation

The preliminary planning evidence is:

- the Los Angeles County Santa Clarita Valley Area Plan describes Stevenson
  Ranch as part of unincorporated Los Angeles County
- CAL FIRE / OSFM publishes separate SRA and LRA FHSZ datasets and states that
  FHSZ describes hazard rather than risk
- the Los Angeles County Board of Supervisors adopted Ordinance `2025-0027` on
  July 22, 2025, with an operative date of August 21, 2025, for state-mandated
  LRA FHSZ changes in the Consolidated Fire Protection District

Block 25.1 rechecked these records and assigned designation metadata only after
intersecting the selected boundary with both official source geometries. The
result contains both LRA and SRA classifications plus one excluded LRA
`NonWildland` polygon, as detailed below.

### Coverage-boundary decision gate

Block 25.1 evaluated candidate sources in this order:

1. a current official Los Angeles County community or planning boundary that
   represents Stevenson Ranch with sufficient precision
2. a current official Los Angeles County unincorporated-jurisdiction layer plus
   a separately documented market-context boundary
3. a versioned federal statistical boundary that identifies the community more
   precisely than ZIP or provider-city data
4. a versioned Census ZCTA `91381` boundary only when no better official
   community boundary is available

A ZCTA or ZIP-derived boundary, if selected, must be labeled `market-context`.
It must never be labeled a jurisdiction, city limit, CAL FIRE boundary, or
parcel determination. The published geometry must include enough surrounding
context to avoid implying that a delivery clip edge is an official hazard edge.
The accepted boundary is the U.S. Census Bureau ACS 2025 `Stevenson Ranch CDP`
polygon, GEOID `0674130`. A Census Designated Place is a statistical place, not
an incorporated jurisdiction or CAL FIRE boundary. It is therefore recorded as
`market-context`. ZIP `91381` remains only the separate product selector.

The accepted delivery rule is an exact hard clip to this CDP boundary. The
visible provenance must disclose that the clip edge is a product coverage edge,
not an official FHSZ transition. Retaining whole intersecting source polygons
was rejected because one official polygon extends far beyond the market and
would materially distort map fit and payload scope.

## Block 25.1 Audit Result

### Official source and jurisdiction findings

The CAL FIRE / OSFM source page and feature-layer metadata still identify the
pinned inputs used by the existing pipeline:

- LRA `FHSZLRA25_1`, service layer `FHSZLRA25_v1_All`
- SRA `FHSZSRA_23_3`, service layer `FHSZSRA_23_3`

The local archives still match their configured checksums:

| Source | Bytes | SHA-256 |
| --- | ---: | --- |
| `FHSZLRA251Allgdb.zip` | 9,840,158 | `736fa5231c70b844550784cd13c8d414c239cf9573c9cae6139554ef0bf464b6` |
| `FHSZSRA_23_3.zip` | 36,001,656 | `e744eb8eb7895157f4025109f29ff5312180a52fdb4648ff9fe9328edf4db3b2` |

A point-on-surface check inside the selected CDP returned one feature from each
official jurisdiction layer:

- CAL FIRE: `Los Angeles County`, `Unincorporated County`, `Qualifying`, unit
  `LAC`
- Los Angeles County GIS: `SANTA CLARITA VALLEY`, `UNINCORPORATED AREA`

Los Angeles County Board of Supervisors Ordinance `2025-0027`, adopted July 22,
2025 and operative August 21, 2025, supplies the local-adoption evidence for
LRA geometry in the Consolidated Fire Protection District. The future manifest
evidence ID is `los-angeles-county-ordinance-2025-0027`; the LRA designation
status is `locally-adopted`. SRA geometry remains `effective` from the CAL FIRE
source. A null `STATUS` value in the CAL FIRE contact layer was not treated as
adoption evidence.

### Boundary provenance

The selected boundary came from the official U.S. Census Bureau TIGERweb ACS
2025 Census Designated Places layer. The bounded query returned exactly one
valid polygon:

| Field | Audited value |
| --- | --- |
| Name | `Stevenson Ranch CDP` |
| GEOID | `0674130` |
| Census land / water area | 16,533,804 / 2,399 square meters |
| GDAL EPSG:3310 polygon area | 16,536,210.674 square meters |
| Boundary bytes | 24,175 |
| Boundary SHA-256 | `2405aaedb264e5854c933f6e461aa3bf6b5e9109f73d6baba0fa65baf47292cf` |
| Geometry validity | valid polygon; one ring |
| Point on surface | `POINT(-118.594058 34.392544)` |

No precise, directly downloadable Los Angeles County polygon named Stevenson
Ranch was found. The County planning record confirms the community's
unincorporated status, while the Census CDP supplies the most precise,
versioned, official community-shaped boundary found. It is preferred over the
ZIP `91381` ZCTA and provider city `Valencia`, neither of which represents the
product community as accurately.

### Spatial and classification findings

An exact-boundary official-service count returned five intersecting LRA source
features and seven SRA source features. The checksum-pinned local archives
returned the same counts. The LRA set contains one `NonWildland` feature, which
continues to be excluded rather than rendered as a fourth severity.

| Responsibility area | Moderate | High | Very High | Excluded `NonWildland` | Supported area (m2) |
| --- | ---: | ---: | ---: | ---: | ---: |
| LRA | 1 | 1 | 2 | 1 | 7,969,148.811 |
| SRA | 0 | 6 | 1 | 0 | 7,507,481.567 |
| Combined | 1 | 7 | 3 | 1 | 15,476,630.378 |

The excluded `NonWildland` area is 1,059,579.364 square meters. Supported FHSZ
geometry plus that excluded source area reconciles to the CDP polygon within
one square meter of projection/serialization tolerance. All 11 supported
clipped geometries are valid. This proves the responsibility area from source
geometry rather than inferring it from ZIP, listing city, or market label.

### Packaging decision

| Measurement | Existing artifact | Exact CDP hard clip | Whole intersecting polygons |
| --- | ---: | ---: | ---: |
| Added supported features | - | 11 | 11 |
| Added coordinates | - | 8,692 | 65,583 |
| Candidate raw bytes | - | 225,195 | 1,690,689 |
| Candidate gzip bytes | - | 54,642 | 446,181 |
| Combined raw bytes | 933,093 | 1,158,246 | 2,623,740 |
| Combined gzip bytes | 234,976 | 289,420 | 680,959 |
| Node 24.19.0 parse mean, 100 runs | not rerun | 2.426 ms | 5.942 ms |

Both candidates are below the 10 MiB raw and 2 MiB gzip hard limits, but the
whole-feature candidate extends to longitude `-120.5036026`, far outside the
Stevenson Ranch market. Exact hard clipping is smaller, keeps the intended map
context, and preserves the current pipeline model. The measured combined hard
clip uses about 11.0% of the raw budget and 13.8% of the gzip budget. Parse
timings are local synthetic comparisons, not browser acceptance results.

Block 25.2 may now implement typed manifest contracts against this frozen
boundary and designation decision. Block 25.3 remains responsible for adding a
reviewed tracked snapshot and reproducible build support; nothing from the
ignored audit cache is a runtime or release artifact.

## Pre-25.3 System Constraint

Before Block 25.3, the Block 19 pipeline:

- ingests checksum-pinned CAL FIRE LRA `FHSZLRA25_1` and SRA
  `FHSZSRA_23_3` archives
- clips those datasets to a tracked five-incorporated-city boundary snapshot
- emits `fhsz-five-cities-2025.1.geojson` and `manifest.json`
- allows only the three official severities and excludes `NonWildland`
- records source versions, attribution, local designation evidence, geometry
  repair, area reconciliation, counts, bounds, and checksums
- fails above 10 MiB raw or 2 MiB gzip

Before Block 25.2, the browser contract was intentionally five-city-specific:
it hardcoded the artifact URL and rejected a manifest that did not contain
exactly the five reviewed jurisdictions. Block 25.2 replaced that future-facing
assumption with typed, variable `coverageTargets` while retaining a temporary
schema version 1 compatibility reader for the artifact that is still deployed.

## Architecture Decision

### Preserve the same-origin derived artifact

Keep the reviewed, versioned, same-origin GeoJSON strategy. Do not make ArcGIS
or React call a live CAL FIRE, county, Census, or third-party hazard service at
runtime.

This preserves deterministic releases and rollback, source checksum and
attribution review, the existing CSP boundary, identical 2D/3D classifications,
and independence from upstream availability. It also adds no recurring CAL FIRE
request cost.

The proposed successor filename is
`fhsz-supported-markets-2025.1-r2.geojson`. Block 25.1 may revise the packaging
suffix if the official source version has changed, but it must publish a new
versioned filename rather than silently replacing the existing filename with
different bytes.

### Introduce typed coverage targets

Manifest schema version 2 replaces the fixed five-name browser assumption with
strict typed `coverageTargets`. Each target records at least:

```text
id
label
kind: incorporated-jurisdiction | market-context
boundarySourceId
lraDesignationStatus
evidenceId
coverageDisclosure
```

The five existing cities become `incorporated-jurisdiction` targets. Stevenson
Ranch becomes `market-context`, with ZIP `91381` recorded as the product
selector but not the legal boundary assertion.

The builder may retain target identifiers while processing to generate
per-target quality statistics. The browser artifact should continue to expose
only the minimum properties needed for rendering unless a reviewed
feature-level provenance requirement justifies another field.

Schema version 2 must reject unknown target kinds or designation statuses,
duplicate target IDs, missing boundary provenance or evidence, insecure
canonical URLs, unsupported severities or responsibility areas, unsafe
artifact filenames, and manifest/artifact integrity disagreement.

### Generalize the builder, not the classification

The GDAL pipeline should iterate typed coverage targets rather than assuming
one incorporated-city layer and a `CITY = name` predicate. Every target supplies
an explicit tracked boundary source and selector. The pipeline still:

- reads checksum-pinned official LRA and SRA inputs
- reprojects to EPSG:4326
- clips only according to the reviewed delivery boundary
- explicitly repairs polygon geometry
- excludes `NonWildland`
- accepts only `Moderate`, `High`, and `Very High`
- preserves responsibility area and designation status
- emits deterministic order and checksums
- reconciles feature count and area before publication

Where source polygons cross a delivery boundary, documentation and visible copy
must make clear that clipping is a product coverage operation. It must not
present an artificial clip edge as a CAL FIRE severity boundary.

### Keep overlay behavior independent from listings

Wildfire overlay loading remains controlled by the overlay toggle and map
driver, not by listing count. Zero stored listings, a restrictive price filter,
or a provider-city label of `Valencia` must not suppress hazard geometry.

Search Criteria may place the map over Stevenson Ranch, but it does not select
or classify hazard features. The entire published artifact remains available
to both ArcGIS modes after the operator enables the overlay.

### Preserve 2D and 3D semantic parity

Both modes retain the existing colors and opacity hierarchy, polygons below
listing markers, strict parser, lazy load, Abort, retry, rollback, teardown,
CAL FIRE attribution, source versions, and disclosures. 3D continues to drape
the same polygons on terrain. Terrain is visual context only and does not alter
severity, geometry, or designation status.

## User-Facing Provenance

The control continues to say `Wildfire hazard zones` and
`Fire Hazard Severity Zones`. It must not say `risk score`, `safe`, `no risk`,
`insurance zone`, or imply current-fire or evacuation information.

The provenance view must identify CAL FIRE / OSFM as classification source,
source versions and snapshot time, the five incorporated-jurisdiction targets,
Stevenson Ranch / ZIP `91381` as market-context coverage, Los Angeles County
evidence for any adopted LRA status, and the existing hazard-not-risk,
blank-area, and non-parcel disclosures.

Compact desktop and mobile copy may summarize targets, but the manifest must
retain complete provenance.

## Performance And Cost Gates

The existing limits remain hard gates:

- maximum raw GeoJSON: 10 MiB
- maximum gzip transfer: 2 MiB
- no visible main-thread stall during first enable
- no duplicate fetch after successful installation in one page
- no retained layer, Blob URL, handler, or WebGL resource after teardown

The limits are not raised because a second region is added. If a combined
artifact fails size or browser-performance acceptance, the fallback is
regionally split, versioned, same-origin artifacts loaded by map context. A
live provider dependency is not the fallback.

No new paid service is planned. Block 25 does not add an ArcGIS privilege, CAL
FIRE key, Census key, AWS service, database table, or background schedule.

## Security And Privacy

- do not add wildcard CSP origins or remote runtime hazard requests
- do not read or modify `.env.local`, Secrets Manager, or GitHub secrets
- do not log listing addresses while auditing hazard coverage
- retain checksum, byte-limit, HTTPS, schema, and geometry validation
- keep maintainer downloads outside browser assets until normalized
- do not call RentCast, PostgreSQL, Telegram, AWS, or production APIs

An official source download or feature-service query in Block 25.1 requires a
fresh explanation and explicit authorization. Audit output retains only bounded
aggregate evidence and reviewed public-source metadata.

## Compatibility, Rollout, And Rollback

Block 25 changes no Domain, API, database, authentication, listing, alert, or
search-profile schema. Existing six-market profiles remain valid.

The new JavaScript, manifest, and artifact must be published as one reviewed web
release. The old five-city artifact remains recoverable from Git history; it
does not require permanent duplicate runtime storage after the successor passes
acceptance.

Rollback reverts the Block 25 web/data commit and redeploys prior static assets.
It requires no migration, data repair, secret rotation, provider rollback, AWS
cleanup, or profile mutation.

## Planned Implementation

### Block 25.0: Documentation and architecture

- freeze product, authority, geography, artifact, schema, security, cost,
  compatibility, rollout, rollback, and acceptance boundaries
- add ADR 0013 and roadmap entries
- perform no source download, external query, artifact build, or runtime edit

### Block 25.1: Authoritative source and boundary audit

**Complete:** current CAL FIRE / OSFM LRA and SRA metadata and pinned archives
were rechecked; Los Angeles County jurisdiction and adoption evidence was
verified; the ACS 2025 Stevenson Ranch CDP was selected and checksummed; exact
LRA/SRA intersections, severities, areas, geometry, size, bounds, parse cost,
and clipping alternatives were measured; and aggregate evidence was recorded
without publishing a runtime artifact.

### Block 25.2: Coverage-target and manifest contracts

**Complete:** red tests established the schema version 2 producer and browser
contracts before implementation. The tracked build config now models the five
existing cities as typed `incorporated-jurisdiction` coverage targets with
explicit boundary source, designation evidence, and disclosure references. The
manifest producer emits only schema version 2, while the browser parser accepts
the currently published version 1 manifest and strict version 2 during the
migration window.

Version 2 rejects unknown target kinds or statuses, duplicate IDs or labels,
missing boundary-source or evidence references, insecure source/evidence URLs,
unsafe artifact filenames, malformed checksums, unknown severity or
responsibility-area counts, and count/integrity disagreement. Existing Chino,
Chino Hills, Corona, Eastvale, and Jurupa Valley designation statuses remain
unchanged. The current published GeoJSON and version 1 manifest were not
modified. Until Block 25.3 adds the reviewed Stevenson Ranch boundary snapshot
and generalized clipping selectors, the build fails closed with an explicit
boundary-pipeline error for a non-city target.

Verification completed on 2026-08-24: all 113 test files and 1,064 tests pass,
repository-wide typecheck passes, and the production web build passes. The
existing ArcGIS bundle-size warning remains unchanged.

### Block 25.3: Deterministic boundary and build pipeline

**Complete:** the exact 24,175-byte ACS 2025 Stevenson Ranch CDP snapshot is
tracked with its audited SHA-256
`2405aaedb264e5854c933f6e461aa3bf6b5e9109f73d6baba0fa65baf47292cf`.
The builder now resolves every target through an explicit tracked
`boundarySourceId` and typed `{ field, equals }` selector, requires exactly one
matching boundary, quotes selector values for GDAL, and fails closed for unsafe
fields, missing or duplicate matches, untracked boundaries, or incomplete
designation provenance.

The existing five jurisdictions use their reviewed `CITY` selectors;
Stevenson Ranch uses Census `GEOID = 0674130`. ZIP `91381` remains only the
separate product selector. The pipeline retains target identity through GDAL QA
for per-target counts and EPSG:3310 area, while the browser artifact still
contains only the minimum official rendering properties.

`pnpm wildfire:data:stage` runs with cached pinned inputs and GDAL
`3.13.2` under Docker `--network=none`, then writes only ignored files under
`.cache/wildfire-hazard/staged`. The publication command is locked until Block
25.4, and both current production asset checksums remained unchanged.

Two consecutive staging builds produced identical bytes:

| Measurement | Deterministic result |
| --- | ---: |
| Combined features | 96 |
| Stevenson Ranch supported features | 11 |
| Stevenson Ranch severity counts | 1 Moderate / 7 High / 3 Very High |
| Stevenson Ranch eligible area | 15,476,630.378 square meters |
| Combined raw bytes | 1,158,246 |
| Combined gzip bytes | 292,581 |
| Artifact SHA-256 | `7d8486b94ef6802ab5866d17b0a591634dfe3e16843ef58a21143a43df5e09fd` |
| Staged manifest SHA-256 | `e926c7de239970180fdc52aaa55a850cf6bd58686518c2576f94fd7fe8b95366` |

The exact build matched the 25.1 raw-byte projection. Its measured gzip result
is 3,161 bytes above the audit-only projection but still uses only about 14% of
the 2 MiB limit. Geometry validity, area drift, severity allowlisting,
`NonWildland` exclusion, coordinate precision, and both transfer budgets pass.
No runtime artifact was published. Verification completed on 2026-08-24: all
114 test files and 1,071 tests pass, repository-wide typecheck passes, and the
production application and infrastructure build passes. The existing ArcGIS
bundle-size warning remains unchanged.

### Block 25.4: Publish the successor artifact

**Complete:** publication was explicitly unlocked in `config.json` after a
fresh offline prepublication stage reproduced the Block 25.3 candidate. Both
`pnpm wildfire:data:stage` and `pnpm wildfire:data:build` use cached,
checksum-pinned inputs with GDAL under Docker `--network=none`; the publication
script now forces `--offline` as part of its package command.

Block 25.4 atomically published:

```text
apps/web/public/data/wildfire-hazard/fhsz-supported-markets-2025.1-r2.geojson
apps/web/public/data/wildfire-hazard/manifest.json
```

The published artifact and schema version 2 manifest are byte-for-byte equal
to the staged review candidates. The successor contains 96 features, including
11 Stevenson Ranch features, and preserves the reviewed severity,
responsibility-area, designation, boundary-source, evidence, product-selector,
and disclosure contracts. Its final measurements are 1,158,246 raw bytes,
292,581 gzip bytes, 44,204 coordinates, bounds
`[-118.622305, 33.8000861, -117.3673113, 34.417989]`, and artifact SHA-256
`7d8486b94ef6802ab5866d17b0a591634dfe3e16843ef58a21143a43df5e09fd`.
The published manifest SHA-256 is
`e926c7de239970180fdc52aaa55a850cf6bd58686518c2576f94fd7fe8b95366`.

Published-artifact tests now fail closed on artifact bytes, checksum, counts,
bounds, transfer budgets, six typed targets, Census CDP provenance, Los Angeles
County adoption evidence, and Stevenson Ranch per-severity area reconciliation.
The prior `fhsz-five-cities-2025.1.geojson` remains present only for the
Block 25.5 runtime-reference transition. Block 25.4 does not change the React
artifact URL, renderer, map behavior, database, provider, secret, cloud
resource, or deployment. Verification completed on 2026-08-24: wildfire data
tests pass 24/24, all 114 repository test files and 1,071 tests pass,
repository-wide typecheck passes, and the production application and AWS
infrastructure build passes. The existing ArcGIS chunk-size warning remains
unchanged.

### Block 25.5: React and ArcGIS integration

- update the browser metadata contract and versioned artifact reference
- present mixed jurisdiction/market-context provenance accurately
- preserve 2D/3D rendering, colors, opacity, ordering, lifecycle, and retries
- prove zero listings do not suppress Stevenson Ranch polygons

### Block 25.6: Automated and browser acceptance

- run focused and repository-wide tests, typecheck, builds, CSP, and payload
  review
- verify Stevenson Ranch with zero matching listings in desktop/mobile 2D/3D
- verify all five existing cities remain semantically unchanged
- inspect Console, Network, nonblank canvas/WebGL, memory, and teardown

### Block 25.7: Final gate and as-built record

- reconcile the final diff with scope and security boundaries
- update source audit, knowledge base, ADR, and roadmap with measured evidence
- document rollback and operator acceptance
- leave commit, push, PR, and merge under repository-owner control

## Acceptance Criteria

Block 25 is complete only when:

1. a reviewed Stevenson Ranch market-context boundary and provenance are
   committed and documented
2. the artifact contains authoritative CAL FIRE FHSZ geometry in that context
3. the overlay displays there even with zero matching listings
4. every feature retains an official severity and responsibility area
5. LRA status has current Los Angeles County evidence
6. existing five-city 2D and 3D rendering remains unchanged
7. listing points remain above transparent hazard polygons
8. manifest and artifact pass checksum, geometry, area, count, and size gates
9. no new runtime origin, credential, provider cost, or cloud resource exists
10. desktop/mobile acceptance confirms provenance, disclosures, interaction,
    Console, Network, and teardown behavior

## Official Planning References

- [CAL FIRE / OSFM Fire Hazard Severity Zones](https://osfm.fire.ca.gov/what-we-do/community-wildfire-preparedness-and-mitigation/fire-hazard-severity-zones)
- [U.S. Census TIGERweb ACS 2025 Census Designated Places](https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Places_CouSub_ConCity_SubMCD/MapServer/12)
- [Los Angeles County Santa Clarita Valley Area Plan](https://planning.lacounty.gov/wp-content/uploads/2022/10/Santa-Clarita-Valley-Area-Plan.pdf)
- [Los Angeles County Board of Supervisors July 22, 2025 proceedings](https://file.lacounty.gov/SDSInter/bos/sop/1189345_072225.pdf)
- [CAL FIRE LRA jurisdiction layer](https://services1.arcgis.com/jUJYIo9tSA7EHvfZ/ArcGIS/rest/services/FHSZLRA_FULLJurisPolys_PubContactTablev4_JOIN_VIEW/FeatureServer/0)
- [Los Angeles County jurisdiction layer](https://services1.arcgis.com/vdxp8SwMGji0hqly/ArcGIS/rest/services/jurisdiction_la_WFL1/FeatureServer/0)
- [Block 19 Wildfire Hazard Overlay](block-19-wildfire-hazard-overlay.md)
- [Block 23 3D Fire Terrain](block-23-3d-fire-terrain.md)
- [Block 24 Stevenson Ranch RentCast Coverage](block-24-stevenson-ranch-rentcast-coverage.md)
- [ADR 0013: Typed Wildfire Coverage Targets](../adr/0013-typed-wildfire-coverage-targets.md)
