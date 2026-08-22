# Block 19 Wildfire Hazard Overlay Knowledge Base

## Purpose

Block 19 adds an optional official Fire Hazard Severity Zone overlay to the
existing listings map. This file is the implementation planning record. Blocks
19.0 through 19.5 are complete. Block 19.5 combined automated, build,
performance, and official-source checks with user-verified desktop and mobile
browser acceptance.

## Feasibility

The feature is feasible with the existing `maplibre-gl` driver:

- hazard data is polygon or multipolygon geometry that MapLibre can render
- a categorical expression can map the three official severities to red fills
- layer insertion can keep polygons below the existing listing circle layer
- `fill-opacity` preserves basemap labels and streets
- the current white listing-marker stroke maintains point contrast
- visibility can be toggled without recreating the map

The hard part is not drawing polygons. It is maintaining authoritative source
provenance, controlling payload size, representing SRA/LRA status honestly, and
keeping an overlay failure isolated from the listings workflow.

## Terminology and disclosure

Use:

- `Fire Hazard Severity Zone`
- `Moderate`
- `High`
- `Very High`
- `Wildfire hazard zones` for the control label

Do not use:

- `wildfire risk score`
- `fireline level`
- `safe`, `unsafe`, or `no risk`
- `insurance zone`
- real-time fire, evacuation, or incident language

The overlay describes mapped hazard conditions. It does not account for home
hardening, defensible space, recent mitigation, current weather, active fire,
individual property construction, loss probability, insurance availability,
or local emergency instructions.

## Official data baseline

Block 19.1 began from the official CAL FIRE / OSFM page and rechecked it on the
day of acquisition. The audit on 2026-08-21 found:

- SRA dataset `FHSZSRA_23_3`, effective April 1, 2024
- LRA combined dataset `FHSZLRA25_1`, released as 2025 recommendations across
  phases 1 through 4
- official severity classes `Moderate`, `High`, and `Very High`
- official guidance that FHSZ evaluates hazard rather than risk
- an LRA `NonWildland` category that is not a severity and must be excluded

Target coverage includes Chino, Chino Hills, Eastvale, Corona, and Jurupa
Valley. Chino, Chino Hills, Corona, and Jurupa Valley have verified local
adoption records. Eastvale remains `recommended` because the official city
record found during the audit documents a proposal review but not final
adoption. An OSFM recommendation may be displayed only when the UI and
provenance manifest say `recommended`; it must not be presented as a locally
adopted designation without a verified local source.

The source archives, checksums, jurisdiction evidence, measurements, and known
limitations are recorded in the
[Block 19.1 Wildfire Hazard Source Audit](../data/wildfire-hazard-source-audit.md).

## Data artifact strategy

The selected runtime is a same-origin GeoJSON artifact produced from the
official downloads and loaded only after first use. The source archives
themselves are not web assets and are not committed merely to begin
implementation.

The deterministic preparation pipeline must:

1. Record canonical URLs, metadata, acquisition timestamp, and source hashes.
2. Extract only the required polygon layers.
3. Normalize severity and responsibility-area fields through an allowlist and
   exclude `NonWildland`.
4. Reproject to EPSG:4326 with longitude first.
5. Repair only transformations explicitly supported by the selected GIS tool;
   do not silently discard invalid features.
6. Clip to a documented Southern California product envelope that covers the
   five target cities and the map's expected nearby context.
7. Simplify topology conservatively for screen display while preserving holes
   and category boundaries.
8. Emit deterministic feature order, minimal properties, provenance manifest,
   and output checksum.
9. Compare feature counts and area summaries before and after transformation.

### As-built pipeline

Block 19.2 implements the maintainer-only builder in
`tools/wildfire-hazard`. It uses:

- Node.js `24.19.0`
- GDAL `3.13.2` in a pinned multi-platform OCI image
- checksum-pinned LRA and SRA archives in an ignored local cache
- a tracked 558,149-byte five-city boundary snapshot derived from the reviewed
  CAL FIRE incorporated-city export
- a Docker container with networking disabled during every GIS operation

The pipeline hard clips each responsibility-area layer to Chino, Chino Hills,
Corona, Eastvale, and Jurupa Valley. It extracts polygonal components, applies
GDAL `ST_MakeValid` explicitly, converts to EPSG:4326, rounds to seven decimal
places, and then lets the Node artifact layer validate, sort, budget, and hash
the result. It never skips invalid features.

The production manifest records source and artifact checksums, source byte
counts, licenses, attribution, target-city designation evidence, feature and
coordinate counts, bounds, geometry repairs, area reconciliation, and transfer
budgets. The build atomically publishes the GeoJSON and manifest under
`apps/web/public/data/wildfire-hazard`.

### Format gate

Block 19.1 measured a conservative, unsimplified spatial-selection prototype:

- 207 features and 138,701 coordinate positions
- 3,615,513 bytes raw
- 976,807 bytes at gzip level 9
- 7.942 ms Node.js 24.19.0 JSON parse mean across 50 runs
- 14.066 ms mean across 10 runs to construct the installed client tiler and
  request a representative z8 tile

The official-service query returned whole intersecting features, so Block 19.2
hard clips the release artifact to the union of the five incorporated-city
boundaries. The reproducible output contains:

- 85 features and 35,512 coordinate positions
- 933,093 bytes raw
- 234,976 bytes at gzip level 9
- 28 `Moderate`, 27 `High`, and 30 `Very High` features
- 18 SRA/effective, 56 LRA/locally-adopted, and 11 LRA/recommended features
- 8 excluded `NonWildland` features
- one repaired source self-intersection and zero invalid output geometries

Two consecutive builds produced SHA-256
`d02baebe5e5b1ddaab3b81c0fcff4e973c3cd363b645432712e9609d15e1863f`.

Use GeoJSON only when all are true:

- the entire state is not included
- gzip transfer size is at most 2 MiB
- uncompressed data is at most 10 MiB
- parsing and source installation do not produce a visibly stalled UI on the
  supported desktop and mobile test profiles
- boundary simplification remains visually faithful at supported zooms

GeoJSON is selected for Block 19.2. If the reproducible archive-based artifact
or Block 19.5 browser verification fails any condition, use a maintained
MapLibre-compatible tiled artifact instead of increasing the budgets.

CI uses a small deterministic fixture and never downloads the official source.
A source refresh is an explicit maintainer operation with reviewable hashes and
derived-output diff statistics.

## Browser contract

The web artifact contains only:

```ts
type WildfireHazardSeverity = "moderate" | "high" | "very-high";
type ResponsibilityArea = "sra" | "lra";
type DesignationStatus = "effective" | "recommended" | "locally-adopted";
```

Every feature contains `severity`, `responsibilityArea`,
`designationStatus`, and `sourceVersion`. The renderer rejects unknown values
and unsupported geometry. Source metadata for attribution is loaded with the
artifact or a paired manifest; listing DTOs remain unchanged.

No browser call reaches RentCast, PostgreSQL, CAL FIRE ArcGIS services, or AWS
credentials. The overlay uses the same application origin as the React build.

## Map driver design

Block 19.3 extends the injected map driver rather than letting React manipulate
MapLibre objects directly. Its responsibilities are:

- install the hazard source once after successful lazy loading
- create one fill layer and bounded boundary layers
- place all hazard layers below the existing `stored-listing-points` layer
- set visibility without rebuilding the map
- preserve listing selection, fit, draft-marker, and map-error behavior
- abort requests and remove installed overlay resources on unmount

Proposed stable IDs:

```text
cpi-wildfire-hazard-source
cpi-wildfire-hazard-fill
cpi-wildfire-hazard-outline-moderate
cpi-wildfire-hazard-outline-high
cpi-wildfire-hazard-outline-very-high
```

The implementation lives in `apps/web/src/wildfireHazardOverlay.ts`. The
driver exposes `setWildfireHazardVisible(boolean)` and does not call it by
default, so Block 19.3 causes no request or visual change on page load. First
enable fetches the versioned same-origin
`/data/wildfire-hazard/fhsz-five-cities-2025.1.geojson` artifact, validates the
complete collection, installs all four layers hidden, and then changes their
visibility together. A successful disable/enable cycle reuses the installed
source and layers.

The controller state machine is `idle`, `loading`, `ready`, and `error`, with
visibility represented separately in the ready state. Unsupported severity,
responsibility area, designation status, geometry, coordinates, network
failure, or partial MapLibre installation produces a bounded overlay error.
Partial source/layer installation is rolled back. Destroy aborts a pending
request and removes installed overlay resources before the map is removed.

The fill expression uses red depth plus bounded opacity. Boundary tone and
weight may also increase with severity so the distinction is not encoded only
by fill color. Listing points and the draggable draft marker remain above the
overlay and interactive.

## User interface

Block 19.4 places a compact binary toggle in the map tool surface:

```text
[toggle] Wildfire hazard zones
```

Implemented behavior:

- default off
- first enable starts lazy loading
- loading state is visible without blocking the map
- success displays the overlay, legend, source, version, and designation status
- disable hides layers and legend but keeps loaded data for the current page
- failure displays `Hazard layer unavailable` with retry and leaves listing
  map interactions intact
- keyboard, focus, and screen-reader behavior are covered by automated tests
- responsive desktop/mobile CSS and screenshot acceptance passed in Block 19.5

The control uses a native checkbox with `role="switch"` and remains absent
until the base map is ready. The collapsed surface is 42 pixels high. Its
expanded legend is constrained to the upper-left map area, leaving room for
MapLibre navigation in the upper-right, attribution in the lower-right, and
draft-marker controls at the bottom. The mobile width reserves 64 pixels on
the right and bounds the expanded height above the draft controls.

The manifest and GeoJSON load concurrently on first enable. The overlay is not
installed unless both pass validation. The UI receives only reviewed browser
metadata: artifact version, snapshot timestamp, canonical HTTPS source,
LRA/SRA source versions, and the five jurisdiction statuses. It does not expose
source download URLs, checksums, or toolchain details in component state.

The legend lists `Moderate`, `High`, and `Very High` with matching swatches.
It also states that blank map areas are not proof of no hazard. On narrow
screens it must not cover the map's navigation control, draft-marker control,
listing markers, or the mobile list/map switch.

## Color and layer acceptance criteria

Initial values:

| Severity | Fill | Opacity |
| --- | --- | --- |
| Moderate | `#f8b4ad` | `0.16` |
| High | `#e85d55` | `0.22` |
| Very High | `#a61b1b` | `0.28` |

Acceptance requires:

- red depth increases monotonically with severity
- no fill opacity exceeds `0.30`
- basemap roads, labels, and boundaries remain legible
- normal and selected listing circles remain visually dominant
- white listing strokes remain visible over `Very High`
- controls and legend do not overlap on supported viewports
- disabled state leaves the map visually identical to the current product

Block 19.5 accepted these exact colors without increasing opacity.

## Failure and freshness behavior

Overlay failures are independent from map failures. A bad artifact, failed
fetch, unsupported severity, or source-installation problem:

- hides all hazard layers
- reports one bounded overlay error
- does not remove listing points
- does not reset selected listing or draft-marker state
- does not show partial severity categories

The attribution surface shows the artifact version and effective or
recommendation date. The application does not claim live updates. Source
refresh cadence is explicit and does not occur automatically during browser
startup or CI.

## Test plan

### Data pipeline

- source checksum and provenance manifest
- exact severity allowlist
- polygon and multipolygon support
- finite coordinate and longitude/latitude order checks
- deterministic feature ordering and output checksum
- invalid geometry and unknown-field rejection
- before/after feature-count and area-summary reconciliation
- format-budget enforcement

### Map driver

- source installed once
- hazard layers inserted before `stored-listing-points`
- severity expression and opacity values
- default hidden visibility
- repeated toggle does not duplicate source or layers
- listing selection and draft marker continue to work
- overlay error does not invoke the global map-error callback
- cleanup aborts pending load and removes installed overlay resources

### React UI

- toggle, loading, ready, off, error, and retry states
- legend labels and source attribution
- keyboard and screen-reader behavior
- mobile list/map mode and control placement
- no fetch before first enable
- no refetch after successful disable/enable in the same mount

### Verification

- CI uses fixtures and makes no official-provider or AWS call
- production build contains no credentials or absolute local paths
- desktop and mobile screenshots verify transparency, layer order, legend, and
  non-overlap
- known sample locations in each available severity class are compared with the
  official viewer
- target-jurisdiction source status is reviewed before completion

## Block 19.5 verification record

Block 19.5 was executed on 2026-08-21 without AWS deployment, production
credentials, RentCast calls, or database access.

### Automated and production-build checks

- `pnpm wildfire:data:test`: 2 files and 9 tests passed
- `pnpm test`: 83 files and 626 tests passed
- `pnpm typecheck`: passed for runtime and AWS infrastructure projects
- `pnpm build`: passed, including the Vite production build and AWS TypeScript
  build
- the existing Vite warning for a JavaScript chunk above 500 kB remains; no
  new build error was introduced
- the production directory scan found no common credential names, AWS access
  key pattern, or `/Users/` absolute path
- the published and production GeoJSON SHA-256 both equal
  `d02baebe5e5b1ddaab3b81c0fcff4e973c3cd363b645432712e9609d15e1863f`

The production artifact remains 933,093 bytes raw, 234,976 bytes with gzip
level 9, and 124,956 bytes with Brotli quality 11. It therefore remains below
the 10 MiB raw and 2 MiB gzip gates. Vite preview serves it from the expected
same-origin path with `application/geo+json`; the paired manifest is served as
`application/json`.

### Local performance evidence

A 25-run local production-preview measurement on Node.js 24.19.0 produced:

| Stage | Mean | p95 | Maximum |
| --- | ---: | ---: | ---: |
| HTTP response headers | 2.670 ms | 3.303 ms | 25.546 ms |
| Response body read | 0.808 ms | 1.874 ms | 1.892 ms |
| `JSON.parse` | 1.996 ms | 2.621 ms | 3.137 ms |

The maximum response-header time was the first request. A separate 30-run
measurement with the same `@maplibre/geojson-vt` implementation used by
MapLibre produced:

| Stage | Mean | p95 | Maximum |
| --- | ---: | ---: | ---: |
| Source index construction | 2.280 ms | 5.273 ms | 8.175 ms |
| Seven representative tiles, z8 through z14 | 3.523 ms | 5.734 ms | 9.336 ms |

These measurements support the GeoJSON format decision and were paired with
manual browser observation of visible stalls, pan, zoom, and paint work.

### Official point comparison

Representative interior points were derived from the published polygons and
queried against the current CAL FIRE LRA feature layer. Each official response
matched the published severity and responsibility area:

| Published severity | Longitude | Latitude | Official response |
| --- | ---: | ---: | --- |
| Moderate | -117.46685073 | 33.984651805 | `FHSZ=1`, `Moderate`, `LRA` |
| High | -117.671529995 | 33.949015935 | `FHSZ=2`, `High`, `LRA` |
| Very High | -117.676467185 | 33.87774064 | `FHSZ=3`, `Very High`, `LRA` |

The current OSFM page still defines exactly `Moderate`, `High`, and `Very High`
and continues to distinguish hazard from risk. The current CAL FIRE
jurisdiction layer returns Chino, Chino Hills, Corona, Eastvale, and Jurupa
Valley as qualifying incorporated cities. Current local records continue to
support local adoption for Chino, Chino Hills, Corona, and Jurupa Valley. No
final Eastvale adoption record was found during the recheck, so Eastvale
correctly remains `recommended` in the artifact and UI.

### Manual browser acceptance

The Codex app displayed the local Browser tab, but its browser-control runtime
repeatedly returned no available instance, including after the tab and desktop
app were restarted. No standalone Playwright or unrelated browser surface was
used as a substitute. The user therefore started the real local API and React
application and completed the browser checklist directly on 2026-08-21. The
user confirmed that every acceptance criterion passed and supplied a desktop
screenshot of the enabled production-sized map surface.

- off state made no wildfire artifact request
- first enable loaded only the manifest and versioned GeoJSON
- successful same-mount disable and re-enable did not refetch the GeoJSON
- basemap roads, boundaries, and labels remained legible across all severities
- normal and selected listing points, including white strokes, remained above
  and visually stronger than the polygon fills
- legend, navigation, attribution, and the mobile list/map switch did not
  overlap at the tested desktop and 390 by 844 mobile viewports
- pan and zoom remained smooth with no visible first-enable stall
- version, snapshot, jurisdiction status, blank-area disclosure, and official
  CAL FIRE / OSFM link rendered correctly

The screenshot and user attestation provide the direct browser evidence that
the unavailable control runtime could not capture. Block 19.5 and Block 19 are
complete.

## Out of scope

- active wildfire perimeters or incidents
- evacuation zones or alerts
- parcel-level hazard certification
- insurance, appraisal, lending, legal, or disclosure advice
- listing filtering or ranking by hazard
- storing a hazard value on a listing
- PostGIS and server-side point-in-polygon
- Showing List generation changes
- AWS deployment or scheduler changes

## Sub-block readiness

Blocks 19.0 through 19.5 are complete. Block 19.2 produced the reproducible
builder, fixture tests, controlled city-boundary snapshot, versioned GeoJSON,
and provenance manifest. Block 19.3 added the lazy, validated MapLibre driver
controller, stable layer ordering, bounded failure rollback, and cleanup.
Block 19.4 added the accessible switch, atomic metadata loading, bounded UI
states, responsive legend, reviewed attribution, and disclosure text. Block
19.5 passed automated regression, production build, performance, official
source, desktop, mobile, interaction, and request-lifecycle acceptance.

## References

- [CAL FIRE / OSFM Fire Hazard Severity Zones](https://osfm.fire.ca.gov/what-we-do/community-wildfire-preparedness-and-mitigation/fire-hazard-severity-zones)
- [California Open Data Fire Hazard Severity Zone Viewer](https://lab.data.ca.gov/dataset/fire-hazard-severity-zone-viewer)
- [Block 19.1 Wildfire Hazard Source Audit](../data/wildfire-hazard-source-audit.md)
- [Wildfire Hazard Data Builder](../../tools/wildfire-hazard/README.md)
- [ADR 0001: Persistence Direction](../adr/0001-persistence-direction.md)
- [ADR 0003: API, Web, and Map Foundation](../adr/0003-api-web-map-foundation.md)
- [ADR 0007: Wildfire Hazard Overlay](../adr/0007-wildfire-hazard-overlay.md)
