# Block 28: Software Quality Platform And AWS Delivery Modernization

## Purpose

Block 28 turns the project into a clearer Software Quality Engineering
portfolio artifact while preserving its production safety boundaries. The block
adds release-confidence layers around the existing TypeScript/AWS application:
browser E2E, black-box API automation, quality observability, dependency-aware
CI, AWS DEV delivery, nightly regression, and safe production smoke.

## Block 28.0 Outcome

Block 28.0 is documentation only. It records the staged approach and the
controls that later executable sub-blocks must obey. It creates no cloud
resource, installs no dependency, changes no workflow, runs no deployment,
mutates no database, calls no external provider, and sends no notification.

## Repository Reality At Start

- `pnpm` TypeScript monorepo with React/Vite, Express, worker/admin apps, and
  shared packages.
- Root CI currently runs install, typecheck, Vitest, and production build.
- Production deployment workflow is manual-only from `main`, uses GitHub OIDC,
  and forces worker schedules disabled.
- Production worker/database infrastructure exists; public Web/API deployment
  does not.
- The approved Web/API target is CloudFront, private S3, App Runner, App Runner
  VPC Connector to private Aurora, WAF, response headers, and origin
  verification.
- At the start of Block 28.0 the repository had no Playwright or Allure
  dependency; Blocks 28.1 and 28.2 add them incrementally.
- There are 118 tracked Vitest test files at the start of Block 28.0.

## Target Quality Architecture

Fast local confidence remains centered on Vitest and React Testing Library.
Playwright is added for a small number of browser-critical user journeys and
black-box API checks. Allure and workflow artifacts are added for diagnosis and
quality storytelling, not as a substitute for deterministic tests.

The intended layers are:

```text
Domain/package tests
  Vitest

Component/workflow tests
  React Testing Library

HTTP contract tests
  Playwright APIRequestContext

Browser critical journeys
  Playwright

Quality observability
  Allure, screenshots, traces, workflow artifacts, failure notifications
```

## Target Delivery Flow

```text
feature/* -> dev PR
  dependency-aware PR quality gate

merge -> dev
  AWS DEV deployment
  health check
  API smoke
  UI smoke

dev -> main PR
  full regression against AWS DEV

main
  controlled production deployment
  safe production smoke only
```

## Dependency-Aware Gate Rules

The gate should begin conservative and become more precise only after repeated
evidence. Initial ownership rules should treat these paths as broad-impact:

- `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`
- `.github/workflows/**`
- `infra/aws/**`
- `Dockerfile`
- `tsconfig*.json`, `vitest.config.mjs`, Playwright config
- `packages/domain/**`
- `packages/application/**`
- shared API DTOs, auth, session, security, and configuration modules

Changes under `apps/web/**` can run web-focused tests plus shared dependency
gates. Changes under `apps/api/**` can run API-focused tests plus shared
dependency gates. Changes under worker, provider, Telegram, OpenAI, S3, PDF,
PostgreSQL, and infrastructure paths must select their focused suites and fall
back to the root gate when ownership is ambiguous.

## Automation Constraints

- No arbitrary sleeps. Use health checks, process readiness, bounded polling,
  and explicit timeouts.
- No fragile UI selectors. Prefer roles, names, labels, and stable test IDs for
  non-semantic controls.
- No production data mutation unless separately authorized.
- No real RentCast, OpenAI, Telegram, production migration, scheduled worker,
  or production notification behavior unless separately authorized.
- No production CDK deployment without explicit authorization.
- Always inspect and classify CDK diff actions before any AWS deployment:
  `CREATE`, `UPDATE`, `REPLACE`, and `DELETE`.
- DEV schedules default to disabled.
- GitHub Actions uses OIDC and least privilege, not long-lived AWS keys.

## Suggested Sub-Blocks

### 28.1 Local Playwright Foundation

Add Playwright with a deterministic local web smoke and API smoke. Use local
servers, fakes, and bounded readiness checks. Do not require AWS, PostgreSQL
Aurora, RentCast, OpenAI, Telegram, or production secrets.

Implementation status: complete. The root Playwright config starts a dedicated
local HTTP stub and, for UI runs, builds workspace packages before starting the
Vite development server. API smoke uses
Playwright `APIRequestContext` over HTTP only and does not import `createApp()`,
application use cases, repositories, domain services, or database adapters. UI
smoke covers sign-in, protected Listings rendering, and sign-out through stable
roles, labels, and names. Playwright retains traces and captures screenshots on
failure. The new scripts are `pnpm test:api`, `pnpm test:ui`,
`pnpm test:e2e`, `pnpm test:e2e:smoke`, and
`pnpm test:e2e:install-browsers`. Local UI smoke requires the Playwright
Chromium binary. The smoke tests abort non-loopback browser requests so this
foundation does not depend on external ArcGIS availability or consume provider
services.

CI hardening note: GitHub runners start from a clean checkout, so the Vite dev
server cannot rely on locally existing `packages/*/dist` artifacts. The
Playwright UI web-server command builds workspace packages before Vite starts
so `workspace:*` imports such as `@chaoran-property-intelligence/domain` resolve
deterministically in both local and CI environments.

### 28.2 Quality Observability

Add Allure and failure artifacts for Vitest and Playwright. Preserve readable
terminal output and upload reports as workflow artifacts. Review artifact
contents for credentials, cookies, tokens, and sensitive customer/listing
content.

Implementation status: complete. Vitest is configured with
`allure-vitest/reporter`; Playwright is configured with `allure-playwright`,
HTML reporting, traces retained on failure, and screenshots on failure. Both
runners write Allure result files to `allure-results`, and
`pnpm report:allure` generates the static report under `allure-report`.
The root CI workflow now installs the Playwright Chromium browser, runs the
local `@smoke` Playwright suite, generates the Allure report when result files
exist, and uploads bounded quality diagnostics from `allure-results`,
`allure-report`, `playwright-report`, and `test-results/playwright`.
The workflow also writes an Allure-derived Markdown summary to the GitHub
Actions run page with total, passed, failed, broken, skipped, unknown, retry,
duration, and quality artifact link fields.
Generated report directories are ignored by Git. Local test scripts clean
`allure-results` and `allure-report` before each run so stale results do not
accumulate; CI uses `CPI_APPEND_ALLURE_RESULTS=true` only for the later
Playwright smoke step so Vitest and Playwright evidence stay together in one
workflow report. No SNS topic, AWS resource, deployment, database mutation,
provider call, production notification, schedule, or migration is part of this
sub-block.

### 28.3 Dependency-Aware PR Gate

Split CI jobs by affected path while retaining a conservative full gate. Pin
actions consistently, preserve typecheck/build coverage, and ensure lockfile or
shared-package changes run broad verification.

Implementation status: complete. The new
`.github/workflows/pr-quality-gate.yml` workflow runs on pull requests targeting
`dev` and publishes one stable final status named `quality-gate`. A dedicated
classifier in `tools/quality-gate/qualityGatePlan.mjs` maps changed files to
frontend, backend, integration, infrastructure, local system-smoke, and
typecheck/build verification. Documentation-only PRs become intentional
successes without installing dependencies or running executable suites. Shared
domain, workflow, dependency, compiler, Playwright, Vitest, lockfile, and
unclassified changes fall back to the broad gate.

The quality gate writes a Markdown plan to the GitHub Actions summary, uploads
that plan as an artifact, and reuses the Block 28.2 Allure summary and
diagnostic artifact flow for non-documentation PRs. Local scripts remain
overwrite-by-default for `allure-results` and `allure-report`; the workflow sets
`CPI_APPEND_ALLURE_RESULTS=true` inside the selected-suite step so multiple
suites can contribute to one Allure report. The focused classifier tests are
available through `pnpm test:quality-gate`.

This step does not create the `dev` branch, configure branch protection, deploy
to AWS, inspect or mutate production data, run migrations, call RentCast,
OpenAI, or Telegram, enable schedules, or send production notifications.

### 28.4 AWS DEV Design And Diff

Add tested CDK definitions for isolated DEV infrastructure. Stop at `synth` and
diff review. Confirm resource names, secrets, schedules, IAM boundaries, and
retention behavior before any real AWS mutation.

Implementation status: complete without deployment. `targetStage` accepts only
`production` or `dev` and defaults to `production`, so the existing production
workflow retains its current stack selection. DEV synthesis is explicit through
`pnpm --dir infra/aws synth:dev` and creates
`ChaoranPropertyIntelligenceGuardrails` plus the separate
`ChaoranPropertyIntelligenceDev` application stack.

The shared application construct preserves existing production construct IDs
and physical names while deriving DEV-only names for `cpi/dev/database`,
`cpi/dev/application`, `/cpi/dev/*` logs, the `cpi-dev-worker-failures` topic,
and both `cpi-dev-*` schedules. Both DEV schedules are hard-disabled by the app
assembly. DEV Aurora has one-day backup retention, no deletion protection, and
`Delete` removal policies; production Aurora and its credentials secret remain
retained and deletion-protected.

CDK asset output is excluded from Vitest discovery so synthesized copies of the
repository cannot inflate the suite by rerunning tracked tests from
`infra/aws/cdk.out`. Local Allure, Playwright report, and test-result directories
are also excluded from the Docker build context, making image asset hashes
stable across quality runs.

The existing GitHub OIDC provider and `cpi-github-deploy` main-branch role are
unchanged. Guardrails adds `cpi-github-deploy-dev`, whose OIDC subject is exactly
the protected GitHub `development` environment. Its inline policy names only
the regional CDK deploy, file-publishing, image-publishing, and lookup roles plus
the bootstrap version parameter. GitHub environment branch restrictions must
allow only `dev` before that role is used.

Production and DEV synth completed. Local-template `cdk diff` classified the
Guardrails change as two IAM resource creates and the DEV stack as 55 resource
creates. The production template retains its critical logical and physical
identities; its only diff is replacement of two immutable ECS task definition
revisions because local Allure and Playwright output directories are now
excluded from the Docker asset context. There are no production database, VPC,
secret, schedule, log, topic, or OIDC identity changes. No delete was found.

The configured AWS SSO session was expired, so an account-backed diff did not
read deployed stack state. It remains a hard pre-deployment gate and must be
repeated with a valid federated session before any separately authorized DEV
deployment. No AWS mutation, secret access, database action, schedule execution,
worker run, migration, RentCast request, OpenAI call, Telegram message, or
notification occurred. See the
[AWS DEV Foundation Runbook](../runbooks/aws-dev-foundation.md).

### 28.5 DEV Deployment And Smoke

Add a protected DEV deployment workflow using OIDC, health checks, API smoke,
UI smoke, rollback evidence, and bounded failure notifications.

### 28.6 Nightly DEV Regression And Flake Engineering

Schedule nightly regression against AWS DEV with artifact retention and explicit
flaky-test policy. Retries must be bounded and reported; quarantine requires an
owner, reason, expiry, and remediation path.

### 28.7 Public Web/API AWS Delivery

Implement CloudFront, private S3, App Runner, VPC Connector, WAF,
response-header, origin-protection, rollback, and smoke-test controls in
reviewable CDK slices. Preserve retained production resources and do not deploy
production without explicit authorization.

### 28.8 Mainline Production Safety Gate

Complete dev-to-main regression against AWS DEV and production-safe smoke on
manual production deployment. Production smoke remains read-only and
non-sensitive by default.

## Completion Evidence Template

Each executable sub-block should finish with:

```text
Relevant focused tests:
Full test suite:
Typecheck:
Production build:
CDK synth/diff if infrastructure changed:
Changed files:
Architectural decisions:
Remaining risks:
Follow-up sub-block:
```

## Related Records

- [ADR 0016: Software Quality Platform And AWS Delivery Modernization](../adr/0016-software-quality-platform-and-aws-delivery-modernization.md)
- [AWS System Design and Configuration](../aws-system-design.md)
- [AWS Deployment Runbook](../runbooks/aws-deployment.md)
- [AWS DEV Foundation Runbook](../runbooks/aws-dev-foundation.md)
- [ADR 0003: API, Web, and Map Foundation](../adr/0003-api-web-map-foundation.md)
- [ADR 0004: Single-User Authentication](../adr/0004-single-user-authentication.md)
