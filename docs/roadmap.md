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
Blocks 18.1-18.9, Blocks 19.0-19.5, and Blocks 20.0-20.7 are complete. The
repository currently contains:

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
   and new-listing predicates. Production behavior remains unchanged.
3. `21.2` Add migration 007, profile ports, a PostgreSQL adapter, an exact
   current-behavior seed, optimistic revision updates, canonical no-op saves,
   and migration/repository tests.
4. `21.3` Add application get/update use cases, administrator attribution,
   stale-revision handling, baseline orchestration contracts, and deterministic
   fakes.
5. `21.4` Add administrator-only `GET` and `PUT`
   `/api/listing-search-criteria` routes, strict bounded DTOs, Origin and
   session enforcement, error mappings, composition, and security tests.
6. `21.5` Add the authenticated React `Search Criteria` workspace with one
   property-type select, price inputs, bedroom/bathroom selects, a five-city
   checkbox disclosure, complete form states, accessibility, responsive
   layout, and component tests.
7. `21.6` Parameterize the RentCast request and production worker, load the
   persisted profile before acquisition, keep one regional request, and fail
   closed when total count exceeds the 500-row page cap.
8. `21.7` Implement atomic revision-aware silent baseline, preserve pending
   events, and add cross-layer tests for later new listings and tracked
   below-floor price drops.
9. `21.8` Run the full suite, typecheck, build, disposable `001-006 -> 007`
   migration integration, local authenticated browser acceptance, fake-data
   two-revision smoke, runbook updates, and a separately confirmed AWS
   read-only precheck.

Every executable sub-block requires a fresh explanation and explicit
confirmation. Block 21.0 does not change source code, connect to a database,
consume RentCast quota, send Telegram, deploy, change a schedule, or operate an
AWS resource.

See the
[Block 21 Configurable Listing Search Knowledge Base](knowledge-base/block-21-configurable-listing-search.md)
and
[ADR 0009: Persisted Listing Search Criteria](adr/0009-persisted-listing-search-criteria.md).
