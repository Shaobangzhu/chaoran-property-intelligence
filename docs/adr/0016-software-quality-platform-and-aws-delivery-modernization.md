# ADR 0016: Software Quality Platform And AWS Delivery Modernization

## Status

Accepted for staged implementation by Block 28.0.

Block 28.0 records the quality architecture, delivery model, environment
boundaries, and rollout sequence only. It does not install dependencies, modify
GitHub workflows, create AWS DEV resources, deploy production, run migrations,
execute worker schedules, call RentCast, call OpenAI, send Telegram messages, or
change CloudFormation resources.

## Context

The repository is now a TypeScript and pnpm monorepo with React/Vite,
Express, PostgreSQL/Aurora, AWS CDK, ArcGIS, and a large Vitest/React Testing
Library suite. The existing CI workflow installs dependencies, typechecks, runs
Vitest, and builds. The production deployment workflow is manual-only, runs
tests/typecheck/build first, uses GitHub OIDC, and forces both worker schedules
disabled.

The approved public application target remains CloudFront, private S3 for the
React build, `/api/*` routing to App Runner, and private Aurora access through
an App Runner VPC Connector. Block 28.5 implements that boundary in tested CDK;
it remains undeployed.

Block 28.6 implements the protected DEV workflow in source with separate plan
and deploy environment approvals, account-backed diff classification, bounded
readiness, read-only remote smoke, rollback evidence, and a dedicated failure
topic. The workflow has not been run against AWS; first deployment and DEV
migration authorization remain external gates.

Block 28.7 adds a credential-free nightly regression consumer and explicit
flake policy in source. It checks out protected `dev`, targets a repository-
configured public DEV origin, permits at most one reported retry, and fails
unexpected, expired, malformed, duplicate, or stale quarantine evidence. It has
not executed a remote run. Release identity binding remains a Block 28.8 gate.

Block 28 must demonstrate Senior SDET and test automation architecture skills
without weakening the existing production safety model. Quality automation
should improve deterministic release confidence rather than maximize test
count.

## Decision

Implement Block 28 as small, separately reviewed sub-blocks. The first
executable work should establish local and CI quality gates before any AWS DEV
or public Web/API infrastructure change.

The target quality layers are:

- Vitest unit, component, and integration tests remain the fast default gate.
- React Testing Library remains the primary component and workflow harness for
  browser-owned state.
- Playwright UI tests cover a deliberately small set of browser-critical
  journeys with role, label, text, and test-id selectors selected for stable
  user intent.
- Playwright `APIRequestContext` tests cover black-box HTTP contract smoke and
  regression checks without importing Express internals.
- Allure, Playwright traces, screenshots, videos when valuable, and GitHub
  workflow artifacts provide quality observability.
- Flaky-test work is engineering work: quarantine requires owner, reason,
  evidence, expiry, and a tracked remediation path.

The target delivery model is:

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

Production deployment remains manual and explicitly confirmed. A production
smoke suite must use only safe, read-only, non-sensitive checks unless a later
runbook grants narrower explicit authorization. It must not run the scheduled
workers, mutate production data, execute production migrations, call RentCast,
call OpenAI, send Telegram messages, or inspect secret values.

AWS DEV must be isolated from production through names, secrets, database,
schedules, IAM permissions, and GitHub environment approvals. DEV schedules
default to disabled. DEV infrastructure may reuse architecture patterns, but it
must not rename or replace retained production physical resources merely for
symmetry.

GitHub Actions continues to use OIDC rather than long-lived AWS credentials.
Each workflow receives the smallest permission set required for its stage.
Dependency-aware quality gates may skip unaffected expensive suites, but shared
package, API contract, infrastructure, workflow, lockfile, and configuration
changes must conservatively broaden the gate.

## Sub-Block Sequence

1. `28.0` Record this ADR, roadmap entry, quality boundaries, and staged
   delivery model.
2. `28.1` Add the local Playwright foundation with a small deterministic
   browser smoke suite and black-box API smoke suite against local test
   servers and fakes.
3. `28.2` Add Allure and failure artifacts for Vitest and Playwright without
   making reporting a hidden dependency of test correctness.
4. `28.3` Split GitHub PR gates by dependency impact while preserving a
   conservative full fallback for shared, workflow, infrastructure, and
   lockfile changes.
5. `28.4` Define AWS DEV infrastructure and OIDC guardrails in CDK with tests,
   `cdk synth`, and reviewed `cdk diff` only; no real deployment in this
   sub-block.
6. `28.5` Implement the CloudFront, private S3, App Runner, VPC Connector, WAF,
   response-header, origin-protection, and rollback primitives in tested CDK.
   Stop at synth and diff review.
7. `28.6` Add the protected DEV deployment workflow with environment
   protection, health check, API smoke, UI smoke, and failure notifications.
8. `28.7` Add nightly DEV regression with artifacts, flake tracking, and a
   deterministic retry policy.
9. `28.8` Complete the dev-to-main regression gate and production-safe smoke
   workflow without broadening production mutation authority.

Every executable sub-block requires a fresh explanation, expected files, test
plan, risk review, and completion evidence.

## Quality Gate Policy

The default local completion gate for code changes remains:

```text
pnpm test
pnpm typecheck
pnpm build
```

Playwright and Allure additions must integrate with that gate incrementally.
If a suite requires a browser server, database, AWS DEV endpoint, or generated
artifact, the workflow must create, await, verify, and tear it down explicitly.
Do not use arbitrary sleeps. Prefer health probes, server-ready checks, and
bounded polling with actionable timeout messages.

UI automation selectors must express user intent. Use accessible roles, names,
labels, stable route contracts, and explicit test IDs only where semantic
selectors are not available. Do not couple tests to generated ArcGIS internals,
random DOM structure, or visual-only implementation details.

Black-box API automation verifies externally observable HTTP behavior: status
codes, safe error bodies, authentication boundaries, headers, caching,
idempotency, and route contracts. It must not import application internals.

## AWS Delivery Boundaries

Before any real AWS DEV deployment, review the synthesized template and CDK
diff and classify changes as `CREATE`, `UPDATE`, `REPLACE`, and `DELETE`.

Before any production deployment, perform a separate production diff review and
retain the existing manual confirmation boundary. Production physical and
logical identities that protect retained data must not be renamed or replaced
for style, symmetry, or convenience.

DEV and production secrets are distinct. No workflow may print secret values or
copy production secret contents into DEV. Any future failure notification should
send bounded operational metadata only.

## Observability

Quality observability should make failures diagnosable without exposing
credentials or sensitive listing/customer content:

- Vitest and Playwright reports are uploaded as workflow artifacts.
- Playwright failures retain screenshots and traces; video is optional and
  should be evaluated for value, size, and sensitivity.
- Allure history may be retained for trend analysis when artifact retention and
  privacy are acceptable.
- SNS email notifications report workflow/stage failure, run URL, environment,
  and bounded summary only.

## Rejected Alternatives

### Deploy AWS DEV before test-platform work

Rejected because the repository does not yet have browser/API black-box smoke,
failure artifacts, or dependency-aware CI gates. Adding cloud first would
increase operational surface before the quality harness can evaluate it.

### Run full browser regression on every PR unconditionally

Rejected because expensive tests should be used where they improve confidence.
A dependency-aware gate plus conservative full fallback gives better signal and
keeps feedback fast.

### Treat production smoke as regression

Rejected because production smoke must be safe. Full regression belongs to
local fakes and AWS DEV unless a future runbook explicitly authorizes a narrow
production action.

### Rework production resources for naming symmetry

Rejected because retained production resources and CloudFormation identities
carry replacement risk. DEV naming can be clean without renaming production.

## Consequences

Positive consequences:

- the project can demonstrate SDET architecture across unit, component,
  black-box API, browser E2E, CI, observability, cloud delivery, and flake
  management
- future AWS delivery work receives quality gates before public exposure
- production remains protected by existing OIDC, manual confirmation, and
  explicit authorization boundaries
- DEV can become a realistic regression target without sharing data or secrets
  with production

Tradeoffs:

- Playwright, Allure, and cloud gates add dependency and runtime cost
- dependency-aware gates require careful path ownership rules and conservative
  fallbacks
- DEV infrastructure adds AWS cost and operational maintenance
- Allure and traces require retention and privacy review before long-lived
  publication

## Related Records

- [Block 28 Software Quality Platform And AWS Delivery Modernization](../knowledge-base/block-28-software-quality-platform-and-aws-delivery-modernization.md)
- [ADR 0002: AWS Deployment Foundation](0002-aws-deployment-foundation.md)
- [ADR 0003: API, Web, and Map Foundation](0003-api-web-map-foundation.md)
- [ADR 0004: Single-User Authentication](0004-single-user-authentication.md)
- [AWS Deployment Runbook](../runbooks/aws-deployment.md)
- [AWS DEV Deployment Runbook](../runbooks/aws-dev-deployment.md)
- [Nightly AWS DEV Regression Runbook](../runbooks/nightly-dev-regression.md)
- [AWS System Design and Configuration](../aws-system-design.md)
