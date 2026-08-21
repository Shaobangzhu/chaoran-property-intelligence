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
- `16.3` through `16.7` remain separately gated and unimplemented.

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

The API returns the JWT in a cookie with:

- `HttpOnly`
- `Secure` in production
- `SameSite=Strict`, unless a documented deployment constraint justifies Lax
- `Path=/`
- bounded `Max-Age`

Local development may use `Secure=false` only through explicit environment-aware
configuration. Logout clears the exact cookie contract used by login. Do not
store the token in `localStorage` or `sessionStorage`.

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

## Block 18: OpenAI Showing List Drafts

### Product Scope

The feature generates an agent-review draft from selected properties:

```text
select listings on map
-> generate structured draft
-> review and edit
-> mark reviewed
-> copy or export
```

The first release does not email or message clients, schedule showings, alter
listing facts, make final property choices, or claim accurate routes, commute
times, MLS status, school boundaries, wildfire classifications, valuations, or
legal conclusions.

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

### Generator Boundary

Application code depends on an injected port:

```ts
interface ShowingListGenerator {
  generate(context: ShowingListContext): Promise<GeneratedShowingList>;
}
```

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

Persist the creator, prompt version, model, bounded input snapshot, validated
result, lifecycle status, and server timestamps. Also consider the provider
response ID, token usage, duration, and a non-sensitive failure category.

Never persist API keys, JWTs, passwords, or unnecessary customer data.

Initial lifecycle:

```ts
type ShowingListStatus = "draft" | "reviewed" | "shared";
```

The first review UI supports editing title, summary, order, highlights,
considerations, and client message; saving; marking reviewed; and copying. PDF,
email, Telegram delivery, and automatic sharing are deferred.

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
- invalid schema, hallucinated ID, duplicate ID, modified address, and bad order
- draft persistence only after successful validation
- prompt version, model, and safe usage metadata persistence
- no secrets in logs
- arbitrary client system prompt rejected
- prohibited Fair Housing instruction cannot override system rules

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
