# ADR 0007: Wildfire Hazard Overlay

## Status

Accepted. Block 19.0 established the product and architecture constraints, and
Block 19.1 completed the official-source audit and selected a GeoJSON runtime
artifact. No application code, database object, or AWS resource has been added.

## Context

The listings workspace already renders normalized listing points in MapLibre on
an OpenFreeMap basemap. The next map feature should let the administrator turn
on official California Fire Hazard Severity Zone polygons and compare their
spatial pattern with stored listing locations.

The Office of the State Fire Marshal classifies Fire Hazard Severity Zones as:

- `Moderate`
- `High`
- `Very High`

The official guidance distinguishes hazard from risk. Hazard describes the
physical conditions that affect fire likelihood and expected fire behavior
over a 30- to 50-year period without accounting for mitigation. It is not a
real-time fire feed, a property-loss estimate, an evacuation instruction, or an
insurance determination.

The current official source boundary is not one interchangeable statewide
layer:

- SRA zones became effective April 1, 2024.
- The Office released 2025 LRA recommendations in four phases.
- Local jurisdictions may adopt or modify LRA recommendations, so a displayed
  LRA polygon must identify whether it is an OSFM recommendation or a verified
  locally adopted source.

The first implementation is a display overlay. It does not require a server-side
point-in-polygon query and therefore does not yet justify enabling PostGIS.

## Decision

### Product semantics

Expose one binary map control labeled `Wildfire hazard zones`. It changes only
overlay visibility and never removes, ranks, or mutates listings. The overlay
is off by default and is loaded lazily on first use.

Use official severity labels without inventing numeric scores. Do not call the
feature `wildfire risk`, `fireline level`, `safe area`, or `insurance zone`.

### Source and publication boundary

Use CAL FIRE / OSFM authoritative SRA and LRA data. Block 19.1 must recheck the
official source immediately before acquisition and record:

- source organization and canonical URL
- dataset title and version
- effective or recommendation date
- SRA or LRA responsibility
- recommendation or adopted status
- source spatial reference and normalized output spatial reference
- acquisition time and source-file checksum
- transformation tool versions and output checksum

Do not make the browser query an ArcGIS FeatureServer at runtime. Instead,
produce a versioned, same-origin static artifact clipped to the bounded product
coverage area. This avoids runtime CORS, provider availability, schema drift,
rate-limit, and credential questions and fits the future private S3 plus
CloudFront web origin.

Block 19.1 selected one normalized GeoJSON artifact after measuring official
geometry for the product area. The conservative, unsimplified prototype is
3,615,513 bytes raw and 976,807 bytes at gzip level 9, below the 10 MiB raw and
2 MiB compressed limits. Node.js 24.19.0 parsed it in a 7.942 ms 50-run mean;
the installed MapLibre tiling dependency created its source and a
representative z8 tile in a 14.066 ms 10-run mean.

Block 19.2 must build the release artifact from checksum-pinned CAL FIRE / OSFM
archives, hard clip it to the product boundary, and emit a provenance manifest.
The ArcGIS services used to validate the audit are not runtime or build
dependencies. A maintained MapLibre-compatible tiled artifact remains the
fallback if the reproducible artifact exceeds either size limit or Block 19.5
finds a visible browser stall. Never ship the whole-state source dataset to the
browser.

The derived artifact must preserve source attribution and license notices. It
must not silently merge polygons with conflicting jurisdictional status.

The LRA source also contains `NonWildland`. That value is not an additional
hazard severity and must be excluded through a positive category allowlist.
Chino, Chino Hills, Corona, and Jurupa Valley have verified local adoption
records. Eastvale remains `recommended` until a current adopted ordinance and
map are verified; qualifying status or a proposed ordinance is insufficient to
label its features `locally-adopted`.

### Geometry contract

The browser-facing features use WGS84 longitude/latitude and a minimal schema:

```ts
type WildfireHazardSeverity = "moderate" | "high" | "very-high";

interface WildfireHazardProperties {
  severity: WildfireHazardSeverity;
  responsibilityArea: "sra" | "lra";
  designationStatus: "effective" | "recommended" | "locally-adopted";
  sourceVersion: string;
}
```

Only `Polygon` and `MultiPolygon` geometry is accepted. Missing, unknown, or
conflicting severity values fail the data build rather than being displayed as
a guessed category. Geometry conversion must preserve polygon holes, enforce
finite coordinates, and produce deterministic output.

### Map composition and visual hierarchy

Keep the existing listing source and circle layer authoritative. Add the hazard
layers after the basemap loads and before `cpi-listings`:

```text
OpenFreeMap basemap
Fire Hazard Severity Zone fills
Fire Hazard Severity Zone boundaries
Listing circles with white strokes
Draft marker and map controls
```

The proposed light-basemap palette is:

| Severity | Fill | Fill opacity | Boundary |
| --- | --- | --- | --- |
| Moderate | `#f8b4ad` | `0.16` | `#d9776d` |
| High | `#e85d55` | `0.22` | `#c43c32` |
| Very High | `#a61b1b` | `0.28` | `#7f1d1d` |

No fill opacity may exceed `0.30` in the initial design. Listing circles remain
above every polygon and retain their white stroke. Block 19.5 must verify the
actual palette against the OpenFreeMap Liberty style on desktop and mobile;
the values are constraints to test, not permission to skip visual review.

Show a compact labeled legend only while the overlay is enabled. Areas without
a polygon must not be labeled `safe` or `no hazard`; they may be outside the
mapped zone or unavailable in the selected source.

### State and failure behavior

The map control owns four bounded states:

- `off`: no artifact request and no visible hazard layers
- `loading`: map and listings remain interactive
- `ready`: layers and attribution are visible
- `error`: hazard layers remain hidden and an inline retry is available

After the first successful load, toggling changes MapLibre layer visibility
instead of rebuilding the map or refetching data. A hazard failure must not
transition the base map into its existing global `Map unavailable` state.

### Security and privacy

The artifact is public-source reference data and contains no listing, client,
agent, credential, or session data. It is fetched from the application's own
origin and needs no browser secret or new CORS policy. The source URL and data
version may be shown; checksums and transformation logs remain build metadata.

### Deferred server-side analysis

Do not add PostGIS, a hazard API, listing hazard fields, database joins,
valuation effects, insurance conclusions, or Showing List hazard language in
Block 19. A later point-in-polygon use case must define boundary semantics,
dataset refresh, conflict handling, disclosures, and tests independently.

## Consequences

- The overlay can be implemented with the existing React and MapLibre stack.
- Listing points remain readable because polygons are transparent and lower in
  layer order.
- Static same-origin publication improves reproducibility and avoids a live
  ArcGIS dependency.
- The repository needs a documented update process when official maps change.
- LRA recommendation/adoption status remains visible instead of being flattened
  into a misleading statewide certainty.
- GeoJSON is the accepted initial format because measured official geometry
  passes both hard size limits with margin; browser behavior remains a release
  gate rather than an assumption.
- A display overlay cannot answer whether a listing is definitively inside a
  zone; that requires a separately reviewed spatial-query feature.

## References

- [CAL FIRE / OSFM Fire Hazard Severity Zones](https://osfm.fire.ca.gov/what-we-do/community-wildfire-preparedness-and-mitigation/fire-hazard-severity-zones)
- [California Open Data Fire Hazard Severity Zone Viewer](https://lab.data.ca.gov/dataset/fire-hazard-severity-zone-viewer)
- [MapLibre GL JS GeoJSON source example](https://maplibre.org/maplibre-gl-js/docs/examples/geojson-line/)
- [Block 19.1 Wildfire Hazard Source Audit](../data/wildfire-hazard-source-audit.md)
