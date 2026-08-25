# ADR 0013: Typed Wildfire Coverage Targets

## Status

Accepted and implemented through Block 25.3. Block 25.0 records the architecture,
Block 25.1 records the authorized boundary and source-audit decision, and Block
25.2 implements the typed config, schema version 2 producer, and strict browser
parser with temporary version 1 read compatibility. Block 25.3 tracks the
reviewed Census CDP snapshot and implements explicit boundary-source and typed
selector clipping with offline staging and a publication lock. No runtime
artifact, environment, database, provider, or cloud resource changed through
Block 25.3.

## Context

The existing wildfire overlay publishes one deterministic, same-origin GeoJSON
artifact derived from checksum-pinned CAL FIRE / Office of the State Fire
Marshal LRA and SRA datasets. The build clips those sources to five incorporated
cities. Its manifest and browser parser intentionally require exactly Chino,
Chino Hills, Corona, Eastvale, and Jurupa Valley.

Block 24 added `Stevenson Ranch` as a product listing market selected through
ZIP `91381`. RentCast currently labels matching listings `Valencia`, and the
application correctly preserves that provider value. Block 24 did not expand
the five-city CAL FIRE artifact, so the ArcGIS map can center on Stevenson Ranch
while the enabled hazard overlay contains no geometry there.

Stevenson Ranch is an unincorporated Los Angeles County community, not an
incorporated city. ZIP `91381` is a product and postal selector, not a legal
jurisdiction or FHSZ boundary. Appending `Stevenson Ranch` to the existing list
of city jurisdictions would misrepresent source authority and make future
non-city coverage unsafe to add.

The product needs authoritative FHSZ context in Stevenson Ranch even when no
listing matches the active criteria. It must not create a new hazard model,
reinterpret official classifications, or add a live external hazard service to
the browser.

## Decision

### Represent coverage targets by geographic role

Replace the fixed five-city assumption with strict typed coverage targets.
Supported target kinds are:

- `incorporated-jurisdiction`
- `market-context`

Each target has a stable ID, display label, boundary-source reference,
designation metadata, evidence reference, and explicit disclosure. The five
existing cities use `incorporated-jurisdiction`. Stevenson Ranch uses
`market-context`; ZIP `91381` may be recorded as its product selector but is not
treated as its legal jurisdiction.

Block 25.1 selected the official U.S. Census Bureau TIGERweb ACS 2025
`Stevenson Ranch CDP`, GEOID `0674130`, as the exact market-context boundary.
No precise, directly downloadable Los Angeles County polygon named Stevenson
Ranch was found; the County planning and jurisdiction records instead confirm
that the community is within the unincorporated Santa Clarita Valley. The
Census Designated Place is a versioned statistical place shaped for the named
community and is more precise for this purpose than ZIP/ZCTA `91381` or provider
city `Valencia`.

The CDP is not a government jurisdiction, postal boundary, parcel
determination, fire district, or CAL FIRE classification boundary. Record it as
`market-context`, with source provenance and the explicit disclosure that an
artifact clip edge is a product coverage edge. Use exact hard clipping to the
CDP. Do not retain whole intersecting source polygons: the audit found that one
such polygon extends far outside the market and unnecessarily broadens map fit
and payload scope.

### Publish a new manifest contract

Introduce wildfire manifest schema version 2 with typed `coverageTargets` and
tracked boundary provenance. Do not weaken strict validation merely to accept a
variable list.

Schema version 2 rejects unknown target kinds and statuses, duplicates,
incomplete evidence, insecure source URLs, unsafe artifact filenames, unknown
severities or responsibility areas, and manifest/artifact integrity mismatch.
It records per-target and combined quality evidence.

The artifact builder may carry target identity while processing for quality
reconciliation. The browser artifact retains only the minimum properties needed
to render official source meaning unless a reviewed provenance need requires an
additional field.

Block 25.3 implements selectors as the closed shape `{ field, equals }` rather
than raw SQL. Each selector must resolve exactly one feature in its referenced
tracked GeoJSON source before GDAL starts. Existing cities select `CITY`; the
Stevenson Ranch market selects Census `GEOID` `0674130`. The selector remains a
maintainer build concern and is not copied into the browser manifest.

### Retain the derived same-origin artifact

Continue to generate a versioned GeoJSON artifact from checksum-pinned official
CAL FIRE inputs. Publish a new filename rather than replacing the old artifact
name with different bytes. The planned filename is
`fhsz-supported-markets-2025.1-r2.geojson`, subject to Block 25.1 confirming the
current upstream versions.

Do not make React or ArcGIS call CAL FIRE, Los Angeles County, Census, or another
hazard service at runtime. This decision introduces no browser credential, CSP
origin, recurring provider request, AWS service, or database dependency.

### Keep product selection, listings, and hazard rendering independent

The Stevenson Ranch product market remains ZIP-defined for RentCast eligibility
and continues to preserve provider city `Valencia`. Hazard coverage uses its
separately reviewed display boundary and official FHSZ geometry.

The wildfire toggle controls artifact loading regardless of listing count.
Zero matching listings must not suppress polygons. Search Criteria may affect
the map viewpoint but does not select, infer, or classify hazard features.

### Preserve source semantics in both ArcGIS modes

CAL FIRE / OSFM remains the classification authority. The application displays
only `Moderate`, `High`, and `Very High` from the official artifact. LRA and SRA
status follows current source and local-adoption evidence. `NonWildland` remains
excluded rather than becoming a fourth severity.

For the selected CDP, CAL FIRE identifies the containing target as qualifying
`Los Angeles County / Unincorporated County`, and Los Angeles County GIS
identifies it as the `SANTA CLARITA VALLEY / UNINCORPORATED AREA`. Los Angeles
County Ordinance `2025-0027`, operative 2025-08-21, is the local-adoption
evidence for LRA features; use evidence ID
`los-angeles-county-ordinance-2025-0027` and status `locally-adopted`. SRA
features remain `effective` from the CAL FIRE source.

ArcGIS 2D and 3D Terrain load the same artifact and renderer contract. Terrain
remains visual context only. It does not change severity, polygon geometry, or
designation status.

Keep existing colors, opacity, listing-marker ordering, lazy load, Abort, retry,
rollback, and teardown behavior. Preserve hazard-not-risk, blank-area, and
non-parcel disclosures while adding honest market-context provenance.

### Retain release and performance gates

The existing 10 MiB raw and 2 MiB gzip artifact limits remain hard gates. If the
combined two-region artifact fails size or browser-performance acceptance, split
it into regionally versioned, same-origin artifacts loaded by map context. Do
not raise the limits or replace deterministic artifacts with a live provider.

## Consequences

Positive consequences:

- Stevenson Ranch receives reviewed hazard context without being mislabeled a
  city jurisdiction
- a future non-city market can use the same explicit boundary contract
- existing CAL FIRE classifications and five-city behavior remain intact
- browser behavior remains deterministic and independent from upstream uptime
- no new key, runtime origin, recurring API request, or cloud resource is needed
- artifact provenance can distinguish legal jurisdiction from delivery context

Tradeoffs:

- manifest schema and browser parsing require a coordinated version change
- the GIS builder must support more than one boundary source and selector shape
- source/adoption evidence is more complex for unincorporated county territory
- a second geographic region increases artifact and browser parse cost
- clipping to a product context requires careful disclosure at artificial edges

Block 25.3 measured a deterministic six-target staging candidate of 96 features,
1,158,246 raw bytes, and 292,581 gzip bytes. Two offline builds produced artifact
SHA-256 `7d8486b94ef6802ab5866d17b0a591634dfe3e16843ef58a21143a43df5e09fd`.
Publication remains disabled until Block 25.4 reviews that candidate.

## Rejected Alternatives

### Append Stevenson Ranch as a sixth city jurisdiction

Rejected because Stevenson Ranch is unincorporated and ZIP `91381` is not a
legal city or CAL FIRE jurisdiction boundary.

### Treat every ZIP 91381 location as one responsibility area

Rejected because LRA/SRA status comes from authoritative source geometry, not
from postal code membership.

### Use the RentCast city field as the hazard boundary

Rejected because provider city `Valencia` is listing data and has no authority
over CAL FIRE geometry or Los Angeles County jurisdiction.

### Query CAL FIRE or ArcGIS live from the browser

Rejected because it weakens deterministic provenance, adds runtime origin and
availability dependencies, complicates CSP and credentials, and can make 2D and
3D releases disagree over time.

### Interpret blank space as no hazard

Rejected because blank space can mean outside the published artifact, excluded
`NonWildland`, or no source polygon. It is not a safety conclusion.

### Build a local risk score from terrain or polygon distance

Rejected because Block 25 extends coverage only. It does not model risk, fire
behavior, insurability, evacuation, or parcel safety.

## Security And Operations

Official downloads and feature-service queries remain maintainer operations and
require explicit authorization. Their output must not include credentials,
listing addresses, or unnecessary raw response data in logs.

The production browser continues to fetch only same-origin versioned wildfire
assets. No environment variable, secret, database migration, AWS resource,
RentCast request, Telegram delivery, schedule, or deployment is authorized by
this ADR.

## Rollback

Revert the Block 25 data/web release and redeploy the previous static bundle and
five-city artifact. No data repair, profile migration, secret rotation, provider
rollback, or cloud cleanup is required.

## Related Records

- [Block 25 Stevenson Ranch Wildfire Coverage](../knowledge-base/block-25-stevenson-ranch-wildfire-coverage.md)
- [Block 19 Wildfire Hazard Overlay](../knowledge-base/block-19-wildfire-hazard-overlay.md)
- [Block 23 3D Fire Terrain](../knowledge-base/block-23-3d-fire-terrain.md)
- [Block 24 Stevenson Ranch RentCast Coverage](../knowledge-base/block-24-stevenson-ranch-rentcast-coverage.md)
- [ADR 0007: Wildfire Hazard Overlay](0007-wildfire-hazard-overlay.md)
- [ADR 0011: Optional 3D Fire Terrain Context](0011-3d-fire-terrain-context.md)
- [ADR 0012: Conditional RentCast Search Areas](0012-conditional-rentcast-search-areas.md)
