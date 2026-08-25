# Wildfire Hazard Data Builder

## Purpose

This maintainer-only tool creates the browser-facing Fire Hazard Severity Zone
GeoJSON used by Block 19. It is not part of the React or API runtime. Ordinary
CI runs only the deterministic fixture tests and does not download official
data or start Docker.

## Commands

```bash
pnpm wildfire:data:test
pnpm wildfire:data:stage
pnpm wildfire:data:build
```

`wildfire:data:stage` is the review path. It is offline-only and writes
candidate files under `.cache/wildfire-hazard/staged`. It fails when a
checksum-pinned CAL FIRE archive is not already cached. `wildfire:data:build`
is the explicit publication path; it is also forced offline and must be
enabled by a reviewed block in `config.json`.

Both build modes require:

- Node.js `24.19.0`
- a running Docker service
- the checksum-pinned OSFM archives in the local cache for offline staging

GDAL runs in the pinned multi-platform image recorded in `config.json`. The
container starts with `--network=none` and can access only
`.cache/wildfire-hazard` through its bind mount.

## Inputs

`config.json` is the reviewed source allowlist. It records canonical and
download URLs when applicable, versions, byte limits, SHA-256 checksums,
licenses, attribution, typed coverage targets, selectors, and local-adoption
evidence.

The LRA and SRA archives are downloaded into:

```text
.cache/wildfire-hazard/sources/
```

They are never committed. A partial or mismatched download is deleted or
rejected before GDAL can read it.

CAL FIRE's incorporated-city export is a mutable endpoint. To keep builds
reproducible, the repository tracks only the five reviewed city boundaries in:

```text
sources/target-city-boundaries-24_1.geojson
```

The config records both the tracked subset checksum and the complete upstream
snapshot checksum. The snapshot is CC BY data attributed to CAL FIRE FRAP and
the California Board of Equalization.

The separately reviewed Stevenson Ranch delivery boundary is the official
U.S. Census Bureau ACS 2025 Census Designated Place, GEOID `0674130`:

```text
sources/stevenson-ranch-cdp-acs25.geojson
```

Its tracked SHA-256 is
`2405aaedb264e5854c933f6e461aa3bf6b5e9109f73d6baba0fa65baf47292cf`.
It is a statistical `market-context` boundary, not a city, ZIP boundary,
parcel determination, or CAL FIRE classification boundary. ZIP `91381`
remains a separate product selector.

## Pipeline

The build performs these bounded stages:

1. Verify every source checksum and byte limit.
2. Resolve each typed `{ field, equals }` selector against its explicit tracked
   boundary source and require exactly one matching feature.
3. Use GDAL to clip LRA and SRA polygons to each reviewed coverage boundary.
4. Extract only polygonal components created by clipping.
5. Apply GDAL `ST_MakeValid` explicitly and record repair counts and area
   drift; do not skip invalid features.
6. Normalize only `Moderate`, `High`, and `Very High`; exclude `NonWildland`.
7. Reproject to EPSG:4326, round to seven decimal places, and preserve holes.
8. Sort features deterministically and emit the minimal browser properties.
9. Reconcile per-target and combined feature counts, validity, severity, and
   EPSG:3310 area before and after normalization.
10. Enforce the 10 MiB raw and 2 MiB gzip artifact budgets.

Any unsafe selector, zero or multiple boundary match, incomplete provenance,
unknown severity, source mismatch, invalid output geometry, feature-count
change, area drift over `0.001`, or size-budget failure stops the build.

## Outputs

Staging atomically writes only ignored review candidates:

```text
.cache/wildfire-hazard/staged/fhsz-supported-markets-2025.1-r2.geojson
.cache/wildfire-hazard/staged/manifest.json
```

Block 25.4 published the reviewed successor while retaining the previous
five-city artifact for the Block 25.5 runtime-reference transition:

```text
apps/web/public/data/wildfire-hazard/fhsz-five-cities-2025.1.geojson
apps/web/public/data/wildfire-hazard/fhsz-supported-markets-2025.1-r2.geojson
apps/web/public/data/wildfire-hazard/manifest.json
```

The public schema version 2 manifest describes the successor artifact and all
six typed coverage targets. The React artifact URL remains on the retained
five-city file until Block 25.5 changes the runtime reference and completes
browser acceptance.

The manifest contains source and artifact checksums, versions, attribution,
designation evidence, coverage-target status, per-target and combined category
counts, bounds, size measurements, repair metrics, and disclosures. Do not edit
generated output by hand.

## Source Refresh

A refresh is a reviewed maintainer operation:

1. Recheck the OSFM source page and all designation records.
2. Download the new complete inputs outside ordinary CI.
3. Review metadata, fields, CRS, license, and target-city boundaries.
4. Generate and inspect reviewed boundary snapshots when needed.
5. Update `config.json` versions and checksums intentionally.
6. Run fixture tests and two identical offline staging builds.
7. Compare manifest counts, bounds, areas, sizes, and checksums in review.
8. Complete browser visual and performance verification before deployment.

Source refreshes must not be automated from a moving provider endpoint.
