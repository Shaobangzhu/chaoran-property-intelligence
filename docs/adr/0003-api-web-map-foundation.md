# ADR 0003: API, Web, and Map Foundation

## Status

Accepted

## Context

Blocks 0-14.1 produced a worker-only system. The worker reads RentCast, applies
domain criteria, stores matching listings in PostgreSQL, and can send Telegram
notifications. The next product stage needs a browser application that can read
the stored listings and display them as an operational list and map.

The current implementation was designed for the alert workflow rather than for
interactive reads:

- `listings.deduplication_key` is the primary key and encodes an internal
  ingestion rule rather than a stable product identity
- `ListingRepositoryPort` exposes worker commands such as baseline
  initialization and notification state transitions
- `NormalizedListing` currently lives in the application package even though it
  is a shared business concept
- persisted rows are discovery snapshots; the worker does not currently provide
  a complete, continuously refreshed active-listing inventory
- the database stores numeric longitude and latitude, which are sufficient for
  map rendering but do not yet support spatial queries
- the repository has no API or web application

Block 16 will add authentication. An unauthenticated production listings API
must not be introduced before that security boundary exists.

## Decision

Build the product transition as a small database-backed vertical slice, divided
into separately confirmed Block 15 sub-blocks. Block 15.0 records the decisions
only; it does not create applications, add dependencies, migrate data, or
provision infrastructure.

The first vertical slice is:

```text
React browser application
  -> GET /api/listings
  -> Express API application
  -> ListListings application use case
  -> ListingQueryPort
  -> PostgreSQL adapter
```

RentCast remains behind the worker boundary:

```text
RentCast -> alert-worker -> PostgreSQL -> API -> browser
```

The browser and API read from PostgreSQL. They do not call RentCast during a
listing read, and no RentCast credential may enter the web bundle.

### Package and Application Ownership

The dependency direction remains:

```text
entrypoints -> application -> domain
infrastructure -> application ports
```

Ownership for the new path is:

- `packages/domain` owns the normalized listing business model and pure rules
- `packages/application` owns `ListListings` and `ListingQueryPort`
- `packages/postgres` implements the query port and maps database rows
- `apps/api` owns Express composition, HTTP routes, middleware, configuration,
  and mapping application results to HTTP DTOs
- `apps/web` owns React state, API calls, list and map presentation, and map
  interactions
- HTTP DTOs do not become domain models, and Express types do not cross into
  application or domain packages

Moving the current listing type is an incremental Block 15.1 refactor. Existing
worker behavior must remain covered while ownership changes.

### Listing Identity and Query Boundary

Add a server-generated UUID as the stable internal listing ID before exposing
listings to a browser. Keep `deduplication_key` unique for ingestion idempotency,
but never expose it as the product ID.

Add a separate read-oriented port rather than extending the worker repository
with HTTP-shaped concerns. Its first responsibility is equivalent to:

```ts
interface ListingQueryPort {
  listListings(): Promise<ListingRecord[]>;
}
```

The exact domain record shape is finalized through Block 15.1 tests. It contains
the stable ID and normalized listing data, but not notification delivery state.

The initial query returns persisted listing snapshots in deterministic order.
It must not claim that every result is currently active or that the data is a
live MLS feed. Freshness and lifecycle synchronization require a later,
separately designed ingestion change.

### Initial HTTP Contract

Block 15.2 implements one read endpoint:

```text
GET /api/listings
```

The draft successful response is:

```ts
interface ListListingsResponse {
  listings: ListingSummaryDto[];
}

interface ListingSummaryDto {
  id: string;
  source: "rentcast" | "manual";
  sourceListingId: string | null;
  mlsName: string | null;
  mlsNumber: string | null;
  formattedAddress: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string;
  zipCode: string;
  latitude: number;
  longitude: number;
  propertyType: string;
  bedrooms: number;
  bathrooms: number;
  price: number;
  status: string;
  listedDate: string;
  lastSeenDate: string;
  firstDiscoveredAt: string;
}
```

Block 15 emits only `rentcast`; the reserved `manual` value and nullable source
ID allow Block 17 to extend the same response shape. This contract intentionally
omits `deduplicationKey` and `notificationStatus` because they are internal
worker state.

The first endpoint has no filters, mutation, pagination, external API call, or
geospatial query. The current dataset is small enough for a bounded foundation
response. Reinspect response size and introduce pagination or viewport queries
before this assumption stops being true.

The Express application is created by a dependency-injected app factory that is
separate from the listening process. Route tests use a fake query port and do
not require PostgreSQL, RentCast, Telegram, or AWS.

### Web Foundation

Use React with a Vite TypeScript application. The product is an authenticated,
client-rendered operational tool and does not currently require server-side
rendering or search-engine indexing.

Use `maplibre-gl` directly and contain its imperative lifecycle in one React map
component. Use the OpenFreeMap Liberty style. The first map consumes a GeoJSON
source derived from API DTOs and coordinates selection with an adjacent listing
view.

The first screen is the working map/list experience, not a marketing landing
page. It includes loading, empty, error, and selected-listing states. On narrow
screens the layout must remain usable without overlapping controls or content.

Use the browser `fetch` API behind a small typed client initially. Do not add a
router or server-state library until Block 16 routes or later caching and
mutation requirements justify them. The web application owns a DOM-enabled
TypeScript configuration rather than weakening the Node-focused base config.

### Local and Production Boundaries

During Block 15, Vite proxies `/api` to the local Express process so the browser
uses a same-origin-shaped path without broad development CORS rules.

No listings API or web application is publicly deployed in Block 15. Block 16
must add server-enforced authentication and protect listing reads before public
deployment.

The target production browser boundary is one HTTPS origin:

```text
CloudFront
  /*      -> private S3 web origin -> React/Vite static build
  /api/*  -> AWS API origin        -> Express application
```

AWS is the selected production platform for both applications. The React/Vite
build is uploaded from `apps/web/dist` to an S3 bucket that blocks all public
access. CloudFront reads that bucket through Origin Access Control; the bucket
is not exposed as a public website endpoint. Hashed assets receive long-lived
immutable caching, while `index.html` receives a short or disabled cache policy.

The `/api/*` behavior routes to an AWS-hosted Express origin, disables shared
caching, supports the required HTTP methods, and forwards the authentication
cookies and request metadata selected during Block 16. The API remains the
authorization boundary; CloudFront routing and React route guards do not replace
server-side authentication.

This same-origin design supports Block 16 HttpOnly cookies and avoids making
cross-origin credentials the default architecture. Vercel is not part of the
target production path because the project already uses AWS identity,
infrastructure as code, cost controls, private Aurora networking, and GitHub
OIDC deployment.

Block 15.5 selects App Runner as the Express compute target. It preserves the
existing container and `node-postgres` runtime, accesses private Aurora through
a VPC Connector, supports Secrets Manager references and CloudWatch logs, and
avoids a continuously billed load balancer. The API uses a dedicated instance
role and connector security group. It receives only the database secret, not
the worker's RentCast or Telegram credentials.

App Runner ingress uses a managed public service URL. CloudFront therefore
overwrites a dedicated origin verification header and Express rejects requests
without the expected value before authentication. This origin check complements
Block 16 authentication; it does not replace user authorization. The value is
managed and rotated through CDK and never enters the React build.

The initial service size is `0.25 vCPU` and `0.5 GB` with one provisioned
instance. Its idle memory baseline is approximately USD 2.56 per 730-hour month
at the documented `us-west-2` rate, before active CPU and other AWS services.
The design intentionally omits RDS Proxy so Aurora can auto-pause. Database
health checks remain out of the request-independent health route, and startup
timeouts must tolerate Aurora resume latency.

Static and API infrastructure will be managed through CDK and deployed through
the existing GitHub OIDC trust rather than long-lived AWS access keys. Block 15
does not create these resources or modify the deployed worker stack, scheduler
state, or Aurora network. Public deployment remains blocked until Block 16
protects listing reads and completes the production security review.

### Geospatial Scope

Do not enable PostGIS merely to draw markers. Existing finite longitude and
latitude values are enough for the initial GeoJSON source.

Add PostGIS when a concrete server-side spatial use case, such as viewport,
school-distance, or wildfire point-in-polygon queries, defines the required
geometry type, SRID, index, and distance semantics.

## Block 15 Sub-Blocks

1. `15.0` Record architecture, contracts, risks, tests, and Block 16 entry
   criteria.
2. `15.1` Add stable listing identity, move the shared listing model to its
   agreed ownership, and add the query use case and PostgreSQL adapter.
3. `15.2` Add the Express app factory and local-only `GET /api/listings` route.
4. `15.3` Add the Vite React application, typed API client, and complete
   loading, empty, error, and content states.
5. `15.4` Add MapLibre/OpenFreeMap rendering and list/map selection behavior.
6. `15.5` Verify the local vertical slice and review the authenticated
   production deployment plan without making it public.

Every sub-block requires a fresh explanation and explicit confirmation. A later
sub-block is not authorized by accepting this ADR.

## Implementation Status

Blocks 15.1 through 15.5 are complete:

- `NormalizedListing` is owned and exported by the domain package
- migration `002_add_listing_identity` adds a database-generated UUID primary
  key and preserves `deduplication_key` as the worker's unique ingestion key
- `ListListings`, `ListingRecord`, and `ListingQueryPort` establish the
  application read boundary
- `PostgresListingQuery` returns normalized records in deterministic order
- the worker repository and query adapter share defensive row parsing without
  exposing notification state through the read port
- `apps/api` provides an injected Express 5 app factory and explicitly maps
  `GET /api/listings` results to the agreed HTTP DTO
- query failures and unknown routes return bounded JSON errors without exposing
  database details, deduplication keys, or notification state
- the local composition root loads only database configuration, runs migrations,
  binds to `127.0.0.1`, and closes its HTTP server and database on shutdown
- CI builds both runtimes while the production worker image continues to build
  only the alert-worker dependency graph
- `apps/web` provides the React/Vite application, a runtime-validating typed
  client for `/api/listings`, and injected loading behavior for isolated tests
- the first listings screen renders bounded loading, empty, error, retry, and
  content states in responsive desktop and mobile layouts
- MapLibre GL JS renders an OpenFreeMap Liberty basemap and a client-created
  GeoJSON point source containing only listing IDs and selected state
- MapLibre v6 uses Vite's `?worker&url` pipeline and an explicit worker URL so
  vector-tile parsing is emitted as a self-contained, same-origin worker asset
- the desktop workspace keeps a scrollable listing panel beside the map, while
  narrow screens use an accessible List/Map segmented control
- listing activation focuses its map point, map point activation selects the
  listing, and mobile point activation returns the user to the selected row
- map initialization, updates, selection, fitting, errors, retries, resizing,
  and cleanup are isolated behind a small driver boundary so automated tests do
  not load external styles or tiles
- Vite binds to loopback and proxies `/api` to the local Express process without
  adding a development CORS policy

Block 15.5 ran both bundled migrations against the local Docker PostgreSQL
database. A temporary two-listing fixture verified the direct Express endpoint
and Vite proxy with stable UUIDs, valid coordinates, `Cache-Control: no-store`,
bounded unknown-route behavior, and no ingestion or notification fields. The
tagged fixtures were removed afterward. No external API or AWS call was made.

The migration has not been run against the AWS production database. Neither the
API nor the web application has been deployed, and the existing worker stack and
scheduler state were not changed.

## Test Strategy

- Block 15.1 tests the migration, deterministic reads, row validation, stable
  IDs, and unchanged worker baseline, pending, and sent behavior.
- Block 15.2 tests success, empty results, repository failure mapping, DTO
  mapping, and the absence of internal fields through an injected fake.
- Block 15.3 tests API client parsing plus loading, empty, error, and rendered
  listing states without a real backend.
- Block 15.4 tests coordinate conversion, map/list selection, responsive layout,
  and rendered map output in desktop and mobile browser checks.
- Block 15.5 runs the local PostgreSQL-backed vertical slice with no real
  RentCast, Telegram, or AWS call.
- CI never calls a real external API and never requires production secrets.
- Root build and typecheck scripts must include each new workspace when it is
  created.

## Block 16 Entry Criteria

Block 16 may begin when all of the following are true:

- listings have stable internal IDs distinct from deduplication keys
- `ListListings` and `ListingQueryPort` provide a tested read boundary
- `GET /api/listings` works locally through a testable Express app factory
- the React application renders database-backed listing, loading, empty, and
  error states
- MapLibre/OpenFreeMap renders valid listing coordinates and coordinates
  selection with the listing view
- browser code contains no RentCast, Telegram, database, or AWS credentials
- the API and web applications pass tests, typecheck, and build in CI
- the production same-origin boundary is documented but remains undeployed
- scheduler state remains unchanged unless separately authorized

Block 16 then owns authentication, authorization, cookies, login throttling,
CSRF/origin controls, protected React routes, and the final security gate before
public deployment.

## Options Considered

### Expose the deduplication key as the listing ID

Rejected because it leaks ingestion rules into the product contract and may
change when source or deduplication logic changes.

### Let the browser call RentCast directly

Rejected because it would expose the API key, couple the UI to a vendor payload,
bypass persisted authoritative data, and consume requests during normal reads.

### Add PostGIS before drawing the first map

Rejected because client-side marker rendering needs only validated coordinates.
PostGIS remains the accepted direction for actual spatial queries.

### Deploy the read API before authentication

Rejected because Block 16 owns the security boundary and production property
data must not be exposed through an unauthenticated endpoint.

### Run Express on Lambda

Rejected for the first production API. Lambda has attractive request-based
pricing, but the current Express and `node-postgres` composition would require
additional VPC and connection-lifecycle adaptation. CloudFront OAC for Lambda
function URLs also requires signed payload handling for future POST requests,
which conflicts with the planned browser login and mutation surface.

### Run Express on ECS Fargate behind a load balancer

Deferred as a future higher-isolation option. It preserves the container model
and can provide a private origin, but an always-running service plus load
balancer has a larger fixed cost and operating surface than the current
single-user, low-traffic API justifies.

### Host the React application on Vercel

Rejected for the current production plan. Vercel would provide convenient
frontend previews, but this client-rendered Vite application does not need SSR
or framework-specific compute. Adding another production platform would split
identity, deployment, cost, and same-origin routing across vendors while the
database and API already require AWS integration. Reconsider only if a future
requirement creates a concrete benefit that outweighs that operational cost.

### Add a React framework, router, map wrapper, and query library immediately

Deferred because the first slice has one screen and one read endpoint. Add each
tool only when a concrete route, rendering, caching, or mutation requirement
justifies it.

## Consequences

- The browser gains a vendor-independent, database-backed read path.
- Stable IDs are introduced before UI selection, URLs, manual listings, and AI
  showing-list references depend on identity.
- The worker repository remains focused on ingestion and delivery state.
- The first map can ship without prematurely choosing spatial schema details.
- The UI must communicate that stored records are snapshots until listing
  lifecycle synchronization is designed.
- AWS, private S3, CloudFront, App Runner, and the `/api/*` Express origin are
  decided; implementation remains gated on Block 16 security work and a reviewed
  CDK change.
- Block 16 can add authentication around an existing tested vertical slice
  instead of mixing foundational data access with security implementation.
