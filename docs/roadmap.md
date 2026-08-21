# Project Roadmap

## Working Agreement

Development proceeds one confirmed block at a time. Every implementation block
starts with an explanation of its goal, design choices, security risks, expected
files, and test plan. Code changes follow Red-Green-Refactor and finish with
tests, typecheck, build, a diff summary, and a suggested commit message.

Future blocks in this document are planning records, not authorization to create
directories, install dependencies, provision cloud resources, or implement
features early.

## Current Status

Blocks 0-14.1, Blocks 15.0-15.5, and Blocks 16.0-16.5 are complete. The
repository currently contains:

- a TypeScript and pnpm workspace
- domain listing filters and normalization
- mocked RentCast and Telegram adapters
- the `CheckNewListings` application use case
- a safe in-memory dry-run CLI
- local integration verification
- PostgreSQL migrations and a production worker composition root
- user persistence, Argon2id password hashing, strict JWT, and authentication
  application use cases
- authenticated Express routes with host-only session cookies and protected
  listing reads
- CI for install, typecheck, tests, and build

Local PostgreSQL and local secrets are developer-machine concerns and are not
tracked in Git.

## Near-Term Sequence

### Block 12: AWS Deployment Foundation

Prepare, test, and document the production container and TypeScript AWS CDK
stack. The planned runtime is EventBridge Scheduler, an ECS Fargate one-off
task, and Aurora PostgreSQL Serverless v2. This block must not provision AWS
resources.

Implementation status: the container, CDK stack, contract tests, local synth,
and deployment ADR are complete. The schedule remains disabled by default until
Block 13 configures production secrets and receives deployment approval.

### Block 13: AWS Bootstrap and Deployment

Create cost alerts, bootstrap CDK, establish GitHub Actions OIDC, provision the
reviewed stack, and verify observability and teardown procedures. This is the
first block allowed to create billable AWS resources, and it requires explicit
confirmation immediately before deployment.

Implementation status: the AWS account is bootstrapped in `us-west-2`; the
guardrail and production stacks, application secret, budget notifications, and
confirmed failure-alert subscription are deployed and verified. The scheduler
is disabled and no worker task has run. The GitHub workflow is prepared locally;
its repository configuration follows when this change is committed and pushed.
The as-built architecture is recorded in
[AWS System Design and Configuration](aws-system-design.md).

### Block 14: Production Baseline Verification

Run the first production worker execution under controlled conditions. Verify
that it writes the independent baseline marker, stores all current matches as
baseline records, creates no pending or sent records, and sends no Telegram
notification.

Implementation status: the database-only `--verify-baseline` mode and controlled
execution runbook are complete. The approved production baseline completed on
2026-08-20 with 28 baseline records, an independent initialized marker, and zero
pending or sent records. The Scheduler remains disabled and no ECS tasks remain
running. The operator confirmed that no Telegram listing message was received.

### Block 14.1: Telegram Production Smoke Test

Verify the production Telegram delivery path independently from listing
detection. The one-off ECS mode loads only Telegram credentials, sends one
fixed smoke-test message, does not connect to PostgreSQL or call RentCast, and
leaves the Scheduler disabled.

Implementation status: the isolated `--telegram-smoke-test` mode is deployed.
The one approved ECS task exited 0, CloudWatch recorded the expected completion
line, the Scheduler remains disabled, and the final CDK diff is empty. Operator
receipt of exactly one expected fixed message is confirmed. Block 14.1 completed
on 2026-08-20.

### Block 15: API, React, and Map Foundation

Reinspect the repository and plan the transition from the worker-only MVP to an
authenticated API and React/MapLibre application. Define the smallest useful
API and web foundations before creating either app. The output of this block
must establish the entry criteria for Block 16.

Block 15.0 architecture planning is complete. The accepted direction is a
database-backed `GET /api/listings` vertical slice, stable listing UUIDs, a
separate read query port, an Express API, and a React/Vite application using
MapLibre with OpenFreeMap. The browser never calls RentCast. Block 15 remains
local-only until Block 16 protects listing reads and the application is approved
for public deployment. See
[ADR 0003: API, Web, and Map Foundation](adr/0003-api-web-map-foundation.md).

Planned sub-block mapping:

1. `15.0` Record architecture, contracts, risks, tests, and Block 16 entry
   criteria. **Complete.**
2. `15.1` Add stable listing identity, shared model ownership, the listing query
   use case, and the PostgreSQL query adapter. **Complete.**
3. `15.2` Add the Express app factory and local-only listings endpoint.
   **Complete.**
4. `15.3` Add the Vite React app, typed API client, and complete read states.
   **Complete.**
5. `15.4` Add MapLibre/OpenFreeMap rendering and list/map selection.
   **Complete.**
6. `15.5` Verify the local vertical slice and review the authenticated
   production deployment plan. **Complete.**

Each item remains separately gated. Block 16 starts only after the Block 16
entry criteria in ADR 0003 are satisfied.

Block 15.1 moved `NormalizedListing` into the domain package, added the stable
UUID identity migration, and established the tested application and PostgreSQL
listing query boundary. The migration has not been applied to the AWS database.

Block 15.2 added the Express 5 app factory, explicit listing DTO mapping, safe
JSON errors, loopback-only database composition, and an isolated worker/API
build structure. The API remains undeployed and unauthenticated.

Block 15.3 added the local React/Vite application, runtime-validating listings
client, responsive operational list, and loading, empty, error, retry, and
content states. The browser uses a Vite loopback proxy and remains undeployed.

Block 15.4 added the MapLibre/OpenFreeMap map, minimal client-side GeoJSON,
responsive list/map workspace, bidirectional listing selection, bounded map
states, and an injected map driver for external-service-free automated tests.
Clustering, PostGIS, viewport queries, and public deployment remain out of
scope.

Block 15.5 ran migrations against the local Docker PostgreSQL database and
verified the real `PostgreSQL -> Express -> Vite proxy` read path with temporary,
uniquely tagged fixtures. The API returned stable UUIDs, valid coordinates,
`Cache-Control: no-store`, bounded `404` JSON, and no deduplication or
notification fields. The fixtures were removed after verification. Tests,
typecheck, and builds remain the completion gate.

The approved production platform is AWS. The React/Vite build will be served by
CloudFront from a private S3 origin, and `/api/*` will route under the same HTTPS
origin to App Runner. App Runner preserves the Express container and
`node-postgres` model, reaches private Aurora through a VPC Connector, and avoids
an always-on load balancer. CloudFront origin-header verification and Block 16
server-side authentication are required before public deployment. No AWS
resources were created or changed in Block 15.5.

## Planned Product Features

### Block 16: Single-User JWT Authentication

Add a normal user model and a single administrator login flow without public
registration. The feature remains extensible to multiple users but implements
only admin creation, login, logout, current-user lookup, and server-enforced
authorization.

Planned sub-block mapping:

1. `16.0` Inspect the API/web architecture, record the authentication threat
   model, contracts, and test plan. **Complete.**
2. `16.1` Add the user domain model, migration, `UserRepository` port, and
   PostgreSQL adapter. **Complete.**
3. `16.2` Add password policy, Argon2id hashing, and the admin creation CLI.
   **Complete.**
4. `16.3` Add JWT configuration, the token service, and required claims.
   **Complete.**
5. `16.4` Add login and current-user application use cases and record logout as
   an HTTP-owned cookie operation. **Complete.**
6. `16.5` Add Express auth routes, login/logout cookies, origin checks, auth
   middleware, protected listings, and database-independent health.
   **Complete.**
7. `16.6` Add React session bootstrap, login, logout, and the protected
   workspace. **Complete.**
8. `16.7` Complete application rate limiting, security headers, CSRF,
   authorization, and end-to-end security tests. **Complete.**

Each numbered item is separately gated and must not be implemented as one large
change.

Block 16.0 accepted
[ADR 0004: Single-User Authentication](adr/0004-single-user-authentication.md).
The selected design uses Argon2id password hashes, a short-lived JWT in an
HttpOnly same-site cookie, live database user-status checks, exact Origin
validation for unsafe requests, an App Runner origin guard, and layered login
rate limiting. The same-origin topology does not enable CORS. Public AWS
deployment remains a separately reviewed operational gate after the security
implementation is complete.

Block 16.1 added the bounded normalized-email domain type, `admin` role,
`active` and `disabled` statuses, the `UserRepositoryPort`, and migration
`003_create_users`. The PostgreSQL adapter translates only the named normalized
email uniqueness violation into a bounded application error, rejects malformed
rows, and keeps password hashes out of ID-based user records. No migration was
applied to a local or production database in this block.

Block 16.2 added the Unicode-aware password policy, `PasswordHasherPort`,
`CreateAdminUser`, the `argon2@0.45.1` infrastructure adapter, and a dedicated
masked-input admin CLI. Hashing uses Argon2id with `19 MiB`, two iterations, and
parallelism one. Host and Node 24 Linux-container benchmarks remained well
below the accepted one-second target. The implementation did not execute the
CLI or create a user in any database.

Block 16.3 added the application-level `TokenServicePort`, a strict
`jose@6.2.9` HS256 adapter, and independently loadable API JWT configuration.
The adapter accepts only the `cpi-access+jwt` profile with the seven required
claims, exact issuer and scalar audience, UUID subject and token ID, a 60-minute
lifetime, and five seconds of clock tolerance. Block 16.5 later connected this
configuration to the API composition root and session cookie flow.

Block 16.4 added `Login` and `GetCurrentUser` application use cases plus bounded
authentication errors and a minimum authenticated-user result. Login performs
one Argon2 verification for every well-formed password, using a fixed valid
dummy hash when the normalized email does not identify a user. Unknown users,
wrong passwords, and disabled users share one credential failure. Current-user
authentication verifies the JWT candidate, reloads the user, requires an active
account, and rejects token/database role drift. Internal repository, hashing,
and unexpected token-service failures remain operational errors rather than
being mislabeled as authentication failures. Logout has no application state to
mutate because the accepted design has no refresh token or revocation list; the
idempotent cookie-clearing command remains owned by the Block 16.5 HTTP layer.

Block 16.5 connected the PostgreSQL user repository, Argon2id adapter, JWT
service, and authentication use cases in the Express runtime. The API now
provides login, logout, current-user, protected listings, and a public
database-independent health route. Authentication is cookie-only; local and
production cookie names and `Secure` behavior are explicit, and every protected
request reloads the live user. Unsafe requests require an exact configured
`Origin`. Explicit production mode binds to `0.0.0.0`, reads App Runner's
`PORT`, and rejects requests that lack the constant-time checked CloudFront
origin header, except for the non-sensitive health check. JSON bodies, Cookie
headers, token length, and cookie lifetime are bounded. No AWS resources,
production secrets, database users, rate limiter, WAF, or deployment were
created in this block.

Block 16.6 added the React session boundary without introducing a router or
client token storage. The application checks `GET /api/auth/me` before mounting
the listings workspace, renders bounded signed-out and recoverable-error states,
and supports password-manager-compatible login plus cookie-clearing logout.
Credential failures, rate limiting, and operational failures have separate
bounded presentation states. A listings `401` immediately returns the UI to
login, while a failed logout keeps the authenticated workspace mounted and
reports a safe retryable notice. Runtime DTO validation accepts only the minimum
admin profile. Block 16.6 did not add the Block 16.7 limiter, security headers,
WAF, AWS deployment, or production configuration.

Block 16.7 completed the local authentication security gate. A global
per-process fixed-window limiter now permits ten failed login requests per 15
minutes before Argon2 work, ignores untrusted forwarding headers, does not count
successful logins, and emits bounded `429` responses with standard rate-limit
metadata. Helmet secures API responses, production mode adds HSTS, and the web
document ships a CSP restricted to same-origin resources plus the selected
OpenFreeMap tile origin. Every request receives a server-generated request ID;
bounded security events contain that ID but no credentials, tokens, cookies, or
email. Listings require explicit admin authorization after authentication.
HTTP and cross-layer tests cover unsafe-method Origin rejection, `401`/`403`,
rate limiting, real Argon2id and JOSE login, cookie authentication, logout, and
post-logout denial. No WAF, CloudFront response policy, App Runner service,
production secret, database user, or AWS resource was created.

### Block 17: Manual Listing Management

Allow an authenticated administrator to create, edit, and archive listings that
do not originate from RentCast. Manual and RentCast records share the normalized
listing model and are distinguished by `source`.

Planned sub-block mapping:

1. `17.1` Extend the normalized listing model for the manual source.
2. `17.2` Add the `CreateManualListing` use case.
3. `17.3` Add the protected manual-listing API.
4. `17.4` Add map marker confirmation and creation UI.
5. `17.5` Add protected edit and archive workflows.
6. `17.6` Complete repository, API, and UI integration tests.

Block 17 depends on Block 16 authorization and the map foundation from Block 15.

Block 17.1 is complete. The normalized listing is now a discriminated RentCast
or manual union, while alert-worker ports remain RentCast-only. Migration 004
adds manual ownership, notes, archive and persistence timestamps, source-aware
identity and notification constraints, nullable manual property facts, bounded
coordinates, and an active-row index. PostgreSQL, API, and browser readers now
accept manual records through the shared contract and present absent facts
without inventing values. ADR 0005 records the accepted model. The migration
was added to the bundle but was not applied to a local or AWS database.

Block 17.2 is complete. A pure domain normalizer now validates and canonicalizes
manual listing drafts, while `CreateManualListing` injects server UUID/time,
keeps actor ownership separate from editable fields, and persists through a
dedicated application port. The PostgreSQL adapter writes source-aware identity,
`not_applicable` notification state, owner, notes, and timestamps with one
parameterized statement and parses the returned manual record. Tests cover
normalization, field bounds, server-controlled values, persistence parameters,
and malformed rows without external services. No HTTP route was added and
migration 004 remains unapplied.

Block 17.3 is complete. `POST /api/listings/manual` now requires exact Origin,
live session authentication, and admin authorization before its bounded JSON
parser. A strict DTO accepts only editable draft fields, the authenticated user
ID becomes the application actor, safe field-only domain errors map to bounded
`400` responses, and successful creation returns `201` with the shared listing
summary. Login and manual routes have separate 4 KiB and 8 KiB parsers. The API
entrypoint composes the use case with PostgreSQL, server UUID, and server time;
its existing migration-before-listen sequence will apply migration 004 on the
next real startup. No API process, database connection, or AWS deployment was
started during this block.

Block 17.4 is complete. The authenticated React workspace now exposes a manual
creation mode in both populated and empty-list states. Its form mirrors the
server allowlist and bounds, while MapLibre supports clicking to place and
dragging to adjust a dedicated draft marker. Coordinates must be explicitly
confirmed before submission, and every marker movement clears that confirmation.
The typed browser client maps bounded API field failures to the corresponding
control, treats malformed success payloads as invalid, and reuses the existing
session-expiry sign-out boundary. A successful `201` adds the returned normalized
listing to the shared list and map and selects it. The desktop layout keeps form
and map together; mobile uses stable Details and Map modes. No geocoder, API
process, database connection, migration execution, or AWS operation was added or
run.

Block 17.5 is complete. Active manual listings now support strict partial edits
and soft archive commands; RentCast and archived records return the same bounded
not-found result. `PATCH /api/listings/:id` and
`POST /api/listings/:id/archive` preserve the established Origin, session,
admin, request-size, and safe-error boundaries. PostgreSQL updates only editable
manual fields and explicit lifecycle timestamps, never ownership or source, and
the default listing query excludes archived rows. The React editor reuses the
confirmed-marker workflow, preserves private notes unless the administrator
chooses replace or clear, and removes successfully archived records from active
state after inline confirmation. No API process, migration, database connection,
or AWS operation ran during implementation.

Block 17.6 is complete, closing Block 17. Three stateful integration tests now
exercise the manual listing lifecycle across its principal boundaries. The
PostgreSQL test composes real application commands with the real repository and
query adapters through an in-memory SQL harness. The API test sends loopback
HTTP requests through real middleware, strict DTOs, and real listing use cases.
The React test drives create, edit, and archive through the real session and
listing HTTP clients. Together they verify server ownership, private-note
preservation, RentCast write protection, active-query filtering, UI state, and
request serialization without contacting PostgreSQL, OpenFreeMap, RentCast,
Telegram, or AWS.

### Block 18: OpenAI Showing List Drafts

Generate structured Showing List drafts from authoritative listing data. Every
result is editable and requires agent review. In production, a weekly AWS job
replaces the single current draft and sends the administrator a temporary
Telegram download link. The system does not send drafts to clients, schedule
showings, alter listing facts, or claim route, school, wildfire, MLS, legal, or
valuation conclusions.

The production retention invariant is latest-only: application-visible primary
storage contains one logical current Showing List draft, represented by at most
one current structured record and one private downloadable artifact. A
successful generation replaces the prior draft; failed generation or
publication leaves the prior draft intact. No dated artifact keys, append-only
generation snapshots, or S3 object versions are retained.

Planned sub-block mapping:

1. `18.1` Define bounded input and structured output schemas.
2. `18.2` Add a `ShowingListGenerator` port and fake.
3. `18.3` Add the use case with authoritative database reload.
4. `18.4` Add the fixed, versioned prompt and guardrails.
5. `18.5` Add the OpenAI Responses API adapter with Structured Outputs.
6. `18.6` Add latest-only draft persistence and private artifact publication.
7. `18.7` Add the review, edit, reorder, copy, and download UI.
8. `18.8` Add the weekly AWS job and administrator Telegram download delivery.
9. `18.9` Complete mocked adapter, validation, replacement, delivery, failure,
   and Fair Housing tests.

Block 18.6 executes as four independently reviewed steps:

1. `18.6.1` Define current-draft persistence contracts, the singleton migration,
   and the PostgreSQL repository.
2. `18.6.2` Render the complete PDF artifact before publication.
3. `18.6.3` Add the stable-key S3 adapter and private unversioned bucket.
4. `18.6.4` Orchestrate render, object replacement, and metadata reconciliation.

Block 18.1 is complete. The application package now owns strict Zod contracts
for one through ten unique listing UUIDs, three bounded nullable preferences,
and a provider-neutral structured draft. Generated content contains title,
summary, ordered listing references, reasons, highlights, considerations,
client message, and review warnings, but cannot restate authoritative address,
price, or MLS fields. Runtime validation rejects unknown keys, blank or
oversized content, duplicate listing IDs, and non-continuous order values. The
downloadable artifact contract is `application/pdf` with filename
`showing-list-draft.pdf`. This block added no endpoint, use case, OpenAI SDK or
API call, PDF renderer, persistence, environment variable, or AWS resource.

Block 18.2 is complete. The application package now owns the provider-neutral
`ShowingListGenerator` port. Its context contains bounded preferences and a
minimal authoritative listing projection without database timestamps, provider
source IDs, private notes, contact details, credentials, or SDK types. The
result envelope carries the validated draft plus bounded-purpose model,
response, token, and duration metadata needed by later persistence. A reusable
deterministic fake records every context and supports explicit success or
failure outcomes without validating its configured result. This block added no
use case, prompt, OpenAI SDK or API call, provider error mapping, endpoint,
persistence, environment variable, or AWS resource.

Block 18.3 is complete. `GenerateShowingListDraft` validates the server-supplied
actor and Block 18.1 request before reading data, reloads every selected active
listing through a narrow query port, rejects missing, archived, duplicate, or
unexpected records, and restores the original selection order before building
the minimal generator context. The existing PostgreSQL listing query now
implements the active-by-ID port with one parameterized UUID-array query. The
use case treats generator output as untrusted, revalidates draft and bounded
metadata, and requires the generated listing-ID set to match the selection
exactly. This block added no endpoint, prompt, OpenAI SDK or API call, provider
error mapping, migration, draft persistence, environment variable, or AWS
resource.

Block 18.4 is complete. The application package now owns a fixed
`SHOWING_LIST_PROMPT_VERSION = "v1"` and deterministic prompt builder. Static
developer instructions are separated from a JSON-serialized untrusted context,
so listing fields and preference text never enter the instruction string. The
v1 prompt requires supplied-data grounding, exact listing-ID coverage,
continuous order values, missing-fact disclosure, non-optimized routing
language, Fair Housing protections, strict schema output, and licensed-agent
review. Tests lock the version, stable envelope, special-character handling,
prompt-injection boundary, and required guardrail categories. This block added
no OpenAI SDK or API call, model selection, API key, endpoint, persistence,
migration, semantic compliance classifier, or AWS resource.

Block 18.5 is complete. A dedicated `packages/openai` adapter implements the
application `ShowingListGenerator` port with the official `openai@7.5.0`
TypeScript SDK, Responses API, and strict Zod Structured Outputs. The approved
production profile is `gpt-5.6-terra` with medium reasoning, a 16,000-token
response ceiling, `store: false`, disabled truncation, a 120-second request
timeout, and two SDK retries. The adapter uses the Block 18.4 instructions and
untrusted JSON input unchanged, returns only validated draft and bounded usage
metadata, and maps authentication, rate-limit, timeout, refusal, incomplete,
invalid-response, and service failures to stable non-sensitive errors. Tests
exercise the real SDK parser and request construction through mocked `fetch`;
CI makes no OpenAI request. This block added no endpoint, `.env` variable,
runtime composition, persistence, migration, real provider smoke test, GitHub
configuration, secret write, or AWS resource.

Block 18.6.1 is complete. The application package now owns strict replacement
and current-record contracts, the fixed `showing-lists/current.pdf` key,
bounded generation metadata, `draft`/`reviewed` lifecycle states, and
`pending`/`sent`/`failed` delivery states. Migration
`005_create_current_showing_list_draft` creates one singleton table whose only
valid primary-key value is `current`; it stores one bounded generation request,
validated draft, model metadata, artifact ETag, actor, and timestamps without a
history table. The PostgreSQL repository replaces only a different generation,
returns an existing row unchanged for the same generation ID and ETag, and
rejects the same generation ID with a different ETag. This block added no PDF
renderer, S3 bucket or call, endpoint, runtime composition, Telegram delivery,
OpenAI call, secret, local database write, or AWS deployment.

Block 18 depends on authentication, database-backed listing reads, and the
selection/review UI established by Blocks 15-17.

See [Blocks 16-18 Feature Knowledge Base](knowledge-base/blocks-16-18.md) for
the detailed product, architecture, security, retention, delivery, and testing
constraints. See
[ADR 0006: Latest-Only Showing List Publication](adr/0006-latest-only-showing-list-publication.md)
for the accepted production publication decision.
