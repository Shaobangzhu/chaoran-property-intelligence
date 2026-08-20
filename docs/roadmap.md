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

Blocks 0-14.1 and Blocks 15.0-15.2 are complete. The repository currently
contains:

- a TypeScript and pnpm workspace
- domain listing filters and normalization
- mocked RentCast and Telegram adapters
- the `CheckNewListings` application use case
- a safe in-memory dry-run CLI
- local integration verification
- PostgreSQL migrations and a production worker composition root
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
5. `15.4` Add MapLibre/OpenFreeMap rendering and list/map selection.
6. `15.5` Verify the local vertical slice and review the authenticated
   production deployment plan.

Each item remains separately gated. Block 16 starts only after the Block 16
entry criteria in ADR 0003 are satisfied.

Block 15.1 moved `NormalizedListing` into the domain package, added the stable
UUID identity migration, and established the tested application and PostgreSQL
listing query boundary. The migration has not been applied to the AWS database.

Block 15.2 added the Express 5 app factory, explicit listing DTO mapping, safe
JSON errors, loopback-only database composition, and an isolated worker/API
build structure. The API remains undeployed and unauthenticated.

## Planned Product Features

### Block 16: Single-User JWT Authentication

Add a normal user model and a single administrator login flow without public
registration. The feature remains extensible to multiple users but implements
only admin creation, login, logout, current-user lookup, and server-enforced
authorization.

Planned sub-block mapping:

1. `16.0` Inspect the API/web architecture and authentication threat surface.
2. `16.1` Add the user domain model and `UserRepository` port.
3. `16.2` Add Argon2id password hashing and the admin creation CLI.
4. `16.3` Add the token service and required JWT claims.
5. `16.4` Add login, logout, and current-user use cases.
6. `16.5` Add Express routes, cookie handling, and auth middleware.
7. `16.6` Add the React login and protected-write experience.
8. `16.7` Complete rate-limit, CSRF, authorization, and security tests.

Each numbered item is separately gated and must not be implemented as one large
change.

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

### Block 18: OpenAI Showing List Drafts

Generate structured Showing List drafts from authoritative listing data. Every
result is editable and requires agent review; the system does not automatically
send drafts, schedule showings, alter listing facts, or claim route, school,
wildfire, MLS, legal, or valuation conclusions.

Planned sub-block mapping:

1. `18.1` Define bounded input and structured output schemas.
2. `18.2` Add a `ShowingListGenerator` port and fake.
3. `18.3` Add the use case with authoritative database reload.
4. `18.4` Add the fixed, versioned prompt and guardrails.
5. `18.5` Add the OpenAI Responses API adapter with Structured Outputs.
6. `18.6` Persist generation snapshots and draft lifecycle state.
7. `18.7` Add the review, edit, reorder, and copy UI.
8. `18.8` Complete mocked adapter, validation, failure, and Fair Housing tests.

Block 18 depends on authentication, database-backed listing reads, and the
selection/review UI established by Blocks 15-17.

See [Blocks 16-18 Feature Knowledge Base](knowledge-base/blocks-16-18.md) for
the detailed product, architecture, security, and testing constraints.
