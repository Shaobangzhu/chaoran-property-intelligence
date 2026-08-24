# Block 22: ArcGIS Map-Engine Migration

## Status

Blocks 22.0 through 22.5 are complete. The parity contract, target adapter
architecture, security boundary, implementation sequence, rollback strategy,
and acceptance gates are frozen. Exact ArcGIS 5.1 dependencies, strict scoped
basemap-key configuration, a component-registration runtime entry, React 19
types, an engine-neutral map port, the ArcGIS listing-map adapter, manual draft
parity, CAL FIRE ArcGIS renderer, and offline tests are present. ArcGIS is now
the only production map engine. The browser entry registers its components,
while the reusable runtime and driver remain independently testable.

Block 22.6 remains planned and separately confirmed. The work is
isolated on `refactor/arcgis-migration`; the owner will merge it into `main`
only after the final acceptance gate. Block 22.5 made no backend call, database
operation, deployment, or AWS operation.

## Objective

Replace the browser map implementation from MapLibre GL JS plus OpenFreeMap to
ArcGIS Maps SDK for JavaScript while preserving the current application.

Success means feature parity, not a new design:

- same authenticated Listings workspace and responsive list/map composition
- same React ownership of application state
- same listing records, stable IDs, API calls, and selection behavior
- same viewport fit/focus behavior
- same manual-listing map placement, dragging, confirmation, and editing flow
- same CAL FIRE artifact, data semantics, control, legend, disclosure, palette,
  lazy loading, failure isolation, and retry behavior
- same bounded map loading, ready, unavailable, retry, resize, and teardown
  states

The backend, database, worker, provider, alert, Showing List, authentication,
and AWS architectures do not change in Block 22.

## Explicit Non-Goals

Block 22 does not add:

- ArcGIS Online or Enterprise user sign-in
- web maps, portal items, hosted feature layers, or an ArcGIS FeatureServer
- geocoding, routing, search, popups, clustering, heatmaps, 3D scenes, or WebGL
  effects
- server-side spatial analysis, PostGIS, or stored hazard classifications
- new listing filters, data fields, API routes, or database migrations
- a new map layout, visual redesign, basemap selector, or ArcGIS widget suite
- a permanent MapLibre/ArcGIS feature flag or dual-engine production bundle
- deployment, DNS, CloudFront, App Runner, Aurora, Scheduler, RentCast, or
  Telegram operations

Any of those requires a separately named and reviewed block.

## Frozen Current-State Inventory

### React and driver boundary

`apps/web/src/ListingsMap.tsx` already isolates the map engine behind an
injected `CreateListingsMap` factory and `ListingsMapDriver`. React owns map
status, selection, retries, wildfire visibility, draft state references, and
resize observation. That boundary is retained.

The current driver supports:

- `updateListings`
- `fitToListings`
- `focusListing`
- `updateDraftMarker`
- `setWildfireHazardVisible`
- `resize`
- `destroy`

### Current visual and interaction values

The migration preserves these reviewed values and behaviors:

| Capability | Current contract | ArcGIS parity target |
| --- | --- | --- |
| Initial view | center `[-117.58, 33.94]`, zoom `10` | same |
| Basemap | OpenFreeMap Liberty | `arcgis/navigation`, comparable light road hierarchy |
| Navigation | zoom, top-right, no compass | ArcGIS zoom component, same placement |
| Listing marker | teal `#0d6e6e`, 7 px radius, white 2 px outline | same symbol |
| Selected marker | rust `#a24f2a`, 9 px radius, white 2 px outline | same symbol |
| One-listing fit | zoom `12.5`, no animation | equivalent viewpoint |
| Multi-listing fit | 56 px padding, maximum zoom `13`, no animation | equivalent extent constraints |
| Focus | selected point, at least zoom `12.5`, 450 ms | equivalent animated go-to |
| Listing hit | select card/listing and show pointer | layer-scoped hit test |
| Empty map click | place draft only in draft mode | same |
| Draft drag | update longitude/latitude callback | same |
| Confirmed draft | retain rust marker with confirmed visual state | same |
| Hazard order | polygons below listings and draft | same |
| Attribution | visible provider attribution | visible ArcGIS attribution |

The basemap itself is not expected to be pixel identical. Label legibility,
listing contrast, hazard transparency, control placement, and workflow behavior
are the acceptance criteria.

### CAL FIRE contract

The migration keeps:

- `/data/wildfire-hazard/fhsz-five-cities-2025.1.geojson`
- the tracked provenance metadata and canonical CAL FIRE / OSFM attribution
- only `Polygon` and `MultiPolygon` geometry in WGS84
- strict ring, finite-coordinate, property, and severity validation
- `moderate`, `high`, and `very-high` categories
- current fill colors and opacities `0.16`, `0.22`, and `0.28`
- current outline colors, widths, and opacity hierarchy
- no artifact request while disabled
- one artifact/metadata load after first successful enable
- toggle by visibility after load
- bounded overlay-only error and retry without breaking the base map
- abort, rollback, and cleanup on retry or unmount

Blank areas remain undisclosed as safe. No hazard-to-listing classification is
added.

## Target Architecture

```text
ListingsScreen / manual-listing workflow / WildfireHazardControl
                            |
                    ListingsMap React shell
                            |
                 ListingsMapDriver interface
                            |
                   ArcGIS driver adapter
        +-------------------+-------------------+
        |                   |                   |
  arcgis-map host     GraphicsLayers      GeoJSONLayer
  navigation basemap  listings + draft    CAL FIRE polygons
```

The adapter creates the ArcGIS component inside the existing container. It
waits for the component's ready event before installing layers and transitioning
the React shell to ready. The rest of the application receives no ArcGIS type.

### SDK integration

Use exact compatible 5.1 package versions rather than floating ranges:

- `@arcgis/map-components`
- `@arcgis/core`
- the compatible `@esri/calcite-components` peer when required

Use ArcGIS map components for view/UI lifecycle and core API modules for
`Map`, `GraphicsLayer`, `GeoJSONLayer`, graphics, symbols, renderers, extents,
and reactive utilities. Register only the components the application uses.

React 19 custom component events use the lowercase ArcGIS event property names
documented by Esri. Avoid a generic wrapper library unless the official
component integration proves insufficient.

### Listing graphics

Use one `GraphicsLayer` for stored listings. Reconcile graphics by stable
listing ID so price or selection changes do not recreate the entire map or
change React identity. Attributes contain only data required for hit testing;
the map does not become an alternate listing store.

Disable popups. Scope hit testing to the listing layer. A listing hit selects
the same React item and suppresses draft placement for that click. Pointer
feedback is active only over a listing graphic.

### Draft graphics

Use a separate topmost `GraphicsLayer` for one draft point. Background click
uses the ArcGIS view's map point and forwards longitude/latitude through the
existing callback. Pointer drag begins only after the draft graphic is hit,
updates its geometry without panning the view, and emits bounded coordinates.

Confirmed and editable states preserve the existing visual distinction and
crosshair behavior. No Sketch widget or ArcGIS editing state is exposed to the
user.

### Hazard polygons

Preserve the existing source validation before ArcGIS receives the data. After
validation:

1. Serialize the validated `FeatureCollection`.
2. Create a Blob and object URL.
3. Construct a `GeoJSONLayer` from that URL.
4. Apply a `UniqueValueRenderer` on `severity` with the current
   `SimpleFillSymbol` colors, opacity, and outlines.
5. Insert the layer below stored listings and the draft layer.
6. Revoke the object URL during rollback or destroy.

This design avoids a second network fetch and keeps malformed or unreviewed
data out of the renderer. It does not replace the static artifact with an
ArcGIS-hosted dataset.

## Configuration and Security

### Browser API key

The web app reads:

```text
VITE_ARCGIS_API_KEY
```

`.env.example` contains only a blank placeholder. `.env.local` is ignored and
contains a nonempty developer value for later manual browser acceptance. The
Block 22.0 safety check inspected only presence and length; no key value was
printed or written to documentation.

Configure `esriConfig.apiKeys.basemapStyles` before creating the map. The key is
limited to required basemap privileges and restricted by referrer to approved
origins, including the exact local development origin and eventual production
origin. Do not use `*` referrers.

Because `VITE_*` values are compiled into browser assets, the key is visible to
clients by design. Security comes from least privilege, referrer restrictions,
rotation, and monitoring, not from pretending the static value is secret.

Tests and builds use dependency injection or fakes and require no real key. A
missing or invalid runtime value must produce the existing bounded map error
without exposing credentials.

### CSP and network audit

At cutover:

- remove `https://tiles.openfreemap.org` from `connect-src`
- add only ArcGIS asset and basemap origins observed and required by 5.1
- add `'wasm-unsafe-eval'` to `script-src` as required by ArcGIS WebAssembly
- preserve `worker-src 'self' blob:`
- preserve the current style policy unless the selected component requires a
  documented, narrower change
- preserve same-origin API and CAL FIRE requests

The acceptance network log must show no OpenFreeMap request and no unexpected
portal, analytics, geocoding, feature-service, or authenticated application
request caused by the map adapter.

### Resource ownership

The adapter records and removes every:

- component event listener
- view event handle
- reactive watcher
- graphic and layer
- Blob URL
- component DOM node
- pending async task or abort controller

`destroy()` is idempotent. Retry creates exactly one live map host and stale
initialization cannot overwrite the newer attempt.

## Expected File Surface

The exact split can follow local code clarity, but implementation is expected
to remain within this surface:

| Area | Expected change |
| --- | --- |
| `apps/web/package.json` and `pnpm-lock.yaml` | add exact ArcGIS packages; remove MapLibre only at cutover |
| `apps/web/src/arcgisConfig.ts` | validate/configure the browser key and register required components |
| `apps/web/src/arcgisListingsMap.ts` | implement the existing driver with ArcGIS layers and lifecycle |
| `apps/web/src/ListingsMap.tsx` | retain React shell; switch injected default only after parity |
| `apps/web/src/wildfireHazardOverlay.ts` | keep validation/state machine engine-neutral |
| `apps/web/src/arcgisWildfireHazardLayer.ts` | ArcGIS GeoJSONLayer/rendering adapter if separation improves ownership |
| `apps/web/src/styles.css` | replace MapLibre-only selectors without redesigning the workspace |
| `apps/web/index.html` | least-privilege ArcGIS CSP after observed network audit |
| `apps/web/src/*.test.ts(x)` | adapter contracts, lifecycle, interaction, CSP, and regression coverage |

`listingGeoJson.ts` and the bundled MapLibre worker are removed only if no
longer referenced after cutover. No package outside `apps/web` should require an
ArcGIS dependency.

## Baseline Evidence

Before implementation, the focused map baseline passed:

```text
ListingsMap.test.tsx
wildfireHazardOverlay.test.ts
manualListingWorkflow.integration.test.tsx
securityPolicy.test.ts

4 test files, 18 tests passed
```

The production web build also passed. The recorded MapLibre baseline is:

| Asset group | Raw bytes | Gzip bytes |
| --- | ---: | ---: |
| Application JavaScript | 1,232,020 | 327,528 |
| CSS | 113,658 | 16,468 |
| MapLibre worker | 470,280 | 129,975 |
| Total | 1,815,958 | 473,971 |

Vite already reports the existing large-chunk advisory. Block 22.6 records the
ArcGIS result against this baseline and explains any material increase. The
migration does not silently increase or waive a budget.

## Implementation Sequence

### Block 22.0: Documentation and parity freeze

Complete in this change:

- capture current behavior, visual values, test baseline, and bundle baseline
- accept ADR 0010
- define security, cleanup, rollback, and merge boundaries
- make no runtime or external-service change

### Block 22.1: SDK, configuration, and security foundation

- install exact compatible ArcGIS 5.1 packages
- add a small configuration boundary for `VITE_ARCGIS_API_KEY`
- register only `arcgis-map` and `arcgis-zoom`
- create tests for valid, missing, and malformed configuration without a real
  key or network call
- prepare CSP assertions but do not remove OpenFreeMap while it is still the
  default map
- verify typecheck, focused tests, and production build

**Complete in code and offline verification:** the web package pins
`@arcgis/core@5.1.20`, `@arcgis/map-components@5.1.20`, and
`@esri/calcite-components@5.1.2`, matching the component peer ranges. React 19
uses the official custom-element types and does not install the deprecated
React wrapper. `arcgisRuntime.ts` registers only `arcgis-map` and `arcgis-zoom`
and delegates to a strict configuration boundary that writes only
`esriConfig.apiKeys.basemapStyles`. Missing, non-string, whitespace-bearing,
and overlong values fail with one credential-free error.

The workspace explicitly denies the indirect
`@vaadin/vaadin-usage-statistics` build script. Thirteen new tests, 31 focused
map/security tests, all 927 repository tests, full runtime/CDK typecheck, and
the production build pass. A credential scan found no local key in 47
source/build/configuration files. The production build still contains only the
existing MapLibre worker and OpenFreeMap CSP/network boundary; no ArcGIS runtime
module or API key is bundled. No user-visible engine cutover or ArcGIS request
occurred in 22.1.

### Block 22.2: ArcGIS listing-map driver

- create the map component and `arcgis/navigation` basemap
- implement listing graphics, selection, pointer feedback, fit, focus, resize,
  ready/error lifecycle, and idempotent destroy
- retain the existing MapLibre default while the ArcGIS adapter is tested
- use injected SDK seams or fakes so CI makes no ArcGIS request
- verify list-to-map and map-to-list selection behavior

**Complete in code and offline verification:** the application-facing map
types now live in `listingsMapDriver.ts`; `ListingsMap.tsx` re-exports the same
names, so existing consumers and React ownership remain unchanged. The new
non-default `arcgisListingsMap.ts` creates one `arcgis-map` host with the
`arcgis/navigation` basemap, the frozen initial center and zoom, visible
attribution, disabled popups, and one top-right `arcgis-zoom` component.

One `GraphicsLayer` reconciles point graphics by stable listing ID. Updates
retain existing `Graphic` instances, remove stale IDs, and apply the reviewed
14 px teal or 18 px rust circles with 2 px white outlines. Layer-scoped async
hit tests drive listing selection and pointer feedback. Monotonic click,
pointer, and navigation generations prevent stale completions from changing
selection, cursor, padding, or a newer view. Single-listing fit, multi-listing
extent fit with 56 px symmetric padding and zoom 13 cap, and 450 ms focus at a
minimum zoom of 12.5 preserve the frozen viewport contract. The component
observes host resizing, while the retained `resize()` hook keeps the port
compatible without recreating the view.

Startup failure is mapped to one credential-free adapter error. Explicit
component ownership, listener removal, layer/graphic cleanup, async guards, and
idempotent destroy prevent retry or unmount races. At the end of 22.2, draft and
CAL FIRE hooks were intentionally inert in this non-default adapter; there was
no partial user-visible cutover.

Nine new adapter tests use injected DOM components and real local ArcGIS core
geometry/graphic classes without a key or network. The five focused
map/security files pass 27 tests; the full repository passes 936 tests across
106 files, full runtime/CDK typecheck passes, and the production build passes.
The bundle audit still finds OpenFreeMap as the default and finds neither the
ArcGIS listing runtime markers nor the local API key in production JavaScript.

### Block 22.3: Manual-listing draft parity

- implement background-click placement and listing-hit suppression
- implement draft drag and coordinate updates
- preserve edit/create state, confirmation visual, and crosshair behavior
- verify create/edit integration without backend or database changes

**Complete in code and offline verification:** a second `GraphicsLayer` named
`draft-listing` is installed after the stored-listing layer and owns at most one
stable draft `Graphic`. Queued pre-ready state, coordinate changes, confirmation
changes, cancellation, and teardown reconcile that graphic without replacing
the layer. The marker is an anchored 27 x 41 px inline SVG
`PictureMarkerSymbol`; editable state is rust and confirmed state adds the
existing teal confirmation signal. The symbol has no remote image dependency.

Click hit tests remain layer-scoped. Listing hits select the existing React
record and suppress placement, draft hits suppress placement, and only a map
background hit in active draft mode forwards valid longitude/latitude through
the existing callback. Pointer state preserves listing `pointer`, draft `grab`,
active drag `grabbing`, and draft-mode background `crosshair` behavior.

Drag start uses ArcGIS event deferral to hit-test the draft before stopping
propagation. A miss leaves normal map pan untouched. A hit updates the same
graphic from screen-to-map coordinates during movement and emits one coordinate
callback on drag end, preserving React ownership of edit/create and confirmation
state. Monotonic click, pointer, and drag generations reject stale async work
after a newer event, cancel, teardown, or marker removal. Both graphics layers,
all handlers, and graphics are removed by the existing idempotent destroy path.

The ArcGIS adapter remains non-default until 22.5. No ArcGIS request, backend
call, database operation, CAL FIRE rendering change, CSP change, deployment, or
AWS operation is part of 22.3.

Fifteen adapter tests exercise draft reconciliation, layer order, marker
anchoring and confirmation, background/listing/draft hit behavior, cursor
states, draft-only drag, drag-end callbacks, map-pan preservation, stale async
completion, and cleanup. Five focused ArcGIS, React map, and manual-listing
workflow files pass 34 tests. The full repository passes 942 tests across 106
files, full runtime/CDK typecheck passes, and production builds pass. The
production JavaScript remains MapLibre/OpenFreeMap-only and contains neither
ArcGIS adapter runtime markers nor the configured local browser key.

### Block 22.4: CAL FIRE overlay parity

- separate engine-neutral validation/state from rendering if needed
- install validated GeoJSON through a Blob-backed `GeoJSONLayer`
- apply the existing severity palette through a unique-value renderer
- preserve lazy first load, no-refetch visibility toggles, metadata coupling,
  retry rollback, request abort, layer order, and disclosure UI
- verify hazard failures never make the base map unavailable

**Complete in code and offline verification:** `wildfireHazardOverlay.ts` now
separates the existing provider-neutral lifecycle from renderer ownership. The
shared lifecycle remains authoritative for concurrent artifact/metadata load,
strict validated input, `idle`/`loading`/`ready`/`error` state, desired
visibility during loading, successful one-fetch reuse, bounded retry, and
AbortController teardown. The current MapLibre adapter wraps the same source
and four layer operations in a renderer, preserving all Block 19 behavior and
tests without changing the user-visible default.

`arcgisWildfireHazardOverlay.ts` owns one layer ID and one Blob URL. Only after
both same-origin artifact and reviewed metadata loaders succeed does it
serialize the validated `FeatureCollection` as `application/geo+json`, create a
Blob URL, construct and load one popup-disabled `GeoJSONLayer`, and add it at
map index `0`. Stored-listing and draft graphics therefore remain above the
hazard polygons. ArcGIS receives no malformed or unattributed geometry and no
ArcGIS FeatureServer or hosted-data dependency was introduced.

The layer uses a `UniqueValueRenderer` on `severity` with a null default symbol.
Moderate, High, and Very High retain the accepted fill colors and opacities
`#f8b4ad`/`0.16`, `#e85d55`/`0.22`, and `#a61b1b`/`0.28`, together with their
existing severity-specific outline colors, opacity, and pixel widths. The
custom React legend, source, version, jurisdiction disclosure, and toggle UI do
not change.

Successful disable/enable changes only the ArcGIS layer's `visible` property
and performs no new fetch, Blob creation, or layer construction. Metadata
failure creates no Blob or layer. Layer load or map insertion failure destroys
partial resources, revokes the Blob URL, reports the existing bounded overlay
error, and permits a clean retry. Destroy aborts pending source work and
idempotently removes the installed layer, destroys it, and revokes its URL.

The ArcGIS driver queues visibility requested before map readiness, forwards
overlay states unchanged, and owns controller teardown. Overlay construction or
runtime failure is isolated from the base-map `onError` boundary, so listings,
selection, draft editing, and map navigation remain available.

The ArcGIS adapter remains non-default until 22.5. No real ArcGIS request,
backend call, database operation, CSP change, deployment, or AWS operation is
part of 22.4.

Seven new ArcGIS overlay tests use real local SDK layer, renderer, and symbol
objects plus injected layer-load and Blob seams. They cover exact symbology,
index-zero installation, lazy one-fetch reuse, loading-time disable, metadata
gating, load and insertion rollback, retry, Abort, layer destruction, and URL
revocation. The ArcGIS driver now has 17 tests including visibility queueing,
state forwarding, error isolation, and controller ownership. Nine focused
ArcGIS, CAL FIRE, and React files pass 74 tests. The full repository passes 951
tests across 107 files, full runtime/CDK typecheck passes, and production builds
pass.

Because the default factory is unchanged, the production build still contains
the MapLibre worker and OpenFreeMap runtime and contains no ArcGIS navigation,
`GeoJSONLayer`, or `UniqueValueRenderer` runtime marker and no configured local
browser key. The existing main JavaScript asset is 1,232.92 kB raw and 330.59
kB gzip; its existing large-chunk advisory remains for the final 22.5 cutover
and 22.6 bundle review.

### Block 22.5: Production factory cutover and cleanup

**Status: complete in code and offline verification.**

- `ListingsMap` defaults to `createArcgisListingsMap`; its injected driver port
  remains available for isolated React tests.
- `main.tsx` owns browser-only map/zoom component registration. Core runtime
  configuration no longer imports component CSS during Node tests.
- MapLibre, OpenFreeMap, the bundled worker, MapLibre-only listing GeoJSON
  helper/tests, renderer adapter, CSS selectors, dependency, and lock entries
  are removed. No dual-engine flag remains.
- Vite sets `envDir: "../.."`, making the documented root `.env.local` the
  explicit local source for `VITE_ARCGIS_API_KEY`.
- A credentialed navigation-style request using the local-development referrer
  returned HTTP 200 without printing the key. Its style document requires the
  SDK style endpoint, `basemaps-api.arcgis.com` vector tiles/glyphs, and
  `cdn.arcgis.com` sprites. CSP permits exactly these three network origins,
  adds `'wasm-unsafe-eval'` for the SDK WebAssembly runtime, and retains Blob
  worker support. It contains no OpenFreeMap origin or wildcard.
- Fifty-nine focused tests pass. The full repository passes 950 tests across
  107 files, full runtime/CDK typecheck passes, and production builds pass.
- A synthetic-key production build emits 1,090 JavaScript assets. Its main
  asset is 1,438.21 kB raw and 360.38 kB gzip, compared with the recorded
  1,232.92 kB raw and 330.59 kB gzip pre-cutover main asset. Vite emits 303
  module-preload links and retains the large-chunk advisory. The build contains
  no MapLibre/OpenFreeMap marker; the synthetic key appears only where expected
  in the browser runtime, and the real local key is absent from this artifact.
- Browser control did not expose the already-open local tab. Therefore 22.5
  records the provider/style-origin audit but does not claim visual, WebGL, or
  browser Network-panel acceptance. Those checks remain mandatory in 22.6.
- No API/backend, database, CAL FIRE publication, RentCast, Telegram, AWS, or
  deployment behavior changed.

### Block 22.6: Acceptance and merge gate

- run full tests, runtime and infrastructure typecheck, and production builds
- run desktop and mobile browser acceptance against local API/web services
- inspect the WebGL/canvas output and network requests
- record final bundle and network-origin deltas
- verify API-key restrictions and absence from logs/errors
- update ADR/knowledge base/runbook status with as-built evidence
- leave merge to the owner after acceptance

The asset count, module-preload count, main-chunk delta, and user-observed map
behavior require an explicit Block 22.6 decision before merge. Block 22.6 does
not deploy to AWS unless a later, separate deployment operation
is explained and explicitly confirmed.

## Automated Test Matrix

### Driver and lifecycle

- initializes exactly one map component and one zoom control
- reports loading, ready, bounded error, and successful retry
- updates listing graphics without replacing the React shell
- fits zero, one, and multiple listings with bounded viewpoints
- focuses selected listings and preserves stable IDs
- translates listing hit tests to the existing selection callback
- keeps pointer feedback scoped to listing graphics
- resizes without recreating layers or graphics
- destroys twice safely and ignores late async completion

### Draft workflow

- places only on background clicks in draft mode
- never places when a listing is hit
- drags only the draft graphic and emits longitude/latitude
- preserves confirmed and editable state styling
- removes draft listeners and graphics on cancel or destroy

### Wildfire overlay

- performs no artifact request while off
- validates artifact and metadata before layer installation
- installs severity symbols below listings
- fetches once after successful first enable
- toggles visibility without refetching
- rolls back partial installation and retries cleanly
- aborts and revokes object URLs on destroy
- leaves the base map interactive during loading or failure

### Security and regression

- accepts only a bounded API-key string and never prints it
- builds and tests without a real key
- CSP contains required ArcGIS directives and no OpenFreeMap origin after
  cutover
- React session, listing API, Search Criteria, Showing List, and manual-listing
  tests remain unchanged and pass
- no package outside the web app imports ArcGIS

## Manual Acceptance Checklist

Desktop and mobile acceptance must confirm:

1. The map is nonblank, correctly framed, and responsive.
2. ArcGIS attribution is visible and not covered by product controls.
3. Listing points retain their teal/rust colors, white outline, and readable
   size above the basemap.
4. Clicking a card focuses its point; clicking a point selects and scrolls the
   same card without changing URL or listing ID.
5. Initial fit, one-listing fit, multi-listing fit, zoom controls, and resize
   behavior remain usable.
6. Manual add/edit placement, drag, confirmation, cancel, and coordinates match
   the current workflow.
7. Wildfire remains off by default and causes no artifact request while off.
8. First enable loads exactly one artifact and metadata pair; later toggles do
   not refetch.
9. Moderate, High, and Very High fills preserve the reviewed transparency and
   never obscure listing points.
10. Hazard attribution, version, jurisdiction note, and blank-area disclosure
    remain readable on desktop and mobile.
11. A hazard failure is isolated; a map initialization failure uses the bounded
    map retry state.
12. Retry, sign-out/sign-in, tab changes, and responsive resizing do not create
    duplicate map hosts, controls, layers, or handlers.
13. The network panel contains no OpenFreeMap request after cutover and only the
    expected ArcGIS asset/basemap requests.
14. No API key appears in application logs, visible error text, screenshots, or
    committed files.

## Completion Criteria

Block 22 is complete only when:

- all automated and manual acceptance items pass
- current listing, draft, wildfire, auth, criteria, and Showing List behavior
  is preserved
- MapLibre and OpenFreeMap are absent from production dependencies, runtime
  code, CSP, and network requests
- ArcGIS is isolated to `apps/web` behind the existing driver
- the real API key is privilege- and referrer-restricted
- final bundle/network evidence and any justified variance are documented
- no backend, database, provider, notification, or AWS behavior changed
- the branch is ready for the owner to merge into `main`

## Rollback

Before cutover, retain MapLibre as the working default while ArcGIS parity is
implemented and tested. After cutover, rollback is performed by reverting the
Block 22 merge or abandoning the migration branch. Do not keep a dormant second
engine in the production application.

If ArcGIS parity, CSP, API-key governance, bundle performance, or lifecycle
cleanup fails the gate, stop before merge. The existing `main` branch remains
the accepted MapLibre implementation.

## References

- [ADR 0010: ArcGIS Map-Engine Migration](../adr/0010-arcgis-map-engine-migration.md)
- [ADR 0007: Wildfire Hazard Overlay](../adr/0007-wildfire-hazard-overlay.md)
- [ArcGIS Maps SDK for JavaScript](https://developers.arcgis.com/javascript/latest/)
- [Migrate to components](https://developers.arcgis.com/javascript/latest/migrating-to-components/)
- [React integration](https://developers.arcgis.com/javascript/latest/react/)
- [ArcGIS map component](https://developers.arcgis.com/javascript/latest/references/map-components/components/arcgis-map/)
- [GeoJSONLayer](https://developers.arcgis.com/javascript/latest/references/core/layers/GeoJSONLayer/)
- [Working with assets](https://developers.arcgis.com/javascript/latest/working-with-assets/)
- [Content Security Policy requirements](https://developers.arcgis.com/javascript/latest/faq/)
