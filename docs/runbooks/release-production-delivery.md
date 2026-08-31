# Release Candidate And Production Delivery Runbook

## Purpose And Authorization Boundary

This runbook covers Block 28.8 source readiness for the `dev -> main` release
gate and controlled public Web/API production delivery. It does not authorize a
real AWS diff, production deployment, API startup migration, secret read,
schedule enablement, worker execution, RentCast or OpenAI call, Telegram
message, SNS publication, or production smoke run.

The first real production plan and every deploy require a separate owner
decision in GitHub Actions. A deploy also requires explicit acknowledgement
that App Runner starts the existing API composition root and may apply bundled
PostgreSQL migrations before listening.

## Immutable Release Identity

Every deployed release has one bounded manifest:

```json
{
  "gitSha": "<40-character lowercase commit SHA>",
  "stage": "dev or production"
}
```

The deployment writes that identity through two independent delivery paths:

- CDK injects `CPI_RELEASE_SHA` and `CPI_DEPLOYMENT_STAGE` into App Runner;
  `GET /api/release` returns them without querying Aurora.
- the verified Vite build receives `/release.json` before S3 publication.

Remote Playwright acceptance fetches both resources through CloudFront and
requires both to equal the expected commit and stage. `/api/release` remains
behind the CloudFront origin-verification boundary; direct App Runner access is
not opened. Neither identity contains credentials, user data, listing data, or
secret values.

Local CDK synth uses forty zeroes when no `releaseSha` context is supplied.
That is a source-review placeholder, not a deployable attestation. Every real
DEV or production deployment passes its exact `GITHUB_SHA`, and remote
acceptance fails if a placeholder, divergent release, or undeployed
runtime-capable change is present.

After DEV acceptance, documentation/test-only descendants may reuse the prior
deployed DEV runtime. In that bounded case, the candidate SHA and deployed SHA
are intentionally distinct: the deployed SHA must be an ancestor, and the
shared deployment-impact classifier must find zero intervening runtime,
infrastructure, delivery, dependency, or unknown files. Production plan and
deployment remain exact-main operations.

## DEV-To-Main Release Gate

`.github/workflows/release-quality-gate.yml` runs for pull requests targeting
`main` and fails unless the source is the same repository's protected `dev`
branch. It checks out the exact pull-request head SHA rather than GitHub's
synthetic merge commit.

The gate has `contents: read` only. It does not request OIDC, assume an AWS
role, deploy, migrate, or enter a GitHub deployment environment. Repository
variable `CPI_AWS_DEV_BASE_URL` supplies the exact public HTTPS CloudFront
origin.

The release gate performs:

1. exact source-branch, repository, checkout, and HTTPS-origin validation
2. quarantine-policy validation
3. the complete deterministic Vitest regression
4. full typecheck and production build
5. bounded AWS DEV health readiness
6. all Playwright tests eligible for remote read-only execution
7. matching Web/API DEV release identity and Git ancestry verification
8. zero undeployed runtime-capable changes between deployed and candidate SHAs
9. retry and stale-quarantine enforcement
10. Allure, Playwright, trace/screenshot, JSON, and bounded flake artifacts

An AWS DEV deployment that is pending, failed, divergent, or behind any
runtime-capable `dev` change makes the release gate fail. A deployed ancestor
is accepted only when every intervening change is explicit documentation or
test evidence. Source regression still runs from the candidate SHA; remote
regression expects the actual deployed SHA.

## Production Stack Boundary

Production keeps its existing foundation identity:

- `ChaoranPropertyIntelligenceGuardrails`
- `ChaoranPropertyIntelligenceProduction`

Block 28.8 adds only these public-runtime stack identities:

- `ChaoranPropertyIntelligenceProductionEdge` in `us-east-1`
- `ChaoranPropertyIntelligenceProductionPublicApplication` in `us-west-2`

CloudFront WAF must remain in `us-east-1`; App Runner, private S3, the VPC
Connector, and Aurora remain in `us-west-2`. Production physical names preserve
the repository's established unprefixed convention (`cpi-web-*`, `cpi-api`,
and `cpi-deployment-failures`). They are not renamed to mirror DEV.

The production web bucket and API-auth secrets use `RETAIN`. Existing Aurora,
database secret, VPC, worker, scheduler, and OIDC logical IDs remain owned by
their existing stacks.

## Two-Run Production Approval

The `Deploy production` workflow has no push trigger and runs only from `main`.
It is bound to the protected GitHub `production` environment, which requires
review, prevents administrator bypass, and permits only `main`. Its existing
OIDC role `cpi-github-deploy` trusts only that exact environment subject; no
long-lived AWS credentials are stored.

### Run 1: plan

Select `operation=plan` and enter:

```text
confirmation=plan-production
```

The run verifies the source, builds the exact Web manifest, synthesizes all
production stacks, confirms the AWS account, and captures an account-backed
template-method CDK diff. It publishes explicit `CREATE`, `UPDATE`, `REPLACE`,
and `DELETE` sections. Any `DELETE` fails automatically.

Every `REPLACE` must be reviewed. Stateless ECS task-definition revisions may
be acceptable when schedules remain disabled. Replacement of Aurora, a
database secret, VPC, retained bucket, retained API-auth secret, OIDC role, or
another state-bearing identity blocks deployment.

The plan artifact includes a SHA-256 approval digest bound to:

- exact main commit
- normalized account-backed CDK diff
- production stage

Retain the 90-day plan artifact and copy only its approval digest into the
deploy input. Do not approve from a screenshot or a manually edited summary.

Block 28.8 offline comparison against its committed pre-change source found no
created or deleted resources in Guardrails or the existing production
foundation. It found one production OIDC policy update, two stateless ECS task
definition image revisions, and new foundation exports. The two new stacks
contain 5 edge resources and 25 public-application resources including CDK
cross-region support resources. These source-template counts are not deployed
state and do not replace the account-backed plan.

### Run 2: deploy

Select `operation=deploy` and enter all three values:

```text
confirmation=deploy-production
approved_plan_digest=<64-character digest from Run 1>
migration_confirmation=authorize-production-api-migration
```

The workflow reruns verification and the account-backed diff. A different
commit or changed AWS state produces a different digest and blocks deployment;
create a new plan instead of bypassing the mismatch.

Deployment names four explicit stacks, uses concurrency one, forces both
worker schedules disabled, publishes the verified Web build, waits for the
CloudFront invalidation and bounded API readiness, then runs safe production
smoke only.

## Safe Production Smoke

The remote smoke is limited to:

- CloudFront site and sign-in screen availability
- security and no-store headers
- database-independent `/api/health`
- exact `/api/release` and `/release.json` identity
- unauthenticated protected-route rejection

Remote mode skips login, logout, listing reads with a session, and every write.
The workflow does not create a production user or inspect production data. It
does not run workers, enable schedules, invoke providers, send Telegram, or
exercise authenticated mutation endpoints.

## Evidence And Rollback

Plan and deployment artifacts retain, as applicable:

- raw and classified CDK diff
- approval JSON and digest
- commit and Actions run URL
- static asset SHA-256 manifest
- CDK outputs
- prior and resulting App Runner image identifiers
- prior and resulting versioned S3 object metadata, capped at 1,000 entries
- Allure and Playwright diagnostics

Application rollback is manual: review a new plan restoring the previous
immutable App Runner image, restore prior S3 object versions, invalidate
CloudFront, and rerun safe smoke. Application rollback never reverses a schema
migration. Database recovery requires its own reviewed forward fix or recovery
procedure.

## Required Setup And First-Run Checklist

- the GitHub `production` environment requires review, prevents administrator
  bypass, and permits only `main`
- the `cpi-github-deploy` OIDC subject is exactly the immutable repository
  identity plus `environment:production`
- `CPI_AWS_DEV_BASE_URL` points to the DEV CloudFront HTTPS origin
- `AWS_ACCOUNT_ID`, `CPI_MONTHLY_BUDGET_USD`, and `CPI_ALERT_EMAIL` are set
- CDK is bootstrapped in `us-west-2` and `us-east-1`
- the Guardrails update granting bounded production public-delivery permissions
  is reviewed and deployed through an administrator-controlled bootstrap path;
  this is required before the first two-region production plan
- `dev` deployment has succeeded and exposes either the exact candidate or a
  proven non-runtime ancestor
- the `dev -> main` release gate is green for the candidate/deployed identity
  relationship
- production plan artifact is reviewed by all four action categories
- no unsafe stateful replacement or deletion is present
- API startup migrations are reviewed before entering migration confirmation
- both schedules remain disabled
- rollback evidence location and last-known-good release are known

No item in this runbook substitutes for explicit authorization to run the
production workflow.
