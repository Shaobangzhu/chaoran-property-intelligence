# Block 23: 3D Fire Terrain Context

## Status

Blocks 23.0-23.6 are complete on `feature/3d-fire-terrain`. The product
semantics, authority boundary, architecture, provider/security decisions,
implementation sequence, test strategy, rollback, and acceptance criteria are
frozen. The separately approved 23.1 provider/browser precheck passed, and the
separately approved 23.2 mode/lifecycle seam passed focused tests and web
typecheck. Block 23.3 added and verified the non-default terrain-scene adapter,
and Block 23.4 added the terrain-draped CAL FIRE renderer and context-only
disclosure. Block 23.5 connected the reviewed scene adapter to the user-visible
mode control and completed draft and failure routing. Block 23.6 completed the
security, network, bundle, lifecycle, and operator-confirmed browser gates.

Blocks 23.3-23.5 registered the exact-pinned SDK's `arcgis-scene` component and
added tested scene, listing, and CAL FIRE terrain adapters plus the conditional
disclosure. The Listings map shell now supplies the real scene factory while
retaining 2D as the default; terrain is instantiated only after the operator
chooses `3D Terrain`. No dependency, browser credential, Content Security
Policy, database, AWS resource, schedule, RentCast quota, or Telegram delivery
changed. Temporary Block 23.1 probe files and services remain removed.

## Product Question

Can the application help the operator understand existing CAL FIRE Fire Hazard
Severity Zones in relation to surrounding terrain and topography?

Yes. A local ArcGIS 3D scene can drape the reviewed CAL FIRE polygons over real
terrain and place the current residential listing markers in that landscape.
This makes ridges, valleys, slopes, and the spatial shape of a zone easier to
inspect without changing the hazard data.

The feature must remain honest about what it does not know. Terrain is visual
context. The application does not infer that a property is safer or more
dangerous because it is above, below, upslope, downslope, near, or far from a
polygon.

## Frozen Authority Contract

The Block 19 CAL FIRE contract remains authoritative:

- runtime hazard source:
  `/data/wildfire-hazard/fhsz-five-cities-2025.1.geojson`
- provenance and release metadata remain tracked and same-origin
- valid geometry remains `Polygon` and `MultiPolygon` in WGS84
- valid severities remain `moderate`, `high`, and `very-high`
- current strict validation runs before ArcGIS receives the feature collection
- current colors, fill opacity, outline hierarchy, labels, source versions,
  snapshot date, jurisdiction status, and blank-area disclosure remain
- disabled means no artifact request before first enable
- failure remains isolated to the hazard overlay

The 3D implementation must not:

- rewrite, interpolate, simplify, buffer, union, split, or reclassify hazard
  polygons for analysis
- use terrain height, slope, or aspect to alter a severity value
- extrude severity into columns or encode it as quantitative height
- add a new `safe`, `low`, or property-level classification
- calculate distance to hazard, evacuation suitability, insurance risk, fire
  spread, wind exposure, fuel loading, or a composite score
- describe blank map areas as safe

## User Experience Contract

### Mode control

Add one compact segmented control inside the existing map workspace:

- `2D`
- `3D Terrain`

Use familiar map/terrain icons from the existing Lucide dependency, visible
labels, keyboard navigation, focus indication, and a stable control size.
Do not create a new page, dashboard card, onboarding flow, basemap picker, or
marketing explanation.

2D remains selected after sign-in and full reload. The choice lasts only for
the current mounted Listings workspace. It is not persisted to the user,
database, browser storage, query string, or API.

### 2D behavior

The existing 2D ArcGIS map is unchanged:

- same basemap, listing and selected-marker tokens
- same list/map bidirectional selection
- same fit and focus behavior
- same manual listing placement, drag, confirmation, and edit flow
- same CAL FIRE toggle, legend, lazy load, retry, and attribution
- same responsive list/map presentation

### 3D behavior

The 3D view provides:

- a local scene over the current five-city Southern California operating area
- real ArcGIS terrain/elevation with no vertical exaggeration
- the current basemap initially, draped over the terrain for continuity
- terrain-aware listing markers with the same teal and selected-rust meaning
- click selection synchronized with the same React listing card
- bounded camera fit for all listings and oblique focus for one selection
- the same CAL FIRE polygons draped over the ground
- the same hazard toggle, legend, provenance, severity labels, colors, opacity
  hierarchy, failure state, retry, and attribution
- a concise disclosure: terrain is visual context only and CAL FIRE
  classifications are unchanged

The scene does not add popups, buildings, trees, shadows, weather, animation,
fly-through tours, line-of-sight, measurement, elevation profiles, routing, or
search.

### Manual listing workflow

3D is read-only. If the user starts Add Listing or edits a manual listing:

1. the map returns to 2D before coordinate placement is enabled
2. the existing draft marker and form workflow continue unchanged
3. the 3D option is disabled while the draft is active
4. cancel or save returns control to the normal Listings workspace; it does not
   automatically force 3D back on

This avoids ambiguous z-coordinates and preserves the already accepted 2D
editing behavior.

### Failure and fallback

The application must distinguish:

- 2D map initialization failure
- 3D scene or capability failure
- CAL FIRE overlay failure inside either mode

A 3D failure leaves listing data and 2D available. Show a bounded scene error
and a clear `Return to 2D` action. Do not silently display a flat surface under
the label `3D Terrain`, because that would misrepresent the feature.

An overlay failure leaves the active base map/scene and listing points usable.
The existing overlay-only retry remains. A mode change must not convert an
overlay error into a whole-map error.

## Architecture

### Existing boundary

The current browser structure is:

```text
ListingsScreen
    |
ListingsMap React shell
    |
ListingsMapDriver
    |
ArcGIS 2D adapter
    +-- listing GraphicsLayer
    +-- draft GraphicsLayer
    +-- validated CAL FIRE GeoJSONLayer
```

React already owns the data and interaction state. ArcGIS is a renderer and
navigation surface, not a source of listing or hazard truth.

### Target boundary

```text
ListingsScreen / manual listing workflow
                    |
            ListingsMap React shell
       mode + state replay + error boundary
                    |
            ListingsMapDriver port
              /             \
      ArcGIS 2D map      ArcGIS 3D scene
      one active host    one active host
              \             /
       validated CAL FIRE release source
```

The preferred implementation keeps two factories that implement the current
driver interface. The React shell selects exactly one factory and replays:

- current listings
- selected listing ID
- desired CAL FIRE visibility
- the current non-draft map state

The adapters do not import application repositories, call `/api/listings`, or
own React state.

### One active WebGL view

Each ArcGIS `MapView` or `SceneView` consumes a WebGL context. Keep exactly one
active host:

1. increment the map generation
2. mark the requested mode loading
3. destroy the previous driver and detach its host
4. create the requested driver
5. ignore stale ready/error callbacks from an older generation
6. replay listings, selection, and desired overlay visibility
7. expose the new view only after it is ready

The React StrictMode fix from Block 22 remains required: detach the component
immediately, but coordinate late component readiness and destruction so no
Lumina/controller callback writes into an unmounted element.

### Scene foundation

Register only the additional `arcgis-scene` component needed for this feature.
The current SDK versions remain exact-pinned unless Block 23.1 finds an
unavoidable incompatibility. No new mapping library is expected.

The initial scene contract is:

| Concern | Decision |
| --- | --- |
| Scene type | Local scene for the bounded five-city operating area |
| Ground | ArcGIS World Elevation |
| Exaggeration | None |
| Basemap | Existing navigation style unless the audit proves unsuitable |
| Quality | ArcGIS automatic quality selection |
| Popup | Disabled |
| UI | Existing app controls plus zoom and the 2D/3D mode control |
| Attribution | Visible ArcGIS attribution plus existing CAL FIRE provenance |

The camera derives its target from listing coordinates. Empty-data behavior
uses the current regional default. One-listing and multi-listing paths must
have explicit altitude/distance and extent limits; the camera cannot end below
terrain or at an unusably shallow angle.

### Listing graphics in 3D

Use one dedicated `GraphicsLayer` and stable listing IDs. Reconcile rather than
replace all graphics on selection changes. The symbol may use a SceneView-aware
billboard/icon representation so it remains readable against terrain, but it
must preserve:

- teal for ordinary listings
- rust for the selected listing
- white outline/halo contrast
- no elevation or hazard encoding in size, vertical position, or color
- listing-layer-scoped hit testing
- no popup or duplicate React record

Use a ground-relative placement mode only to keep markers visible. Any small
visual offset is presentation, not a stored or displayed property elevation.

### CAL FIRE polygons in 3D

Keep the existing lifecycle and strict parser engine-neutral. The scene
renderer creates its own `GeoJSONLayer` from the validated Blob URL and sets
terrain-aware ground draping. It reuses the existing unique-value renderer
rather than creating a new 3D severity scheme.

Layer order remains:

1. basemap and terrain ground
2. CAL FIRE polygons draped on ground
3. stored listing markers

There is no 3D draft layer because editing remains in 2D.

The artifact and metadata are immutable for the deployed release. A shared
validated-load cache may prevent a second same-origin download when changing
modes, but it must cache only successful validated results. Failure, retry,
Abort, and teardown behavior remain deterministic.

## Security, Provider, and Cost Gate

### Current credential boundary

`VITE_ARCGIS_API_KEY` is compiled into the web bundle and currently configured
only for basemap styles. It is a public browser credential protected by
least-privilege service permissions, approved HTTP referrers, rotation, and
monitoring.

Block 23.1 determined and recorded:

- the scene can load World Elevation while the current credential remains
  scoped only to Basemap Styles
- no numeric Elevation API call or `premium:user:elevation` privilege is needed
  for the accepted terrain-visualization path
- the exact SDK credential boundary remains
  `esriConfig.apiKeys.basemapStyles`; it is not broadened globally
- approved local and production referrers
- the numeric ArcGIS Elevation API has a separate returned-point price category
  that does not apply because Block 23 never calls that API
- Terrain3D tile traffic and existing basemap usage remain subject to account
  terms and receive a provider usage-dashboard review in Block 23.6
- a second browser key is unnecessary for this feature

Keep one restricted browser key. Do not add a second environment variable,
change `.env.local`, update GitHub configuration, or change AWS Secrets Manager
for Block 23.

### Network and CSP

The current production policy contains exact origins observed for the ArcGIS
2D basemap and SDK assets. 3D terrain may introduce additional service, tile,
worker, image, font, or static-asset origins.

The Block 23.1/23.6 browser audit must:

- start from a hard refresh with Network recording enabled
- identify each request by feature and initiator
- add only exact required origins to the appropriate CSP directive
- retain `blob:` only where the SDK or validated GeoJSON layer requires it
- reject ArcGIS wildcards and unrelated portal/analytics endpoints
- confirm no listing record, session token, password, RentCast key, Telegram
  value, or backend secret is sent to ArcGIS
- confirm the browser key is never printed in logs or committed evidence

Block 23.1 accepted one new external origin candidate:

```text
connect-src https://elevation3d.arcgis.com
```

The temporary production-equivalent CSP probe loaded the scene and terrain
without any ArcGIS wildcard, `elevation-api.arcgis.com`, or `'unsafe-eval'`.
One `script-src: eval` attempt from the local Vite-optimized ArcGIS config
bundle was blocked; the scene still became ready with no runtime error. The
policy will not be weakened for this optional code path. Block 23.6 repeats the
check against production assets.

Terrain requests necessarily reveal the viewed geographic extent to the map
provider. They do not need listing payloads or user identity.

### Real-request rule

Automated tests use injected fakes and local fixtures. They make no ArcGIS,
CAL FIRE upstream, RentCast, Telegram, PostgreSQL, or AWS request.

The credentialed Block 23.1 provider probe received explicit approval before
execution. Evidence records status, origin, privilege outcome, and request
count without recording the token. Future credentialed or production probes
still require a fresh explanation and approval.

## Block 23.1 Evidence

### Official capability review

- `arcgis-scene` 5.1 supports a scene created without a WebScene item, a local
  viewing mode, `ground="world-elevation"`, camera attributes, and core layers.
- World Elevation resolves to the Terrain3D tiled elevation service used by
  SceneView ground.
- ArcGIS 5.1 requires a supported 64-bit WebGL2 browser, at least 8 GB desktop
  memory, and recommends automatic SceneView quality selection.
- each `MapView` or `SceneView` consumes one WebGL2 context, validating the
  one-active-view design.

### Local capability audit

The 2026-08-24 development device has an Apple M4 GPU, 16 GB memory, macOS
26.6.2, and Chrome 151. The controlled page reported:

```text
sceneReady: true
viewingMode: local
webgl2: true
groundLayerCount: 1
errorCount: 0
```

User-provided visual evidence confirmed a nonblank oblique scene, nonflat
terrain around Chino Hills/Pomona/Ontario, a legible navigation basemap, and
working zoom controls.

### Provider audit

The approved service-level probe sent the existing browser credential only in
an authorization header and never printed it:

| Request | Result |
| --- | --- |
| Terrain3D ImageServer metadata | HTTP 200, ArcGIS Server 11.5, `Image,Tilemap,Mensuration` |
| Corona-area Terrain3D tile, level 10 | HTTP 200, `application/octet-stream`, 80,624 bytes |

The browser then loaded the same ground while application code configured the
key only for basemap styles. This proves the accepted rendering path does not
need a global key, a second key, or a numeric Elevation API request.

### Deferred confirmations

- final ArcGIS attribution placement is verified in the integrated responsive
  scene during Blocks 23.5 and 23.7
- production-build CSP/eval behavior, exact request inventory, asset delta,
  repeated-view memory, and provider usage dashboard are Block 23.6 gates
- CAL FIRE terrain draping is not part of 23.1 and remains Block 23.4

## Performance and Compatibility

ArcGIS 3D requires WebGL2 and materially more GPU, memory, and network resources
than 2D. The SDK's supported-browser requirements and automatic quality choice
are the compatibility baseline.

Implementation rules:

- never mount 2D and 3D concurrently
- do not force `qualityProfile: "high"`
- keep the existing bounded 27-listing/five-city artifact scale as the initial
  acceptance dataset
- do not add buildings, integrated meshes, shadows, atmosphere effects, or
  additional elevation queries
- do not query numeric elevation per listing
- release view, layers, object URLs, handles, and component resources on every
  mode switch
- retain the known ArcGIS bundle advisory and record the Block 23 delta rather
  than silently changing a budget
- provide a clear 2D fallback when WebGL2 or terrain is unavailable

The final acceptance records:

- production asset count and main raw/gzip size against the Block 22 baseline:
  1,090 JavaScript assets, 1,438.27 kB raw, 360.43 kB gzip, 303 preload links
- one active ArcGIS host and one WebGL context during each mode
- repeated 2D/3D switching without growing active handlers or hosts
- responsive navigation at desktop and mobile viewport sizes
- no blank canvas, clipping, overlap, or unreadable listing/hazard layers

## Expected File Surface

The implementation should stay close to the existing browser boundary:

| Area | Expected change |
| --- | --- |
| `apps/web/src/ListingsMap.tsx` | own mode state, one-active-driver lifecycle, state replay, and fallback |
| `apps/web/src/listingsMapDriver.ts` | add only mode-neutral types that remove real duplication |
| `apps/web/src/arcgisComponents.ts` | register `arcgis-scene` in addition to current components |
| `apps/web/src/arcgisTerrainListingsScene.ts` | implement the non-default 3D scene adapter |
| `apps/web/src/arcgisRuntime.ts` / `arcgisConfig.ts` | least-privilege elevation configuration after the audit |
| `apps/web/src/arcgisWildfireHazardOverlay.ts` | reuse or parameterize terrain draping without changing severity semantics |
| `apps/web/src/WildfireHazardControl.tsx` | show the 3D context-only disclosure without changing provenance |
| `apps/web/src/styles.css` | compact mode control and responsive scene states without redesign |
| `apps/web/index.html` | exact observed 3D/elevation CSP origins only |
| `apps/web/src/*.test.ts(x)` | mode, scene, CAL FIRE, lifecycle, CSP, and regression coverage |

No package outside `apps/web` should import an ArcGIS scene type. No database
migration, API route, domain field, worker input, or AWS construct is expected.

## Test Strategy

### Unit and adapter tests

- default mode is 2D and does not construct a scene
- selecting 3D destroys 2D before creating 3D
- rapid mode changes ignore stale ready/error callbacks
- listings and selected ID replay into the new driver
- desired CAL FIRE visibility replays after readiness
- only a successful validated hazard release is reused across modes
- one listing graphic exists per stable ID in 3D
- 3D hit testing selects only listing graphics
- scene fit/focus commands are bounded and tolerate empty data
- CAL FIRE renderer has exactly three existing severity values
- polygons are on-ground/draped and not extruded
- listing symbols do not encode terrain height or hazard
- scene failure offers 2D fallback and leaves listing content intact
- overlay failure remains independent from scene failure
- draft activation routes to 2D and prevents 3D editing
- resize and repeated destroy are safe
- unmount before component readiness cannot trigger the Block 22 `reading 'A'`
  regression
- security policy contains exact expected origins and no ArcGIS wildcard

### Integration and component tests

- desktop and narrow layouts expose one accessible mode control
- keyboard and pointer mode changes have the same result
- list-to-map and map-to-list selection survive mode changes
- CAL FIRE enabled/disabled/loading/error/ready states remain accessible in 3D
- logout/unmount destroys the scene
- Add Listing from 3D enters the unchanged 2D draft workflow
- cancel/save produces no duplicate listing and no unexpected return to 3D

### Browser acceptance

Run against local Express and React with the approved browser credential only
after the relevant confirmation:

1. sign in and confirm 2D is unchanged
2. switch to 3D and confirm real, nonflat terrain renders
3. orbit, pan, and zoom; confirm the camera moves and remains bounded
4. confirm all current listing points are visible and selectable
5. select a listing from both card and scene and confirm synchronization
6. enable CAL FIRE and confirm polygons drape over terrain
7. compare all three severity colors/labels and provenance with 2D
8. confirm the terrain-context-only disclosure is visible in 3D
9. switch repeatedly between modes and confirm state is preserved
10. start Add Listing and confirm the existing 2D draft workflow
11. test overlay retry and simulated scene failure/Return to 2D
12. repeat at desktop and mobile viewport sizes
13. capture screenshots and inspect WebGL/canvas pixels to prove a nonblank,
    correctly framed scene with visible terrain, listings, and hazard polygons
14. inspect Console for uncaught errors and Network for unexpected origins
15. verify ArcGIS and CAL FIRE attribution remains visible

## Implementation Sequence

### Block 23.0: Documentation and contract freeze

Complete in this change:

- accept ADR 0011
- freeze authority and non-model semantics
- choose optional 2D-default, one-active-view architecture
- define 2D-only editing, failure fallback, security/cost gates, test strategy,
  rollback, and merge ownership
- make no runtime or external-service change

### Block 23.1: Provider, credential, and capability precheck

- verify official ArcGIS 5.1 scene, ground, elevation, and browser requirements
- inspect current key metadata/privileges without revealing its value
- determine the minimum elevation privilege and exact SDK credential boundary
- review usage accounting and expected cost before a real terrain request
- run one controlled scene/terrain request only after explicit confirmation
- record exact origins, CSP candidates, attribution, and unsupported-device
  behavior
- make no user-visible feature cutover

**Complete:** official 5.1 capability and system requirements were reviewed;
the target M4/16 GB/Chrome 151 device passed WebGL2 and rendered one ready local
scene over real Terrain3D ground. Authorized metadata and one terrain tile
returned HTTP 200 without exposing the key. The existing basemap-only key scope
is sufficient for the chosen scene path; no numeric Elevation API, elevation
privilege, second key, or new environment variable is required. The only new
CSP candidate is exact `https://elevation3d.arcgis.com` in `connect-src`.
Temporary probe files and localhost services were removed. No user-visible
feature, committed runtime source, credential, production policy, dependency,
backend, database, or AWS resource changed.

### Block 23.2: Mode and lifecycle seam

- add the `2D` / `3D Terrain` state and accessible control
- create an injected 3D factory seam with test doubles
- enforce one active driver and generation-safe state replay
- preserve 2D as default and keep the real 3D adapter unavailable to users
- add rapid-switch, retry, selection, overlay-desire, and teardown tests

**Complete:** `ListingsMap` owns a session-only mode and selects between the
existing 2D factory and an optional injected terrain factory. The control uses
visible `2D` and `3D Terrain` labels, Lucide map/terrain icons, native buttons,
`aria-pressed`, a labelled group, and stable responsive dimensions. It is
rendered only when the optional terrain capability exists; production still
passes no terrain factory and therefore exposes no unfinished control.

The lifecycle effect has one active driver and destroys it before React starts
the replacement generation. Initial listings and draft presentation are sent
to every new driver. Readiness replays fit, selected-listing focus, and desired
CAL FIRE visibility. Desired overlay visibility survives driver replacement,
while renderer-owned loading state resets. Guards ignore every callback from an
inactive generation, including selection, draft coordinates, overlay state,
ready, and error.

Focused `ListingsMap` tests prove the production default, both mode-switch
directions, exact teardown/create ordering, state replay, stale-callback
isolation, and retry against the currently selected factory. The focused suite
passes seven tests and the web TypeScript check passes. No ArcGIS scene module,
terrain request, provider privilege, CSP origin, dependency, backend, database,
or AWS resource was added in this block.

### Block 23.3: Non-default 3D listing scene

- register `arcgis-scene`
- create one local scene with World Elevation and the accepted basemap
- implement listing graphics, hit testing, initial fit, selected focus, zoom,
  resize, capability failure, and idempotent destroy
- use automatic quality and no terrain exaggeration
- keep the adapter non-default and CAL FIRE unavailable in the scene

**Complete:** the web bundle now registers `arcgis-scene`, and
`arcgisTerrainListingsScene.ts` implements the existing engine-neutral driver
behind a non-default factory. It configures one local scene with
`arcgis/navigation`, `world-elevation`, visible attribution, disabled popups,
no quality override, no vertical exaggeration, and a bounded five-city camera.
World Elevation readiness and WebGL2 support fail closed through one bounded
scene error without exposing provider details.

Listings use one dedicated `GraphicsLayer` with stable IDs,
`relative-to-ground` placement and an 8-meter presentation offset. Ordinary and
selected markers retain the accepted teal, rust, and white-outline semantics;
size and height do not encode elevation or hazard. Layer-scoped click and
pointer hit testing preserve React selection. Single, multi-listing, and focus
camera commands use explicit zoom and tilt bounds. Stale hit tests and camera
promises cannot affect a destroyed generation, and teardown removes handlers,
graphics, the layer, component host, and late component readiness exactly once.

Eleven adapter tests cover configuration, unsupported WebGL2, delayed ground
readiness, stable reconciliation, selection, pointer feedback, bounded camera,
pre-ready command replacement, inactive future operations, bounded failures,
and idempotent teardown. Together with the 2D map, React shell, and production
boundary regressions, 36 focused tests and the web TypeScript check pass. The
production boundary test proves that the component is registered while neither
`main.tsx` nor `ListingsMap.tsx` imports the terrain adapter. CAL FIRE scene
rendering, disclosure, and production wiring remain intentionally unavailable
until Blocks 23.4 and 23.5. This block made no real provider request and changed
no key, CSP, dependency, backend, database, or AWS contract.

### Block 23.4: Terrain-draped CAL FIRE

- reuse the exact validated release and metadata
- add a scene renderer with on-ground polygons and unchanged severity symbols
- keep hazard below listings and preserve lazy load, visibility reuse, rollback,
  retry, Abort, and overlay-only failure
- add the terrain-context-only disclosure
- prove no classification, boundary, extrusion, or API/backend change

**Complete:** `arcgisTerrainWildfireHazardOverlay.ts` creates the terrain layer
from the existing reviewed `GeoJSONLayer` factory and changes only
`elevationInfo.mode` to `on-the-ground`. The layer retains the same stable ID,
same-origin validated Blob input, provenance loader, exact `moderate`, `high`,
and `very-high` unique-value renderer, colors, opacity hierarchy, outlines,
popup/legend settings, and hidden layer-list behavior. Its symbols remain
`SimpleFillSymbol`; no 3D symbol, extrusion, elevation value, geometry rewrite,
or derived analysis exists.

The existing engine-neutral lifecycle now accepts the selected layer factory,
so both 2D and terrain paths share lazy loading, strict artifact/manifest
validation, desired visibility, same-scene no-refetch toggling, Abort,
rollback, retry, layer destruction, and Blob URL revocation. The terrain scene
creates this controller only after scene and ground readiness, replays a queued
visibility request, inserts hazard at map index `0` below listing graphics,
forwards overlay state, isolates construction/load errors from scene readiness,
and destroys the controller before scene teardown.

The existing legend receives a terrain-context flag from the React-owned mode
and, only while a terrain overlay is visible, adds: `Terrain is visual context
only. CAL FIRE classifications are unchanged.` The 2D legend and existing
blank-area disclosure remain unchanged. Thirty-two focused terrain, shared
overlay, scene, control, and React shell tests pass with web typecheck. The real
terrain factory remains disconnected from production until Block 23.5, so this
block made no real provider request and changed no key, CSP, dependency,
backend, database, or AWS contract.

### Block 23.5: User-visible integration

- enable the real 3D factory from the mode control
- preserve listings, selection, desired overlay visibility, and bounded camera
  behavior across mode changes
- route Add/Edit to 2D and disable 3D during a draft
- complete responsive, keyboard, focus, loading, error, and Return to 2D states
- run focused offline regression tests and production build

**Complete:** `ListingsMap` now imports the reviewed terrain scene factory as
the production 3D capability while preserving `2D` as its initial mode. Merely
rendering or loading the authenticated Listings workspace still constructs the
existing 2D driver; the scene and World Elevation path begin only after an
explicit `3D Terrain` selection. Driver replacement retains React-owned
listings, stable selection, bounded fit/focus replay, and desired CAL FIRE
visibility while stale callbacks remain generation-scoped and ignored.

Opening an Add/Edit draft immediately makes 2D the effective renderer, destroys
an active terrain scene, and disables the `3D Terrain` control until the draft
closes. The existing 2D marker placement, dragging, confirmation, and
coordinate contract remain unchanged; closing the draft leaves the workspace
in 2D rather than unexpectedly recreating terrain.

The mode control retains native button keyboard behavior, `aria-pressed`,
visible focus, and stable responsive sizing. Loading distinguishes `Loading 3D
terrain` from the existing 2D state. A bounded 3D initialization failure offers
`Retry 3D` and `Return to 2D`; returning destroys the failed driver, restores
focus to the 2D mode button, and replays desired CAL FIRE visibility when 2D is
ready. The 2D error contract remains `Map unavailable` / `Retry map`.

Fifty focused shell, scene, overlay, boundary, screen, and manual-listing tests
pass. The repository-wide suite passes all 968 tests, and root typecheck plus
the runtime, web production, and infrastructure builds pass. The provider key
privilege, exact CSP/network origins, request and memory audit, and bundle-delta
record remain Block 23.6. This block changed no backend, database,
provider-alert, Telegram, AWS, schedule, or deployment contract.

### Block 23.6: Security, network, and performance gate

- apply the least-privilege key configuration accepted in 23.1
- update CSP from observed exact origins only
- verify approved/rejected referrers without logging the key
- record terrain request behavior, attribution, usage/cost assumptions, and
  bundle delta
- audit one active WebGL context, repeated mode cleanup, automatic quality,
  supported-device handling, and memory behavior
- leave deployment and AWS unchanged

**Complete:** the production document now adds only
`https://elevation3d.arcgis.com` to `connect-src`. It does not add an ArcGIS
wildcard, `elevation-api.arcgis.com`, another image/script origin,
`'unsafe-eval'`, or a second credential. `arcgisConfig.ts` remains unchanged:
the existing browser credential is still assigned only to
`esriConfig.apiKeys.basemapStyles` and is never assigned globally.

The authorized service-level referrer audit read the existing key from
`.env.local` without printing it. The approved
`http://127.0.0.1:5173/` referrer returned HTTP 200 from the navigation basemap
style endpoint; an intentionally unapproved referrer returned HTTP 401. No key,
token-bearing URL, response body, or credential metadata was written to source,
test output, build reports, screenshots, or documentation. No environment,
credential, privilege, referrer, or ArcGIS account setting changed.

Block 23.5's static scene registration made the main production JavaScript
asset 2,583.17 kB raw / 678.38 kB gzip. Block 23.6 replaces that path with a
small synchronous lazy driver. It dynamically registers `arcgis-scene` and
imports the reviewed terrain adapter only after the operator selects `3D
Terrain`. The proxy bounds and replays the latest listings, selected ID, draft
presentation, navigation, desired CAL FIRE visibility, and resize intent. A
destroyed generation cannot create a late scene or report a late load error.

The synthetic-key production build records:

| Metric | Block 22 baseline | Block 23.6 | Delta |
| --- | ---: | ---: | ---: |
| JavaScript assets | 1,090 | 1,382 | +292 total on-demand assets |
| Main raw | 1,438.27 kB | 1,454.96 kB | +16.69 kB / +1.16% |
| Main gzip | 360.43 kB | 365.88 kB | +5.45 kB / +1.51% |
| Module preloads | 303 | 312 | +9 / +2.97% |

The separately loaded `arcgis-scene` chunk is 1,069.54 kB raw / 283.60 kB
gzip. Compared with the static Block 23.5 result, lazy loading removes 1,128.21
kB raw / 312.50 kB gzip from the main asset. The build still emits the accepted
large-chunk advisory; Block 23 does not hide or relax that warning.

Offline lifecycle tests prove that React destroys the active driver before
starting its replacement, an unresolved lazy scene cannot mount after destroy,
an initialized scene is destroyed once, and real-scene teardown removes its
overlay, listing layer, handlers, graphics, host, and component resources.
Scene tests also prove that WebGL2 failure creates no host and that the
application does not set `qualityProfile`, leaving ArcGIS automatic quality in
control. These are deterministic ownership gates, not a claim about browser or
GPU memory that the test process cannot observe.

The real-key production build and Vite preview started successfully. Read-only
preview probes returned HTTP 200 for `/` and `/api/health`; the served HTML
contains the exact Terrain3D origin and no wildcard. The local API was restarted
for this audit with `API_PUBLIC_ORIGIN=http://127.0.0.1:4173` as a process-only
override. A preview-origin `/api/auth/me` request without a session cookie
returned the expected HTTP 401 authentication response rather than an origin
rejection. No source or environment file changed for this audit setup. The
automated browser-control surface was unavailable during implementation, so
browser results were not inferred from unit tests. On August 24, 2026, the
operator completed live browser acceptance and confirmed that the Block 23.6
criteria were met. The accepted view shows real 3D terrain, draped CAL FIRE
classifications, a readable selected listing marker above the hazard fill, the
context-only disclosure, and Esri/provider attribution. The operator also
accepted the 2D/3D lifecycle, Console, network, and responsive behavior. The
provider usage dashboard remains an informational operator surface rather than
a source-code or deployment gate; no ArcGIS account setting changed.

Cost assumptions are intentionally narrow as of August 24, 2026:

- the navigation style uses the existing basemap tile model; ArcGIS Location
  Platform publishes 2 million free basemap tiles per month, then USD 0.15 per
  1,000 tiles, while ArcGIS Online includes basemap tiles in its subscription
- a direct access token is the tile usage model; the application does not start
  a basemap session
- the separate numeric Elevation API publishes 50,000 free returned points,
  then USD 1.00 per 1,000 points, but Block 23 makes zero such requests and does
  not hold its privilege
- World Elevation Terrain3D transfer is external provider traffic, but it is not
  represented as a numeric Elevation API transaction in the published service
  table; this document does not call it universally free
- API-key service consumption and billing belong to the subscription that
  created the key; the authoritative operator check is **My dashboard > Usage >
  Developer credentials > selected credential > billing cycle**

Official references: [Basemap Styles service and pricing](https://developers.arcgis.com/rest/basemap-styles/),
[Elevation API pricing](https://developers.arcgis.com/rest/elevation/index.html),
[API-key usage tracking](https://developers.arcgis.com/documentation/security-and-authentication/api-key-authentication/api-key-credentials/location-platform/),
and [SceneView performance and quality](https://developers.arcgis.com/javascript/latest/references/core/views/SceneView/).

### Block 23.7: Acceptance and merge gate

- run all tests, runtime/CDK typecheck, and production builds
- run desktop/mobile screenshot, canvas-pixel, camera, interaction, CAL FIRE,
  Console, Network, CSP, credential, and fallback acceptance
- compare 2D behavior and CAL FIRE semantics with the frozen baseline
- update roadmap, ADR, knowledge base, and operator evidence as built
- leave the branch-to-`main` merge to the repository owner

## Completion Criteria

Block 23 is complete only when:

- 2D remains the default and passes all prior behavior acceptance
- exactly one ArcGIS view is active at a time
- 3D renders real terrain on supported hardware with no exaggeration
- listing points and selection remain correct and readable
- CAL FIRE polygons are draped, not extruded, and retain exact classifications
- the context-only disclosure and all source provenance are visible
- manual listing creation/editing remains unchanged in 2D
- unsupported/failed 3D returns safely to 2D
- repeated switches and unmounts produce no leaked host, handler, or uncaught
  Console error
- exact CSP and referrer restrictions pass without wildcards
- usage/cost and bundle deltas are recorded
- full automated and browser acceptance pass
- no unintended backend, database, provider-alert, Telegram, or AWS change is
  present

## Rollback

Before merge, discard the feature branch. After merge, revert Block 23. The 2D
ArcGIS map and current CAL FIRE renderer remain the complete fallback. Because
Block 23 has no migration or backend contract, rollback requires no data repair
or cloud resource change.

## Sources

- [ArcGIS scene component](https://developers.arcgis.com/javascript/latest/references/map-components/components/arcgis-scene/)
- [Display a scene tutorial](https://developers.arcgis.com/javascript/latest/tutorials/display-a-scene/)
- [Introduction to 3D visualization](https://developers.arcgis.com/javascript/latest/scenes-3d/)
- [SceneView](https://developers.arcgis.com/javascript/latest/references/core/views/SceneView/)
- [Ground and World Elevation](https://developers.arcgis.com/javascript/latest/references/core/Ground/)
- [ElevationInfo placement modes](https://developers.arcgis.com/javascript/latest/references/core/symbols/support/ElevationInfo/)
- [ArcGIS Maps SDK system requirements](https://developers.arcgis.com/javascript/latest/system-requirements/)
- [ArcGIS Maps SDK FAQ](https://developers.arcgis.com/javascript/latest/faq/)
- [API key authentication](https://developers.arcgis.com/documentation/security-and-authentication/api-key-authentication/)
- [API key elevation privilege tutorial](https://developers.arcgis.com/documentation/security-and-authentication/api-key-authentication/tutorials/create-an-api-key/location-platform/)
- [Numeric ArcGIS Elevation service and pricing](https://developers.arcgis.com/rest/elevation/)
- [Block 19 Wildfire Hazard Overlay](block-19-wildfire-hazard-overlay.md)
- [Block 22 ArcGIS Map-Engine Migration](block-22-arcgis-map-engine-migration.md)
