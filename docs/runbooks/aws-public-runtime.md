# AWS Public Runtime Runbook

## Purpose And Boundary

This runbook covers the Block 28.5 DEV public Web/API CDK definition and
pre-deployment review. It does not authorize `cdk deploy`, secret reads or
changes, database access, migrations, worker execution, schedule enablement,
RentCast or OpenAI calls, Telegram messages, or notifications. Production
deployment is explicitly outside this runbook.

## Stack Ownership

| Stack | Region | Ownership |
| --- | --- | --- |
| `ChaoranPropertyIntelligenceGuardrails` | `us-west-2` | Existing budget/OIDC resources; DEV role gains exact bootstrap roles for both deployment regions |
| `ChaoranPropertyIntelligenceDev` | `us-west-2` | Existing DEV VPC, Aurora, database secret, worker resources, disabled schedules |
| `ChaoranPropertyIntelligenceDevEdge` | `us-east-1` | CloudFront-scope WAF and login rate rule |
| `ChaoranPropertyIntelligenceDevPublicApplication` | `us-west-2` | Private web S3, CloudFront, App Runner, VPC Connector, API security group, S3 endpoint, API-auth secrets |

WAF for a CloudFront distribution must remain in `us-east-1`. Application and
data resources remain in `us-west-2`. The DEV GitHub OIDC role names only the
CDK bootstrap roles in those two regions; it does not receive wildcard
bootstrap-role access.

## Runtime Security Contract

- S3 blocks public access and CloudFront reads it through Origin Access Control.
- The web bucket is versioned. A later deployment workflow must record the
  deployed object versions and distribution ID as rollback evidence.
- `/api/*` uses HTTPS to App Runner, disables shared caching, forwards viewer
  context except `Host`, and receives the same response-header policy as web
  responses.
- The Common Rule Set keeps its managed actions except `SizeRestrictions_BODY`,
  which is counted because the application has strict endpoint-specific body
  limits above 8 KB. Monitor its metric before changing this exception.
- CloudFront overwrites `x-cpi-origin-verification` with a generated secret and
  overwrites `x-cpi-viewer-origin` from its accepted viewer `Host`.
- Express rejects direct App Runner access except `GET /api/health`, which is
  database-independent and returns no application data.
- The App Runner VPC Connector uses isolated subnets with no NAT. Aurora accepts
  5432 only from the dedicated API security group. S3 traffic uses a Gateway
  Endpoint.
- App Runner reads only the stage database secret, API-auth secrets, and the
  current Showing List artifact. Worker provider secrets are not granted.
- DEV schedules remain disabled and are not part of the public runtime stacks.

## Local Verification

```bash
pnpm test:infra
pnpm typecheck
pnpm build
pnpm aws:synth
pnpm --dir infra/aws synth:dev
git diff --check
```

Review the synthesized templates for secret values as well as resource shape.
Secret ARNs and CloudFormation dynamic references are expected; resolved secret
values are not. `PORT` is intentionally absent from App Runner runtime variables
because App Runner reserves it and derives it from image port `3000`.

## Required Diff Review

Before the first real DEV deployment, obtain a valid non-root federated session,
confirm the account, and bootstrap both `us-west-2` and `us-east-1`. Run an
account-backed diff for all four DEV assembly stacks and classify every action:

```text
CREATE:
UPDATE:
REPLACE:
DELETE:
```

Expected intent is additive public runtime creation, one bounded Guardrails
policy update, and foundation exports required by cross-stack references. Any
replacement or deletion of Aurora, its secret, the VPC, retained production
resources, schedules, or OIDC identities blocks deployment.

Block 28.5 offline classification, excluding `AWS::CDK::Metadata`:

```text
CREATE: 4 DEV edge resources; 24 DEV public-application resources
UPDATE: Guardrails DEV IAM policy; DEV foundation Outputs only
REPLACE: 2 production ECS task-definition revisions from image digest changes
DELETE: none
```

The local production-template comparison for Block 28.5 contains only two ECS
task-definition image digest changes. Those immutable revisions are stateless;
no production database, VPC, secret, schedule, topic, log, or logical identity
changed. This offline comparison does not substitute for deployed-state diff.

## Migration Gate

The API composition root currently executes bundled PostgreSQL migrations before
it starts listening. Creating the App Runner service can therefore mutate the
isolated DEV schema. Do not perform the first deployment until that migration is
separately reviewed and explicitly authorized. A failed startup must not be
worked around with manual SQL or arbitrary waits.

## Rollback And Teardown Preconditions

- Record the prior App Runner image identifier, web object versions, CloudFront
  distribution ID, deployed commit SHA, and CDK outputs.
- Roll back App Runner to the prior immutable image and restore prior S3 object
  versions before invalidating CloudFront paths.
- Schema rollback is not implied by application rollback. Migrations require a
  forward-compatible or separately approved recovery plan.
- DEV public stacks may be removed only after a fresh diff proves no foundation
  or production resource deletion. Never use teardown to repair a failed
  production deployment.

## Remaining Authorization Gates

- valid federated AWS session and confirmed account
- CDK bootstrap present in both deployment regions
- account-backed four-stack diff with explicit action classification
- explicit approval for the DEV schema migration caused by API startup
- protected GitHub `development` environment restricted to `dev`
- Block 28.6 workflow source reviewed and its two approvals configured
- first account-backed plan artifact reviewed before deployment approval

Execution details are in the
[AWS DEV Deployment Runbook](aws-dev-deployment.md). Source completion does not
authorize the first real DEV deployment.
