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

Blocks 0-14.1, Blocks 15.0-15.5, Blocks 16.0-16.7, Blocks 17.1-17.6,
Blocks 18.1-18.9, Blocks 19.0-19.5, Blocks 20.0-20.7, and Blocks 21.0-21.8 are
complete. Blocks 22.0-22.6 are complete and merged into `main`; the ArcGIS
migration passed automated, desktop/mobile, CAL FIRE, Console, network,
credential, and bundle acceptance. Blocks 23.0-23.7 are complete and merged
into `main`. Blocks 24.0-24.7 are complete and merged into `main`. The controlled
provider gate found 17
complete ZIP `91381` results, all labeled `Valencia` rather than `Stevenson
Ranch`. The product decision now keeps Stevenson Ranch as a ZIP-defined market
while preserving provider city `Valencia`. Block 24.2 added the sixth
version-1 product market and exact-city/or-ZIP Domain matcher without migrating
existing five-market profiles. Block 24.3 added typed radius/ZIP RentCast
geography while preserving the Brea default. Block 24.4 added conditional,
sequential, all-or-nothing multi-area source reads while leaving production on
the Brea compatibility default. Block 24.5 now projects persisted markets into
production areas and adds safe per-area/combined audit reporting. Block 24.6
proves the legacy five-market load and explicit six-market API/React save path.
Block 24.7 now proves production mixed-area overlap reconciliation, quiet
revision baseline, all-or-nothing second-area failure, provider-city
preservation, and ArcGIS 2D/3D cross-region fit through all 1048 passing tests,
full typecheck, and production build. The operator completed the logged-in local
criteria flow, explicitly saved Stevenson Ranch, accepted the stored-snapshot
Listings behavior, and verified that the unchanged five-city CAL FIRE artifact
loads with its blank-area disclosure. Blocks 25.0 and 25.1 are complete on
`feature/stevenson-ranch-wildfire-coverage`. The separately authorized audit
selected the U.S. Census ACS 2025 Stevenson Ranch CDP, GEOID `0674130`, as a
statistical `market-context` boundary; verified Los Angeles County
unincorporated jurisdiction and Ordinance `2025-0027` LRA adoption evidence;
reconciled five LRA and seven SRA source intersections; and selected an exact
hard clip that projects the combined artifact at 1,158,246 raw and 289,420 gzip
bytes. Audit candidates remain ignored and no runtime artifact changed.
Blocks 25.2-25.7 are complete and merged into `main`. Blocks 26.0-26.7 are
complete on `refactor/five-city-direct-market-coverage`: the five incorporated
markets now use direct city acquisition, Stevenson Ranch retains ZIP `91381`,
the source and production workflow require explicit sequential areas, and the
legacy Brea-default audit path is retired. Request-cost guidance now treats 50
requests as a planning reference and requires current account-plan and usage
verification before any real audit or production run.
The final release matrix proves successful one-, five-, and six-market worker
composition with exactly 1, 5, and 6 canonical provider requests. All 114 test
files and 1,101 tests, typecheck, production/AWS build, browser evidence, and
security/diff gates pass; merge, schedule, and deployment remain under
repository-owner control.
Block 21.8
closed its offline, disposable migration,
authenticated HTTP, React
automated, fake-worker, user-confirmed browser visual, and separately approved
AWS metadata-only gates. The repository currently contains:

- a TypeScript and pnpm workspace
- domain listing filters and normalization
- mocked RentCast and Telegram adapters
- the `CheckListingAlerts` new-listing and price-drop application workflow
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

Block 18.6.2 is complete. The application package now owns a provider-neutral
artifact-renderer port with a fixed 5 MiB in-memory output limit, and the
dedicated `packages/pdf` adapter renders the complete `application/pdf`
artifact with PDFKit before publication. The adapter revalidates the generation
ID, timestamp, preferences, authoritative listing projection, structured draft,
and exact listing-ID set; joins generated commentary to authoritative address,
price, status, date, and MLS facts; sorts by proposed order; and deliberately
omits private agent instructions. The PDF includes an unreviewed-draft banner,
review warnings, explicit licensed-agent review boundaries, automatic wrapping,
multi-page output, and page-number footers. Rendering is deterministic for the
same validated input and remains entirely in memory. Focused tests cover the
artifact contract, authoritative/generated content boundary, ordering,
determinism, maximum bounded pagination, unsupported glyph handling, invalid
input, and output-size failure. A rendered two-page sample passed local visual
QA. This block added no S3 call or bucket, persistence orchestration, endpoint,
runtime composition, OpenAI call, Telegram delivery, secret, database write, or
AWS deployment.

Block 18.6.3 is complete. The application package now owns a provider-neutral
current-artifact store port whose caller supplies only the validated PDF
artifact and cannot choose an object key. The dedicated `packages/s3` adapter
uses AWS SDK v3 `PutObject` to overwrite only
`showing-lists/current.pdf`, sends an expected-owner guard, SHA-256 checksum,
SSE-S3 request, attachment disposition, exact PDF content type, and `no-store`
cache policy, and returns only the bounded S3 ETag with the fixed key. It rejects
empty, oversized, malformed, or metadata-bearing artifacts before the provider
call and fails closed on a missing ETag or any returned S3 VersionId. Provider
failures map to one non-sensitive application error. The CDK production stack
now defines one dedicated bucket with all public access blocked, ACLs disabled,
S3-managed encryption, TLS 1.2 enforcement, versioning disabled, Object Lock
disabled, no CORS, and a one-day incomplete-multipart cleanup rule. The bucket
and its current object are destroyed together on stack deletion. Focused tests
lock the SDK command and CloudFormation contract. This block made no real S3 or
AWS call, deployed no stack, granted no access to the existing daily worker,
generated no presigned URL, and added no publication orchestration, database
write, OpenAI call, Telegram delivery, endpoint, or schedule.

Block 18.6.4 is complete. `GenerateShowingListDraft` preserves its existing
result-only `execute` contract and now also exposes a validated preparation
envelope containing the normalized generation request, the exact authoritative
listing projection used by the model, and the validated structured result.
`PublishCurrentShowingListDraft` accepts that immutable envelope plus a
server-owned generation UUID, actor UUID, and generation timestamp. It validates
the complete persistence candidate before rendering, renders the PDF, replaces
the one stable S3 object, and only then upserts singleton metadata with prompt
version `v1` and the returned ETag. Repository output must strictly validate and
match both the attempted generation ID and artifact ETag. A non-conflict
metadata error receives one bounded reconciliation attempt with the identical
payload; that retry does not rerender, reupload, or regenerate model content.
Generation identity conflicts fail immediately. Focused tests lock the ordered
side effects, strict inputs and outputs, no-write rendering and upload failures,
malformed adapter results, ambiguous-commit reconciliation, bounded retry, and
conflict behavior. Block 18.6 is now complete in source, but no runtime has
composed the real OpenAI, PDF, S3, or PostgreSQL adapters. This block made no
provider, database, Telegram, or AWS call; added no endpoint, task, schedule,
presigned URL, secret, IAM grant, migration execution, or deployment.

Block 18.7 is complete in source. The authenticated administrator application
now has a first-level Showing List workspace alongside Listings. It loads the
singleton current draft and authoritative listing summaries, edits title,
summary, client message, order rationale, highlights, and considerations,
reorders stops with continuous numbering, copies the editable draft, downloads
the generated PDF snapshot, saves, and marks a clean saved draft reviewed.
Every read and mutation passes through the existing session and administrator
authorization boundary. Save and review commands use the generation ID plus
expected update timestamp for optimistic concurrency; a stale tab receives a
bounded conflict and must reload. Saving any edit resets lifecycle state to
`draft`. The generated PDF remains the immutable publication snapshot for that
generation, and the UI explicitly states that later structured edits do not
rewrite it. The API omits actor identity, model/provider metadata, token usage,
private agent instructions, bucket identity, object key, and ETag. Authenticated
downloads read the stable private object with S3 `If-Match` against the current
database ETag. PostgreSQL, application, S3, API, API-client, component, and
session-boundary tests cover the workflow without calling AWS or modifying a
database. The production API still needs its future App Runner task role and
injected artifact-bucket configuration before private S3 downloads work in AWS.

Block 18.8 is complete in source. The worker image now exposes a separate
`--run-showing-list` composition root that validates one strict server-side
generation configuration before opening PostgreSQL or calling a provider. It
composes authoritative listing reload, OpenAI generation, PDF rendering,
latest-only S3 replacement, singleton metadata commit, a short-lived stable-key
presigned URL, and an administrator Telegram message that labels the file as an
unreviewed draft. Delivery state uses optimistic `pending`/`failed`/`sent`
updates; a successful send is suppressed on ordinary retry, while two bounded
delivery attempts retain the documented unknown-timeout duplicate risk. A
deterministic UUID derived from the configured local calendar week and current
generation configuration makes same-week recovery reuse the published
generation without another model call.

CDK now defines a dedicated one-off Fargate task, seven-day log group, DLQ,
stable-object read/write policy, and `cpi-weekly-showing-list` Scheduler. It does
not reuse or mutate `cpi-daily-property-alert`. Weekday, hour, minute, time zone,
and enabled state are explicit deployment contexts, and GitHub deployment
passes both schedules as disabled. The application Secret shape now includes
`OPENAI_API_KEY` and `SHOWING_LIST_GENERATION_CONFIG` alongside RentCast and
Telegram values. Focused tests cover configuration rejection, weekly identity,
ordered publication and delivery, duplicate suppression, failure persistence,
stable-key signing, Telegram content, IAM, and schedule isolation. No AWS,
OpenAI, Telegram, S3, or database operation was performed; the task and
schedule have not been deployed or enabled.

Block 18.9 is complete in source and closes Block 18. A stateful integration
test now enters through the weekly production composition root and composes the
real OpenAI, PDF, PostgreSQL, S3, and Telegram adapters over deterministic
in-memory provider boundaries. It verifies first publication, later latest-only
replacement, same-week idempotency, ordered delivery, safe metadata, stable-key
presigning, ambiguous metadata reconciliation, bounded Telegram recovery, and
configuration fail-fast behavior. Separate failure cases prove that generation,
exact-listing validation, and upload failures preserve the prior row and PDF and
send no Telegram message. Focused API and OpenAI tests add an explicit non-admin
Showing List `403` and lock prohibited steering text below the fixed Fair
Housing instruction boundary. CI performs no real provider, database, or AWS
operation, and the schedule remains disabled pending a separately approved
production runbook execution.

Block 18 depends on authentication, database-backed listing reads, and the
selection/review UI established by Blocks 15-17.

See [Blocks 16-18 Feature Knowledge Base](knowledge-base/blocks-16-18.md) for
the detailed product, architecture, security, retention, delivery, and testing
constraints. See
[ADR 0006: Latest-Only Showing List Publication](adr/0006-latest-only-showing-list-publication.md)
for the accepted production publication decision.

### Block 19: Wildfire Hazard Zone Overlay

Add an optional Fire Hazard Severity Zone overlay to the MapLibre listings map.
The control is a binary `Wildfire hazard zones` toggle, not a listing filter.
When enabled, official polygons render below listing markers with transparent
red fills whose depth increases from `Moderate` to `High` to `Very High`.

The feature must use the official CAL FIRE / Office of the State Fire Marshal
term `Fire Hazard Severity Zone` and must not relabel hazard as wildfire risk.
It does not show active fires, evacuation orders, parcel-level safety,
insurability, or expected property loss. The UI must identify source version,
jurisdictional status, and update date and link to the official source.

Planned sub-block mapping:

1. `19.0` Record feasibility, source constraints, architecture, visual
   hierarchy, legal boundaries, performance budgets, and test plan.
   **Complete in documentation only.**
2. `19.1` Audit the current official SRA and LRA datasets, verify the five
   target jurisdictions, measure clipped geometry, and select GeoJSON or a
   tiled artifact using the documented performance gate. **Complete: GeoJSON
   selected from a conservative 3,615,513-byte raw / 976,807-byte gzip
   prototype; Eastvale remains recommended until local adoption is verified.**
3. `19.2` Add a reproducible normalization and clipping pipeline plus a
   provenance manifest and deterministic test fixture. Do not add a runtime
   ArcGIS dependency. **Complete: the digest-pinned GDAL pipeline emits a
   933,093-byte five-city GeoJSON and provenance manifest; two controlled
   builds produced the same SHA-256.**
4. `19.3` Extend the injected MapLibre driver with lazy source loading,
   severity fill and boundary layers, stable layer ordering, and bounded
   overlay-only failure behavior. **Complete: the driver validates and loads
   the versioned same-origin artifact once, installs four hidden layers below
   listing points, reuses them across toggles, rolls back partial failures, and
   aborts pending work during cleanup.**
5. `19.4` Add the responsive toggle, loading/error states, labeled legend,
   attribution, and accessible keyboard behavior. The overlay remains off by
   default. **Complete: a native switch drives the isolated map controller;
   GeoJSON and reviewed manifest metadata load atomically; the responsive
   legend exposes severity, version, snapshot, jurisdiction status,
   attribution, and bounded retry/disclosure states.**
6. `19.5` Complete fixture-based tests, browser visual verification,
   performance checks, known-location comparison against official maps, and
   production-build verification. Do not deploy AWS resources. **Complete:
   fixture and full regression tests, type checking, production build, artifact
   audit, local performance measurements, three-severity official point checks,
   and five-jurisdiction freshness review pass. User-verified desktop and mobile
   browser acceptance also passed transparency, layer order, visual hierarchy,
   non-overlap, pan/zoom, first-enable, and same-mount request-lifecycle checks.
   Block 19 is complete.**

Every executable sub-block requires a fresh explanation and explicit
confirmation. Block 19 does not enable PostGIS or assign a hazard level to a
listing. A future server-side point-in-polygon feature needs a separate data,
freshness, API, and disclosure decision.

See the
[Block 19 Wildfire Hazard Overlay Knowledge Base](knowledge-base/block-19-wildfire-hazard-overlay.md)
and
[ADR 0007: Wildfire Hazard Overlay](adr/0007-wildfire-hazard-overlay.md). The
source evidence and format measurements are in the
[Block 19.1 Wildfire Hazard Source Audit](data/wildfire-hazard-source-audit.md).

### Block 20: Price-Drop Alerts

Extend the property-alert workflow so a strictly lower observed asking price at
the same canonical RentCast address creates a durable Telegram alert. A price
drop uses the new-listing delivery and retry guarantees but is not a new MLS
identity: it does not change `listedDate`, create a duplicate React listing row,
or add another map point.

The previous value is the immediately prior successfully persisted observation,
not the last alerted price. Every integer-dollar decrease qualifies. Increases
advance the observation baseline without an alert, and unchanged prices remain
idempotent. The first Block 20-capable run establishes price state silently.
Manual listings remain outside the automated observation lifecycle.

The confirmed coverage includes a tracked property that falls below the current
`$780,000` minimum. Before changing the production request, Block 20.1 must
prove that a one-request RentCast acquisition strategy can retain this coverage
without reaching the `500` result cap or increasing the monthly request budget.

Planned sub-block mapping:

1. `20.0` Freeze product semantics, canonical address identity, observation and
   outbox architecture, RentCast coverage gate, migration behavior, Telegram
   content, React projection, AWS runtime boundary, and test plan. **Complete in
   documentation only; no code, provider, database, Telegram, or AWS operation
   was performed.**
2. `20.1` Add deterministic coverage fixtures and a controlled RentCast audit
   command. After separate confirmation, use at most one real request to measure
   broadened-query count, cap margin, response size, latency, target-city
   coverage, and tracked-address presence. Do not change production behavior.
   **20.1A complete:** official documentation confirms `*` as an omitted range
   endpoint; the isolated audit profile uses `price=*:850000`,
   `includeTotalCount=true`, and `limit=500`. A dedicated aggregate-only command
   requires `--execute-one-request`, while the production profile at the end of
   20.1 remained exactly `780000:850000`. Twenty-two focused tests pass without
   a real request. The audit gate also rejects an incomplete returned page. The
   complete 641-test suite, full typecheck, alert-worker build, and
   no-confirmation CLI rejection also pass. **20.1B complete:** one explicitly
   approved request returned all 132 matches, including 54 below `$780,000`,
   with 368 rows of cap margin. The page was complete and the gate passed.
   Production remained unchanged, and Block 20.1 is complete.
3. `20.2` Add strict structured-address normalization, typed `new-listing` and
   `price-drop` events, observation contracts, event-oriented notification
   ports, validation, and in-memory fakes. **Complete:** the versioned
   `ListingAddressKey`, strict observation/event validation, atomic-transition
   boundary, immutable event semantics, deterministic state repository, and
   notification fake are implemented. The legacy worker and every production
   adapter remain unchanged. Twenty-nine focused contract tests, all 670 project
   tests, full typecheck, and the production build pass.
4. `20.3` Implement detection using the previous committed observation, with
   new-listing precedence, `$1` decreases, below-floor tracked decreases,
   increase updates, silent initialization, multiple pending transitions, and
   idempotent retry tests. **Complete:** the parallel `CheckListingAlerts` use
   case, acquisition/new-listing criteria split, legacy-compatible listing key,
   deterministic event identity, duplicate-provider-row guard, ordered retry,
   failure recovery, and first-discovery preservation are implemented against
   deterministic ports. Seventy-one focused tests, all 701 project tests, full
   typecheck, and the production build pass. Production composition remains on
   `CheckNewListings` until Blocks 20.4 and 20.5.
5. `20.4` Add the PostgreSQL observation state and durable notification outbox,
   update current listing snapshots transactionally, preserve legacy pending
   delivery, and verify rollback, constraints, concurrency, and migration
   idempotency. **Complete in code and offline verification:** migration 006,
   exact expected-observation compare-and-swap, immutable event persistence,
   ordered pending delivery, sent-state compatibility, and conditional legacy
   backfill are implemented. Migrated observations require one fresh comparison
   baseline before a price-drop event. No local or AWS database was migrated,
   and production composition remains unchanged. All 711 tests, full typecheck,
   and the production build pass.
6. `20.5` Add Telegram event formatting with previous/current price, absolute
   and percentage decrease, bounded chunking, worker composition, and adapter
   integration tests without regressing smoke-test or Showing List delivery.
   **Complete in code and offline verification:** the production worker now
   composes `CheckListingAlerts`, `PostgresListingAlertRepository`, and typed
   Telegram notification events; migration and legacy initialization run before
   the broadened `price=*:850000`, `limit=500` provider request. Telegram keeps
   each event intact, formats whole-dollar and one-decimal percentage changes,
   and prevalidates a batch before bounded delivery. The dry-run uses the same
   application pipeline. Adapter integration proves a tracked `$825,000` row
   dropping to `$770,000`, durable snapshot update, exact Telegram content, and
   database close order. Existing address alerts, production smoke test, and
   Showing List delivery remain covered. All 719 tests pass; no real provider,
   database, Telegram, deployment, or AWS operation occurred.
7. `20.6` Keep stable API and React listing identity while exposing the latest
   price. Verify one card and map marker, unchanged selection/Showing List
   references, manual listings, and genuine relisting behavior. **Complete as
   offline regression coverage with no runtime or schema change:** persistence
   assertions prove a price transition conflicts on the same listing key
   without replacing its database UUID or first-discovery time. PostgreSQL and
   authenticated API tests return one stable ID with the latest `$770,000`
   price. React renders one card and one GeoJSON point and keeps list/map
   selection on that ID; Showing List generation reloads the same ID with its
   latest price. Existing manual-listing coverage passes, and a genuine accepted
   relisting remains a separate identity. All 724 tests pass; no database,
   provider, Telegram, deployment, or AWS operation occurred.
8. `20.7` Complete full tests, type checking, builds, migration integration,
   local smoke verification, runbook updates, and AWS read-only precheck. Real
   provider calls, database migration, production Telegram, deployment, and
   schedule enablement remain independently confirmed operations. **20.7A is
   complete:** the image now exposes database-only preparation and read-only
   price-alert verification modes; aggregate output contains no listing data,
   and the production runbook separates every external or mutating boundary.
   All 736 tests, full typecheck, build, CDK synth, fake-data dry run, and diff
   checks pass without a database, provider, Telegram, deployment, or AWS
   operation. **20.7B is complete:** a disposable `postgres:18` instance proved
   the real `001-005` to `006` upgrade, two-address legacy backfill,
   non-comparable first observation state, one preserved pending event, exact
   aggregate verification, and an unchanged retry snapshot. The temporary
   instance was removed and the existing local database remained healthy. No
   provider, Telegram, Aurora, deployment, schedule, or AWS operation occurred.
   **20.7C and Block 20 deployment readiness are complete:** the matching
   federated identity, Region, stacks, disabled daily Scheduler, zero ECS tasks,
   available Aurora, failure rules, Secret metadata, and SNS confirmation all
   passed read-only checks. The weekly Scheduler is not yet deployed. A
   no-change-set CDK diff contains no Guardrails, database, VPC, deletion,
   retained-resource replacement, or schedule-enablement change; it combines
   the expected Block 20 worker image with the previously deferred weekly
   Showing List infrastructure. No deployment, task, database connection,
   Secret-value read, provider request, or Telegram delivery occurred.

Every executable sub-block requires a fresh explanation and explicit
confirmation. Block 20.0 does not change source code, consume RentCast quota,
connect to PostgreSQL, send Telegram, or operate AWS resources.

See the
[Block 20 Price-Drop Alerts Knowledge Base](knowledge-base/block-20-price-drop-alerts.md)
and
[ADR 0008: Price-Drop Alert State and Outbox](adr/0008-price-drop-alert-state-and-outbox.md).

### Block 21: Configurable Listing Search Criteria

Replace the hard-coded alert criteria with one authenticated, persisted search
profile while preserving the backend as the authoritative and extensible
filter boundary. California and active status remain fixed server invariants.
The administrator can edit one property type, minimum and maximum price,
minimum bedrooms, minimum bathrooms, and one to five cities from the existing
five-city set.

Block 21 keeps one regional RentCast request per worker run. Selected cities
are applied by Domain logic after that response, and minimum price remains a
new-listing threshold rather than an acquisition floor so tracked below-floor
price drops continue to alert. Saving a changed profile increments its
revision but does not call RentCast, send Telegram, delete existing listings,
or alter the current Listings snapshot.

An unapplied revision is silently baselined on the next worker run. This avoids
treating existing inventory as newly listed when criteria are widened while
preserving durable pending events and stable listing records.

1. `21.0` Freeze the product semantics, fixed invariants, one-request provider
   strategy, versioned profile schema, revision baseline, API/UI contracts,
   risks, and test plan. **Complete in documentation only.**
2. `21.1` Add versioned Domain criteria, exact property-type and city enums,
   strict validation, current-value defaults, and parameterized acquisition
   and new-listing predicates. **Complete in code and offline verification:**
   Domain now owns a frozen, strict `schemaVersion: 1` criteria value, all seven
   property types, the canonical five-city set, bounded numeric validation,
   fixed `CA`/`Active` invariants, and parameterized predicates. Zero bedroom
   or bathroom minimums accept nullable Land data. Compatibility exports keep
   the existing worker on the exact current defaults, so provider, database,
   and notification behavior remain unchanged. All 793 tests, full runtime/CDK
   typecheck, and the production build pass.
3. `21.2` Add migration 007, profile ports, a PostgreSQL adapter, an exact
   current-behavior seed, optimistic revision updates, canonical no-op saves,
   and migration/repository tests. **Complete in code and offline
   verification:** migration 007 defines one constrained `primary` JSONB
   profile and seeds revision/appliedRevision `1/1` with the exact Domain
   defaults. Application exposes typed query/save ports and structured
   `updated`, `unchanged`, and `conflict` outcomes. The PostgreSQL adapter uses
   a transaction and row lock, strictly parses JSONB, bigint revisions,
   timestamps, and actor UUIDs, preserves appliedRevision on an edit, and
   performs no write for canonical no-op or stale input. All 812 tests, full
   runtime/CDK typecheck, and the production build pass. Migration 007 was not
   executed against a local or AWS database.
4. `21.3` Add application get/update use cases, administrator attribution,
   stale-revision handling, baseline orchestration contracts, and deterministic
   fakes. **Complete in code and offline verification:** Get returns only the
   editable criteria, revision, and update timestamp. Update strictly rejects
   unknown or fixed fields, injects trusted schema/CA/Active values, validates
   actor UUID and clock, and maps stale or lost-race saves to one stable error.
   Application validates every repository result before returning it. The fake
   records defensive calls and implements changed, canonical no-op, conflict,
   and injected-failure behavior while preserving appliedRevision. All 837
   tests, full runtime/CDK typecheck, and the production build pass. No API
   route, database operation, provider request, notification, deployment, or
   AWS operation occurred.
5. `21.4` Add administrator-only `GET` and `PUT`
   `/api/listing-search-criteria` routes, strict bounded DTOs, Origin and
   session enforcement, error mappings, composition, and security tests.
   **Complete in code and offline verification:** both routes require the
   existing session and administrator boundary. PUT authenticates and
   authorizes before its strict 4 KiB parser, rejects unknown and fixed fields,
   injects the authenticated actor, and maps invalid input and stale revisions
   to stable bounded errors. Responses omit fixed, audit, persistence, and
   provider fields. The production API composes Get/Update with one PostgreSQL
   profile repository. All 860 tests, full runtime/CDK typecheck, and the
   production build pass. No migration, database connection, provider request,
   notification, deployment, or AWS operation occurred.
6. `21.5` Add the authenticated React `Search Criteria` workspace with one
   property-type select, price inputs, bedroom/bathroom selects, a five-city
   checkbox disclosure, complete form states, accessibility, responsive
   layout, and component tests. **Complete in code and offline verification:**
   the third authenticated workspace uses a strict typed client backed by the
   shared Domain enums and bounds. It implements initial load/retry, clean and
   dirty state, local validation, discard, duplicate-safe save, success,
   unavailable, optimistic conflict/reload, and load/save session expiry. The
   accessible city disclosure supports one-to-five selection, Escape,
   click-away, and focus return; desktop and narrow layouts keep stable form
   controls and tabs. All 886 tests, full runtime/CDK typecheck, and the
   production build pass. No migration, database connection, provider request,
   notification, deployment, or AWS operation occurred.
7. `21.6` Parameterize the RentCast request and production worker, load the
   persisted profile before acquisition, keep one regional request, and fail
   closed when total count exceeds the 500-row page cap. **Complete in code
   and offline verification:** the RentCast adapter now accepts a typed
   provider projection, keeps the fixed regional anchor/CA/Active scope, uses
   dynamic property type, maximum price, bedroom, and bathroom values, and
   requests `includeTotalCount=true` with `limit=500`. Production loads and
   strictly validates the primary profile before constructing alert state,
   source, or notification adapters. City and minimum price remain Domain
   filters, so one-city and five-city profiles both issue one regional request
   and tracked below-floor price drops remain eligible. Missing, malformed,
   profiles fail closed. At this checkpoint, an unapplied profile also failed
   closed; Block 21.7 replaces that temporary guard with atomic silent baseline.
   A total above the cap
   or an incomplete below-cap page fails before listing state or Telegram
   mutation. All 903 tests, full runtime/CDK typecheck, and the production
   build pass. No real provider, database, Telegram, deployment, schedule, or
   AWS operation occurred.
8. `21.7` Implement atomic revision-aware silent baseline, preserve pending
   events, and add cross-layer tests for later new listings and tracked
   below-floor price drops. **Complete in code and offline verification:** the
   Application workflow tags acquisition candidates without creating alert
   transitions and handles typed `applied`, `already-applied`, and `conflict`
   results. The PostgreSQL adapter locks the primary profile plus canonical
   addresses, writes full-criteria inventory and already tracked below-floor
   addresses, preserves outbox events, and advances `applied_revision` in the
   same transaction. Provider coverage failure and database failure leave the
   revision unapplied; successful baseline paths retry older pending events.
   Cross-run tests prove that later eligible listings and tracked drops below
   the minimum price still alert. All 914 tests, full runtime/CDK typecheck,
   and the production build pass. No real provider, database, Telegram,
   deployment, schedule, or AWS operation occurred.
9. `21.8` Run the full suite, typecheck, build, disposable `001-006 -> 007`
   migration integration, local authenticated browser acceptance, fake-data
   two-revision smoke, runbook updates, and a separately confirmed AWS
   read-only precheck. **Complete:** the disposable migration upgrade
   and idempotent retry passed against PostgreSQL 18; synthetic local
   authentication, criteria revision 1 read, revision 2 save/reload, fixed
   CA/Active scope, actor attribution, stale conflict, logout, and 401 boundary
   passed through real Express and PostgreSQL adapters. React's 28 focused tests
   and the two-revision fake provider/Telegram worker smoke pass. Cleanup was
   confirmed without changing the existing local PostgreSQL container. The
   user confirmed the browser visual acceptance. The separately authorized AWS
   precheck read metadata only and confirmed healthy stacks, disabled/absent
   schedules, zero running or pending ECS tasks, available private encrypted
   Aurora, enabled failure rules, confirmed SNS, guardrails, Secret metadata,
   and a template-only CDK diff with no deletion or protected topology change.
   Evidence and rerun instructions are in the
   [acceptance runbook](runbooks/listing-search-criteria-acceptance.md).

Every executable sub-block requires a fresh explanation and explicit
confirmation. Block 21.0 does not change source code, connect to a database,
consume RentCast quota, send Telegram, deploy, change a schedule, or operate an
AWS resource.

See the
[Block 21 Configurable Listing Search Knowledge Base](knowledge-base/block-21-configurable-listing-search.md)
and
[ADR 0009: Persisted Listing Search Criteria](adr/0009-persisted-listing-search-criteria.md).

### Block 22: ArcGIS Map-Engine Migration

Migrate only the authenticated browser map from MapLibre GL JS and OpenFreeMap
to ArcGIS Maps SDK for JavaScript. Preserve the existing React/TypeScript
architecture, injected `ListingsMapDriver`, workspace layout, listing and
selection behavior, manual-listing draft workflow, CAL FIRE pipeline and UX,
API/backend contracts, authentication, Search Criteria, Showing List, and AWS
topology.

The accepted target uses ArcGIS 5.1 map components for view/UI lifecycle and
core `GraphicsLayer`/`GeoJSONLayer` APIs behind the current driver boundary.
The CAL FIRE artifact remains a validated same-origin static GeoJSON release;
the browser does not add an ArcGIS FeatureServer dependency. The
`VITE_ARCGIS_API_KEY` browser credential is limited to required basemap
privileges and approved referrers. It is never treated as a hidden server
secret.

This block is a migration, not a redesign or feature expansion. It does not add
ArcGIS login, portal items, hosted layers, search, geocoding, routing, popups,
clustering, 3D, PostGIS, new API routes, database migrations, or cloud
deployment.

Planned sub-block mapping:

1. `22.0` Freeze feature parity, architecture, security, lifecycle, bundle
   baseline, rollback, and acceptance contracts. **Complete in documentation
   only:** ADR 0010 and the Block 22 knowledge base are accepted. Four focused
   baseline files with 18 tests and the production web build pass. The current
   MapLibre web asset baseline is 1,815,958 raw bytes and 473,971 gzip bytes.
   No dependency, runtime source, network service, or AWS resource changed.
2. `22.1` Add exact compatible ArcGIS 5.1 packages, component registration,
   basemap-key configuration, and missing/invalid-key tests. Keep MapLibre as
   the user-visible default and make no real ArcGIS request in automated tests.
   **Complete in code and offline verification:** exact Core 5.1.20,
   map-components 5.1.20, and Calcite 5.1.2 dependencies are pinned. The
   isolated runtime registers only the map and zoom components, applies a
   strictly validated key only to `apiKeys.basemapStyles`, and includes React
   19 JSX types. The indirect Vaadin usage-statistics build script is denied.
   Thirteen new tests, 31 focused tests, all 927 repository tests, full
   typecheck, and production builds pass. The current bundle and CSP remain
   MapLibre/OpenFreeMap-only, and no ArcGIS request or credential exposure
   occurred.
3. `22.2` Implement the ArcGIS listing-map driver with the navigation basemap,
   listing graphics, selection hit testing, fit/focus behavior, resize,
   bounded startup failure, retry, and idempotent teardown. Do not cut over the
   default factory yet. **Complete in code and offline verification:** an
   engine-neutral port preserves existing imports, and the non-default ArcGIS
   adapter creates one navigation map, one top-right zoom component, and one
   stable-ID `GraphicsLayer`. It preserves marker tokens, layer-scoped
   selection and pointer behavior, fit/focus constraints, bounded errors,
   stale-async guards, automatic host resize, and idempotent cleanup. Nine new
   adapter tests, 27 focused tests, all 936 repository tests, full typecheck,
   and production builds pass. The production bundle remains
   MapLibre/OpenFreeMap-only and contains neither the ArcGIS listing runtime nor
   the local API key. Draft and CAL FIRE hooks remain deferred to 22.3 and
   22.4.
4. `22.3` Reproduce manual-listing background placement, listing-hit
   suppression, draft dragging, coordinate callbacks, confirmation state, and
   create/edit integration without adding ArcGIS editing UI. **Complete in
   code and offline verification:** the non-default ArcGIS adapter installs a
   separate topmost draft `GraphicsLayer`, reconciles one stable point graphic,
   and renders an anchored local data-URI pin with rust editable and teal-halo
   confirmed states. Layer-scoped hit tests preserve listing selection,
   background-only placement, draft-hit suppression, crosshair/pointer/grab
   feedback, and map navigation outside the draft. Dragging stops map
   propagation only after the draft is hit, updates geometry during movement,
   and emits bounded coordinates only on drag end. Async generations prevent
   late click or drag results from writing after cancel or destroy. The ArcGIS
   adapter remains non-default; no backend, database, wildfire, network, CSP,
   or AWS behavior changed. Fifteen adapter tests, 34 focused ArcGIS/React
   workflow tests, all 942 repository tests across 106 files, full typecheck,
   and production builds pass. Production JavaScript remains
   MapLibre/OpenFreeMap-only and contains neither ArcGIS adapter runtime markers
   nor the local browser key.
5. `22.4` Migrate the existing strict CAL FIRE state machine to a validated,
   Blob-backed ArcGIS `GeoJSONLayer` with severity rendering, preserved layer
   order, lazy loading, one-fetch toggles, rollback, retry, and cleanup.
   **Complete in code and offline verification:** the existing artifact and
   metadata loaders, strict parser, state transitions, desired visibility,
   one-fetch cache, retry, and Abort behavior now run through one
   engine-neutral lifecycle with renderer-owned installation and rollback.
   MapLibre retains its existing source/four-layer renderer. The non-default
   ArcGIS adapter creates one validated Blob-backed `GeoJSONLayer`, applies the
   accepted three-class `UniqueValueRenderer`, and installs it at map index `0`
   below stored listings and the draft marker. Disable/enable changes only
   `visible`; failure removes and destroys the layer, revokes its object URL,
   and remains retryable. Overlay state is forwarded to the existing React
   control, while construction or load failure never invokes the base-map error
   boundary. No real provider request, default-engine cutover, CSP change,
   backend operation, database operation, deployment, or AWS operation
   occurred. Seven new ArcGIS overlay tests, 74 focused ArcGIS/CAL FIRE/React
   tests, all 951 repository tests across 107 files, full typecheck, and
   production builds pass. Production JavaScript remains
   MapLibre/OpenFreeMap-only and contains neither ArcGIS overlay runtime markers
   nor the configured local browser key.
6. `22.5` Switch the production factory to ArcGIS, update CSP from an observed
   least-privilege network audit, and remove MapLibre, OpenFreeMap, the bundled
   worker, dead helpers, and engine-specific selectors. The final runtime has
   one map engine and no permanent compatibility flag. **Complete in code and
   offline verification:** `ListingsMap` now defaults to the ArcGIS driver, and
   browser-only component registration is isolated in the web entry point.
   MapLibre, OpenFreeMap, their worker, GeoJSON helper, dependency, selectors,
   and lockfile entries are removed. Vite now reads the repository-root browser
   environment explicitly. A credentialed request using the approved local
   referrer returned the ArcGIS navigation style successfully and identified
   only `basemapstyles-api.arcgis.com`, `basemaps-api.arcgis.com`, and
   `cdn.arcgis.com`; the key value was never printed. CSP is restricted to
   those origins plus the SDK's WebAssembly and Blob-worker requirements.
   Fifty-nine focused tests, all 950 repository tests across 107 files, full
   runtime/CDK typecheck, and production builds pass. The synthetic-key bundle
   has 1,090 JavaScript assets and a 1,438.21 kB raw/360.38 kB gzip main asset;
   it contains no MapLibre/OpenFreeMap marker and does contain the expected
   synthetic key injection. The real local key is absent from that artifact.
   Browser control could not attach to the open local tab, so visual, WebGL,
   and browser Network-panel acceptance are deliberately not claimed here and
   remain the Block 22.6 merge gate. No backend, database, AWS, RentCast,
   Telegram, or deployment operation occurred.
7. `22.6` Run full tests, typecheck, builds, desktop/mobile browser acceptance,
   WebGL/canvas and network inspection, API-key restriction review, and bundle
   delta recording. Update as-built documentation and leave the merge into
   `main` to the repository owner after acceptance. **Complete:** all 950 tests
   across 107 files, full runtime/CDK typecheck, and a synthetic-key production
   build pass. User-confirmed desktop/mobile acceptance preserves the ArcGIS
   basemap, listing selection and framing, manual draft workflow, CAL FIRE
   three-severity overlay, provenance, disclosures, and responsive layout. The
   browser audit exposed and closed two least-privilege CSP gaps: exact ArcGIS
   SDK/static/CDN origins and `connect-src blob:` for the validated local
   `GeoJSONLayer`. It contains no wildcard or OpenFreeMap origin. A React
   StrictMode teardown race was reproduced with a regression test and fixed by
   waiting for `componentOnReady()` before destroying an unmounted component;
   the user confirmed a clean Console after hard refresh. The observed Network
   panel contains the expected ArcGIS and same-origin artifact requests and no
   OpenFreeMap request. The final 1,090-asset build has a 1,438.27 kB raw /
   360.43 kB gzip main asset and 303 preload links; the known large-chunk
   advisory remains. Approved and rejected referrer probes returned HTTP 200
   and HTTP 401/ArcGIS 498 respectively, no real key was logged, and a
   synthetic-key audit found no real local key in the build. No backend,
   database, RentCast, Telegram, AWS, schedule, or deployment operation
   occurred.

Every executable sub-block requires a fresh explanation and explicit
confirmation. Block 22 does not call RentCast, connect to PostgreSQL, send
Telegram, mutate AWS resources, enable a schedule, or deploy unless a separate
operation is reviewed and approved.

See the
[Block 22 ArcGIS Map-Engine Migration Knowledge Base](knowledge-base/block-22-arcgis-map-engine-migration.md)
and
[ADR 0010: ArcGIS Map-Engine Migration](adr/0010-arcgis-map-engine-migration.md).

### Block 23: 3D Fire Terrain Context

Add an optional `3D Terrain` mode to the authenticated Listings map. The mode
will render the existing residential listings and the existing CAL FIRE Fire
Hazard Severity Zone release against ArcGIS real-world terrain/elevation so an
operator can visually understand the surrounding topography.

This is contextual visualization, not a new fire-risk model. The same tracked,
strictly validated CAL FIRE artifact remains authoritative. Its `moderate`,
`high`, and `very-high` values are rendered without reclassification,
interpolation, elevation adjustment, slope scoring, buffering, or prediction.
Terrain does not change whether a property is inside, near, or outside a hazard
polygon, and the application does not produce a property risk score.

The accepted product direction keeps 2D as the default and adds one explicit
2D/3D mode control. Only one ArcGIS view may be active at a time. The 3D mode is
read-only for map exploration; starting or resuming manual listing placement
uses the existing 2D workflow. No API, database, worker, alert, RentCast,
Telegram, Showing List, authentication, or AWS contract changes.

Planned sub-block mapping:

1. `23.0` Freeze the product semantics, authority boundary, single-view
   architecture, security/cost gates, failure behavior, rollback, tests, and
   acceptance criteria. **Complete in documentation only:** ADR 0011 and the
   Block 23 knowledge base are accepted. No runtime source, dependency,
   credential, network service, database, or AWS resource changed.
2. `23.1` Run a provider and browser capability precheck for `arcgis-scene`,
   `world-elevation`, API-key privileges/referrers, exact network origins, CSP,
   attribution, service terms, and expected usage/cost. Any credentialed ArcGIS
   request requires fresh confirmation and must not print the key. **Complete
   in a controlled local/provider audit:** exact ArcGIS 5.1.20 dependencies
   remain compatible; the M4/16 GB/Chrome 151 test device reports WebGL2 and a
   ready local scene with one real World Elevation ground layer and no runtime
   error. Authorized Terrain3D metadata and one Corona-area LERC tile returned
   HTTP 200 without exposing the key. The browser succeeded while the key
   remained scoped only to basemap styles, so no elevation privilege, second
   key, or numeric Elevation API is required. The only new CSP origin candidate
   is `https://elevation3d.arcgis.com` in `connect-src`; a production-equivalent
   probe passed without a wildcard or `'unsafe-eval'`. One nonfatal ArcGIS
   config-bundle `eval` attempt remained blocked during Vite development and is
   retained as a Block 23.6 production-build regression check. No committed
   runtime source, credential, CSP, dependency, backend, database, or AWS
   resource changed.
3. `23.2` Add the mode-neutral 2D/3D controller seam and accessible mode control
   with injected fake drivers. Preserve React-owned listings, selection,
   wildfire visibility, retries, and one-active-view lifecycle. Keep the real
   3D implementation non-default. **Complete:** `ListingsMap` now owns the
   session-only `2d` / `terrain-3d` mode, accepts an optional injected terrain
   factory, destroys the active driver before replacement, and replays
   listings, draft presentation, selection focus, and desired CAL FIRE
   visibility after readiness. Lifecycle guards reject stale selection, draft,
   overlay, ready, and error callbacks. The accessible segmented control is
   capability-gated and therefore remains absent from the production workspace
   until a real factory is deliberately wired in Block 23.5. Focused tests prove
   both switch directions, retry ownership, teardown order, and stale-callback
   isolation without an ArcGIS or network request. No real scene, terrain
   request, credential, CSP, dependency, backend, database, or AWS change was
   added.
4. `23.3` Add the non-default ArcGIS local-scene adapter with World Elevation,
   current-basemap continuity, terrain-aware listing graphics, camera fit,
   focus, selection hit testing, resize, capability failure, and idempotent
   teardown. Do not add CAL FIRE rendering yet. **Complete:** the exact-pinned
   SDK now registers `arcgis-scene`, and a non-default driver creates a local
   `arcgis/navigation` scene over `world-elevation` with automatic quality, no
   exaggeration, visible attribution, disabled popups, bounded camera fit/focus,
   WebGL2 and ground-readiness failure isolation, stable terrain-relative
   listing graphics, layer-scoped selection, and idempotent teardown. Eleven
   adapter tests plus the existing 2D/shell/boundary regressions provide 36
   focused passing tests, and web typecheck passes. Production does not import
   the adapter, so 2D remains the only visible mode; CAL FIRE scene rendering,
   CSP changes, provider requests, and user-visible wiring were not added.
5. `23.4` Drape the same validated CAL FIRE `GeoJSONLayer` on terrain with the
   existing three severity classes, colors, opacity hierarchy, provenance,
   lazy loading, retry, layer ordering, and no extrusion or derived analysis.
   **Complete:** the terrain adapter derives its layer from the reviewed 2D
   factory and changes only elevation placement to `on-the-ground`. It shares
   the exact parser, manifest, three-class `SimpleFillSymbol` renderer,
   visibility state machine, Abort, rollback, retry, teardown, and Blob URL
   ownership. The scene creates the controller after ground readiness, queues
   desired visibility, keeps hazard below listing graphics, and isolates overlay
   failure from scene readiness. The terrain-only disclosure preserves CAL FIRE
   authority. Thirty-two focused tests and web typecheck pass; production
   wiring, real requests, CSP/key changes, backend, database, and AWS remain
   unchanged.
6. `23.5` Enable the user-visible mode switch and complete draft-mode routing,
   2D fallback, terrain-context disclosure, keyboard/accessibility behavior,
   responsive layouts, and state replay across mode changes. **Complete:** the
   production map shell now supplies the reviewed terrain scene factory while
   retaining 2D as the default and deferring scene creation until explicit user
   selection. Mode changes destroy the active driver and replay listings,
   selection focus, bounded camera fit, and desired CAL FIRE visibility. Add/Edit
   drafts immediately use 2D, disable terrain, and remain on 2D after closing.
   Terrain loading and failure have specific bounded states with `Retry 3D` and
   `Return to 2D`; return restores keyboard focus and safely recreates the 2D
   driver. Fifty focused shell, adapter, overlay, boundary, screen, and workflow
   tests pass; the repository-wide suite passes all 968 tests, root typecheck
   passes, and runtime/web/infrastructure production builds pass. Key/CSP/network,
   request, memory, and bundle audits remain 23.6; backend, database, AWS, and
   deployment are unchanged.
7. `23.6` Complete the least-privilege API-key/CSP integration, provider network
   audit, bundle delta, WebGL-context and memory audit, automatic ArcGIS quality
   behavior, and supported-device fallback. Do not broaden origins or privileges
   beyond observed need. **Complete:** the exact `elevation3d.arcgis.com`
   connect origin is applied with no wildcard or additional privilege.
   Approved/rejected
   referrer probes returned HTTP 200/401 without exposing the key. Scene code is
   dynamically loaded only after 3D selection, reducing the static Block 23.5
   main asset from 2,583.17/678.38 kB raw/gzip to a synthetic-key
   1,454.96/365.88 kB, only 1.16%/1.51% above the Block 22 main baseline. The
   build has 1,382 JS assets and 312 preloads; the 1,069.54/283.60 kB scene
   chunk is on demand. All 973 tests, root typecheck, and runtime/web/infra
   builds pass. Production preview and its API proxy return HTTP 200. The
   operator completed live browser acceptance on August 24, 2026 and confirmed
   the 3D terrain, draped CAL FIRE overlay, readable listing marker,
   context-only disclosure, attribution, 2D/3D lifecycle, Console, network, and
   responsive criteria. No backend, database, AWS, deployment, environment,
   account, privilege, or referrer setting changed.
8. `23.7` Run full tests, typecheck, builds, desktop/mobile visual acceptance,
   screenshot and nonblank WebGL/canvas checks, camera interaction, Console and
   Network inspection, CAL FIRE semantic parity, security review, and rollback
   verification. Update as-built documentation and leave the merge into
   `main` to the repository owner. **Complete:** the final branch audit contains
   only `apps/web` and documentation changes. All 973 tests, root typecheck,
   runtime/web/infrastructure builds, and 9 CAL FIRE artifact tests pass. The
   production preview returns HTTP 200, retains the exact least-privilege CSP,
   and does not preload the on-demand scene chunk. The operator confirmed both
   desktop and mobile browser acceptance, including nonblank terrain, listing
   selection, CAL FIRE draping, disclosure, attribution, responsive behavior,
   lifecycle, Console, Network, and fallback criteria. Rollback requires no
   data or cloud repair. Block 23 is ready for owner-controlled merge.

Every executable sub-block requires a fresh explanation and explicit
confirmation. Block 23 does not call RentCast, connect to PostgreSQL, send
Telegram, mutate AWS resources, enable a schedule, or deploy.

See the
[Block 23 3D Fire Terrain Knowledge Base](knowledge-base/block-23-3d-fire-terrain.md)
and
[ADR 0011: Optional 3D Fire Terrain Context](adr/0011-3d-fire-terrain-context.md).

### Block 24: Stevenson Ranch RentCast Coverage

Add `Stevenson Ranch`, California `91381` as a sixth selectable listing market
without weakening the existing RentCast page-completeness, Domain eligibility,
price-drop, revision-baseline, or notification guarantees.

The current Brea 20-mile request remains the acquisition area for Chino, Chino
Hills, Eastvale, Corona, and Jurupa Valley. A separately bounded ZIP `91381`
request covers Stevenson Ranch. Existing-only or Stevenson-only profiles issue
one provider request; mixed profiles issue two sequential requests. Every page
must independently remain below the 500-result cap, and one failed area fails
the whole source read before persistence or Telegram delivery.

The criteria schema remains version 1. Existing profiles are not silently
rewritten; the operator opts in by selecting Stevenson Ranch and saving. The
search-revision baseline prevents historical inventory from becoming new-
listing notifications. The additional area can double requests per worker run,
so quota and future schedule cadence remain explicit operational gates.

Block 24 does not expand the tracked five-city CAL FIRE artifact, create a new
hazard model, migrate the database, alter AWS, enable a schedule, deploy, send
Telegram, or mutate the production profile.

Planned sub-block mapping:

1. `24.0` Freeze product, provider-area, quota, compatibility, failure,
   security, rollout, rollback, test, and acceptance boundaries. **Complete in
   documentation only:** ADR 0012 and the Block 24 knowledge base are accepted.
   No runtime source or external system changed.
2. `24.1` Verify the official ZIP query contract and, after separate approval,
   execute exactly one real aggregate-only RentCast coverage audit for `91381`.
   **Inconclusive:** the one authorized request returned a successful 2xx JSON
   array, but an over-escaped local total-count regular expression stopped the
   aggregate validator before it retained totals or city labels. No retry was
   made. Local fixture gates and a new explicit authorization are required
   before a second real request; production wiring remains unchanged.
   **24.1A complete:** an isolated aggregate-only audit runner, explicit
   one-request CLI guard, safe default command, and deterministic fixtures now
   prove the ZIP URL, strict decimal header, complete-page, expected-city/ZIP,
   filter, schema, no-retry, and redaction gates without provider access.
   **24.1B complete, provider gate failed closed:** one newly authorized request
   returned all 17 matching records in one complete page with 483 result slots
   remaining. ZIP, property type, status, and configured filters passed, but all
   17 city labels were `Valencia`; no retry occurred and no raw listing data was
   retained. **Decision accepted:** retain `Stevenson Ranch` as the product
   market, match it by ZIP `91381`, and preserve provider city `Valencia`.
3. `24.2` Add Stevenson Ranch to the version-1 Domain market set, introduce the
   explicit exact-city/or-ZIP market matcher, preserve provider city data, and
   prove backward compatibility with existing five-city profiles. **Complete:**
   the shared Domain matcher uses ZIP `91381` only for Stevenson Ranch, original
   markets retain exact-city matching, legacy profiles do not auto-expand, and
   Domain/API/React tests, all 1009 repository tests, root typecheck, and root
   build pass without an external request.
4. `24.3` Add typed radius/ZIP geography to the RentCast client and preserve its
   strict URL, timeout, parser, key-header, and completeness contracts.
   **Complete:** the client accepts validated, mutually exclusive radius/ZIP
   areas, exports the current Brea radius as its compatible default, and passes
   42 targeted tests, all 1019 repository tests, root typecheck, and root build
   without a real provider request.
5. `24.4` Implement conditional one/two-area source routing, sequential fetch,
   all-or-nothing failure, and existing canonical-address reconciliation.
   **Complete:** pure market mapping selects Brea once for original markets,
   ZIP `91381` for Stevenson Ranch, and stable Brea-then-ZIP order for mixed
   selections. The source validates every page before returning any result,
   preserves downstream canonical-address reconciliation, and passes 46
   targeted tests, all 1034 repository tests, root typecheck, and root build.
   Production composition still uses the single Brea default until 24.5; no
   real provider request or external side effect occurred.
6. `24.5` Wire persisted criteria into production acquisition areas and update
   per-area/combined coverage audit reporting without changing AWS or schedule.
   **Complete:** normalized persisted markets now select one Brea area, one ZIP
   `91381` area, or stable Brea-then-ZIP areas in production composition. Audit
   reporting supports explicit sequential areas, per-area completeness and
   capacity, and combined provider rows labeled before reconciliation. The
   guarded CLI remains a single default-Brea request. All 1039 repository tests,
   root typecheck, and root build pass without a real request, profile mutation,
   cloud operation, schedule change, or deployment.
7. `24.6` Expose the sixth city through the existing API and React criteria UI,
   preserving revision, accessibility, responsive, and conflict behavior.
   **Complete:** five-market profiles remain unchanged, Stevenson Ranch is an
   explicit unchecked opt-in, six-market loads and canonical saves are covered
   through React, Web adapter, authenticated HTTP, and Application tests, and a
   save increments revision exactly once while retaining the applied baseline.
   All 1043 tests, root typecheck, root build, and diff checks pass. The operator
   completed the authenticated local save flow and accepted the resulting UI.
8. `24.7` Run fake multi-area integration, full automated/browser acceptance,
   quota and security review, as-built documentation, and the final merge gate.
   **Complete:** production
   integration proves stable Brea-then-ZIP requests, canonical overlap collapse,
   quiet revision baseline, preserved provider city `Valencia`, and zero partial
   repository or Telegram effects when the second area fails. ArcGIS fixtures
   prove 2D and 3D cross-region fit while CAL FIRE remains the unchanged
   five-city artifact with its blank-area disclosure. All 1048 tests, root
   typecheck, root build, and diff/security checks pass. A mixed profile consumes
   two requests per run, so 50 requests permit at most 25 runs before
   audits/retries. The operator completed logged-in local acceptance and
   explicitly saved Stevenson Ranch. Listings correctly remained stored
   snapshots until a worker run, and the CAL FIRE overlay correctly retained its
   five-city scope and blank-area disclosure. No deployment, schedule change,
   real worker run, Telegram send, AWS operation, or production profile mutation
   occurred.

Every executable sub-block requires a fresh explanation and explicit
confirmation.

See the
[Block 24 Stevenson Ranch RentCast Coverage Knowledge Base](knowledge-base/block-24-stevenson-ranch-rentcast-coverage.md)
and
[ADR 0012: Conditional RentCast Search Areas](adr/0012-conditional-rentcast-search-areas.md).

### Block 25: Stevenson Ranch Wildfire Coverage

Extend the reviewed CAL FIRE / Office of the State Fire Marshal Fire Hazard
Severity Zone artifact to the Stevenson Ranch product market without treating
ZIP `91381` as a city, legal jurisdiction, or hazard boundary. Stevenson Ranch
is a typed `market-context` coverage target; the existing five cities remain
`incorporated-jurisdiction` targets.

The runtime continues to use a deterministic, versioned, same-origin GeoJSON
artifact. React and ArcGIS do not call a live CAL FIRE, Los Angeles County,
Census, or third-party hazard service. The application preserves official
`Moderate`, `High`, and `Very High` classifications, LRA/SRA responsibility,
existing transparent styling, listing-marker ordering, 2D/3D parity, and all
hazard-not-risk and blank-area disclosures.

The overlay remains independent from listing count. When the map is viewing the
supported Stevenson Ranch context, enabling the overlay must display reviewed
hazard geometry even when no stored listing matches current criteria. Search
Criteria and RentCast city data do not select or classify hazard features.

Planned sub-block mapping:

1. `25.0` Freeze product, authority, geography, typed coverage-target, manifest,
   artifact, security, cost, compatibility, rollout, rollback, and acceptance
   boundaries. **Complete in documentation only:** ADR 0013 and the Block 25
   knowledge base are accepted. No source download, external query, artifact
   build, runtime source, secret, database, provider, cloud, or deployment
   changed.
2. `25.1` Recheck current official CAL FIRE LRA/SRA sources and Los Angeles
   County adoption evidence; select and checksum a defensible Stevenson Ranch
   market-context boundary; audit LRA/SRA intersections, severities, geometry,
   counts, bounds, area, size, parse cost, and clipping semantics. Any real
   download or service query requires a fresh explanation and explicit
   authorization. Do not publish a runtime artifact. **Complete:** the official
   ACS 2025 Stevenson Ranch CDP (`0674130`) is the selected statistical
   boundary with SHA-256
   `2405aaedb264e5854c933f6e461aa3bf6b5e9109f73d6baba0fa65baf47292cf`.
   Official and pinned-local checks agree on five LRA intersections, including
   one excluded `NonWildland`, and seven SRA intersections. Los Angeles County
   Ordinance `2025-0027` supports `locally-adopted` LRA status. Exact CDP hard
   clipping adds 11 supported features and projects the combined artifact at
   1,158,246 raw / 289,420 gzip bytes; whole intersecting polygons were rejected
   as geographically overbroad. No runtime artifact was published.
3. `25.2` Add red tests and implement typed coverage-target and manifest schema
   version 2 contracts. Generalize the fixed five-city config and parser while
   retaining strict kinds, statuses, provenance, URL, filename, checksum,
   duplicate, severity, and responsibility-area validation. **Complete:** the
   build config now uses typed `coverageTargets`; the manifest producer writes
   schema version 2 only; the browser parser reads the currently published
   schema version 1 and strict version 2 during migration; the five existing
   designation statuses are preserved; and invalid kinds, statuses, duplicate
   IDs/labels, missing source/evidence references, insecure evidence URLs,
   unsafe artifact filenames, integrity counts, severities, and responsibility
   areas fail closed. The current runtime artifact and manifest remain
   unchanged. The build rejects non-city targets with an explicit Block 25.3
   boundary-pipeline error until the reviewed Stevenson Ranch snapshot lands.
4. `25.3` Add the reviewed checksum-pinned boundary snapshot and generalize the
   deterministic GDAL pipeline to explicit target boundary sources and
   selectors. Preserve geometry repair, area reconciliation, severity
   allowlisting, `NonWildland` exclusion, transfer budgets, and fail-closed
   behavior. **Complete:** the ACS 2025 Stevenson Ranch CDP is tracked at its
   audited checksum; all six targets use typed selectors that must match one
   tracked boundary; per-target GDAL QA is recorded; offline staging and a
   Block 25.4 publication lock are enforced. Two offline builds produced the
   same 96-feature, 1,158,246-byte artifact with SHA-256
   `7d8486b94ef6802ab5866d17b0a591634dfe3e16843ef58a21143a43df5e09fd`.
   The current public GeoJSON and manifest remain byte-for-byte unchanged.
5. `25.4` Generate and review the successor versioned artifact and manifest.
   Reconcile per-target and combined counts, severities, bounds, geometry,
   areas, checksums, attribution, raw/gzip size, and deterministic rebuilds
   before changing runtime references. **Complete:** a fresh offline stage and
   offline publication produced byte-identical successor files. The public
   schema version 2 manifest describes all six targets; the 96-feature artifact
   is 1,158,246 raw / 292,581 gzip bytes with SHA-256
   `7d8486b94ef6802ab5866d17b0a591634dfe3e16843ef58a21143a43df5e09fd`.
   Stevenson Ranch reconciles to 11 valid features and the audited 1 Moderate /
   7 High / 3 Very High split. The previous artifact is retained and the React
   runtime URL remains unchanged until Block 25.5. Wildfire tests pass 24/24,
   all 114 repository test files and 1,071 tests pass, typecheck passes, and the
   production application and infrastructure build passes.
6. `25.5` Integrate the strict schema and artifact into React and both ArcGIS
   modes. Preserve visual tokens, layer order, lazy loading, Abort, retry,
   rollback, teardown, terrain semantics, and compact/mobile provenance. Prove
   zero listings do not suppress Stevenson Ranch hazard polygons. **Complete:**
   the shared runtime loader now requests the six-target successor; 2D and 3D
   retain one artifact and lifecycle contract; the legend distinguishes the
   Stevenson Ranch market context, Census CDP coverage edge, and ZIP `91381`
   product selector; and a zero-listing React test proves the toggle remains
   independent from listing results. Focused tests pass 45/45, wildfire tests
   pass 24/24, all 114 repository files and 1,072 tests pass, typecheck passes,
   and the production application and infrastructure build passes. Browser
   visual, Console, Network, WebGL, and teardown acceptance was deferred to
   Block 25.6.
7. `25.6` Run focused and repository-wide tests, typecheck, builds, CSP and
   payload review, then complete desktop/mobile 2D/3D visual acceptance for
   Stevenson Ranch and all five existing cities. Inspect Console, Network,
   nonblank canvas/WebGL output, memory, interaction, and teardown. **Complete:**
   all 114 repository test files and 1,072 tests pass, repository-wide
   typecheck and production/AWS builds pass, and the existing ArcGIS chunk-size
   warning is unchanged. Desktop and 390 x 844 mobile acceptance confirms
   nonblank 2D/3D output, transparent authoritative polygons, listing-marker
   ordering, six-target provenance, Stevenson Ranch visibility with no matching
   listing, zero interaction-window Console errors/warnings, no horizontal
   mobile overflow, and full map/scene/canvas teardown. A stale local Vite
   optimized-dependency cache caused the reported map outage; forced dependency
   reoptimization restored the local ArcGIS modules without a source, artifact,
   CSP, API-key, backend, or provider change.
8. `25.7` Complete the final diff, security, provenance, rollback, and as-built
   documentation gate. Leave commit, push, PR, and merge under repository-owner
   control. **Complete:** the 25-path branch diff is limited to the wildfire
   pipeline/assets, React integration, tests, docs, and explicit offline scripts;
   no environment, CI/CD, AWS, backend, provider, database, schedule, credential,
   or CSP boundary changed. A digest-pinned, network-disabled GDAL rebuild
   reproduced the 96-feature artifact and schema version 2 manifest byte-for-byte
   while preserving the prior five-city rollback asset. Focused tests pass
   24/24; the final repository gate passes 114/114 test files and 1,072/1,072
   tests, repository-wide typecheck, the production web build, and the AWS build.
   Commit, push, PR, merge, deployment, and rollback remain under owner control.

Every executable sub-block received a fresh explanation and explicit
confirmation. Block 25 does not create a new hazard model, call RentCast,
connect to PostgreSQL, send Telegram, mutate AWS, add a browser credential,
change a schedule, or deploy.

See the
[Block 25 Stevenson Ranch Wildfire Coverage Knowledge Base](knowledge-base/block-25-stevenson-ranch-wildfire-coverage.md)
and
[ADR 0013: Typed Wildfire Coverage Targets](adr/0013-typed-wildfire-coverage-targets.md).

### Block 26: Five-City Direct Market Coverage

Replace the legacy 20-mile RentCast radius centered at Brea with one direct
`city + state=CA` provider area for each selected incorporated market: Chino,
Chino Hills, Eastvale, Corona, and Jurupa Valley. Stevenson Ranch retains its
reviewed ZIP `91381` area and provider city remains unchanged.

The worker preserves explicit typed geography, canonical market order,
per-area 500-result completeness, sequential all-or-nothing acquisition,
canonical-address reconciliation, price-drop behavior, and one stored React
record per property. No production or successor audit path may silently fall
back to the Brea radius.

The Brea radius does not govern wildfire data. The existing five city targets
remain exact `incorporated-jurisdiction` boundaries, while Stevenson Ranch
remains a `market-context` target. Block 26 does not rebuild the CAL FIRE
artifact, reinterpret classifications, or introduce a live hazard request.

Planned sub-block mapping:

1. `26.0` Freeze product, provider geography, hazard authority, quota, failure,
   compatibility, security, rollout, rollback, test, and acceptance boundaries.
   **Complete in documentation only:** ADR 0014 and the Block 26 knowledge base
   are accepted, ADR 0012 is marked partially superseded, and this roadmap is
   recorded. No runtime code, secret, provider request, database, wildfire
   artifact, AWS resource, schedule, Telegram delivery, or deployment changed.
2. `26.1A` Add fixture-gated direct-city coverage-audit tooling, strict command
   authorization, aggregate-only output, and dry-run tests without reading a
   credential or calling RentCast. **Complete:** an isolated runner now builds
   five canonical `city + state=CA` requests and reports only per-city and
   combined counts, provider labels, completeness, capacity, bytes, prices, and
   timings. The CLI requires exact five-request and market-list confirmations;
   its non-executing package command does not load `.env.local`, makes no
   request, and fails with guarded usage. Twenty-four focused tests, all 116
   test files and 1,096 tests, root typecheck, and production/AWS build pass.
   No real provider request or production-path change occurred.
3. `26.1B` With fresh explicit authorization, execute exactly five real
   RentCast city requests without retry and record aggregate provider labels,
   capacity, completeness, response size, and elapsed evidence. **Complete:**
   the guarded command made five canonical sequential requests with no retry;
   all city, filter, schema, and completeness gates passed. It returned all 112
   matching rows (Chino 22, Chino Hills 1, Eastvale 2, Corona 64, Jurupa Valley
   23), zero filter violations, and a 2,388-row combined capacity margin. Only
   aggregate evidence was recorded, and production acquisition did not change.
4. `26.2` Add the strict typed city-area client contract, mutually exclusive
   query parameters, and required explicit production geography. Remove the
   implicit Brea default while retaining explicit radius capability for
   reviewed maintenance or rollback. **Complete:** the RentCast package exports
   a strict city variant; city, ZIP, and radius runtime fields are mutually
   exclusive; city labels are normalized without changing provider case; and
   invalid areas fail before fetch. Both client entrypoints require an explicit
   area, so omitted geography can no longer fall back to Brea. Existing worker
   mapping remains explicitly Brea-based until Blocks 26.3 and 26.4. All 39
   focused client tests, all 116 test files and 1,104 repository tests, root
   typecheck, and the production/AWS build pass.
5. `26.3` Map each selected incorporated city to one city area and Stevenson
   Ranch to ZIP `91381` in canonical order. Reject empty, duplicate, and
   unsupported inputs before network access. **Complete:** the active selector
   now maps every supported market to one explicit frozen area, restores Domain
   order independent of input order, and fails closed on empty, duplicate,
   unsupported, or malformed input. One, five, and six selected markets yield
   exactly 1, 5, and 6 areas. Production composition now receives five direct
   city areas plus the existing Stevenson ZIP when all markets are selected;
   no worker or provider request was executed. Twenty-six focused mapping,
   production-composition, and existing workflow integration tests pass, along
   with all 116 test files and 1,106 repository tests, root typecheck, and the
   production/AWS build.
6. `26.4` Integrate direct areas into the source and production composition
   while preserving all-or-nothing reads, completeness gates, overlap
   reconciliation, observation time, alert state, and zero partial Telegram
   effects. **Complete:** the source now requires an explicit non-empty area
   list and has no Brea fallback. Six-market source coverage proves canonical
   sequential reads, a shared post-success observation time, and independent
   completeness gates; a sixth-request provider failure and a later-area
   incomplete page return no rows and do not read the observation clock.
   Production workflow integration proves that the same late failure causes no
   persistence, revision advancement, listing snapshot, alert event, or
   Telegram request. Existing canonical-address overlap reconciliation,
   tracked price-drop delivery, and ZIP `91381` provider city `Valencia`
   preservation remain covered. All 116 test files and 1,107 tests, root
   typecheck, and the production/AWS build pass.
7. `26.5` Replace active Brea-default audit and operations guidance with
   explicit market-scoped commands and visible request-count/quota gates. No
   ordinary command may silently execute five or six provider requests.
   **Complete:** the old Brea-default scripts and executable chain are removed.
   Safe five-city and Stevenson Ranch previews load no environment file and
   exit before provider access; real forms require exact request-count and
   market confirmations. The five-city audit costs 5 requests, the ZIP `91381`
   audit costs 1, and no ordinary combined six-request command exists. Output
   and operations guidance expose the 50-request planning reference plus 5/6
   production cost while requiring verification of current account plan and
   usage. Historical Block 20/24 evidence remains documented but is no longer
   executable guidance. All 48 focused successor-audit tests, all 114 test
   files and 1,096 repository tests, root typecheck, and the production/AWS
   build pass. No real request or external side effect occurred.
8. `26.6` Verify the existing six-target wildfire artifact remains unchanged
   and complete 2D/3D, zero-listing, responsive, provenance, disclosure,
   interaction, and teardown regression acceptance for all five cities.
   **Complete:** pinned SHA-256 checks protect the unchanged GeoJSON and
   manifest; incorporated-target and empty-listing 2D/3D regressions pass;
   all 71 focused tests, all 114 repository test files and 1,098 tests,
   typecheck, and the production/AWS build pass. Desktop and mobile manual
   acceptance confirmed the authoritative overlay, terrain context, markers,
   controls, provenance, disclosures, List/Map behavior, unchanged Search
   Criteria UX, and a clean application Console. No provider, database-write,
   Telegram, AWS, schedule, artifact-build, or deployment side effect occurred.
9. `26.7` Run fake-provider one-, five-, and six-market integrations, full
   tests/typecheck/builds, browser and security acceptance, final diff,
   rollback, quota, and as-built documentation gates. Commit, push, PR, merge,
   schedule, and deployment remain under repository-owner control.
   **Complete:** the production-composition matrix proves exact canonical
   request counts of 1, 5, and 6 with no implicit Brea parameters, no partial
   state, and no Telegram during revision baseline. All 175 focused tests and
   all 114 repository test files / 1,101 tests pass with root typecheck and the
   production/AWS build. The accepted 26.6 browser evidence remains valid
   because 26.7 changes no Web runtime. Final security and diff review found no
   credential, tracked local environment, dependency-lock, migration,
   workflow, infrastructure-runtime, wildfire-artifact, schedule, or
   deployment change.

Every executable sub-block requires a fresh explanation and explicit
confirmation. A full six-market worker run consumes six successful RentCast
requests; using 50 requests as a monthly planning reference, no more than eight
complete runs fit before audits, retries, or other provider use. Verify the
current account plan and usage before execution. Block 26 does not approve or
change a production cadence.

See the
[Block 26 Five-City Direct Market Coverage Knowledge Base](knowledge-base/block-26-five-city-direct-market-coverage.md)
and
[ADR 0014: Direct Market RentCast Acquisition](adr/0014-direct-market-rentcast-acquisition.md).

### Block 27: Irvine Market And Wildfire Coverage

Add Irvine in Orange County as an opt-in seventh listing market and as a
reviewed CAL FIRE wildfire coverage target. Irvine follows the incorporated
city pattern: one direct RentCast `city=Irvine&state=CA` area and one official
incorporated-jurisdiction boundary. It does not use the Stevenson Ranch ZIP/CDP
exception.

Existing schema-version-1 profiles and default selections remain the six
pre-Irvine markets until a user explicitly selects Irvine. Listing acquisition
retains canonical ordering, strict per-area completeness, sequential
all-or-nothing failure, canonical-address reconciliation, provider-data
preservation, and existing new-listing and price-drop behavior. A seven-market
run costs seven provider requests; the current 50-request planning reference
fits at most seven complete runs with one request left before audits, retries,
or other usage.

The wildfire extension uses a checksum-pinned official Irvine city boundary
and independently reviewed CAL FIRE LRA/SRA intersections and City of Irvine
designation/adoption evidence. It preserves exact authoritative severities,
the deterministic same-origin artifact, existing payload gates, 2D/3D parity,
transparent styling, provenance, and disclosures. Irvine polygons remain
available when no listing matches. Terrain is context only and blank space is
not a safety conclusion.

Planned sub-block mapping:

1. `27.0` Freeze product, provider geography, wildfire authority, quota,
   compatibility, security, rollout, rollback, test, and acceptance boundaries.
   **Complete in documentation only:** ADR 0015, the Block 27 knowledge base,
   and this roadmap are accepted. No runtime code, environment file, provider
   request, official GIS query, download, artifact, database, profile, AWS,
   schedule, Telegram, deployment, commit, push, or merge changed.
2. `27.1A` Add fixture-gated Irvine direct-city audit tooling with exact
   one-request confirmation, aggregate-only output, dry-run behavior, filter,
   completeness, provider-city, redaction, and no-retry tests. Do not read
   `.env.local` or call RentCast. **Complete:** the isolated runner reuses the
   strict direct-city core and constructs one bounded Irvine request; the CLI
   requires exact one-request and `irvine-ca` confirmations. Its safe preview
   omits `.env.local`, exits before `fetch`, and reports that no request was
   made. Eighteen runner and nine command tests cover geography, filters,
   schema, total counts, completeness, capacity, provider city, aggregate-only
   output, strict arguments, no retry, missing key, and secret/URL redaction.
   All 75 audit regressions and all 116 repository test files / 1,128 tests
   pass, along with repository-wide typecheck and the production/AWS build. No
   external request or runtime production change occurred.
3. `27.1B` With fresh explicit authorization, make exactly one real Irvine
   RentCast request without retry and record only aggregate provider geography,
   completeness, capacity, price, byte, and timing evidence. **Request complete,
   provider gate not cleared:** the one authorized request returned a valid,
   complete zero-row page with a 500-row limit margin, zero filter violations,
   a 2-byte body, and 651 ms provider elapsed time. No retry occurred. The
   result proves request acceptance and zero current inventory under the frozen
   filters, but it cannot verify the provider city label, so production Irvine
   mapping remains disabled.
4. `27.1C` Add a separately guarded, wider Irvine provider-identity probe and,
   only with fresh explicit authorization, make one real request without retry.
   Record aggregate city distribution and sample evidence only; do not change
   product filters or treat a broad sample as product inventory completeness.
   **Complete; provider-geography gate cleared:** the probe
   sends only `city=Irvine`, `state=CA`, `status=Active`, `limit=500`, and
   `includeTotalCount=true`, omitting property type, price, bedroom, bathroom,
   address, radius, ZIP, and county filters. Its real form requires exact
   one-request, `irvine-ca`, and `active-market-identity` confirmations and has
   no retry path. A full 500-row page is reported as a saturated, bounded
   identity sample rather than complete inventory. Fourteen runner tests and
   ten command tests cover identity, state/status, count, sample saturation,
   aggregate-only output, strict arguments, no retry, missing key, and
   secret/URL redaction. All 99 audit regressions and all 118 repository test
   files / 1,152 tests pass, along with repository-wide typecheck and the
   production/AWS build. The safe preview loads no environment file and makes
   no request. After fresh authorization, exactly one real request completed
   without retry. RentCast reported 865 matching Active listings; the bounded
   sample returned the expected 500 rows, all 500 used provider city `Irvine`,
   and zero rows violated the California/Active scope. The saturated sample
   correctly reported that not all matching rows were returned. The response
   was 570,092 bytes in 1,338 ms. No production change occurred.
5. `27.2` With fresh explicit authorization, audit official Irvine boundary,
   CAL FIRE LRA/SRA metadata and intersections, City of Irvine designation
   evidence, geometry, severity, responsibility area, bounds, area, checksum,
   payload, and parse-cost projections. Publish no runtime artifact.
   **Complete:** current official services returned one qualifying incorporated
   Irvine jurisdiction and one valid current city boundary. The normalized
   boundary has SHA-256
   `368205802647ca6d9c476682edf8425a9ef781ffda7c4e171697a67920ec8b23`
   and is topologically equal to the cached `24_1` geometry. City Council
   Ordinance `25-19`, adopted 2025-06-24, establishes `locally-adopted` LRA
   evidence. Current service counts and pinned-archive hard clips agree on 12
   LRA features and 2 SRA features with zero invalid geometry, zero repair
   drift, and zero LRA/SRA overlap area. The projected 110-feature successor is
   1,374,114 raw / 354,030 gzip bytes; 200 Node `24.19.0` parses averaged 2.990
   ms with p95 3.438 ms. All candidates remain ignored and no runtime artifact
   or production system changed.
6. `27.3` Append Irvine to the schema-version-1 Domain/API/React allowlist while
   keeping existing and default profiles unchanged. Preserve the current city
   checkbox UX, validation, revisions, authentication, and accessibility.
   **Complete:** Irvine is appended as the seventh canonical market while the
   default remains the six pre-Irvine markets. Domain, Application, API, browser
   client, and React tests prove opt-in saving, canonical order, unchanged old
   profiles, revision behavior, authentication, and accessible checkbox use.
   The isolated 27.3 stage failed closed on an Irvine selection before any
   RentCast request; 27.4 replaces that temporary guard with the reviewed
   direct-city mapping. All 118 test files and 1,161 tests, repository-wide
   typecheck, and the production/AWS build pass.
7. `27.4` Map Irvine to one direct city area and prove 1-, 6-, and 7-market
   request counts, canonical order, per-area completeness, all-or-nothing
   behavior, overlap reconciliation, provider-data preservation, observation
   time, alerts, and zero partial Telegram effects.
   **Complete:** Irvine maps to one exact `city=Irvine&state=CA` provider area
   without ZIP, address, radius, or county fallback. Tests prove Irvine-only,
   six-incorporated-city, pre-Irvine six-market, and all-seven-market request
   plans in canonical order. A failed or incomplete seventh request returns no
   partial rows and causes no persistence, observation, revision advancement,
   alert, or Telegram side effect. All 118 test files and 1,169 tests,
   repository-wide typecheck, and the production/AWS build pass.
8. `27.5` Add the reviewed boundary snapshot, stage the seven-target artifact,
   and reconcile deterministic provenance, geometry, counts, severity, area,
   checksums, and raw/gzip limits while retaining the current public artifact.
   **Complete:** the 39,079-byte tracked Irvine boundary is pinned at SHA-256
   `368205802647ca6d9c476682edf8425a9ef781ffda7c4e171697a67920ec8b23`
   and resolves exactly one `CITY=Irvine` feature. Two offline, network-disabled
   builds produced byte-identical 110-feature `r3` candidates at 1,374,114 raw
   / 354,030 gzip bytes with artifact SHA-256
   `766a643e69b99c3d1e6442c94f2480a97c19a116fdb8b06c757045043fdf6427`
   and manifest SHA-256
   `f521440a4f632e9b14b931bf145fab9b257843086db63495be538794d4f536f3`.
   All output geometry is valid, normalization area drift is zero, and Irvine
   contributes the audited 4 Moderate / 4 High / 6 Very High features. The
   publication command fails closed until 27.6; committed public `r2` bytes and
   the React loader remain unchanged. All 118 test files / 1,170 tests,
   repository-wide typecheck, and the production/AWS build pass.
9. `27.6` Publish the versioned successor and integrate it into the shared
   ArcGIS 2D/3D loader, metadata, provenance, disclosures, viewport, and
   zero-listing behavior without changing classification or terrain semantics.
   **Complete:** the committed `r3` artifact and manifest exactly match the
   Block 27.5 staged checksums, while `r2` remains unchanged for rollback. The
   shared same-origin loader now serves all 110 features and seven typed targets
   to both ArcGIS modes. Metadata and control regressions expose Irvine's
   incorporated-city boundary and locally-adopted evidence; zero-listing tests
   preserve overlay loading and 2D/3D mode switching independently from
   markers. Existing styling, layer order, lazy load, Abort/retry/rollback,
   teardown, CSP, and terrain-context semantics are unchanged. All eight
   focused test files and 58 tests pass. All 118 repository test files and
   1,170 tests, repository-wide typecheck, and the production/AWS build also
   pass; browser acceptance remains 27.7.
10. `27.7` Complete focused and repository-wide tests, typecheck, production/AWS
   builds, and desktop/mobile 2D/3D visual, Console, Network, WebGL, responsive,
   interaction, and teardown acceptance for Irvine and all prior markets.
   **Complete:** all 118 test files and 1,170 tests, repository-wide typecheck,
   and the production/AWS build pass. Authorized `1440 x 900` desktop and
   `390 x 844` mobile acceptance verifies Irvine coverage without listings,
   prior-market listing markers, all seven provenance disclosures, 2D/3D
   Terrain, zoom, responsive framing with zero overflow, and two structural
   teardown cycles with no retained canvas or ArcGIS component. The saved six
   predecessor markets remain selected and Irvine remains unchecked. Two
   bounded ArcGIS basemap `AbortError` cancellation logs occurred while a
   still-loading map was replaced; no CSP, authorization, data, Terrain3D,
   WebGL, or application failure occurred.
11. `27.8` Complete final security, quota, artifact, CSP, compatibility,
    rollout, rollback, diff, and as-built release gates. Leave commit, push, PR,
    merge, production profile changes, schedules, and deployment under
    repository-owner control. **Complete:** the final 10-commit, 44-path branch
    diff is confined to the reviewed Irvine market, provider tooling, wildfire
    pipeline/assets, ArcGIS integration, tests, scripts, and documentation. No
    migration, environment file, lockfile, CI/CD, AWS, auth/session, database,
    Telegram, schedule, CSP, credential, or deployment boundary changed. Secret
    and whitespace scans pass. A fresh digest-pinned, network-disabled offline
    GDAL stage reproduced the public 110-feature `r3` artifact and manifest
    byte-for-byte while the `r2` and five-city rollback hashes remained
    unchanged. Focused release tests pass 293/293; all 118 repository test files
    and 1,170 tests plus repository-wide typecheck pass. An isolated production
    web build containing no `.env*` file passes with a synthetic ArcGIS key and
    contains no MapLibre/OpenFreeMap residue. Quota remains one request for
    Irvine or seven for all markets, Irvine remains opt-in, and rollback order
    remains remove saved Irvine selections before restoring the six-market
    runtime and retained `r2` asset. Commit, push, PR, merge, profile edits,
    schedule changes, and deployment remain under owner control.

Every executable sub-block requires a fresh explanation and explicit
confirmation. Real provider or official GIS access is never implied by a plan
or fixture test.

See the
[Block 27 Irvine Market And Wildfire Coverage Knowledge Base](knowledge-base/block-27-irvine-market-and-wildfire-coverage.md)
and
[ADR 0015: Irvine Market And Wildfire Coverage](adr/0015-irvine-market-and-wildfire-coverage.md).

### Block 28: Software Quality Platform And AWS Delivery Modernization

Modernize the repository's quality platform and AWS delivery path so the project
demonstrates both application engineering and Senior SDET/Test Automation
Architect judgment. The target architecture adds a focused Playwright browser
and black-box API layer, Allure and workflow artifacts, dependency-aware PR
gates, AWS DEV deployment, nightly DEV regression, flaky-test engineering, and
safe production smoke around the approved CloudFront/private-S3/App Runner/VPC
Connector public Web/API architecture.

Block 28 preserves the existing production worker/database safety model.
Production CloudFormation identities, retained resources, secrets, schedules,
data, and notification paths are not renamed or mutated for symmetry with DEV.
GitHub Actions continues to use OIDC and least privilege. DEV remains isolated
from production and schedules default to disabled. Public Web/API delivery
requires CDK synth, diff classification, WAF, response headers, origin
protection, rollback, health check, API smoke, and UI smoke review before any
real deployment.

Planned sub-block mapping:

1. `28.0` Record Software Quality Platform and AWS Delivery Modernization
   architecture, delivery stages, environment boundaries, observability goals,
   and safety constraints. **Complete in documentation only:** ADR 0016, the
   Block 28 knowledge base, and this roadmap entry define the staged quality
   architecture and delivery model. No dependency, workflow, runtime code, CDK
   resource, AWS deployment, database, schedule, provider request, OpenAI call,
   Telegram message, production notification, commit, push, or merge changed.
2. `28.1` Add the local Playwright foundation with deterministic browser smoke
   and Playwright `APIRequestContext` black-box API smoke against local servers
   and fakes. Do not require AWS, Aurora, production secrets, RentCast, OpenAI,
   Telegram, or a production migration. **Complete:** root Playwright config,
   API/UI smoke suites, a local HTTP stub, failure screenshots/traces, and
   `test:api`, `test:ui`, `test:e2e`, and `test:e2e:smoke` scripts are in
   place. API smoke runs through HTTP only and does not import Express internals;
   UI smoke uses Vite plus the local stub and stable accessible selectors. The
   framework starts bounded local servers through Playwright readiness checks
   and performs no AWS, database, provider, OpenAI, Telegram, schedule,
   production notification, or migration action.
3. `28.2` Add Allure and failure artifacts for Vitest and Playwright, including
   screenshots and traces on Playwright failure, with artifact privacy review.
   **Complete:** Vitest and Playwright both emit Allure result files into
   `allure-results`, `pnpm report:allure` generates `allure-report`, CI runs
   the local Playwright smoke suite, and CI uploads bounded quality diagnostics
   from Allure plus Playwright reports/traces. Generated report directories are
   ignored locally. This step creates no SNS topic, cloud resource, deployment,
   database mutation, provider call, production notification, or schedule.
4. `28.3` Add dependency-aware PR Quality Gate rules for `feature/* -> dev`
   PRs while retaining a conservative full fallback for shared package,
   workflow, infrastructure, lockfile, auth, API contract, and config changes.
   **Complete:** `.github/workflows/pr-quality-gate.yml` now runs on PRs
   targeting `dev`, computes an affected-suite plan, and reports one stable
   final job named `quality-gate`. The gate intentionally skips executable
   suites for documentation-only PRs, runs selected focused suites for scoped
   app/package changes, and falls back to full Vitest plus local Playwright
   smoke for broad-impact or unclassified changes. The classifier is covered by
   focused tests under `tools/quality-gate`. This step creates no branch,
   branch protection rule, AWS resource, deployment, database mutation,
   provider call, production notification, schedule, or migration.
5. `28.4` Define isolated AWS DEV CDK architecture and OIDC guardrails with
   contract tests, synth, and reviewed diff only. Do not deploy. **Complete:**
   CDK now selects either the existing production application stack or the new
   `ChaoranPropertyIntelligenceDev` stack through a validated `targetStage`
   context. Production remains the default. DEV receives its own VPC, Aurora,
   secrets, logs, failure topic, queues, and explicitly disabled schedules.
   The existing OIDC provider now has a separate
   `cpi-github-deploy-dev` role trusted only by the protected GitHub
   `development` environment and scoped to the exact regional CDK bootstrap
   roles. Contract tests, production and DEV synth, and local-template CDK diff
   review passed. The production diff contains only two replaceable ECS task
   definition revisions caused by excluding local quality artifacts from the
   Docker context; retained database, VPC, secrets, schedules, and production
   IAM identities are unchanged. No stack was deployed, no secret was read or
   changed, and no schedule, worker, migration, provider, OpenAI, Telegram, or
   notification action ran. An account-backed diff remains mandatory before a
   separately authorized first DEV deployment.
6. `28.5` Implement the DEV public Web/API runtime in CDK and stop at synth and
   diff review. **Complete without deployment:** separate DEV edge and public
   application stacks now define a CloudFront WAF in `us-east-1`, private
   versioned S3 with Origin Access Control, App Runner in `us-west-2`, an
   isolated-subnet VPC Connector, Aurora security-group ingress, response
   headers, SPA routing, disabled API caching, stage-specific API secrets, and
   CloudFront origin protection. API configuration accepts the existing Aurora
   credentials JSON secret and a CloudFront-overwritten exact viewer-origin
   marker. Contract tests and both synth modes pass. No AWS resource, secret,
   database, migration, schedule, worker, provider, notification, or production
   data was accessed or changed.
7. `28.6` Add protected DEV deployment from `dev` with health check, API smoke,
   UI smoke, rollback evidence, workflow artifacts, and bounded SNS failure
   email. **Complete in source without deployment:** a two-approval
   `development` workflow verifies the release, obtains an account-backed CDK
   diff, blocks DELETE, deploys only explicit DEV stacks with schedules
   disabled, publishes the verified web artifact, performs bounded readiness
   and read-only remote Playwright smoke, and retains Allure plus rollback
   evidence. The OIDC role has bounded direct delivery permissions and the DEV
   public stack owns a dedicated failure topic. The first real run remains
   separately authorized and its second approval must explicitly cover API
   startup migrations. No AWS action or notification was executed.
8. `28.7` Add nightly AWS DEV regression and flaky-test engineering controls:
   bounded retries, explicit quarantine metadata, owner, expiry, and
   remediation path. **Complete in source without remote execution:** a
   credential-free scheduled/manual workflow checks out protected `dev`, uses a
   repository-configured CloudFront URL, runs bounded health plus read-only
   Playwright regression, reports every retry, fails unexpected retry usage,
   validates a strict 30-day quarantine registry, and uploads linked Allure,
   Playwright, trace/screenshot, JSON, and flake evidence for 30 days. The
   registry is empty. No AWS credential, deployment, migration, schedule,
   worker, provider, Telegram, OpenAI, or SNS behavior ran. Binding the tested
   source SHA to a deployed artifact remains in 28.8.
9. `28.8` Complete `dev -> main` full regression against AWS DEV and
   controlled production deployment with safe production smoke only.
   **Complete in source without AWS execution:** DEV Web/API now expose matching
   immutable release manifests, and nightly plus the same-repository
   `dev -> main` gate require the exact candidate SHA before accepting remote
   regression. Production adds separate edge/public-application stacks while
   preserving the existing foundation and unprefixed production physical-name
   convention. A manual plan run classifies account-backed CREATE, UPDATE,
   REPLACE, and DELETE and emits a commit/diff approval digest; a separate
   deploy run must reproduce that digest and explicitly acknowledge API startup
   migration. Both schedules remain disabled and production smoke is remote,
   read-only, and unauthenticated. No AWS diff, deployment, migration, schedule,
   worker, provider, notification, secret, or production-data action ran.

Every executable sub-block requires a fresh explanation, expected files, test
plan, relevant tests, full typecheck, production build, changed-files summary,
architectural decisions, and remaining risks. Real AWS deployment, production
CDK deployment, production migration, scheduled worker execution, RentCast,
OpenAI, Telegram, or production notification behavior is never implied by a
plan or fixture test.

See the
[Block 28 Software Quality Platform And AWS Delivery Modernization Knowledge Base](knowledge-base/block-28-software-quality-platform-and-aws-delivery-modernization.md)
and
[ADR 0016: Software Quality Platform And AWS Delivery Modernization](adr/0016-software-quality-platform-and-aws-delivery-modernization.md).

### Block 29: AWS Public Launch And Operational Readiness

Turn the source-complete Block 28 public Web/API architecture into a controlled,
browser-accessible AWS launch. The supported initial entry point is the
CloudFormation `ApplicationUrl`, an HTTPS CloudFront hostname such as
`https://<generated-name>.cloudfront.net`; CloudFront does not provide this
application with a stable user-facing IP address.

Block 29 reuses the approved architecture and deployment workflows. It does not
rename production resources, merge DEV and production, enable worker schedules,
or introduce direct production deployment from a local machine. Every mutating
sub-block requires exact account confirmation, account-backed diff
classification, explicit authorization, immutable release evidence, safe
smoke, and rollback evidence.

Planned sub-block mapping:

1. `29.0` Prepare ADR 0017, the Block 29 knowledge base, this roadmap entry,
   and the staged launch operation runbook. **Complete in documentation only:**
   no AWS login, diff, bootstrap, deployment, migration, DNS change, secret
   access, database operation, worker, provider, Telegram, notification, or
   production action is authorized or executed.
2. `29.1` Perform a separately confirmed read-only AWS inventory for identity,
   account, regions, current stacks, CDK bootstrap, OIDC roles, schedules,
   budgets, and public-runtime absence/status. **Complete on 2026-08-28:** the
   [redacted preflight record](operations/block-29-1-read-only-launch-preflight.md)
   captures AWS and GitHub blockers; no mutation was performed.
3. `29.2` Bootstrap only missing regions, then review and deploy the bounded
   Guardrails/OIDC update through federated administrator access. Bootstrap and
   Guardrails are separate mutation approvals; production trust and retained
   identities must remain unchanged. **Complete on 2026-08-28:** `us-east-1`
   bootstrap and Guardrails were separately authorized; the
   [redacted execution record](operations/block-29-2-bootstrap-and-guardrails.md)
   confirms `CREATE 2 / UPDATE 1 / REPLACE 0 / DELETE 0`, preserved production
   trust, and a clean post-deploy diff.
4. `29.3` Configure protected GitHub DEV settings and perform the first manual
   `dev` plan/deploy with two approvals. The second approval covers only the
   reviewed DEV stacks and DEV API startup migration. Both schedules remain
   disabled. **Infrastructure and the first release were deployed on
   2026-08-28; focused smoke and deployment-evidence remediation is now
   deployed under exact DEV SHA `3a95c51c...`:** health, the public sign-in
   page, and exact Web/API identity pass. See the
   [deployment record](operations/block-29-3-first-dev-public-deployment.md).
5. `29.3a` Prepare the separately protected initial DEV administrator path.
   The DEV-only Fargate task has no schedule or endpoint, reads a unique
   temporary secret, does not run migrations, and requires digest-bound plan
   and create runs. **Complete on 2026-08-30:** the independently approved plan
   and create runs succeeded, temporary credentials were deleted, and the
   repository owner manually accepted authenticated DEV access. See the
   [preparation record](operations/block-29-3a-dev-admin-bootstrap-preparation.md)
   and [acceptance record](operations/block-29-4-dev-public-acceptance.md).
6. `29.4` Accept the generated DEV CloudFront HTTPS URL through exact Web/API
   identity, health, security-header, read-only API/UI smoke, and one manual
   nightly regression run. Configure `CPI_AWS_DEV_BASE_URL` only after success.
   **Complete on 2026-08-30:** exact Web/API identity matched `3a95c51c...`,
   remote smoke passed, and Nightly DEV Regression run `33340950741` passed
   with zero retries and no quarantine findings. See the
   [acceptance record](operations/block-29-4-dev-public-acceptance.md).
6a. `29.4a` Make DEV deployment dependency-aware without weakening release
   identity. Every `dev` push produces classification evidence; docs/test-only
   descendants skip AWS and approvals, while runtime, infrastructure,
   delivery, dependency, unknown, and manual cases retain the full path.
   Release and nightly gates accept a prior deployed ancestor only after
   proving zero intervening deployable files. See the
   [29.4a record](operations/block-29-4a-dependency-aware-dev-deployment.md).
7. `29.5` Promote the exact deployed candidate through the protected
   `dev -> main` release gate and require green main CI. Before production,
   bind the production deployment job to a protected `production` environment
   with required review and exact-main restriction, and test that contract.
   **Promotion complete:** PR `#16` merged exact DEV SHA `3a95c51c...` into
   main SHA `5b5e8b84...`. **29.5 source preparation complete:** the production
   job and preserved production role identity now use the exact protected
   `production` environment contract; GitHub configuration and the separately
   approved Guardrails trust update remain operational prerequisites. See the
   [29.5 preparation record](operations/block-29-5-production-environment-protection.md).
8. `29.6` Run the controlled production plan, review its approval digest, then
   obtain separate authorization for the digest-bound deployment and production
   API startup migration. Run safe, unauthenticated production smoke only.
   **Complete:** final Production deploy run `33552752664` reproduced the
   reviewed digest for exact `main` SHA `f40c3428...b3bb`, retained disabled
   schedules, passed safe smoke, and the owner accepted the authenticated map
   experience.
9. `29.7` Optionally add an owned custom domain through tested CDK, ACM, and
   DNS changes after generated-hostname launch. Do not create console drift.
   **Deferred by owner:** the generated CloudFront hostname is the supported
   Production address.
10. `29.8` Complete operational handoff with URLs, release identities, plan and
   deployment artifacts, schedule state, budget/SNS checks, rollback evidence,
   ownership, and remaining risks. **Complete on 2026-09-01:** the bounded
   evidence and accepted follow-ups are recorded in the
   [Block 29 completion record](operations/block-29-completion-record.md); no
   separate implementation phase was required.

**Block 29 is complete.** DEV and Production are publicly reachable through
their generated HTTPS hostnames, protected delivery and administrator paths are
operational, schedules remain disabled, and the repository owner completed
authenticated Production acceptance.

See the
[Block 29 AWS Public Launch And Operational Readiness Knowledge Base](knowledge-base/block-29-aws-public-launch-and-operational-readiness.md),
[Block 29 AWS Public Launch Runbook](runbooks/block-29-aws-public-launch.md),
and
[ADR 0017: AWS Public Launch And Operational Readiness](adr/0017-aws-public-launch-and-operational-readiness.md).
