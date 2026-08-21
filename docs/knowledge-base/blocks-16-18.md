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
contract, and Block 18.6.2 implements its in-memory renderer. Storage and
publication remain separate boundaries.

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

### Block 18.4 Fixed Prompt and Guardrails

The application package owns `SHOWING_LIST_PROMPT_VERSION = "v1"`, the fixed
`SHOWING_LIST_PROMPT_INSTRUCTIONS`, and a deterministic
`buildShowingListPrompt(context)` function. The returned value contains the
version, the static instructions, and a JSON input envelope with a fixed task
name and `untrustedContext`. It is provider-SDK neutral and maps directly to the
Responses API separation between `instructions` and `input` documented by the
[official OpenAI Responses API](https://developers.openai.com/api/reference/cli/resources/responses/methods/create).

Listing facts, client display name, and agent instructions are serialized only
inside the input envelope. They are never interpolated into the developer
instructions. The prompt explicitly treats every input value as untrusted data;
`agentInstructions` can express optional preferences but cannot change roles,
policy, output shape, grounding rules, or reveal fixed instructions. JSON
encoding safely preserves quotes, newlines, and delimiter-like text without
turning those values into a higher-priority prompt segment.

The fixed v1 instructions require:

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

The v1 prompt also carries the accepted Fair Housing constraints: objective
property facts only; no recommendation, exclusion, ranking, or steering based
on protected characteristics or proxies; no demographic or neighborhood
composition claims; and a neutral review warning when conflicting preference
text is ignored. This is an instruction-layer defense combined with the strict
schema and exact-ID validation from Blocks 18.1 and 18.3. It is not presented as
a comprehensive semantic compliance classifier, and every result remains an
unreviewed draft for a licensed agent.

Tests verify the fixed version, deterministic JSON envelope, separation of
authoritative values from developer instructions, special-character encoding,
prompt-injection isolation, and the presence of grounding, routing, Fair
Housing, schema, and review guardrails. Block 18.4 performs no provider call and
adds no SDK, model selection, API key, endpoint, persistence, migration, or AWS
resource.

### Block 18.5 OpenAI Responses Adapter

The user explicitly selected `gpt-5.6-terra` with medium reasoning after a
quality, latency, and cost review on August 20, 2026. At selection time, the
[official OpenAI model comparison](https://developers.openai.com/api/docs/models/compare)
described Terra as the intelligence-and-cost balance in the GPT-5.6 family,
supported the Responses API and Structured Outputs, and listed standard text
pricing of USD 2 per million input tokens and USD 12 per million output tokens.
Pricing and model availability remain external service facts that must be
rechecked before a later production deployment or model change.

`packages/openai` implements `ShowingListGenerator` with the official
`openai@7.5.0` TypeScript SDK. Its approved configuration is fixed in code:

```ts
const OPENAI_SHOWING_LIST_CONFIGURATION = {
  model: "gpt-5.6-terra",
  reasoningEffort: "medium",
  maxOutputTokens: 16_000,
  timeoutMs: 120_000,
  maxRetries: 2,
  responseFormatName: "showing_list_draft",
};
```

The adapter uses `responses.parse()` with the application-owned Zod schema via
`zodTextFormat`. It sends the Block 18.4 fixed prompt as `instructions`, the
separate JSON envelope as `input`, `store: false`, `truncation: "disabled"`, and
low text verbosity. It enables no model tools and does not send a conversation,
previous response, browser actor ID, customer contact detail, private note, or
provider credential inside the body. The API key is supplied only to the
backend SDK client.

A successful call returns the parsed draft plus the actual response model,
response ID, nullable input/output/total token counts, and integer elapsed
milliseconds. The Block 18.3 use case still revalidates the complete result and
exact listing-ID set; SDK parsing is not treated as the sole trust boundary.

Provider and transport failures cross the adapter as fixed, non-sensitive error
classes for authentication/access, rate limiting, timeout, refusal, incomplete
output, invalid response, or general unavailability. Provider messages,
request IDs, response bodies, refusal text, API keys, and network details do not
appear in those errors. A content-filter incomplete result is classified as a
refusal; a max-output-token result is incomplete; malformed or schema-invalid
JSON is invalid; failed terminal responses and connection errors are
unavailable.

Adapter tests exercise the actual SDK request builder, JSON Schema helper, and
response parser behind mocked `fetch`. They verify the model and reasoning
profile, `store: false`, prompt/input separation, usage metadata, and every
failure category without contacting OpenAI. Block 18.5 does not add
`OPENAI_API_KEY` to `.env.example`, `.env.local`, GitHub, AWS Secrets Manager, or
any frontend variable because no runtime composition exists yet. Never
introduce `VITE_OPENAI_API_KEY`. Live secret injection and an explicitly
authorized provider smoke test remain later deployment gates.

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

### Block 18.6.1 Current Draft Persistence

The application layer owns two strict runtime contracts. A replacement contains
the generation UUID, administrator UUID, prompt version, bounded Block 18.1
request snapshot, validated generated draft, bounded provider metadata, stable
artifact key and ETag, and generation timestamp. A current record adds the
lifecycle state, delivery state, nullable delivery timestamp, and update
timestamp. The only accepted artifact key is
`showing-lists/current.pdf`; dated and generation-specific keys fail validation.
Unknown fields also fail validation so secrets and unrelated customer data
cannot silently enter the current record.

Migration `005_create_current_showing_list_draft` creates the singular
`current_showing_list_draft` table. Its primary key accepts only `current`, so
PostgreSQL can hold at most one row. Named checks enforce bounded prompt/model,
provider response ID, token counts, duration, object-shaped JSON, the stable PDF
key, artifact ETag, lifecycle and delivery enums, delivery timestamp
consistency, and timestamp order. The creator references `users` with restricted
deletion. There is no history table, date-based artifact key, append-only event
row, or draft-history index.

`PostgresCurrentShowingListDraftRepository` validates replacement input before
querying and strictly validates every returned row. Its transaction inserts the
first generation and overwrites the singleton for a different generation. If a
retry supplies the same generation ID, the upsert performs no update; a second
lookup returns the existing row only when its ETag also matches. This preserves
review edits and delivery state after an ambiguous successful commit. Reusing a
generation ID with a different ETag raises a stable conflict instead of changing
the current record.

Block 18.6.1 checked in the migration and adapter but did not connect to or
modify a local or AWS database. It did not call S3, provision a bucket, compose
a runtime, call OpenAI, create a presigned URL, or send Telegram. Later
sub-blocks preserve those execution boundaries unless they explicitly introduce
and review the corresponding operation.

### Block 18.6.2 PDF Artifact Rendering

The application layer owns `ShowingListArtifactRendererPort`. Its input contains
only the generation identity and time, the validated preferences, the minimal
authoritative listing projection, and the validated structured draft. Its fixed
result contract is an in-memory byte array with media type `application/pdf`
and filename `showing-list-draft.pdf`. The application-level maximum is 5 MiB;
the renderer fails closed when output is empty or exceeds that bound.

`packages/pdf` implements the port with `pdfkit@0.19.1`. It revalidates all
input at the adapter boundary, requires one through ten unique authoritative
listings and an exact generated listing-ID set, and sorts stops by their
continuous proposed order. Generated content supplies only the title, summary,
order rationale, highlights, considerations, client message, and review
warnings. Address, price, beds, baths, property type, status, listed date, and
MLS identity always come from the authoritative listing projection. Private
`agentInstructions` are accepted as part of the validated preferences contract
but are never written into the artifact.

The Letter-size PDF contains:

- fixed project branding and an unreviewed-draft banner
- generation, showing-date, client, property-count, and draft-reference metadata
- a plan overview and one ordered section per selected property
- a clearly labeled draft client message and review warnings
- a final review boundary covering availability, MLS, price, showing
  instructions, route, legal, valuation, school-boundary, safety, wildfire, and
  Fair Housing review
- automatic wrapping, multi-page flow, and `Page X of Y` footers

The adapter uses PDFKit's built-in fonts, normalizes supported punctuation to a
safe WinAnsi-compatible form, and substitutes unsupported glyphs rather than
allowing an untrusted generated string to break the stream. Creation and
modification metadata derive from the supplied generation time, so identical
validated input produces identical bytes. Rendering buffers the complete PDF in
memory and performs no filesystem, network, database, S3, OpenAI, or Telegram
operation.

Focused tests cover the fixed artifact contract, authoritative/generated
content composition, private-instruction omission, proposed ordering,
deterministic bytes, maximum bounded multi-page output, page footers, unsupported
glyphs, malformed input, mismatched IDs, and byte-limit failure. A representative
four-property PDF was rendered to PNG page images and visually checked for
wrapping, hierarchy, page breaks, overlap, clipping, and footer placement. S3
publication and stable-key replacement begin in Block 18.6.3.

### Block 18.6.3 Stable-Key S3 Storage

The application layer owns `ShowingListArtifactStorePort`. Its only write
operation accepts a `RenderedShowingListArtifact` and returns the fixed current
key plus a bounded ETag. The caller cannot supply a bucket, object key, ACL,
custom metadata, cache policy, encryption mode, or provider command. This keeps
dated keys, generation-specific keys, and arbitrary object publication outside
the application contract.

`packages/s3` implements the port with the modular AWS SDK for JavaScript v3
S3 client. Before any provider call it strictly accepts only the three-field PDF
artifact contract, requires one through 5 MiB of bytes, and copies the byte array
so caller mutation cannot change an in-flight upload. Every replacement uses one
`PutObjectCommand` with:

- bucket name and 12-digit expected AWS account owner supplied at composition
- key `showing-lists/current.pdf`
- exact `application/pdf` content type and attachment filename
- `Cache-Control: no-store, max-age=0`
- a precomputed SHA-256 transfer checksum
- SSE-S3 request encryption and no ACL or user-defined object metadata

The adapter requires a nonblank bounded ETag for database reconciliation. Any
returned VersionId is rejected as configuration drift because the production
bucket must remain unversioned. AWS failures map to one stable non-sensitive
unavailable error; missing ETag, oversized ETag, or unexpected version identity
maps to a distinct invalid-response error. The adapter performs no logging and
does not expose the bucket name or provider message through its errors.

The production CDK stack now defines a dedicated Showing List artifact bucket.
It uses a generated physical name and is separate from the planned React static
asset bucket. Its synthesized contract is:

- all four S3 Block Public Access controls enabled
- bucket-owner-enforced ownership with ACLs disabled
- S3-managed server-side encryption
- HTTPS and TLS 1.2 minimum enforced by bucket policy
- versioning disabled and Object Lock explicitly disabled
- no CORS configuration or public website behavior
- incomplete multipart uploads aborted after one day
- `RemovalPolicy.DESTROY` with automatic object deletion during stack deletion

The bucket is exposed as a stack construct for a later least-privilege grant,
but Block 18.6.3 does not grant the existing daily property-alert task access.
It does not define the weekly task, inject bucket configuration, generate a
presigned URL, or compose the renderer, S3 adapter, and PostgreSQL repository.
Those responsibilities remain in Blocks 18.6.4 and 18.8.

Adapter tests use an injected command client and make no network request. They
cover the exact PutObject request, stable-key reuse, checksum, object metadata,
input limits, malformed provider output, unexpected version identity,
non-sensitive error mapping, and configuration validation. CDK assertions cover
the bucket count, encryption, ownership, public access, lifecycle, TLS policy,
versioning, Object Lock, CORS, and deletion policies. No AWS stack was deployed
and no real S3 request was made in this block.

### Block 18.6.4 Publication Orchestration

`GenerateShowingListDraft` retains its result-only `execute` method and now also
implements `ShowingListDraftPreparationPort`. The preparation result contains
the normalized generation input, the exact minimal authoritative listing
projection sent to the generator, and the already validated draft plus bounded
provider metadata. This prevents publication from reloading listings after
generation and accidentally rendering facts from a different database moment.

`PublishCurrentShowingListDraft` does not invoke the model. Its immutable input
contains a server-owned generation UUID, actor UUID, ISO timestamp, normalized
generation input, authoritative listing projection, validated draft, and
bounded generation metadata. The strict top-level parser rejects unknown fields
before rendering. A complete placeholder persistence candidate is then parsed
before side effects, so an invalid draft or model metadata cannot replace the
current object.

The use case owns one ordered sequence:

1. validate the immutable publication envelope
2. render the complete PDF in memory
3. replace `showing-lists/current.pdf`
4. validate the returned fixed key and ETag
5. replace or reconcile the singleton PostgreSQL row
6. validate that the returned current row matches the generation ID and ETag

Rendering failure makes no S3 or PostgreSQL call. S3 failure makes no PostgreSQL
call. After S3 succeeds, a non-conflict repository error receives exactly one
bounded reconciliation call with the identical persistence payload. The second
call does not invoke OpenAI, rerender the PDF, or replace S3 again. This covers a
transient database failure and the ambiguous case where PostgreSQL committed but
the first response was lost. A `CurrentShowingListGenerationConflictError` is
not retried because the same generation ID with a different ETag represents an
identity violation rather than a transient commit outcome.

S3 and PostgreSQL still do not share a transaction. If both metadata attempts
fail, the use case fails after the stable object may already have changed, and
Telegram must not run. Any additional retry in the future task must retain the
same immutable publication envelope and generation identity; it must not call
the model again under the old generation ID. Task-level retry ownership and
operational recovery from process termination in this cross-service window
remain explicit Block 18.8 concerns.

Focused tests use only in-memory ports. They cover the exact render, store, and
persist order; prompt-version and ETag mapping; strict input rejection; invalid
generation metadata before rendering; renderer and storage failures; malformed
storage and repository output; one-attempt ambiguous-commit reconciliation;
bounded repeated database failure; and no retry for a generation conflict. No
real renderer, S3, PostgreSQL, OpenAI, Telegram, endpoint, task, schedule, IAM
grant, migration, secret, or deployment was used in this block.

### Block 18.7 Review Workspace

The React application exposes Showing List as a first-level authenticated
administrator workspace next to Listings. It does not expose generation or
client delivery controls. The workspace loads the current singleton draft and
the existing bounded listing summaries so generated listing IDs can be shown
with authoritative addresses. It supports editing title, summary, client
message, order rationale, highlights, and considerations; moving stops up or
down with continuous proposed-order renumbering; saving; marking reviewed;
copying the editable content; and downloading the generated PDF snapshot.

The Express API provides four administrator-only routes:

- `GET /api/showing-list/current`
- `PATCH /api/showing-list/current`
- `POST /api/showing-list/current/review`
- `GET /api/showing-list/current/download`

The response DTO contains only generation identity, non-private client/showing
labels, structured draft, lifecycle and delivery states, timestamps, and the
fixed artifact filename/kind. It deliberately omits creator identity, private
agent instructions, prompt/model/provider metadata, token use, duration, S3
bucket/key/ETag, and secrets. All responses retain `Cache-Control: no-store`.

Save and review requests carry `generationId` and `expectedUpdatedAt`.
PostgreSQL updates only when both still match the singleton row. A concurrent
weekly replacement or another browser save therefore returns a bounded `409`
instead of silently overwriting newer work. Saving structured content always
resets status to `draft`; review is permitted only for the current clean saved
version and is idempotent when it is already reviewed.

The PDF is intentionally the immutable generated artifact for its publication
generation. Structured review edits do not rerender or replace it in Block
18.7. The workspace labels the download `PDF snapshot` and states this boundary
next to the command bar. A future requirement for an edited PDF must add a
separate render-and-replace command with an explicit artifact/database
reconciliation contract; it must not happen as a hidden side effect of text
editing.

The private download path reads the current database metadata first and sends
S3 `GetObject` with the fixed key, expected account owner, and `If-Match` for
the current ETag. A replacement race fails closed. The adapter accepts only the
fixed PDF content type, one through 5 MiB, the expected ETag, and no VersionId.
Provider details never reach the client. Local API startup may omit
`AWS_ACCOUNT_ID` and `SHOWING_LIST_ARTIFACT_BUCKET`; in that mode review works
and download returns a bounded unavailable response. AWS runtime composition
requires both values together plus a least-privilege current-object read grant.

No AWS request, deployment, database migration execution, OpenAI call,
Telegram delivery, task, schedule, or production IAM mutation occurred in
Block 18.7.

### Block 18.8 Weekly Production Job and Telegram Delivery

Block 18.8 adds a dedicated `--run-showing-list` production composition root to
the existing worker image. It reads one strict server-side JSON configuration
with an administrator UUID, one through ten listing UUIDs, and the bounded
Block 18.1 preferences. Missing, blank, malformed, oversized, or unknown
configuration fails before database creation, model generation, artifact
replacement, or Telegram delivery. Browser selection state is never consulted.

Each execution derives a deterministic version-5-shaped UUID from the
configured time zone's Monday-based calendar week plus the complete parsed
generation configuration. A same-week retry with unchanged configuration
checks the singleton record first. If that generation already exists, it skips
authoritative reload, OpenAI, rendering, S3 replacement, and metadata
replacement and resumes only pending or failed Telegram delivery. A confirmed
`sent` row returns without creating a URL or sending another message. Changed
configuration deliberately creates a new identity even in the same week.

The delivery use case creates an HTTPS S3 presigned `GetObject` URL for only
`showing-lists/current.pdf`, requests the fixed attachment name and PDF content
type, and limits configured expiry to 60 through 900 seconds. The URL exists
only in memory. Telegram receives a fixed operational message containing the
URL, expiry timestamp, and an explicit unreviewed-draft/licensed-agent review
warning. At most two in-process delivery attempts are made. Final failure marks
the current generation `failed` without reverting the row or object; success
atomically marks it `sent` with `delivered_at`. A provider timeout can have an
unknown outcome, so the retry can still produce a duplicate Telegram message.
Errors and logs do not include the URL.

CDK defines a separate 0.5-vCPU/1-GiB Fargate task, seven-day log group, 14-day
Scheduler DLQ, and `cpi-weekly-showing-list` EventBridge Scheduler. Its task role
can read and replace only the stable Showing List object. It uses the existing
Aurora connection and public-subnet egress pattern, but has a distinct command
and no RentCast secret. Scheduler weekday, hour, minute, IANA time zone, and
enabled state are deployment contexts. The GitHub workflow supplies all five
explicitly and forces both daily and weekly schedules disabled.

The production application Secret now contains `RENTCAST_API_KEY`,
`OPENAI_API_KEY`, `SHOWING_LIST_GENERATION_CONFIG`, `TELEGRAM_BOT_TOKEN`, and
`TELEGRAM_CHAT_ID`. Block 18.8 is source-complete and locally tested. It did not
synchronize that expanded Secret, deploy a stack, run migration 005, invoke
OpenAI, write S3 or PostgreSQL, send Telegram, run a Fargate task, or enable a
schedule. Those operations require the production runbook gate and explicit
approval.

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
