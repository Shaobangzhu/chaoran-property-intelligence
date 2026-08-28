# AWS DEV Foundation Runbook

## Purpose And Boundary

This runbook covers the Block 28.4 AWS DEV CDK definition and pre-deployment
review. It does not authorize a deployment. Do not run `cdk deploy`, create a
change set, synchronize application secrets, run migrations, start workers,
enable schedules, call RentCast or OpenAI, send Telegram messages, or publish
failure notifications under this runbook.

The public CloudFront, private S3 web origin, App Runner API, VPC Connector,
WAF, response headers, and origin protection are owned by the separate Block
28.5 public runtime stacks. They do not change this foundation's ownership.

## Fixed Identities

| Boundary | Production | DEV |
| --- | --- | --- |
| Application stack | `ChaoranPropertyIntelligenceProduction` | `ChaoranPropertyIntelligenceDev` |
| OIDC role | `cpi-github-deploy` | `cpi-github-deploy-dev` |
| OIDC subject | exact `main` branch | exact `development` environment |
| Database secret | `cpi/production/database` | `cpi/dev/database` |
| Application secret | `cpi/production/application` | `cpi/dev/application` |
| Daily schedule | `cpi-daily-property-alert` | `cpi-dev-daily-property-alert` |
| Showing List schedule | `cpi-weekly-showing-list` | `cpi-dev-weekly-showing-list` |

The GitHub `development` environment must allow deployments from `dev` only.
Environment protection is part of the OIDC trust boundary because GitHub emits
an environment subject instead of a branch subject when a job uses an
environment.

## Local Verification

Run the infrastructure contracts and both synth modes:

```bash
pnpm test:infra
pnpm --dir infra/aws typecheck
pnpm aws:synth
pnpm --dir infra/aws synth:dev
git diff --check
```

Vitest ignores `infra/aws/cdk.out/**`; a synth must not create duplicate test
discovery. Docker asset hashing also ignores local Allure, Playwright report,
and test-result directories.

Production remains the default. `targetStage` accepts only `production` or
`dev`; any other value fails synthesis. The DEV app assembly forces both
schedules disabled even if schedule context is supplied.

Review these DEV template facts before requesting deployment authorization:

- no `cpi/production` secret or log reference
- separate VPC and security groups
- PostgreSQL ingress only from the DEV worker security group
- Aurora backup retention of one day and deletion protection disabled
- both EventBridge schedules in `DISABLED` state
- no public Web/API resources inside the foundation stack

## Diff Review

An offline create preview can compare DEV with the tracked empty template:

```bash
pnpm --dir infra/aws exec cdk diff \
  --app 'node dist/bin/app.js' \
  -c targetStage=dev \
  --template test/fixtures/empty-cloudformation-template.json \
  --method template \
  --no-color \
  --exclusively \
  ChaoranPropertyIntelligenceDev
```

This preview proves template intent but does not replace an account-backed diff.
Before the first real DEV deployment, obtain a valid federated `cpi-admin`
session, verify the account and `us-west-2` region, and run template-only CDK
diffs for `ChaoranPropertyIntelligenceGuardrails` and
`ChaoranPropertyIntelligenceDev`. Do not create a CloudFormation change set at
this review stage.

Classify the result explicitly:

```text
CREATE:
UPDATE:
REPLACE:
DELETE:
```

Any production database, VPC, secret, schedule, log, topic, or OIDC identity
change that was not already reviewed blocks deployment. Any production retained
resource `REPLACE` or `DELETE` blocks deployment unconditionally.

## Block 28.4 Review Record

The production and DEV synths passed. Offline CDK diff found two additive
Guardrails IAM resources and 55 new DEV application resources. It found no
delete. The production application comparison found only two immutable ECS task
definition revisions because local Allure and Playwright artifact directories
are now excluded from the Docker context. No retained or stateful production
resource changed.

The configured AWS SSO session was expired, so no deployed stack was read and no
account mutation occurred. Repeat the account-backed diff after federated login
and before any separately authorized deployment.

## Remaining Deployment Gates

- explicit user authorization for a real AWS DEV deployment
- valid non-root federated identity and confirmed target account/region
- protected GitHub `development` environment restricted to `dev`
- distinct DEV alert email and later DEV-only application credentials
- public Web/API account-backed diff completed under its separate runbook
- reviewed rollback and teardown plan
