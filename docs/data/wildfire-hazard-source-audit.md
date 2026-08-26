# Wildfire Hazard Source Audit

## Audit Result

Block 19.1 completed on 2026-08-21. The current CAL FIRE / Office of the
State Fire Marshal sources, target-jurisdiction status, source schema, clipped
geometry budget, and browser parse cost were reviewed.

The selected Block 19 runtime format is one versioned, same-origin GeoJSON
artifact that is fetched lazily when the user first enables the overlay. The
measured conservative prototype is below both documented size limits. Block
19.2 subsequently passed the reproducible build gate. A tiled artifact remains
a fallback only if Block 19.5 browser verification fails the same gate.

Block 19.1 did not publish a browser artifact or add a runtime ArcGIS
dependency. Block 19.2 now publishes a versioned derived GeoJSON and manifest;
the downloaded archives remain ignored local inputs outside Git.

## Authoritative Sources

The source page is the
[CAL FIRE / OSFM Fire Hazard Severity Zones page](https://osfm.fire.ca.gov/what-we-do/community-wildfire-preparedness-and-mitigation/fire-hazard-severity-zones).
It identifies `Moderate`, `High`, and `Very High` as the official severity
classes, distinguishes hazard from risk, and publishes separate State
Responsibility Area (SRA) and Local Responsibility Area (LRA) downloads.

Acquisition was recorded at `2026-08-22T00:13:29Z`, which is
`2026-08-21 17:13:29 PDT`.

| Source | Published artifact | Size | Last modified | SHA-256 | Native CRS |
| --- | --- | ---: | --- | --- | --- |
| LRA | `FHSZLRA251Allgdb.zip` | 9,840,158 bytes | 2025-05-01 | `736fa5231c70b844550784cd13c8d414c239cf9573c9cae6139554ef0bf464b6` | EPSG:3310 |
| SRA | `FHSZSRA_23_3.zip` | 36,001,656 bytes | 2025-02-24 | `e744eb8eb7895157f4025109f29ff5312180a52fdb4648ff9fe9328edf4db3b2` | EPSG:3310 in the downloaded shapefile |

Block 19.2 also acquired the official CAL FIRE `California Incorporated
Cities` GeoJSON export: 38,672,112 bytes with SHA-256
`0571ca0f9d66a96889a0df7ee0b417790b3bf71fd3410af92ae7a097fbc8cb8e`.
Because that export URL is mutable, the repository tracks only its five-city
version `24_1` subset: 558,149 bytes with SHA-256
`29d92acd5ec5e210d2894eb6cffba14540e7f7a0d7d3e4e1388a0eb512d804f8`.
The source catalog identifies the dataset as Creative Commons Attribution.

The LRA archive contains the `FHSZLRA25_1_All.gdb` File Geodatabase. The SRA
archive contains both shapefile and File Geodatabase representations. Block
19.2 ingests these checksum-pinned archives directly with a digest-pinned GDAL
3.13.2 image; the official feature services remain validation and audit
surfaces, not browser runtime dependencies.

Official download URLs:

- [2025 combined LRA archive](https://34c031f8-c9fd-4018-8c5a-4159cdff6b0d-cdn-endpoint.azureedge.net/-/media/osfm-website/what-we-do/community-wildfire-preparedness-and-mitigation/fire-hazard-severity-zones/fhszlra251allgdb.zip?hash=4FE6C7291E09FC36126F91318C6CCB88&rev=c273e91031b6401b99937894df5f1266)
- [2023 SRA archive](https://34c031f8-c9fd-4018-8c5a-4159cdff6b0d-cdn-endpoint.azureedge.net/-/media/osfm-website/what-we-do/community-wildfire-preparedness-and-mitigation/fire-hazard-severity-zones/fhszsra_23_3.zip?hash=87816F8F0635FFA1D7B99A723DE38A70&rev=f5118b1ba17044a8aa3cd2994f00d6d3)

## Schema And Category Audit

The official CAL FIRE feature layers expose polygon geometry and the fields
`OBJECTID`, `SRA`, `FHSZ`, `FHSZ_Description`, shape area, and shape length.
Statewide service counts at audit time were:

| Responsibility area | Moderate | High | Very High | NonWildland | Total |
| --- | ---: | ---: | ---: | ---: | ---: |
| LRA | 4,741 | 2,049 | 1,008 | 1,954 | 9,752 |
| SRA | 4,188 | 5,824 | 8,411 | 0 | 18,423 |

`NonWildland` is present in the LRA source but is not a fourth Fire Hazard
Severity Zone. The normalization pipeline must use a positive allowlist for
the three official severities and exclude `NonWildland`. Unknown values must
fail the build.

Official validation services:

- [LRA feature layer](https://services1.arcgis.com/jUJYIo9tSA7EHvfZ/arcgis/rest/services/FHSALRA25_v1_All/FeatureServer/0)
- [SRA feature layer](https://services1.arcgis.com/jUJYIo9tSA7EHvfZ/ArcGIS/rest/services/FHSZSRA_23_3/FeatureServer/0)
- [Jurisdiction status layer](https://services1.arcgis.com/jUJYIo9tSA7EHvfZ/ArcGIS/rest/services/FHSZLRA_FULLJurisPolys_PubContactTablev4_JOIN_VIEW/FeatureServer/0)

## Product Coverage

The combined official jurisdiction envelope for Chino, Chino Hills, Eastvale,
Corona, and Jurupa Valley is:

```text
[-117.8025510324, 33.8000860970, -117.3673113099, 34.0483913903]
```

The audit used a 0.03-degree context margin and measured this selection
envelope:

```text
[-117.8325510324, 33.7700860970, -117.3373113099, 34.0783913903]
```

The read-only official feature-service query returns whole features that
intersect an envelope rather than cutting their geometry at the boundary.
Therefore, the measurement prototype is a conservative spatially selected
superset and its geometry extends beyond the envelope. Block 19.2 hard clips
source geometry to the union of the five reviewed incorporated-city boundaries.
The final artifact does not include nearby context outside those cities.

## Jurisdiction Verification

CAL FIRE's jurisdiction layer classified all five target cities as qualifying
jurisdictions with LRA Fire Hazard Severity Zones at audit time. Local adoption
status is not uniform:

| Jurisdiction | Audited status | Evidence and artifact rule |
| --- | --- | --- |
| Chino | Locally adopted | Chino Valley Fire District Ordinance 2025-01 applies to Chino and Chino Hills, was adopted 2025-07-09, and became effective 2025-09-01. The ordinance states that the District made no changes to the State Fire Marshal recommendations or maps. |
| Chino Hills | Locally adopted | Same Chino Valley Fire District ordinance and no-change finding as Chino. |
| Corona | Locally adopted | Corona adopted Ordinance 3418 on 2025-06-04, effective 2025-07-04. The city states that it did not propose additions or increases to the OSFM map. |
| Jurupa Valley | Locally adopted | The City Council adopted Ordinance 2025-13 on 2025-06-26, adopting the State Fire Marshal recommendations. |
| Eastvale | Recommended until locally verified | CAL FIRE's public status layer showed a qualifying jurisdiction and public-contact status. The official city record found for this audit documents a proposed ordinance review, not final adoption. Do not label Eastvale features `locally-adopted` until a current adopted ordinance and map are obtained. |

Local evidence:

- [Chino Valley Fire District Fire Hazard Severity Zone Map](https://chinovalleyfire.org/280/Fire-Hazard-Severity-Zone-Map)
- [Corona Fire Hazard Severity Zones](https://www.coronaca.gov/departments/fire/fire-prevention-and-planning/fire-hazard-severity-zones-fhsz-maps)
- [Corona Ordinance 3418 staff report](https://pub-corona.escribemeetings.com/filestream.ashx?DocumentId=25746)
- [Jurupa Valley June 26, 2025 minutes](https://www.jurupavalley.org/DocumentCenter/View/4218)
- [Jurupa Valley 2025 FHSZ page](https://www.jurupavalley.org/590/2025-Fire-Hazard-Severity-Zones-FHSZ)
- [Eastvale Public Safety Commission report](https://d3n9y02raazwpg.cloudfront.net/eastvale/59d6f124-bcd5-11ef-ab4b-005056a89546-d60328a7-4a03-48da-a1ce-62a28b0c2bb6-1744912649.pdf)

## Measured Prototype

The audit projected the selected official-service geometry to EPSG:4326,
excluded `NonWildland`, retained only the browser contract properties, and
serialized deterministic GeoJSON. No simplification was applied, so the
result is intentionally conservative for the format gate.

| Measurement | Result |
| --- | ---: |
| Features | 207 |
| Moderate / High / Very High | 68 / 78 / 61 |
| Coordinate positions | 138,701 |
| Raw GeoJSON | 3,615,513 bytes |
| Gzip level 9 | 976,807 bytes |
| Node.js 24.19.0 JSON parse, 50-run mean | 7.942 ms |
| `@maplibre/geojson-vt` source plus representative z8 tile, 10-run mean | 14.066 ms |

Audit-only prototype checksums:

```text
GeoJSON: 76b10086ef2bd23cb03ad152853e9c6f6545079b12383347366be54c86ca7a17
Gzip:    ba559f3ac59d9fa77ba56ad1258c07b06599d30fb595a509bf019a20acf12777
```

These checksums identify only the temporary measurement prototype. They must
not be copied into a release manifest. Block 19.2 generates new deterministic
checksums from the downloaded archives and its pinned transformation pipeline.

## Format Decision

GeoJSON passes the Block 19 format gate with margin:

- raw data is 3.45 MiB against a 10 MiB maximum
- gzip transfer is 0.93 MiB against a 2 MiB maximum
- Node parsing and client-side tiling measurements are short on the audit
  machine
- the prototype includes whole intersecting polygons and no simplification,
  while the final artifact will be clipped

Block 19.2 emits one versioned GeoJSON artifact and a paired provenance
manifest. Block 19.5 subsequently passed fetch, parse, source-installation,
desktop/mobile pan, zoom, and visible-stall acceptance. If a future refreshed
artifact crosses either hard size limit or introduces a visible stall, the
decision returns to a maintained MapLibre-compatible tiled format; the limits
are not raised.

## Block 19.2 Result

The completed implementation:

1. Pins GDAL `3.13.2` by multi-platform OCI digest.
2. Verifies source checksums and byte limits before GIS processing.
3. Reads the downloaded OSFM archives and a tracked five-city boundary snapshot.
4. Hard clips to the five incorporated-city boundaries, reprojects to WGS84,
   and preserves polygon holes without boundary simplification.
5. Uses explicit GDAL `ST_MakeValid`, records repair and area metrics, and
   fails if output remains invalid or area drift exceeds `0.001`.
6. Allows only `Moderate`, `High`, and `Very High`; excludes `NonWildland`.
7. Keeps Eastvale `recommended` while assigning the four verified local
   adoptions and SRA `effective` status.
8. Emits deterministic minimal properties, counts, bounds, attribution,
   transformation metadata, and checksums.
9. Uses a deterministic fixture in ordinary CI with no provider or Docker call.

The resulting artifact has 85 features, 35,512 coordinate positions, 933,093
raw bytes, and 234,976 gzip bytes. It excludes 8 `NonWildland` features,
repairs one self-intersecting source feature, removes one zero-area line
component produced by clipping, and has zero invalid output geometries. Two
identical builds produced SHA-256
`d02baebe5e5b1ddaab3b81c0fcff4e973c3cd363b645432712e9609d15e1863f`.

Before publishing a derived artifact, preserve required official attribution
and recheck the current source terms and disclaimers. This audit makes no
assumption that an open viewer implies an unrestricted redistribution license.

## Block 25.1 Stevenson Ranch Extension Audit

Block 25.1 completed on 2026-08-24 under separate authorization. It made
read-only requests to official CAL FIRE / OSFM, Los Angeles County, and U.S.
Census services, then used the existing digest-pinned GDAL image with container
networking disabled. It did not read application secrets, call a provider or
production service, publish a runtime artifact, or retain listing addresses.
Downloaded candidates and audit responses remain ignored under
`.cache/wildfire-hazard`.

### Boundary selection

No precise, directly downloadable Los Angeles County polygon named Stevenson
Ranch was found. County planning and GIS records identify Stevenson Ranch as
part of the unincorporated Santa Clarita Valley, but the jurisdiction layer is
too broad to serve as the product coverage boundary.

The selected candidate is the official U.S. Census Bureau TIGERweb ACS 2025
`Stevenson Ranch CDP`, GEOID `0674130`, from the Census Designated Places layer.
It is a statistical `market-context` boundary, not a city, postal boundary,
parcel determination, fire district, or CAL FIRE classification boundary.

| Boundary measurement | Result |
| --- | --- |
| Feature count | 1 valid Polygon |
| Census `AREALAND` / `AREAWATER` | 16,533,804 / 2,399 square meters |
| GDAL EPSG:3310 area | 16,536,210.674 square meters |
| Point on surface | `POINT(-118.594058 34.392544)` |
| Download size | 24,175 bytes |
| SHA-256 | `2405aaedb264e5854c933f6e461aa3bf6b5e9109f73d6baba0fa65baf47292cf` |

Official boundary source:

- [U.S. Census TIGERweb ACS 2025 Census Designated Places layer](https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Places_CouSub_ConCity_SubMCD/MapServer/12)

### Jurisdiction and designation evidence

The CDP point-on-surface intersects exactly one feature in each official
jurisdiction check:

- CAL FIRE: county `Los Angeles`, jurisdiction `Los Angeles County`, type
  `Unincorporated County`, status `Qualifying`, unit `LAC`
- Los Angeles County GIS: name `SANTA CLARITA VALLEY`, jurisdiction
  `UNINCORPORATED AREA`

Los Angeles County Ordinance `2025-0027` was adopted on 2025-07-22 and became
operative on 2025-08-21 for LRA FHSZ designations in the Consolidated Fire
Protection District. It is the evidence for assigning `locally-adopted` to LRA
features in this market context. The CAL FIRE jurisdiction layer's null
`STATUS` field is not used as adoption evidence. SRA features retain source
status `effective`.

Official evidence:

- [Los Angeles County Board of Supervisors July 22, 2025 proceedings](https://file.lacounty.gov/SDSInter/bos/sop/1189345_072225.pdf)
- [Los Angeles County Santa Clarita Valley Area Plan](https://planning.lacounty.gov/wp-content/uploads/2022/10/Santa-Clarita-Valley-Area-Plan.pdf)
- [CAL FIRE LRA jurisdiction layer](https://services1.arcgis.com/jUJYIo9tSA7EHvfZ/ArcGIS/rest/services/FHSZLRA_FULLJurisPolys_PubContactTablev4_JOIN_VIEW/FeatureServer/0)
- [Los Angeles County jurisdiction layer](https://services1.arcgis.com/vdxp8SwMGji0hqly/ArcGIS/rest/services/jurisdiction_la_WFL1/FeatureServer/0)

### Block 25.3 deterministic staging reconciliation

The audited ACS 2025 CDP response is now tracked byte-for-byte at
`tools/wildfire-hazard/sources/stevenson-ranch-cdp-acs25.geojson`. Its checksum,
single-feature count, GEOID, and geometry type are validated before clipping.
The generalized builder resolves Stevenson Ranch with `GEOID = 0674130`; the
five existing incorporated jurisdictions retain their explicit `CITY`
selectors. Raw SQL selectors are not accepted.

Two offline builds using the existing checksum-pinned CAL FIRE archives and
GDAL `3.13.2` produced identical candidate bytes. Stevenson Ranch reconciled to
11 valid supported geometries, 15,476,630.378 square meters, and severity counts
of 1 Moderate, 7 High, and 3 Very High. The combined candidate contains 96
features and measures 1,158,246 raw / 292,581 gzip bytes with SHA-256
`7d8486b94ef6802ab5866d17b0a591634dfe3e16843ef58a21143a43df5e09fd`.
The prior gzip figure was an audit-only projection; the measured result remains
well within the unchanged 2 MiB gate. Publication is locked until Block 25.4,
and no browser asset changed in Block 25.3.

### Block 25.4 deterministic publication reconciliation

A fresh offline stage reproduced the reviewed candidate, after which the
offline-only publication path wrote the successor artifact and schema version
2 manifest. The staged and public files compare byte-for-byte. The public
artifact has SHA-256
`7d8486b94ef6802ab5866d17b0a591634dfe3e16843ef58a21143a43df5e09fd`;
the public manifest has SHA-256
`e926c7de239970180fdc52aaa55a850cf6bd58686518c2576f94fd7fe8b95366`.

Final combined measurements are 96 features, 44,204 coordinates, 1,158,246
raw bytes, 292,581 gzip bytes, and bounds
`[-118.622305, 33.8000861, -117.3673113, 34.417989]`. The artifact contains
29 Moderate, 34 High, and 33 Very High features; 25 are SRA and 71 are LRA.
Designation counts are 25 `effective`, 11 `recommended`, and 60
`locally-adopted`. Stevenson Ranch retains 11 features, 15,476,630.378 square
meters, zero invalid geometry, and the audited 1 / 7 / 3 severity split.

The old five-city GeoJSON is retained temporarily because the React loader URL
does not move until Block 25.5. No live GIS service, credential, provider,
database, cloud resource, or deployment was introduced by publication.

### Block 25.7 final release reconciliation

Block 25.7 reran the stage-only pipeline with Docker networking disabled and
the already-installed digest-pinned GDAL `3.13.2` image. It made no upstream,
provider, database, cloud, or secret request. The rebuild again produced 96
features, 1,158,246 raw bytes, 292,581 gzip bytes, and artifact SHA-256
`7d8486b94ef6802ab5866d17b0a591634dfe3e16843ef58a21143a43df5e09fd`.

The staged artifact and manifest compared byte-for-byte with the public files.
The manifest retained SHA-256
`e926c7de239970180fdc52aaa55a850cf6bd58686518c2576f94fd7fe8b95366`,
and the tracked Stevenson Ranch boundary retained SHA-256
`2405aaedb264e5854c933f6e461aa3bf6b5e9109f73d6baba0fa65baf47292cf`.
The prior five-city artifact remains available at SHA-256
`d02baebe5e5b1ddaab3b81c0fcff4e973c3cd363b645432712e9609d15e1863f`
as the bounded rollback asset.

Focused wildfire tests pass 24/24. The final repository gate passes all 114
test files and 1,072 tests, repository-wide typecheck, the production web build,
and the AWS infrastructure build. No source refresh, authority reinterpretation,
runtime origin, credential, deployment, or rollback execution occurred.

### Source and intersection reconciliation

The current CAL FIRE service metadata still identifies LRA layer
`FHSZLRA25_v1_All` and SRA layer `FHSZSRA_23_3`. The local archives used for
the spatial audit match the existing configured sizes and SHA-256 digests.

Exact polygon queries against the official feature services returned five LRA
and seven SRA features. Local clipping from the checksum-pinned archives
returned the same counts. The LRA set includes one `NonWildland` feature; the
normalizer continues to exclude it and allow only the three official FHSZ
classes.

| Responsibility area | Moderate | High | Very High | `NonWildland` | Supported area (m2) | Invalid geometries |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| LRA | 1 | 1 | 2 | 1 | 7,969,148.811 | 0 |
| SRA | 0 | 6 | 1 | 0 | 7,507,481.567 | 0 |
| Combined | 1 | 7 | 3 | 1 | 15,476,630.378 | 0 |

The excluded `NonWildland` area is 1,059,579.364 square meters. Supported
geometry plus the excluded source polygon reconciles to the CDP area within one
square meter. LRA/SRA assignment therefore comes from the authoritative source
geometry and is not inferred from ZIP `91381`, provider city `Valencia`, or the
product market label.

### Clip and packaging decision

The audit compared exact hard clipping with retaining every full official
source polygon that intersects the CDP:

| Measurement | Exact CDP hard clip | Whole intersecting polygons |
| --- | ---: | ---: |
| Supported features | 11 | 11 |
| Coordinates | 8,692 | 65,583 |
| Candidate raw / gzip bytes | 225,195 / 54,642 | 1,690,689 / 446,181 |
| Combined raw / gzip bytes | 1,158,246 / 289,420 | 2,623,740 / 680,959 |
| Node 24.19.0 parse mean, 100 runs | 2.426 ms | 5.942 ms |

The whole-feature candidate extends west to longitude `-120.5036026` because a
source polygon is much larger than the product market. Although both candidates
fit the hard transfer budgets, retaining that geometry would misframe the map
and broaden the delivery scope without product value. Block 25 selects an exact
hard clip to the Census CDP and must disclose that the clip edge is a product
coverage boundary rather than an official severity transition.

The published combined hard-clipped artifact remains well below the 10 MiB raw
and 2 MiB gzip limits. Block 25.3 reproduced the transformation from a tracked
boundary snapshot, and Block 25.4 recorded the final deterministic checksums
and quality reconciliation before the coordinated runtime-reference change.

## Block 27.2 Irvine Extension Audit

Block 27.2 completed on 2026-08-25 under separate authorization. It made
read-only requests to official CAL FIRE / OSFM, California Open Data, and City
of Irvine services, then used the existing digest-pinned GDAL `3.13.2` image
with container networking disabled. It did not read application secrets, call
RentCast, PostgreSQL, Telegram, AWS, or an ArcGIS account, publish a runtime
artifact, or retain listing addresses. Audit evidence remains ignored under
`.cache/wildfire-hazard/audit/block-27-2` and totals about 4.7 MiB.

### Irvine boundary and designation evidence

The current CAL FIRE `City Boundaries` service returned exactly one feature
with `CITY=Irvine` and `COUNTY=Orange`. The selected normalized boundary is
39,079 bytes with SHA-256
`368205802647ca6d9c476682edf8425a9ef781ffda7c4e171697a67920ec8b23`.
It is valid, has EPSG:3310 area `170,869,605.704035` square meters and bounds
`[-117.868766, 33.599396, -117.678038, 33.773657]`. Its geometry is
topologically equal to the Irvine geometry in the existing official `24_1`
snapshot, with identical area.

The CAL FIRE jurisdiction service identifies Irvine as a qualifying
incorporated city. City Council Ordinance `25-19` was introduced on 2025-06-10
and adopted on 2025-06-24. It repeals Ordinance `12-03`, designates the 2025
Moderate, High, and Very High FHSZ map, and becomes effective 30 days after
adoption. The ordinance, rather than the CAL FIRE contact-workflow status, is
the evidence for `locally-adopted` LRA status. SRA retains `effective` status.

Official boundary and designation sources:

- [California Incorporated Cities](https://lab.data.ca.gov/dataset/california-incorporated-cities)
- [CAL FIRE LRA jurisdiction layer](https://services1.arcgis.com/jUJYIo9tSA7EHvfZ/ArcGIS/rest/services/FHSZLRA_FULLJurisPolys_PubContactTablev4_JOIN_VIEW/FeatureServer/0)
- [City of Irvine Ordinance 25-19](https://irvine.granicus.com/MetaViewer.php?event_id=2641&meta_id=167078&view_id=)
- [City of Irvine current LRA GIS layer](https://gis.cityofirvine.org/arcgis/rest/services/ParcelClariti/MapServer/160)

### Source and intersection reconciliation

Current metadata still identifies CAL FIRE LRA layer `FHSZLRA25_v1_All` and
SRA layer `FHSZSRA_23_3`. The local source archives remain byte-identical to
their configured checksums. At audit time, LRA service item
`018035e18cdc4778afcbe06185c01426` reported data last edited on 2025-09-10,
SRA item `6000aebca6f24b3892ecb01b598f7545` reported 2025-06-27, and the current
City Boundaries layer reported data last edited on 2026-04-09. These metadata
checks validate source identity; they do not replace the pinned archive bytes
used for deterministic clipping.

The verified archives are:

| Source | Bytes | SHA-256 |
| --- | ---: | --- |
| LRA `FHSZLRA251Allgdb.zip` | 9,840,158 | `736fa5231c70b844550784cd13c8d414c239cf9573c9cae6139554ef0bf464b6` |
| SRA `FHSZSRA_23_3.zip` | 36,001,656 | `e744eb8eb7895157f4025109f29ff5312180a52fdb4648ff9fe9328edf4db3b2` |

Exact current-service polygon queries and local hard clips agree:

| Responsibility area | Moderate | High | Very High | Features | Area (m2) | Invalid geometries |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| LRA | 4 | 4 | 4 | 12 | 65,497,365.692 | 0 |
| SRA | 0 | 0 | 2 | 2 | 17,014.666 | 0 |
| Combined | 4 | 4 | 6 | 14 | 65,514,380.358 | 0 |

No raw clipped feature required repair and `ST_MakeValid` introduced zero area
drift. Two LRA/SRA feature pairs touch at their boundaries, but their overlap
area is zero. Supported FHSZ geometry covers about 38.342% of the Irvine city
boundary. Responsibility area and severity remain source attributes, not
application inference.

Official classification sources:

- [CAL FIRE / OSFM Fire Hazard Severity Zones](https://osfm.fire.ca.gov/what-we-do/community-wildfire-preparedness-and-mitigation/fire-hazard-severity-zones)
- [2025 LRA feature layer](https://services1.arcgis.com/jUJYIo9tSA7EHvfZ/ArcGIS/rest/services/FHSALRA25_v1_All/FeatureServer/0)
- [2023 SRA feature layer](https://services1.arcgis.com/jUJYIo9tSA7EHvfZ/ArcGIS/rest/services/FHSZSRA_23_3/FeatureServer/0)

### Payload and parse projection

The Irvine-only runtime-shaped candidate contains 14 features, 8,256
coordinates, 62 rings, 215,910 raw bytes, and 61,665 gzip bytes. Its bounds are
`[-117.8537862, 33.5993963, -117.6780379, 33.773657]`.

Rebuilding the current six-target artifact plus Irvine through the existing
artifact builder projects:

| Metric | Current artifact | Projected successor | Growth |
| --- | ---: | ---: | ---: |
| Features | 96 | 110 | 14 |
| Raw bytes | 1,158,246 | 1,374,114 | 215,868 |
| Gzip bytes | 292,581 | 354,030 | 61,449 |

The projected artifact uses about 13.10% of the 10 MiB raw limit and 16.88% of
the 2 MiB gzip limit. On Node `24.19.0`, 200 warm-cache `JSON.parse` iterations
averaged 2.990 ms, with p50 2.907 ms, p95 3.438 ms, and maximum 7.000 ms. This
projection is not a published artifact; Block 27.5 must reproduce the result
through the reviewed deterministic pipeline.

## Limitations

- This is a display-data audit, not parcel-level hazard certification.
- The audit did not install GDAL or another local GIS dependency.
- Local adoption records can change and must be rechecked during a refresh.
- Eastvale's local adoption remains unresolved by the official records found.
- A future source refresh must repeat the Block 19.5 size, performance, and
  browser visual checks.
- The selected Stevenson Ranch CDP is a statistical market-context boundary;
  its product clip edge is not a legal or CAL FIRE hazard boundary.
