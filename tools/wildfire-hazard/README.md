# Wildfire Hazard Data Builder

## Purpose

This maintainer-only tool creates the browser-facing Fire Hazard Severity Zone
GeoJSON used by Block 19. It is not part of the React or API runtime. Ordinary
CI runs only the deterministic fixture tests and does not download official
data or start Docker.

## Commands

```bash
pnpm wildfire:data:test
pnpm wildfire:data:build
```

The production build requires:

- Node.js `24.19.0`
- a running Docker service
- network access only when a checksum-pinned OSFM archive is absent from the
  local cache

GDAL runs in the pinned multi-platform image recorded in `config.json`. The
container starts with `--network=none` and can access only
`.cache/wildfire-hazard` through its bind mount.

## Inputs

`config.json` is the reviewed source allowlist. It records canonical and
download URLs, versions, byte limits, SHA-256 checksums, licenses, attribution,
target jurisdictions, and local-adoption evidence.

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

## Pipeline

The build performs these bounded stages:

1. Verify every source checksum and byte limit.
2. Confirm exactly one boundary for each target jurisdiction.
3. Use GDAL to clip LRA and SRA polygons to each incorporated-city boundary.
4. Extract only polygonal components created by clipping.
5. Apply GDAL `ST_MakeValid` explicitly and record repair counts and area
   drift; do not skip invalid features.
6. Normalize only `Moderate`, `High`, and `Very High`; exclude `NonWildland`.
7. Reproject to EPSG:4326, round to seven decimal places, and preserve holes.
8. Sort features deterministically and emit the minimal browser properties.
9. Reconcile per-severity feature counts, validity, and EPSG:3310 area before
   and after normalization.
10. Enforce the 10 MiB raw and 2 MiB gzip artifact budgets.

Any unknown severity, source mismatch, invalid output geometry, feature-count
change, area drift over `0.001`, or size-budget failure stops publication.

## Outputs

Successful builds atomically replace only:

```text
apps/web/public/data/wildfire-hazard/fhsz-five-cities-2025.1.geojson
apps/web/public/data/wildfire-hazard/manifest.json
```

The manifest contains source and artifact checksums, versions, attribution,
designation evidence, jurisdiction status, category counts, bounds, size
measurements, repair metrics, and disclosures. Do not edit either output by
hand.

## Source Refresh

A refresh is a reviewed maintainer operation:

1. Recheck the OSFM source page and all five local-adoption records.
2. Download the new complete inputs outside ordinary CI.
3. Review metadata, fields, CRS, license, and target-city boundaries.
4. Generate and inspect a new five-city boundary snapshot when needed.
5. Update `config.json` versions and checksums intentionally.
6. Run fixture tests and two identical production builds.
7. Compare manifest counts, bounds, areas, sizes, and checksums in review.
8. Complete browser visual and performance verification before deployment.

Source refreshes must not be automated from a moving provider endpoint.
