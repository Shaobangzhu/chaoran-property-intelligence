# ADR 0010: ArcGIS Map-Engine Migration

## Status

Accepted for Block 22 implementation. Block 22.0 records the migration
architecture and parity contract only. It does not authorize dependency
installation, runtime code changes, external requests, deployment, or AWS
operations. Each executable sub-block requires a fresh review and explicit
confirmation.

## Context

The authenticated Listings workspace currently uses MapLibre GL JS with the
OpenFreeMap Liberty style. The map adapter renders stored listing points,
synchronizes selection with the listing panel, fits and focuses the viewport,
supports a draggable manual-listing draft marker, and lazily renders the
same-origin CAL FIRE Fire Hazard Severity Zone artifact.

The product now needs ArcGIS Maps SDK for JavaScript as its browser mapping
engine. This is a technology migration, not a redesign or a GIS product-scope
expansion. The migration must preserve:

- the React and TypeScript application architecture
- the existing `ListingsMapDriver` boundary and injected map factory
- listing, selection, viewport, loading, retry, and error behavior
- manual-listing placement, dragging, confirmation, and coordinates
- the Block 19 CAL FIRE source, build pipeline, semantics, legend, disclosures,
  lazy loading, and retry behavior
- all browser/API/backend contracts and persisted listing identity
- RentCast, PostgreSQL, Telegram, Showing List, authentication, and AWS behavior

ArcGIS Maps SDK for JavaScript 5.1 recommends map components for view creation
and UI composition while continuing to use the core API for maps, layers,
graphics, symbols, and renderers. Starting a new direct `MapView` and legacy
widget integration would create avoidable migration work inside this migration.

## Decision

### Preserve the application-facing map port

Keep React dependent on the existing engine-neutral `ListingsMapDriver`:

```ts
interface ListingsMapDriver {
  updateListings(listings: readonly ListingSummary[], selectedId: string | null): void;
  fitToListings(listings: readonly ListingSummary[]): void;
  focusListing(listing: ListingSummary): void;
  updateDraftMarker(draft: ListingDraftMarker | null): void;
  setWildfireHazardVisible(visible: boolean): void;
  resize(): void;
  destroy(): void;
}
```

The ArcGIS implementation remains behind the existing injected factory.
`ListingsMap.tsx` continues to own React state and lifecycle orchestration; it
must not expose ArcGIS objects to the rest of the application. Small additions
to the private adapter contract are allowed only when a parity behavior cannot
be expressed safely through the current port.

### Use ArcGIS map components with core layers

Use compatible, exact-pinned 5.1 releases of:

- `@arcgis/map-components` for the map and zoom component lifecycle
- `@arcgis/core` for configuration, maps, layers, graphics, geometry, symbols,
  renderers, and reactive utilities
- `@esri/calcite-components` only as required by the selected ArcGIS component
  release

Create an `arcgis-map` host inside the existing map container and add an
`arcgis-zoom` component in the current top-right control position. Do not add a
basemap picker, search, popup, legend widget, compass, portal login, or other
ArcGIS user interface.

Use the `arcgis/navigation` basemap style as the initial light road-and-label
equivalent. This is a visual parity target rather than a pixel-identical claim;
the workspace layout, controls, selection colors, hazard palette, and UX
behavior remain unchanged.

### Listing and draft layers

Represent the bounded stored-listing collection in a dedicated
`GraphicsLayer`. Each listing is one point `Graphic` whose attributes contain
only the stable listing identifier and selection state needed by the map.

Preserve the current symbols:

- unselected listing: teal `#0d6e6e`, 7 px radius, 2 px white outline
- selected listing: rust `#a24f2a`, 9 px radius, 2 px white outline

Use layer-scoped hit testing for listing selection and pointer feedback. Keep
the popup disabled. Programmatic extent and focus operations preserve the
current zero-duration initial fit, maximum zoom behavior, padding, and animated
selection focus as closely as the ArcGIS view API permits.

Represent the manual-listing draft marker in a separate `GraphicsLayer` above
listings and hazard polygons. Preserve background-click placement, suppression
when a listing is hit, coordinate callbacks, drag updates, confirmation state,
and the existing crosshair mode. Do not introduce the ArcGIS Sketch UI or a new
editing workflow.

### CAL FIRE overlay

Keep the tracked CAL FIRE / OSFM GeoJSON and metadata files as the only hazard
runtime inputs. The browser must not query an ArcGIS FeatureServer, geoprocessing
service, or hosted feature layer for this feature.

Retain the existing strict validation and bounded `idle`, `loading`, `ready`,
and `error` state machine. After successful validation, create a Blob URL from
the validated GeoJSON and load it into one `GeoJSONLayer`. A
`UniqueValueRenderer` maps `moderate`, `high`, and `very-high` to the existing
fill and outline colors and opacities. The hazard layer remains below listings
and the draft marker.

Turning the overlay off after its first successful load changes layer
visibility and does not fetch or parse the artifact again. Retry rolls back any
partial layer installation. Destroy aborts pending work, removes installed
layers and handles, and revokes the Blob URL.

ADR 0007 remains authoritative for source provenance, jurisdictional status,
severity wording, disclosure language, visual opacity, performance limits, and
deferred analysis. This ADR changes only the browser rendering adapter.

### API key and browser security

Read `VITE_ARCGIS_API_KEY` only in the web application. Set
`esriConfig.apiKeys.basemapStyles` before the first basemap request so the
credential is scoped to the selected ArcGIS basemap service instead of becoming
a default credential for every ArcGIS request.

A Vite browser value is included in the shipped JavaScript bundle and is not a
server secret. The ArcGIS API key credential must therefore use the minimum
required basemap privilege and strict referrer restrictions for approved local
and production origins. Never log the key, include it in UI errors, commit a
real value, or place it in backend/AWS application secrets without a separately
defined server use case.

`.env.example` keeps a blank placeholder. `.env.local` remains ignored. Tests,
type checking, and production builds must not require a valid key; a missing or
invalid key is handled by the existing bounded map-unavailable and retry UI at
runtime.

### Content Security Policy and network boundary

Remove the OpenFreeMap origin only at cutover. Update the web Content Security
Policy from observed ArcGIS 5.1 browser requests, not from a broad wildcard.
ArcGIS WebAssembly requires `'wasm-unsafe-eval'` in `script-src`, and workers
require the existing `blob:` allowance. Preserve same-origin API, hazard
artifact, and session behavior.

Keep ArcGIS attribution visible. The acceptance audit must confirm that no
OpenFreeMap request remains, that only expected ArcGIS asset and basemap origins
are contacted, and that neither the API key nor authenticated application data
appears in logs or error messages.

### Lifecycle and cutover

Every SDK event handle, reactive watcher, object URL, layer, component, and DOM
node created by the adapter has one teardown owner. `destroy()` is idempotent
and must prevent stale async completion from mutating an unmounted or retried
map.

Keep MapLibre available while the ArcGIS adapter reaches automated and manual
parity. After the parity gate passes, switch the default factory and remove the
MapLibre dependency, bundled worker, OpenFreeMap CSP rule, and engine-specific
CSS/tests. The merged result contains one production map engine; do not retain
a permanent runtime flag or dual-engine compatibility layer.

## Consequences

- React screens and backend boundaries remain stable while the rendering engine
  changes behind one adapter.
- ArcGIS components align the implementation with the current SDK direction
  and reduce immediate legacy-widget migration debt.
- The product gains an ArcGIS basemap runtime dependency and browser API-key
  governance requirement.
- The static same-origin CAL FIRE publication model remains reproducible and
  independent from ArcGIS hosted GIS data services.
- Bundle size and network origins will change. Block 22 records the final delta
  and treats unexplained or excessive growth as an acceptance failure rather
  than silently relaxing the budget.
- ArcGIS and OpenFreeMap basemaps are not pixel identical, so acceptance is
  based on behavior, readability, hierarchy, and established visual tokens.
- Rollback is the branch or merge revert. The application does not carry two
  engines after acceptance.

## Supersession

This ADR supersedes the MapLibre GL JS and OpenFreeMap implementation choice in
ADR 0003 and the MapLibre-specific rendering details in ADR 0007 only after
Block 22.5 completes the cutover. All product, data, security, and operational
decisions in those ADRs remain in force unless explicitly restated here.

## References

- [ArcGIS Maps SDK for JavaScript 5.1](https://developers.arcgis.com/javascript/latest/)
- [Migrate to components](https://developers.arcgis.com/javascript/latest/migrating-to-components/)
- [Use ArcGIS with React](https://developers.arcgis.com/javascript/latest/react/)
- [ArcGIS map component](https://developers.arcgis.com/javascript/latest/references/map-components/components/arcgis-map/)
- [ArcGIS configuration](https://developers.arcgis.com/javascript/latest/api-reference/esri-config.html)
- [GeoJSONLayer](https://developers.arcgis.com/javascript/latest/references/core/layers/GeoJSONLayer/)
- [GraphicsLayer](https://developers.arcgis.com/javascript/latest/references/core/layers/GraphicsLayer/)
- [UniqueValueRenderer](https://developers.arcgis.com/javascript/latest/references/core/renderers/UniqueValueRenderer/)
- [Content Security Policy requirements](https://developers.arcgis.com/javascript/latest/faq/)
- [API key credential restrictions](https://developers.arcgis.com/documentation/security-and-authentication/api-key-authentication/api-key-credentials/enterprise/)
- [ADR 0007: Wildfire Hazard Overlay](0007-wildfire-hazard-overlay.md)
