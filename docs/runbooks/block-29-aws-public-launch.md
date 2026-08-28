# Block 29 AWS Public Launch Runbook

## Purpose And Authorization Boundary

This runbook sequences the first real public AWS launch. Reading this runbook,
committing it, or completing a local gate does not authorize an AWS mutation.
Every section marked `MUTATING` requires the repository owner's explicit
authorization immediately before execution.

Never run a production CDK deploy, API migration, worker, schedule, RentCast
request, OpenAI call, Telegram operation, production notification, or database
inspection unless its own runbook and explicit authorization permit it.

## Expected Browser Address

Use the CloudFormation `ApplicationUrl` output:

```text
https://<generated-name>.cloudfront.net
```

Do not use a resolved CloudFront IP address. CloudFront identifies the
distribution from the HTTP `Host` header, and HTTPS certificate validation is
hostname-based. A custom hostname is outside the initial launch and requires a
reviewed CDK extension.

## Phase Status

| Phase | Operation | Current state | Authorization |
| --- | --- | --- | --- |
| 29.0 | Documentation and local verification | Prepared | None for AWS |
| 29.1 | Read-only account inventory | Complete; blockers recorded | Read-only authorization completed |
| 29.2a | Missing-region CDK bootstrap | Complete in `us-east-1` | Explicit authorization completed |
| 29.2b | Guardrails/OIDC update | Complete; post-deploy diff clean | Separate authorization completed |
| 29.3 | First DEV plan/deploy/migration | Pending | Two GitHub environment approvals |
| 29.4 | DEV acceptance | Pending | Read-only remote testing |
| 29.5 | `dev -> main` promotion | Pending | Protected PR review |
| 29.6a | Production plan | Pending | Explicit plan authorization |
| 29.6b | Production deploy/migration | Pending | Separate production authorization |
| 29.7 | Optional custom domain | Deferred | Separate design and deployment approval |
| 29.8 | Operational handoff | Pending | Evidence review |

## Stop Conditions

Stop immediately when any condition applies:

- AWS identity is root, account is unexpected, or region is ambiguous
- the working tree or release SHA differs from the reviewed candidate
- either worker schedule is enabled
- an account-backed diff is missing or cannot be classified
- any `DELETE` is present
- `REPLACE` affects Aurora, VPC, database secret, retained S3, API-auth secret,
  OIDC provider/role, or another state-bearing resource
- production identities are renamed for DEV symmetry
- the `development` environment has no branch restriction or required review
- the production deploy job is not bound to a protected `production`
  environment before the first production run
- migration impact is not separately understood and authorized
- Web/API release identities differ from each other or the expected SHA
- smoke attempts to authenticate, mutate data, run a worker, or call a provider
- rollback evidence or last-known-good identity is unavailable

## 29.0 Local Source Gate

This phase is local and credential-free:

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build
pnpm aws:synth
pnpm --dir infra/aws synth:dev
git diff --check
```

Confirm the exact commit intended for DEV and verify that no `.env*`, secret,
Allure output, Playwright trace, screenshot, or generated CDK assembly is staged.

## 29.1 Read-Only AWS Inventory

Authorization scope: authenticate and read metadata only. Do not bootstrap,
deploy, update a secret, create a change set, publish SNS, or start a task.

```bash
aws sso login --profile cpi-admin
aws sts get-caller-identity --profile cpi-admin
aws configure get region --profile cpi-admin
aws cloudformation describe-stacks \
  --profile cpi-admin \
  --region us-west-2
aws cloudformation describe-stacks \
  --profile cpi-admin \
  --region us-east-1
```

Record without committing the full account ID:

- assumed-role ARN type and expected account confirmation
- `CDKToolkit` status in `us-west-2` and `us-east-1`
- Guardrails and production foundation stack status
- whether the three DEV stacks and two production public stacks already exist
- exact production and DEV OIDC role trust subjects when present
- both production and DEV worker schedule states
- current monthly budget state and confirmed notification subscribers

Repository/GitHub preflight:

- `dev` and `main` protection rules are active
- `development` permits only `dev` and has required reviewers
- a protected `production` environment is designed for the production job;
  current source must be updated and tested if the job does not declare it
- `AWS_ACCOUNT_ID` and `CPI_MONTHLY_BUDGET_USD` are configured
- `CPI_ALERT_EMAIL` is stage-appropriate; use environment-scoped values when
  DEV and production recipients differ
- no AWS access-key secret exists in GitHub

Produce a redacted inventory summary and stop for review.

Status: complete on 2026-08-28. See the
[redacted Block 29.1 preflight record](../operations/block-29-1-read-only-launch-preflight.md).
The record proves that `us-east-1` bootstrap, DEV OIDC, branch protection, and
environment protections remain prerequisites. It does not authorize Block
29.2 mutations.

## 29.2a CDK Bootstrap

`MUTATING`: execute only for a region proven missing in 29.1 and only after
explicit authorization. CDK bootstrap creates or updates `CDKToolkit`, asset
storage, ECR, and deployment roles.

Use the confirmed account value without placing it in committed evidence. Match
the parameters of the existing bootstrap and target only the region proven
missing:

```bash
AWS_PROFILE=cpi-admin pnpm --dir infra/aws exec cdk bootstrap \
  "aws://<confirmed-account-id>/<missing-region>" \
  --toolkit-stack-name CDKToolkit \
  --qualifier hnb659fds \
  --bootstrap-kms-key-id AWS_MANAGED_KEY \
  --cloudformation-execution-policies \
    arn:aws:iam::aws:policy/AdministratorAccess \
  --public-access-block-configuration \
  --deny-external-id \
  --no-termination-protection \
  --yes
```

If one region is already correctly bootstrapped, target only the missing region.
Afterward, read back both `CDKToolkit` stacks and require a complete status.

Status: complete on 2026-08-28. Only `us-east-1` was bootstrapped. Both regions
are now at bootstrap version 32 and `CREATE_COMPLETE`. See the
[Block 29.2 execution record](../operations/block-29-2-bootstrap-and-guardrails.md).

## 29.2b Guardrails And GitHub OIDC

First obtain an account-backed template diff. This operation reads deployed
state and must not create a change set:

```bash
AWS_PROFILE=cpi-admin pnpm --dir infra/aws exec cdk diff \
  ChaoranPropertyIntelligenceGuardrails \
  -c targetStage=dev \
  --exclusively \
  --method template \
  --no-color
```

Classify the output:

```text
CREATE:
UPDATE:
REPLACE:
DELETE:
```

Expected intent is the bounded DEV OIDC role/policy and existing production
public-delivery permissions. The production trust subject must remain exactly
the protected `main` ref, and DEV trust must be exactly:

```text
repo:Shaobangzhu/chaoran-property-intelligence:environment:development
```

`MUTATING`: after a separate approval of that exact diff, deploy only the
Guardrails stack. Supply the reviewed email and budget through protected local
inputs; do not put either value or a secret in command history or this record.

```bash
AWS_PROFILE=cpi-admin pnpm --dir infra/aws exec cdk deploy \
  ChaoranPropertyIntelligenceGuardrails \
  -c targetStage=dev \
  --exclusively \
  --require-approval never \
  --parameters \
    ChaoranPropertyIntelligenceGuardrails:AlertEmail="$CPI_ALERT_EMAIL" \
  --parameters \
    ChaoranPropertyIntelligenceGuardrails:MonthlyBudgetUsd="$CPI_MONTHLY_BUDGET_USD"
```

`--require-approval never` is permitted here only because approval occurred
immediately before this exact command against the retained diff artifact. It is
not permission to skip the diff or reuse an older approval.

After deployment, read back the role trust and bounded bootstrap-role policy.
Do not continue if GitHub OIDC still cannot assume `cpi-github-deploy-dev`.

Status: complete on 2026-08-28. Guardrails reached `UPDATE_COMPLETE`, both OIDC
trust subjects were verified, schedules remained disabled, and the
post-deployment account-backed diff reported zero differences. This does not
authorize the first DEV deployment.

## 29.3 First DEV Public Deployment

Before dispatch:

1. Merge the reviewed candidate into `dev` through the PR Quality Gate.
2. Confirm the exact `dev` SHA and a clean GitHub Actions result.
3. Confirm `development` protections and DEV-only values.
4. Confirm both DEV schedules synthesize as disabled and, if they already
   exist, are deployed as disabled.
5. Review bundled DEV API migrations and authorize startup migration separately.

Manually run `Deploy DEV` from `dev` for the first launch.

Approval one releases only the plan job. Download the plan artifact and review
all four action categories. Require no delete and no unsafe replacement.

`MUTATING`: approval two authorizes the exact plan, DEV stack changes, static
web publication, CloudFront invalidation, and DEV API startup migration. It
does not authorize production or any worker behavior.

Require these jobs to finish successfully:

- release-candidate verification
- account-backed DEV plan
- explicit DEV deploy
- bounded `/api/health` readiness
- read-only API/UI smoke
- Allure summary and deployment evidence upload

Obtain `ApplicationUrl` from the workflow environment URL or the public-stack
CloudFormation output. Record the CloudFront hostname and exact DEV SHA.

## 29.4 DEV Acceptance

Set repository variable `CPI_AWS_DEV_BASE_URL` to the exact HTTPS CloudFront
origin with no path, query, fragment, or credentials.

Read-only checks:

```bash
curl --fail --show-error --silent \
  "https://<dev-cloudfront-host>/api/health"
curl --fail --show-error --silent \
  "https://<dev-cloudfront-host>/release.json"
curl --fail --show-error --silent \
  "https://<dev-cloudfront-host>/api/release"
```

Require health status `ok`, expected security headers, and matching DEV release
identities. Open the CloudFront URL in a browser and verify the unauthenticated
sign-in page only. Do not create a deployed user or inspect DEV database data as
part of public launch acceptance.

Manually run `Nightly DEV Regression` once. Require zero unexpected retries,
no expired quarantine, and the exact deployed SHA. Natural service readiness
and workflow polling replace fixed sleeps.

## 29.5 Release Promotion

Open a same-repository pull request from `dev` to `main`. The Release Quality
Gate must pass against the exact DEV release. A pending, stale, or failed DEV
deployment blocks promotion by design.

After review, merge into `main` and require the main CI run to pass. Record the
main SHA that will be used for the production plan.

Before 29.6, bind the production job to a protected GitHub `production`
environment and cover that workflow contract with a source test. Configure
required reviewers and restrict deployment to `main`. This source hardening is
a normal reviewed PR; it does not itself authorize or execute a deployment.

## 29.6a Production Plan

Explicitly authorize a plan-only run of `Deploy production` from `main` with:

```text
operation=plan
confirmation=plan-production
```

The run may authenticate and read deployed state but must not deploy. Review:

- exact main SHA and target account
- all `CREATE`, `UPDATE`, `REPLACE`, and `DELETE` sections
- both schedules disabled
- retained production physical/logical identities unchanged
- public runtime creation or update only as expected
- migration bundle and rollback implications

Retain the 90-day artifact and its 64-character approval digest. A screenshot
or copied diff text is not an approval token.

## 29.6b Production Deployment

`MUTATING`: requires a new, explicit production authorization after 29.6a.
Run `Deploy production` from the same `main` SHA with:

```text
operation=deploy
confirmation=deploy-production
approved_plan_digest=<digest from the reviewed plan>
migration_confirmation=authorize-production-api-migration
```

The workflow must reproduce the plan digest before mutation. Require explicit
stack deployment, static web publication, CloudFront invalidation, bounded
health readiness, immutable release identity, and safe production smoke.

Production smoke is limited to public page availability, security headers,
database-independent health/release metadata, and unauthenticated protected
route rejection. It must not log in, query production listings, mutate data,
run a worker, enable a schedule, or call a provider.

Record the production `ApplicationUrl`; that HTTPS CloudFront hostname is the
browser entry point until an optional custom domain is implemented.

The public sign-in page being reachable does not imply that an application user
exists. Production admin creation and authenticated acceptance mutate
production state and remain outside this launch operation unless separately
authorized under the admin runbook.

## Rollback Decision

Do not auto-rollback infrastructure or schema.

- Before stack mutation: stop the run and retain the failed plan evidence.
- Web-only issue: restore reviewed S3 object versions, invalidate CloudFront,
  and rerun safe smoke.
- API image issue: prepare a new digest-bound plan restoring the previous
  immutable App Runner image.
- Migration issue: stop traffic promotion and prepare a separately reviewed
  forward fix or database recovery plan; application rollback does not reverse
  schema changes.
- Stateful replacement/delete: do not deploy.

## 29.7 Optional Custom Domain

The current source does not configure a custom domain. Implement it in a
separate PR only after choosing an owned hostname. CloudFront requires the
alternate domain name to be covered by a trusted TLS certificate; Route 53 can
use alias records to the distribution. CloudFront viewer certificates and WAF
remain in `us-east-1`.

Required source changes include CDK properties/outputs, certificate and DNS
ownership, tests, both synth modes, account-backed diff, URL-variable updates,
smoke, and rollback. Do not edit the distribution manually in the console.

## 29.8 Execution Record Template

Record only bounded metadata:

```text
Execution date:
Operator:
Reviewed git SHA:
AWS identity type confirmed (no full account ID):
Bootstrap us-west-2 status:
Bootstrap us-east-1 status:
Guardrails plan artifact/run:
Guardrails action classification:
DEV plan/deploy run:
DEV ApplicationUrl:
DEV release identity:
DEV smoke/nightly result:
Release PR:
Production plan run and digest:
Production deploy run:
Production ApplicationUrl:
Production release identity:
Production safe smoke result:
Schedules disabled before/after:
Rollback evidence artifact:
Budget/SNS confirmation:
Remaining risks:
```

Never record credentials, secret values, JWTs, cookies, private listing data,
database rows, full production request/response bodies, or screenshots that
contain sensitive data.

## References

- [AWS DEV deployment runbook](aws-dev-deployment.md)
- [Public runtime runbook](aws-public-runtime.md)
- [Release and production delivery runbook](release-production-delivery.md)
- [AWS deployment runbook](aws-deployment.md)
- [ADR 0017](../adr/0017-aws-public-launch-and-operational-readiness.md)
- [AWS CloudFront custom domains](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/CNAMEs.html)
- [AWS CDK bootstrapping](https://docs.aws.amazon.com/cdk/v2/guide/bootstrapping-env.html)
