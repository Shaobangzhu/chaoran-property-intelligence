# ADR 0011: Optional 3D Fire Terrain Context

## Status

Accepted. Block 23.0 records the product, authority, rendering, lifecycle,
security, cost, and acceptance boundaries. Block 23.1 completed the separately
approved provider/browser precheck and confirmed the proposed ArcGIS local
scene plus World Elevation path on the target development device. Block 23.2
implemented the mode-neutral React controller and injected-factory seam with
fake-driver lifecycle tests. Block 23.3 implemented the separately approved,
non-default local-scene adapter and its offline lifecycle tests. Block 23.4
remains separately gated.

## Context

The authenticated Listings workspace now uses ArcGIS Maps SDK for JavaScript
5.1 in a 2D `arcgis-map`. It renders stored residential listing points and a
tracked, same-origin CAL FIRE / OSFM Fire Hazard Severity Zone GeoJSON release.
The current overlay preserves the source categories `moderate`, `high`, and
`very-high` and intentionally performs no property-level risk calculation.

The operator needs an additional way to understand the spatial relationship
between those authoritative polygons, listings, and surrounding terrain. A 3D
scene can reveal ridges, valleys, elevation changes, and the shape of a mapped
zone more clearly than a flat view. It must not imply that terrain changes the
CAL FIRE classification or that the application predicts fire behavior.

The current React shell already isolates the map engine behind
`ListingsMapDriver`. React owns listing data, selected listing identity,
manual-draft state, wildfire visibility, map status, retry, and teardown. This
boundary can support another ArcGIS view without changing backend or domain
contracts.

## Decision

### Add an optional mode, not a replacement

Keep 2D as the default after sign-in and page reload. Add one explicit mode
control with `2D` and `3D Terrain` choices inside the existing map workspace.
The choice is session-only UI state; it is not stored in PostgreSQL and does
not add an API route.

Only one ArcGIS view is mounted at a time. Switching modes destroys the active
driver, creates the other driver, and replays canonical React state. The
application must not keep a hidden 2D `MapView` and 3D `SceneView` alive
simultaneously because each consumes a WebGL context and associated memory.

### Keep a mode-neutral application boundary

Preserve the current `ListingsMapDriver` operations for listing updates,
fit/focus, manual draft presentation, CAL FIRE visibility, resize, and destroy.
Implement separate 2D-map and 3D-scene factories behind the same interface.
ArcGIS objects remain private to the adapters.

Block 23.2 implements the second factory as an optional capability. When no
terrain factory is supplied, the production workspace constructs the existing
2D ArcGIS driver and does not render a nonfunctional 3D control. Injected test
factories expose the accessible segmented control and prove both switch
directions. The real scene factory remains disconnected until the later
user-visible integration block.

React remains the source of truth for:

- listings and stable listing IDs
- selected listing ID
- desired CAL FIRE visibility
- map mode and bounded loading/error state
- manual-listing draft state

Mode changes must not fetch listings again, mutate listing records, change the
selected card, or alter the Search Criteria profile.

Driver replacement resets only renderer-owned loading state. After the new
driver reports ready, the controller replays listing fit, selected-listing
focus, and desired CAL FIRE visibility. Listing data and draft presentation are
sent during driver construction. Every callback from an inactive generation,
including selection, draft coordinates, overlay state, ready, and error, is
ignored.

### Use a local ArcGIS scene with real terrain

Use the ArcGIS scene component and a local 3D scene appropriate to the bounded
Southern California operating area. Use ArcGIS World Elevation as the ground
surface with no vertical exaggeration. Keep the current navigation-style
basemap initially for visual continuity; changing the 3D basemap is allowed
only if the Block 23.1/23.3 audit demonstrates a readability or compatibility
need and the exact alternative is documented.

Use the SDK's automatic quality selection. Do not force a high quality profile
on mobile or unknown hardware. Unsupported WebGL2, terrain-service failure, or
scene initialization failure produces a bounded 3D error with a `Return to 2D`
action; it must not break the listing workspace.

The 3D camera starts from the listing extent with a restrained oblique angle.
Fit and focus operations remain bounded so a single listing cannot force an
extreme ground-level or excessively close camera.

Block 23.3 implements this decision behind an unconnected factory. The local
scene starts at longitude `-117.58`, latitude `33.65`, altitude `45,000`
meters, heading `0`, and tilt `55`. Fit uses tilt `58`; one-listing fit uses
zoom `14`, multi-listing fit is clamped to zoom `9.5`-`12.5`, and selected
focus uses tilt `62` with zoom `14`-`15`. ArcGIS retains automatic quality and
the ground has no application-defined exaggeration. Ground readiness is an
initialization gate, not a silent flat-terrain fallback.

The scene's listing layer uses `relative-to-ground` placement with an 8-meter
visual offset and disables screen-size perspective so symbols remain readable.
This offset is not stored, displayed, or interpreted as property elevation.
WebGL2 capability, ground failure, stable graphic reconciliation, layer-scoped
hit testing, stale asynchronous work, bounded navigation, and idempotent
teardown are covered by injected-dependency tests. The production entry point
and map shell do not yet import this factory; CAL FIRE draping and user-visible
wiring remain Blocks 23.4 and 23.5.

### Terrain is context only

The following semantics are immutable:

- CAL FIRE / OSFM remains the hazard authority.
- The tracked same-origin artifact remains the only hazard runtime input.
- `moderate`, `high`, and `very-high` are rendered exactly as supplied.
- Terrain/elevation never changes a severity value or polygon boundary.
- Hazard polygons are draped on the ground; they are never extruded.
- The application does not calculate slope, aspect, distance-to-zone, fuel,
  wind, fire spread, evacuation, or a combined property risk score.
- The application does not display a computed elevation or make a safety,
  insurability, or evacuation recommendation.

The visible 3D legend retains the existing CAL FIRE provenance, source version,
snapshot date, jurisdiction status, and blank-area disclosure. It also states
that terrain is visual context only and CAL FIRE classifications are unchanged.

### Render listings and hazard data without changing their meaning

The 3D scene uses a dedicated listing `GraphicsLayer`. Listing points are
terrain-aware and remain legible above the ground without encoding elevation
or risk in symbol size, height, or color. The existing teal and selected-rust
semantics remain. Layer-scoped hit testing continues to synchronize map and
list selection. Popups remain disabled.

The CAL FIRE renderer reuses the validated Blob-backed `GeoJSONLayer`, stable
layer identity, same three-class unique-value renderer, fill/outline palette,
opacity hierarchy, lazy-load state machine, rollback, retry, and provenance.
Set its elevation behavior to drape polygons on the ground. Listings remain
visually above the hazard fill.

The immutable validated CAL FIRE release may be cached across a 2D/3D mode
change after one successful load. Each renderer owns only its ArcGIS layer,
object URL, handlers, and teardown. Cache reuse must not weaken validation,
retry, Abort, or stale-generation protections.

### Keep manual listing editing in 2D

The 3D scene is an exploration view. Creating or editing a manual listing uses
the existing 2D placement and drag workflow. Starting or resuming that workflow
switches to 2D before map interaction, and the 3D option is unavailable while
a draft is active. No ArcGIS Sketch widget, 3D placement, z-coordinate, or
elevation field is added.

This preserves all existing behavior without introducing ambiguous 3D editing
semantics.

### Gate credentials, network, cost, and browser capability

Block 23.1 verified that `arcgis-scene` can load World Elevation while the
existing browser key remains configured only in
`esriConfig.apiKeys.basemapStyles`. The scene path does not call the separate
numeric ArcGIS Elevation API and does not require the
`premium:user:elevation` privilege for this implementation. Existing approved
basemap referrers continue to protect the browser credential.

Continue to treat `VITE_ARCGIS_API_KEY` as a browser credential, not a hidden
secret. Keep one least-privilege, referrer-restricted browser key with the
existing basemap privilege. Do not add an elevation privilege, a second key, or
a global ArcGIS credential for Block 23. The current runtime deliberately
scopes the key to basemap styles.

Update Content Security Policy only from observed requests. The accepted
candidate adds `https://elevation3d.arcgis.com` to `connect-src` and changes no
other directive. Do not add `elevation-api.arcgis.com`, `*.arcgis.com`,
`'unsafe-eval'`, a permissive wildcard, or an unreviewed portal/analytics
origin. Never log the key or include it in UI errors, tests, screenshots,
documentation, or build reports. Block 23.6 applies and rechecks the production
policy after the non-default scene exists.

The ArcGIS numeric Elevation API publishes a separate per-returned-point price.
Block 23 does not call it, so that transaction category is not part of this
feature. Terrain3D tile transfer and existing basemap usage remain subject to
the applicable ArcGIS account terms and will be reviewed against provider usage
reporting in Block 23.6; this ADR does not claim that external map traffic is
universally free.

### Preserve operational boundaries

Block 23 changes only `apps/web` and documentation unless a separately reviewed
need is discovered. It adds no API or database schema, no server-side elevation
call, no PostGIS, and no worker, alert, Telegram, Showing List, authentication,
or AWS topology change.

Every SDK handle, watcher, layer, object URL, scene component, DOM node, pending
promise, and abort controller has one teardown owner. Mode switching, retry,
React StrictMode, and unmount must leave exactly one active view and no late
callback capable of mutating the new generation.

## Consequences

- Users gain an optional topographic perspective while the familiar 2D map
  remains the default and fallback.
- CAL FIRE authority and classification semantics remain unchanged and
  auditable.
- The browser gains terrain-service requests and a heavier 3D GPU/memory path;
  capability, bundle, network, and cost audits become acceptance gates.
- Manual listing creation/editing remains coherent because coordinate editing
  stays in 2D.
- The adapters gain lifecycle and state-replay complexity, but React and all
  backend contracts remain stable.
- Unsupported or failed 3D rendering degrades to the existing 2D experience
  rather than making the Listings workspace unavailable.

## Rejected Alternatives

- Replacing 2D with 3D by default: rejected for performance, familiarity, and
  graceful-fallback reasons.
- Keeping both views mounted: rejected because it spends multiple WebGL
  contexts and duplicates layers, handlers, and memory.
- Extruding CAL FIRE polygons by severity: rejected because height would imply
  a quantitative hazard magnitude not present in the source classification.
- Deriving slope-adjusted severity or property risk: rejected because that
  would create a new hazard model outside this feature's authority and scope.
- Querying an ArcGIS hosted hazard layer: rejected because the reviewed local
  CAL FIRE release remains the reproducible authoritative runtime input.
- Adding numeric elevation to listing records: rejected because it is not
  required for visual context and would introduce a new data/API contract.

## Rollback

Before merge, discard or revert the Block 23 branch. After merge, revert the
Block 23 commits to remove the mode control and 3D adapter. The existing 2D
ArcGIS adapter, listing APIs, CAL FIRE artifact, and all backend data remain
valid; no data migration or cloud rollback is required.

## References

- [ArcGIS scene component](https://developers.arcgis.com/javascript/latest/references/map-components/components/arcgis-scene/)
- [Display a scene tutorial](https://developers.arcgis.com/javascript/latest/tutorials/display-a-scene/)
- [Introduction to 3D visualization](https://developers.arcgis.com/javascript/latest/scenes-3d/)
- [SceneView](https://developers.arcgis.com/javascript/latest/references/core/views/SceneView/)
- [Ground](https://developers.arcgis.com/javascript/latest/references/core/Ground/)
- [ElevationInfo](https://developers.arcgis.com/javascript/latest/references/core/symbols/support/ElevationInfo/)
- [ArcGIS Maps SDK system requirements](https://developers.arcgis.com/javascript/latest/system-requirements/)
- [ArcGIS Maps SDK FAQ and WebGL guidance](https://developers.arcgis.com/javascript/latest/faq/)
- [API key authentication](https://developers.arcgis.com/documentation/security-and-authentication/api-key-authentication/)
- [Create an API key with elevation privileges](https://developers.arcgis.com/documentation/security-and-authentication/api-key-authentication/tutorials/create-an-api-key/location-platform/)
- [Numeric ArcGIS Elevation service and pricing](https://developers.arcgis.com/rest/elevation/)
- [ADR 0007: Wildfire Hazard Overlay](0007-wildfire-hazard-overlay.md)
- [ADR 0010: ArcGIS Map-Engine Migration](0010-arcgis-map-engine-migration.md)
