# Block 25: Stevenson Ranch Wildfire Coverage

## Status

Block 25.0 is complete in documentation only on
`feature/stevenson-ranch-wildfire-coverage`. This record freezes the product,
authority, geography, artifact, compatibility, security, cost, rollback, test,
and acceptance boundaries before implementation.

No CAL FIRE or county dataset was downloaded or queried, no production artifact
was rebuilt, and no runtime source, environment file, secret, database, AWS
resource, RentCast request, Telegram delivery, or deployment changed in Block
25.0. Every executable sub-block still requires a fresh explanation and
explicit confirmation.

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

These records establish the planning direction, not the final feature
selection. Block 25.1 must recheck the current official records and determine
which portions of the reviewed Stevenson Ranch context are LRA, SRA, or outside
either published source before assigning designation metadata.

### Coverage-boundary decision gate

Block 25.1 must select and checksum one defensible display boundary. Candidate
sources are evaluated in this order:

1. a current official Los Angeles County community or planning boundary that
   represents Stevenson Ranch with sufficient precision
2. a current official Los Angeles County unincorporated-jurisdiction layer plus
   a separately documented market-context boundary
3. a versioned Census ZCTA `91381` boundary only when no better official
   community boundary is available

A ZCTA or ZIP-derived boundary, if selected, must be labeled `market-context`.
It must never be labeled a jurisdiction, city limit, CAL FIRE boundary, or
parcel determination. The published geometry must include enough surrounding
context to avoid implying that a delivery clip edge is an official hazard edge.
The exact clip/context rule is an output of 25.1, not assumed in 25.0.

## Existing System Constraint

The Block 19 pipeline currently:

- ingests checksum-pinned CAL FIRE LRA `FHSZLRA25_1` and SRA
  `FHSZSRA_23_3` archives
- clips those datasets to a tracked five-incorporated-city boundary snapshot
- emits `fhsz-five-cities-2025.1.geojson` and `manifest.json`
- allows only the three official severities and excludes `NonWildland`
- records source versions, attribution, local designation evidence, geometry
  repair, area reconciliation, counts, bounds, and checksums
- fails above 10 MiB raw or 2 MiB gzip

The browser contract is also intentionally five-city-specific: it hardcodes the
artifact URL and rejects a manifest that does not contain exactly the five
reviewed jurisdictions. Block 25 must generalize these assumptions without
weakening strict validation.

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

- recheck current CAL FIRE / OSFM LRA and SRA versions, terms, and downloads
- verify Los Angeles County adoption evidence and operative map scope
- select and checksum the Stevenson Ranch market-context boundary
- determine LRA/SRA intersections without inferring from ZIP alone
- measure features, severities, coordinates, size, bounds, parse cost, geometry,
  and context clipping behavior
- record aggregate evidence without publishing a runtime artifact

### Block 25.2: Coverage-target and manifest contracts

- add failing tests for typed coverage targets and schema version 2
- generalize config and manifest generation away from exactly five cities
- retain strict source, status, URL, filename, checksum, and duplicate checks
- prove the existing targets preserve current designation metadata

### Block 25.3: Deterministic boundary and build pipeline

- add the reviewed, license-compatible, checksum-pinned boundary snapshot
- generalize GDAL clipping to explicit boundary sources and selectors
- preserve geometry repair, area drift, allowlist, budgets, and deterministic
  output
- fail closed when Stevenson Ranch provenance is incomplete

### Block 25.4: Publish the successor artifact

- generate the new versioned GeoJSON and manifest from reviewed inputs
- verify per-target and combined counts, bounds, severities, areas, checksums,
  attribution, and transfer budgets
- update published-artifact tests only after deterministic rebuild comparison

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
- [Los Angeles County Santa Clarita Valley Area Plan](https://planning.lacounty.gov/wp-content/uploads/2022/10/Santa-Clarita-Valley-Area-Plan.pdf)
- [Los Angeles County Board of Supervisors July 22, 2025 proceedings](https://file.lacounty.gov/SDSInter/bos/sop/1189345_072225.pdf)
- [Block 19 Wildfire Hazard Overlay](block-19-wildfire-hazard-overlay.md)
- [Block 23 3D Fire Terrain](block-23-3d-fire-terrain.md)
- [Block 24 Stevenson Ranch RentCast Coverage](block-24-stevenson-ranch-rentcast-coverage.md)
- [ADR 0013: Typed Wildfire Coverage Targets](../adr/0013-typed-wildfire-coverage-targets.md)
