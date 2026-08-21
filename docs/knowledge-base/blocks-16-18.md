# Blocks 16-18 Feature Knowledge Base

## Purpose

This document records future requirements for authentication, manual listings,
and AI-assisted Showing List drafts. It preserves decisions and constraints for
later block planning. It does not authorize implementation.

At the start of each future sub-block, reinspect the repository, Git status,
architecture, tests, CI, and current external-service documentation. Do not add
an endpoint, directory, service, or dependency until that sub-block needs it.

## Architecture Integration

The existing dependency direction remains in force:

```text
entrypoint -> application -> domain
infrastructure -> application ports
```

ADR 0003 defines the API and web foundation ownership:

- the normalized listing model and pure rules belong in domain code
- use cases and ports, including `ListListings` and `ListingQueryPort`, belong
  in application code
- PostgreSQL repositories and migrations belong in the persistence adapter
- HTTP DTO mapping, routes, cookies, CORS, and middleware belong in `apps/api`
- forms, route guards, map interactions, and review screens belong in
  `apps/web`
- Argon2id, JWT, and OpenAI SDK details remain replaceable infrastructure
  adapters behind application ports

Block 15 establishes a local-only `GET /api/listings` vertical slice. Listing
reads come from PostgreSQL through the application query port; neither the API
nor browser calls RentCast. The HTTP DTO uses the stable listing UUID and omits
the ingestion deduplication key and Telegram notification state.

AWS is the selected production platform. The target boundary uses one HTTPS
origin, with CloudFront reading the React/Vite build from private S3 through
Origin Access Control and routing `/api/*` to an AWS-hosted Express origin.
Vercel is not part of the current production plan. Block 15.5 selected App
Runner as the Express compute target. A dedicated VPC Connector and security
group provide outbound access to private Aurora while the App Runner instance
role reads only the required database secret.

The `/api/*` CloudFront behavior must disable shared caching and forward the
Block 16 authentication cookie and required request metadata. Express remains
the authorization boundary. CloudFront must overwrite a dedicated origin
verification header, and Express must reject requests without the expected
value before authentication middleware runs. This protects the otherwise
public App Runner service URL from becoming an accepted bypass path. Do not
publicly deploy either application until Block 16 protects listing reads,
implements this origin check, and completes the production security review.

React route guards improve user experience but never replace API authentication
and authorization.

### Block 16 Entry Dependency

Block 16 starts only after the ADR 0003 entry criteria are satisfied. Block
15.5 confirmed the local PostgreSQL-to-Express path directly and through the
Vite proxy, including stable UUIDs, valid map coordinates, `no-store` responses,
and omission of ingestion and notification fields. React read states and
MapLibre interactions remain covered by the Block 15 automated and browser
checks.

## Block 16: Single-User JWT Authentication

### Implementation Status

- `16.0` complete: ADR 0004 records the accepted authentication architecture,
  threat model, contracts, and test inventory.
- `16.1` complete: the user domain model, repository port, users migration, and
  PostgreSQL adapter are implemented and covered by isolated tests.
- `16.2` complete: password policy, the Argon2id adapter, and the masked-input
  local administrator CLI are implemented and covered by isolated tests.
- `16.3` complete: JWT configuration, the application token port, and the
  strict JOSE access-token adapter are implemented and covered by isolated
  tests.
- `16.4` complete: login and current-user application use cases are implemented.
- `16.5` complete: Express auth routes, cookies, origin checks, middleware, and
  protected listings are implemented.
- `16.6` complete: React session bootstrap, login, logout, and the protected
  workspace are implemented.
- `16.7` complete: login rate limiting, security headers, explicit admin
  authorization, structured security events, CSP, and cross-layer tests are
  implemented.

### Product Scope

The first release has one administrator but uses a normal `users` table and user
model. It must not encode "one user forever" into persistence.

In scope:

- one-time administrator creation command
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- protect `GET /api/listings` before any public deployment
- short-lived access JWT, initially around one hour
- authentication and admin authorization middleware

Out of scope:

- public registration
- refresh tokens
- password reset
- email verification
- additional roles or user-management UI

### User and Admin Creation

The planned model includes a server-generated ID, normalized email, password
hash, `admin` role, `active` or `disabled` status, and server timestamps.

Block 16.1 implements email normalization as trim plus lowercase with a
254-character bound and basic email-shape validation. The application port
separates an ID-based `UserAccount` lookup from the internal email-based
`UserAuthenticationRecord`, so ordinary user records do not contain a password
hash. Migration `003_create_users` enforces the role, status, canonical email,
email length, and named unique-email constraints. Applying that migration to a
real database remains an explicit runtime operation; the block did not alter a
local or AWS database.

The initial user is created with a one-time command such as
`pnpm user:create-admin`. The password must come from an approved non-source
input mechanism, must never be printed, and must never be committed. Duplicate
normalized email must fail clearly. The command must not create a registration
endpoint.

Use Argon2id through an injected `PasswordHasher` port. Never use plaintext,
SHA-256, reversible encryption, or a custom password-hashing implementation.
Use the maintained `argon2` package and its PHC hash representation, beginning
with `19 MiB`, two iterations, and parallelism one. Benchmark without weakening
that documented baseline. Passwords support Unicode and spaces, use consistent
NFC normalization, require 15-128 characters, have no composition rules, and
are checked against a bounded common and context-specific blocklist.

Block 16.2 implements separate normalization and new-password validation paths.
Verification can continue to normalize an existing password if a later release
expands the blocklist, while account creation applies both the blocklist and
context derived from the normalized email. `packages/auth` owns the maintained
Argon2 dependency and PHC representation. `apps/admin-cli` requires an explicit
`--email`, asks for matching passwords through masked prompts, emits only
bounded errors, runs bundled migrations, and closes the database on every
post-connection outcome.

Five-sample benchmarks with the accepted Argon2id parameters measured a maximum
hash time of 16.2 ms on the ARM64 Mac development host and 18.7 ms in the ARM64
Node 24 Debian container. No CI timing assertion was added. The CLI was not run,
so Block 16.2 did not create a local or production administrator.

Unknown-email authentication performs one verification against a fixed valid
dummy hash. Unknown email, wrong password, and disabled user return the same
public status and error shape.

Block 16.4 implements this boundary in `packages/application`. `Login`
normalizes an existing password without applying the evolving new-password
blocklist, performs exactly one verification for every password inside the
accepted input bounds, and issues a token only for an active matching user. A
malformed email uses the same fixed dummy-hash path as an unknown email. Inputs
outside the password bounds fail generically before Argon2 work so an attacker
cannot force unbounded password processing.

`GetCurrentUser` treats the verified JWT as a candidate identity, reloads the
user by subject, requires an active account, and rejects role drift. Its result
contains only ID, normalized email, and current database role. Known token
validation failures become one bounded authentication error; repository and
unexpected infrastructure failures remain operational failures.

There is intentionally no no-op application `Logout` use case. With no refresh
token or server-side revocation state, logout is the idempotent HTTP operation
that clears the exact session cookie in Block 16.5. It does not invalidate a
copied access token for an otherwise active user.

### JWT and Cookie Contract

The JWT contains only the minimum claims:

```text
sub, role, iat, exp, iss, aud, jti
```

It never contains passwords, hashes, API keys, or unnecessary personal data.
JWT issuer, audience, and signing secret are server configuration. The signing
secret must never enter the React bundle.

Use `jose`, fixed `HS256` verification, a random secret with at least 256 bits
of entropy, an explicit token type, and a 60-minute initial lifetime. JWT
verification identifies a candidate user only. Every protected request reloads
that user by `sub`, requires `active` status, and derives authorization from the
current database role rather than trusting the token role alone.

Block 16.3 implements this profile with `jose@6.2.9`. The signing secret is
canonical base64url that decodes to 32-64 bytes. The protected header contains
only `alg=HS256` and `typ=cpi-access+jwt`; the payload contains only the seven
required claims. Subject and token ID are UUIDs, audience must be the configured
scalar value, lifetime is exactly 3600 seconds, and clock tolerance is five
seconds. All verification failures cross the application boundary as the same
`InvalidAccessTokenError`.

`apps/api` exposes an independent `loadAuthConfig` for `JWT_SIGNING_SECRET`,
`JWT_ISSUER`, and `JWT_AUDIENCE`. Block 16.5 loads it in the API composition
root and passes it only to the server-side token service. No production secret
was created or synchronized by either block.

The API returns the JWT in a cookie with:

- `HttpOnly`
- `Secure` in production
- `SameSite=Strict`, unless a documented deployment constraint justifies Lax
- `Path=/`
- bounded `Max-Age`

Local development may use `Secure=false` only through explicit environment-aware
configuration. Logout clears the exact cookie contract used by login. Do not
store the token in `localStorage` or `sessionStorage`.

Block 16.5 implements the HTTP boundary in `apps/api`. `POST /api/auth/login`
accepts only bounded JSON with the exact `email` and `password` fields, sets the
session cookie, and returns ID, normalized email, and role. Logout clears the
same host-only cookie and returns `204`. `/api/auth/me` and `/api/listings` read
only that cookie and never accept a bearer token. The authentication middleware
calls `GetCurrentUser` on every request, so a missing, disabled, or role-drifted
user is denied before listing data is queried.

Local mode binds only to `127.0.0.1`, uses `cpi_session`, and defaults to the
Vite origin `http://127.0.0.1:5173`. Explicit production mode binds to
`0.0.0.0`, reads App Runner's `PORT`, requires an HTTPS public origin, and uses
`__Host-cpi_session`. The production origin-verification secret is compared in
constant time before body parsing and authentication. `GET /api/health` is the
only origin-header exception so App Runner can probe a non-sensitive route; it
does not query application use cases or the database. This code boundary does
not provision App Runner, CloudFront, WAF, or production secrets.

### React Session Boundary

Block 16.6 implements the four-state React boundary from ADR 0004:

```text
checking session | signed out | authenticated | recoverable error
```

The browser calls only same-origin `/api` endpoints with the HttpOnly session
cookie. It never reads a JWT and never writes authentication data to
`localStorage` or `sessionStorage`. The application validates the minimum
`id`, `email`, and `admin` role DTO before treating a session as authenticated.
It does not mount the listings workspace until bootstrap or login succeeds.

The login form supports password-manager autofill and bounded submitting,
invalid-credential, rate-limited, and unavailable states. A `401` from the
listings client signs the UI out instead of showing a generic data error.
Logout remains a POST command; success unmounts protected content, while a
network or server failure preserves the workspace and shows a bounded notice.
These client guards are presentation behavior only. Express remains the
authorization boundary on every protected request.

### HTTP Security

- keep the accepted local Vite-proxy and production CloudFront flows
  same-origin; do not enable CORS
- require an exact configured `Origin` for every unsafe request, including
  login and logout
- use HTTPS in production
- run the App Runner origin guard before body parsing and authentication
- layer an application login limiter with a CloudFront WAF rate rule
- return the same generic error for unknown email and incorrect password
- deny disabled users
- log security outcomes without password, token, or cookie values
- return only the minimum profile from `/auth/me`

Block 16.7 implements the application layer of this profile. The in-process
limiter uses one bounded global fixed window because the deployed CloudFront and
App Runner proxy chain has not yet been verified as a trustworthy viewer-IP
source. It permits ten failed login responses per 15 minutes per API instance,
does not count successful responses, runs before JSON parsing and Argon2, and
returns bounded `429` JSON plus `Retry-After` and a standard `RateLimit` header.
Its clock and thresholds are injected in tests; tests never wait for a real
window. The counter is defense in depth and is not a distributed production
control.

Helmet adds API response hardening, with HSTS enabled only in explicit
production mode. The static web document has a CSP that permits same-origin
scripts, styles, workers, images, and API calls plus connections to the selected
`tiles.openfreemap.org` map service. Inline scripts and eval remain forbidden.
CloudFront must apply the reviewed production response-headers policy when the
static origin is deployed because S3 metadata does not replace an edge policy.

All requests receive a server-generated `X-Request-ID`; viewer-provided request
IDs are ignored. Security events contain only a bounded event name and request
ID. The listings route applies authentication before reusable admin
authorization, preserving `401` for missing or invalid sessions and reserving
`403` for an authenticated identity that lacks the required role.

A future cross-origin client requires a separate review and exact credentialed
allowlist. Wildcard credentialed CORS is never allowed.

### Authentication Test Inventory

- valid credentials and normalized email
- wrong password, unknown user, and disabled user
- indistinguishable public errors for credential failures
- Argon2id hash differs from plaintext
- admin command rejects duplicate email and does not print the password
- required JWT claims, expiration, invalid signature, and wrong issuer/audience
- missing or invalid cookie
- protected route returns 401 when unauthenticated
- admin-only route returns 403 for insufficient authorization
- logout clears the cookie
- login rate limiting and CSRF/origin behavior
- server-generated request IDs and credential-free security events
- CSP and environment-specific security headers
- real Argon2id and JOSE cookie flow through login, listings, logout, and denial

The complete accepted threat model, route contracts, residual risks, and
sub-block ownership are recorded in
[ADR 0004](../adr/0004-single-user-authentication.md).

## Block 17: Manual Listing Management

### Product Scope

Manual listings support properties supplied by a client or found through another
compliant source when RentCast does not return them. They extend the shared
normalized model:

```ts
type ListingSource = "rentcast" | "manual";
```

Do not create a disconnected manual-listing model. Exact optionality and schema
migration must be designed from the current listing model at Block 17.1.

In scope:

- `POST /api/listings/manual`
- `PATCH /api/listings/:id`
- `POST /api/listings/:id/archive`
- authenticated creation, edit, and archive UI
- address entry plus map marker confirmation

Permanent deletion and an unreviewed geocoding provider are out of scope.

### Identity and Ownership

- use a server-generated UUID
- force `source = "manual"`
- allow `sourceListingId` to be absent
- derive `createdByUserId` from JWT `sub`
- generate IDs and timestamps on the server
- never allow clients to set database IDs, ownership, source, or timestamps
- archive records instead of deleting history

Duplicate detection, if needed, begins with a separately reviewed, explainable
normalization strategy. Do not silently merge potentially distinct properties.

### Validation and Authorization

Every write endpoint requires authentication and admin authorization. Validate
with Zod or the established project mechanism, including:

- required address fields
- supported state, status, and source values
- finite latitude in `[-90, 90]`
- finite longitude in `[-180, 180]`
- string and notes length limits
- optional numeric property fields
- an explicit allowlist of editable fields

MapLibre/OpenFreeMap is not a geocoder. The first workflow asks the user to
enter address data, place or drag a marker, confirm coordinates, and then save.

### Manual Listing Test Inventory

- unauthenticated write returns 401
- non-admin write returns 403
- valid creation succeeds
- server controls ID, owner, source, and timestamps
- invalid coordinates and missing address fields are rejected
- invalid source/status and excessive notes are rejected
- edit cannot overwrite protected fields
- archive removes a record from default active queries without deleting it
- RentCast and manual listings can be read through one normalized contract
- repository and application tests use no external API

### Block 17.1 Implementation Baseline

Block 17.1 implements the shared model and persistence foundation in
[ADR 0005](../adr/0005-manual-listing-model.md). RentCast records retain their
required provider identity and complete search facts. Manual records have no
provider source ID and may omit property type, bedrooms, bathrooms, price, and
listed date, while address fields, coordinates, status, and server timestamps
remain required.

Migration 004 adds ownership, bounded notes, archive metadata, persistence
timestamps, source-aware checks, and `not_applicable` notification state. It is
bundled but has not been applied to local or AWS PostgreSQL. Creation, HTTP
writes, forms, edit/archive commands, and active-query filtering remain owned
by Blocks 17.2 through 17.5.

### Block 17.2 Implementation Baseline

Block 17.2 implements the pure manual draft normalizer,
`CreateManualListing`, `ManualListingRepositoryPort`, and
`PostgresManualListingRepository`. The command separates the authenticated
actor ID from editable draft fields, injects server UUID/time, and returns a
manual record with ownership and lifecycle metadata.

The accepted first-release values are California, `Active` or `Pending` status,
confirmed finite coordinates, optional nonnegative property facts, and an
optional valid `YYYY-MM-DD` listed date. Price is an integer within PostgreSQL
range; bedrooms and bathrooms are bounded at 100; notes are bounded at 4,000
characters. Formatted address, source, source ID, discovery/last-seen values,
database identity, ownership, notification state, and persistence timestamps
are not editable.

The PostgreSQL adapter uses `manual:<UUID>` only as an internal deduplication
key and performs no address-based merge. Block 17.3 still owns the protected
HTTP DTO/parser, verified JWT actor injection, API composition, and migration
execution decision. Migration 004 has not been applied locally or in AWS.

### Block 17.3 Implementation Baseline

Block 17.3 implements `POST /api/listings/manual`. Origin verification, exact
Origin enforcement, session authentication, and admin authorization all run
before the route's 8 KiB JSON parser. The login route now uses its own 4 KiB
parser after the failed-login limiter, preserving its existing security order.

The manual request DTO is strict and accepts only editable draft fields. Extra
protected fields, wrong primitive types, malformed JSON, arrays, and oversized
bodies return bounded `400 INVALID_REQUEST` responses without executing the use
case. Domain failures return `400 INVALID_MANUAL_LISTING` with a field name but
no submitted value. Successful responses contain the shared listing summary
only; owner, notes, internal deduplication/notification state, and persistence
timestamps remain private.

The API entrypoint now composes `CreateManualListing`, the PostgreSQL adapter,
`randomUUID`, and a server clock. `runBundledMigrations` still completes before
the listener starts, so migration 004 is required and will apply on the next
actual API startup. No local API process, migration, database connection, or AWS
operation was executed while implementing Block 17.3.

### Block 17.4 Implementation Baseline

Block 17.4 implements the authenticated browser creation workflow. The listings
workspace exposes `Add listing` even when no records exist and swaps its list
panel for an accessible, bounded form while preserving the map. Required and
optional controls match the Block 17.3 editable DTO; coordinates are never typed
into the request independently of the map state.

MapLibre owns one draggable draft marker in addition to the stored-listing
GeoJSON layer. A map click places the marker, a drag updates its coordinates, and
either action clears prior confirmation. Submission remains disabled until the
current coordinates are explicitly confirmed. No address lookup, geocoder, tile
credential, or additional external API is introduced.

The browser client posts same-origin JSON to `POST /api/listings/manual`, parses
the returned shared summary at runtime, and reduces bounded server validation to
form-level or field-level feedback without displaying response internals. A
create-time `401` enters the same signed-out state as an expired listing read.
Successful creation inserts and selects the authoritative returned summary, so
manual and RentCast records continue through one list and map contract.

Desktop creation keeps the scrolling form and map visible side by side. Mobile
creation uses Details and Map modes without unmounting the shared workflow state.
Tests cover marker confirmation and invalidation, request serialization,
malformed responses, field feedback, successful list refresh, and session
expiry. No API process, PostgreSQL connection, migration, or AWS operation ran
while implementing this block.

### Block 17.5 Implementation Baseline

Block 17.5 implements administrator-only manual listing edits and soft archive.
The application layer accepts a non-empty partial draft, reloads an active
manual record, merges omitted values, preserves notes unless `notes` is present,
normalizes the complete result, and supplies one server timestamp to persistence.
Archive sets `archived_at` and `updated_at` to one server timestamp. Invalid,
missing, archived, and RentCast IDs share `ManualListingNotFoundError` so callers
cannot infer protected record state.

`PATCH /api/listings/:id` accepts only the existing editable allowlist and uses
the manual 8 KiB JSON limit. `POST /api/listings/:id/archive` has no request
body. Both routes require exact unsafe-method Origin, a live session, and admin
authorization. Patch success returns the shared listing summary with `200`;
archive success returns `204`. Protected fields produce bounded `400` responses,
and unavailable editable records produce bounded `404` responses.

The PostgreSQL adapter selects and mutates only active `source = 'manual'` rows.
Update statements do not write identity, source, owner, creation time, discovery
time, or notification state. Archive uses `UPDATE`, never `DELETE`, and the
default listing query filters `archived_at IS NULL`.

In React, actions appear only for a selected manual listing. Edit mode preloads
the public summary and treats its current coordinates as confirmed; moving the
draft marker clears confirmation. Because notes are not part of the public read
contract, the editor offers explicit keep, replace, and clear choices. Archive
uses an inline confirmation and removes the successful record from active list
and map state. Mutation-time `401` responses reuse the existing signed-out
boundary. No local API, PostgreSQL, migration, external API, or AWS operation ran
while implementing this block.

### Block 17.6 Integration Test Baseline

Block 17.6 closes the manual listing feature with three stateful, external-free
integration tests:

- `manualListingLifecycle.integration.test.ts` in the PostgreSQL package runs
  `CreateManualListing`, `UpdateManualListing`, `ArchiveManualListing`, and
  `ListListings` against the real PostgreSQL adapters through an in-memory SQL
  harness. It checks normalization, parameter mapping, metadata preservation,
  soft archive, active filtering, and the absence of `DELETE`.
- `manualListingLifecycle.integration.test.ts` in the API runs loopback HTTP
  through real security middleware, DTO parsing, response mapping, and listing
  use cases backed by one stateful in-memory repository. It checks actor-derived
  ownership, private-note preservation, RentCast write protection, bounded
  `404`, audit events, archive, and the final active listing response.
- `manualListingWorkflow.integration.test.tsx` renders the authenticated React
  application with real session and listing HTTP clients backed by a stateful
  fetch harness. It drives map-confirmed creation, partial edit, inline archive,
  request serialization, and the resulting empty state.

Focused tests, the full suite, type checking, production builds, and diff checks
form the Block 17 completion gate. These integration harnesses start no durable
service and use no real database, migration, map tiles, provider API, secret, or
AWS resource.

## Block 18: OpenAI Showing List Drafts

### Product Scope

The feature generates an agent-review draft from selected properties:

```text
weekly AWS trigger or authorized manual request
-> reload the selected authoritative listings
-> generate structured draft
-> validate and replace the single current draft
-> send the administrator a temporary Telegram download link
-> review and edit
-> mark reviewed
-> copy or export
```

The production schedule generates one draft per week. The exact weekday, time,
time zone, and initial enabled state remain explicit Block 18.8 deployment
parameters. Manual generation may use the same application use case but cannot
create a second retained draft. The scheduled job reads listing IDs and bounded
preferences from an explicit current server-side generation configuration
defined in Block 18.1; it never depends on transient browser state. A missing or
invalid configuration preserves the prior draft and sends no Telegram message.

The first release sends an operational download link only to the configured
administrator Telegram chat. It does not email or message clients, schedule
showings, alter listing facts, make final property choices, or claim accurate
routes, commute times, MLS status, school boundaries, wildfire
classifications, valuations, or legal conclusions.

### Trusted Input Boundary

The browser sends listing IDs and bounded preferences, not authoritative listing
facts or a map screenshot. The API reloads every selected listing from the
database before generation. Limit listing count and all text lengths.

Minimize customer data sent to the model:

- no email, phone, identity documents, or financial documents
- use a first name, initials, or no display name
- treat agent instructions, notes, and other user text as untrusted content
- do not send large MLS public remarks without a separate authorization,
  injection, and token-cost review

The endpoint is `POST /api/showing-lists/generate` and requires authenticated
admin authorization.

### Block 18.1 Contract

Block 18.1 places provider-neutral runtime schemas in the application package.
The current generation configuration is a strict object:

```ts
interface ShowingListGenerationInput {
  listingIds: string[];
  preferences: {
    clientDisplayName: string | null;
    showingDate: string | null;
    agentInstructions: string | null;
  };
}
```

The selection contains one through ten unique UUIDs. A non-null display name is
trimmed and limited to 80 characters, the date must be a real `YYYY-MM-DD`, and
agent instructions are trimmed and limited to 2,000 characters. All preference
keys are required so omitted and intentionally absent values cannot be confused;
the absent value is explicit `null`. Unknown root or preference keys are
rejected, including a client-provided system prompt or contact field.

The structured generator output is also a strict object:

```ts
interface GeneratedShowingList {
  title: string;
  summary: string;
  stops: Array<{
    listingId: string;
    proposedOrder: number;
    orderReason: string;
    highlights: string[];
    considerations: string[];
  }>;
  clientMessage: string;
  reviewWarnings: string[];
}
```

Every field is required for Structured Outputs. Arrays may be empty only where
the contract permits it. Strings, arrays, and integer order values have explicit
application limits. Stops contain only a listing UUID and generated commentary;
they do not contain address, price, status, coordinates, MLS data, or other
authoritative facts. Block 18.3 joins stops to freshly loaded database listings
and verifies that every selected ID appears exactly once. The current output
schema already rejects duplicate IDs and requires order values to be the unique,
continuous sequence from one through the stop count.

The production download artifact is a PDF with media type `application/pdf` and
filename `showing-list-draft.pdf`. Block 18.1 defines that stable artifact
contract but does not render or store a PDF.

### Generator Boundary

Application code depends on an injected port:

```ts
interface ShowingListGenerator {
  generate(
    context: ShowingListContext,
  ): Promise<ShowingListGenerationResult>;
}
```

### Block 18.2 Port and Fake

The application-owned `ShowingListContext` contains the validated preferences
and a minimal listing projection with ID, formatted address, coordinates,
nullable property facts, status, listed date, and nullable MLS identity. It
does not expose provider source IDs, ingestion timestamps, database metadata,
private notes, customer contact details, credentials, or OpenAI SDK types.

The port returns an envelope rather than only generated content:

```ts
interface ShowingListGenerationResult {
  draft: GeneratedShowingList;
  metadata: {
    model: string;
    responseId: string | null;
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
    durationMs: number;
  };
}
```

Metadata is operational input for later current-draft persistence and cost
visibility. It contains no prompt text, generated content, customer data, API
key, request headers, or raw provider response.

`FakeShowingListGenerator` is a reusable deterministic adapter for application
and integration tests. It records each context and returns one configured result
or throws one configured `Error`. It deliberately does not parse or validate
the configured result: Block 18.3 must treat every adapter result as untrusted at
runtime and apply the application schema and cross-listing invariants itself.
Provider error classification remains deferred to the Block 18.5 adapter.

### Block 18.3 Authoritative Generation Use Case

`GenerateShowingListDraft` accepts the verified actor separately from the
Block 18.1 request. The future HTTP layer must derive `actorUserId` from the
authenticated session; it never reads actor identity from a request body. The
use case validates both actor UUID and request before reading listings.

The application-owned `ShowingListListingQueryPort` exposes one operation:

```ts
interface ShowingListListingQueryPort {
  findActiveListingsByIds(
    listingIds: readonly string[],
  ): Promise<ListingRecord[]>;
}
```

`PostgresListingQuery` implements this boundary with an active-only,
parameterized query:

```sql
WHERE archived_at IS NULL
  AND id = ANY($1::uuid[])
```

The UUID array is one query parameter and is never interpolated into SQL. An
empty selection does not contact PostgreSQL. The adapter's row order is not a
business contract: the use case rejects missing, duplicate, and unexpected
records, then restores the original validated selection order before projecting
the minimal `ShowingListContext`. Archived and nonexistent IDs are intentionally
indistinguishable through `ShowingListSelectionUnavailableError`.

After generation, the use case parses the complete result again. It enforces
the Block 18.1 draft schema, exact selected listing-ID set, bounded model and
response identifiers, nullable nonnegative integer token counts, and a maximum
15-minute duration. Invalid input, unavailable selection, and invalid generator
result use separate bounded application errors without embedding Zod issues,
addresses, preferences, provider output, or metadata values. Operational errors
from the generator are not relabeled; provider-specific mapping remains a Block
18.5 responsibility.

Block 18.3 does not expose an HTTP endpoint or persist a draft. Authentication
middleware, persistence, lifecycle updates, prompt construction, provider calls,
and publication remain owned by later sub-blocks.

At implementation time, consult current official OpenAI documentation and ask
for an explicit model choice after explaining quality, latency, and cost. Use
the Responses API and Structured Outputs rather than parsing arbitrary Markdown.
The OpenAI API key remains backend-only; never introduce a
`VITE_OPENAI_API_KEY`.

### Prompt and Output Integrity

Use a fixed, server-owned, explicitly versioned prompt such as
`SHOWING_LIST_PROMPT_VERSION = "v1"`. The client cannot provide a system prompt.

The prompt and programmatic validation require:

- only supplied authoritative data and listing IDs
- no invented or duplicate property
- database addresses remain authoritative
- missing facts are reported as not provided
- unique, continuous proposed order values
- no invented drive time, school boundary, or wildfire result
- no claim that an explanatory order is the shortest route
- prompt-injection text in notes or instructions has no authority
- refusal, incomplete output, or schema failure is not a successful draft

Precise routing remains a future routing-engine concern. A language model can
explain an order but does not calculate a guaranteed shortest route.

### Persistence and Review

Persist one application-visible current draft rather than an append-only series
of generation snapshots. The current database record stores the creator,
generation ID, prompt version, model, bounded input snapshot, validated result,
artifact key and ETag, lifecycle and delivery states, and server timestamps.
Provider response ID, bounded token usage, duration, and a non-sensitive failure
category may be retained only on that current record or in bounded operational
logs.

Never persist API keys, JWTs, passwords, or unnecessary customer data.

Initial lifecycle:

```ts
type ShowingListStatus = "draft" | "reviewed";
type ShowingListDeliveryStatus = "pending" | "sent" | "failed";
```

The first review UI supports editing title, summary, order, highlights,
considerations, and client message; saving; marking reviewed; copying; and
downloading the current private artifact. Client email, client messaging, and
automatic client sharing are deferred.

### Latest-Only Retention

Latest-only is an application invariant for the current single-administrator
product:

- the database contains at most one application-visible current draft row
- private S3 storage contains one stable artifact key, such as
  `showing-lists/current.<format>`
- the artifact bucket remains unversioned and does not use Object Lock
- publication overwrites the stable key; it does not create dated keys or
  noncurrent object versions
- a lifecycle rule aborts incomplete multipart uploads so abandoned parts do
  not accumulate storage cost
- CloudWatch retains only bounded, non-content operational metadata under the
  project retention policy

Block 18.1 selected PDF as the downloadable format. The one-current-object rule
does not depend on that format choice.

Generate and validate the complete replacement before touching the current
artifact. S3 publication of one key is atomic, so readers observe the old or the
new complete artifact, never a partial object. If generation, validation, or
upload fails, the current database record and artifact remain unchanged and no
Telegram message is sent.

After a successful upload, upsert the singleton database record with the new
generation ID and S3 ETag. If that metadata write fails, the job fails and an
idempotent retry reconciles the same generation and ETag; it must not create a
history object. Application-visible primary storage remains latest-only, while
AWS-managed database backups may retain prior bytes for their separate bounded
backup window.

### Telegram Download Delivery

After the replacement is published and its current metadata is committed, the
job creates a short-lived S3 presigned download URL and sends it to the
configured administrator Telegram chat. The message identifies the content as
an unreviewed draft and states that the link expires.

- the artifact bucket blocks public access; Telegram receives a temporary URL,
  not a public object
- URL lifetime is the shorter of the configured expiry and the task's temporary
  AWS credential lifetime
- the URL is generated at delivery time and is never persisted or logged
- download responses request an attachment filename
- because every URL targets the stable current key, an older unexpired message
  can expose only the current artifact, never a retained historical draft
- a Telegram failure does not roll back or delete the successfully published
  current draft; delivery remains `failed` or `pending` for bounded retry
- the generation ID and sent timestamp prevent ordinary retries from sending
  the same successful delivery twice

Telegram retains the message independently, but the embedded URL loses access
when it expires. A later on-demand link refresh can reuse the same current
artifact without creating another stored draft.

### Fair Housing Guardrails

Generation and review must use consistent, objective, source-attributed facts.
The prompt and validation must not recommend, exclude, or rank using protected
characteristics or proxies, including race, color, national origin, religion,
sex, familial status, disability, and applicable California protected classes.

Disallow steering language such as "good neighborhood", "safe for families",
"best for Asian buyers", "ideal demographic", or "people like you live here".
School, language, restaurant, grocery, and neighborhood-demographic information
must not act as protected-class proxies. Every generated result remains a draft
for the licensed agent's final review.

### OpenAI Test Inventory

CI never calls the real OpenAI API. Use a fake generator for application tests
and a mocked SDK or HTTP boundary for adapter tests.

- unauthenticated and unauthorized requests
- empty selection and listing-count limit
- authoritative database reload
- successful structured response
- timeout, rate limit, authentication failure, refusal, and incomplete response
- invalid schema, hallucinated ID, duplicate ID, attempted authoritative fact
  field, and bad order
- first successful publication creates one current row and one current object
- second successful publication replaces both without a history row, dated key,
  or S3 object version
- generation, validation, or upload failure preserves the previous current
  draft and sends no Telegram message
- database metadata failure is idempotently reconciled by generation ID and ETag
- Telegram runs only after publication and metadata commit
- Telegram failure preserves the current draft and records bounded retry state
- retry after a successful Telegram send does not intentionally duplicate it
- presigned URLs are short-lived, absent from persistence and logs, and target
  only the stable current key
- prompt version, model, and safe usage metadata persistence on the current row
- no secrets in logs
- arbitrary client system prompt rejected
- prohibited Fair Housing instruction cannot override system rules
- weekly schedule configuration, single-run idempotency, and disabled-state gate
- missing or invalid scheduled-generation configuration preserves the current
  draft and sends no Telegram message

## Cross-Feature Rules

- all write APIs require server-side authentication and authorization
- configuration is loaded only at composition roots
- no real external API call runs in CI
- no secret appears in source, fixtures, logs, snapshots, or chat
- authoritative facts are loaded server-side
- migrations are explicit and reviewed
- all three features continue the one-sub-block-at-a-time confirmation rhythm
- exact package and endpoint ownership is revalidated against the repository
  before implementation
