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

## Change-Classified Main Release Gate

`.github/workflows/release-quality-gate.yml` runs for pull requests targeting
`main`. A trusted base-revision classifier selects application, platform, and
documentation/tests-only concerns; unknown paths fail closed. Application work
still requires the same repository's protected `dev` branch and checks out the
exact pull-request head SHA rather than GitHub's synthetic merge commit.

The application lane has `contents: read` only. Repository variable
`CPI_AWS_DEV_BASE_URL` supplies the public HTTPS CloudFront origin. That lane
performs exact source/repository/checkout validation, quarantine validation,
bounded readiness, full remote-safe Playwright regression, matching Web/API
identity and Git ancestry, undeployed-impact rejection, retry enforcement, and
bounded diagnostics. A pending, failed, divergent, or stale runtime-capable DEV
release makes the application lane fail.

Platform work uses an isolated candidate Guardrails synthesis without AWS
credentials. A second job checks out trusted base planning tools, enters the
protected `production` environment, obtains temporary OIDC credentials, and
runs an account-backed `cdk diff --method template`. It rejects deletions,
publishes a digest-bound plan, and never deploys. Documentation/tests-only work
uses a no-permission no-deployment lane without checkout, dependencies, DEV,
AWS, or remote regression. Mixed work requires both deployable lanes.

Every conditional result feeds an `if: always()` aggregator. The aggregator
retains the required context name below and fails if selected work is not
successful or unselected work is not skipped. The first rollout uses a
conservative application-plus-platform fallback only while the trusted base
classifier is absent; it never runs the candidate classifier.

The required GitHub checks are `PR Quality Gate / quality-gate` for protected
feature-to-DEV pull requests and
`Release Promotion Gate / Promote exact AWS DEV release` for every pull request
to `main`. Application and mixed candidates still require the `dev -> main`
route; platform-only and documentation/tests-only candidates follow the route
defined by ADR 0020.
Merging to `main` does not run the removed legacy `CI / verify` workflow and
does not automatically deploy Production.

Branch routing, the one-time bootstrap, classifier evolution, and recovery are
defined in the
[change-classified promotion runbook](change-classified-release-promotion.md).

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

Configure `CPI_PRODUCTION_ARCGIS_API_KEY` as a secret in the protected
`production` GitHub environment. Use a production-specific ArcGIS browser key
restricted to the production CloudFront origin. The workflow maps it to
`VITE_ARCGIS_API_KEY` only for the immutable Web build and fails before planning
or deployment unless the resulting JavaScript bundle contains that configured
value. The key is necessarily public in the browser bundle, so ArcGIS referrer
and product-scope restrictions remain the authorization boundary.

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
  relationship when application evidence is required
- any required Guardrails promotion plan is approved, deletion-free, and green
- the stable release aggregator is green for the selected change concerns
- production plan artifact is reviewed by all four action categories
- no unsafe stateful replacement or deletion is present
- API startup migrations are reviewed before entering migration confirmation
- both schedules remain disabled
- rollback evidence location and last-known-good release are known

No item in this runbook substitutes for explicit authorization to run the
production workflow.
