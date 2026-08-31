# Create The Production Administrator

## Purpose

Create the first application administrator in the isolated production Aurora
database without exposing a registration endpoint, copying DEV data, opening a
database tunnel, rerunning migrations, or placing credentials in logs or
artifacts.

This is a production-data mutation. Source preparation, merge, CDK synthesis,
and a bootstrap `plan` do not authorize `create`.

## Architecture

The production bootstrap path is intentionally separate from DEV:

- GitHub environment: `production-admin-bootstrap`
- workflow: `Bootstrap production administrator`
- source branch: exact `main` SHA only
- OIDC role: `cpi-github-production-admin-bootstrap`
- ECS task family: `cpi-production-admin-bootstrap`
- task entry point: `productionAdminBootstrap.js`
- temporary secret prefix: `cpi/production/admin-bootstrap/`
- database: production Aurora only

The task has no schedule. It receives production database credentials through
the ECS execution boundary, reads exactly one per-run credential secret, calls
the existing administrator creation use case with `runMigrations: false`, and
returns only bounded success or failure codes. It cannot read DEV bootstrap
secrets. The GitHub role cannot read the credential value or assume CDK roles.

## Stop Conditions

Stop without bypassing controls if any condition applies:

- the selected workflow ref is not the reviewed exact `main` SHA
- the AWS account or region differs from the reviewed target
- either production worker schedule is enabled
- the protected environment or OIDC trust differs from this runbook
- an account-backed CDK diff contains a delete or state-bearing replacement
- existing Aurora, VPC, database secret, public runtime, OIDC provider, or
  retained resource identity changes unexpectedly
- the plan contains an email, password, secret value, database row, JWT, or
  cookie rather than the bounded email SHA-256
- the create digest differs from the reviewed 64-character plan digest
- the per-run secret cannot be deleted or the task result is unavailable

Never retry `create` speculatively. `ACCOUNT_ALREADY_EXISTS` is a stop and
review result, not permission to replace or reset the account.

## GitHub Environment

Create `production-admin-bootstrap` before deploying its OIDC trust:

1. Add the repository owner as a required reviewer.
2. Leave **Prevent self-review** disabled while the repository has only one
   authorized operator.
3. Uncheck **Allow administrators to bypass configured protection rules**.
4. Restrict deployment branches and tags to the protected `main` branch only.
5. Add environment secrets `CPI_PRODUCTION_ADMIN_EMAIL` and
   `CPI_PRODUCTION_ADMIN_PASSWORD`.

Use a production-specific password even when the email identity matches DEV.
Do not store either value as a repository variable, repository secret, shell
history entry, committed file, artifact, or runbook value.

## Infrastructure Enablement

The source introduces two independently reviewed AWS changes. Neither may be
deployed from this runbook without fresh, exact authorization. First merge the
feature into protected `dev`. Complete the Guardrails update and the normal AWS
DEV plan/deploy for that exact DEV release before opening the dev-to-main PR.

### Guardrails

Obtain an account-backed diff for only
`ChaoranPropertyIntelligenceGuardrails`. The expected change is a new
least-privilege OIDC role, inline policy, and output for the exact
`environment:production-admin-bootstrap` subject.

Classify the diff as `CREATE`, `UPDATE`, `REPLACE`, and `DELETE`. Require a
separate authorization naming the exact diff before deploying only that stack.
After deployment, require a clean post-deploy diff and read back the role trust
and policy without recording the account ID.

The subsequent DEV plan must show the Guardrails stack clean. The shared admin
image may produce a stateless DEV bootstrap task-definition revision; review it
normally, keep DEV schedules disabled, and do not run either administrator
task. Complete the AWS DEV deployment and release evidence before promotion.

### Production Bootstrap Task

After the dev-to-main release gate passes, use the normal protected production
plan/deploy path from exact `main`. Review
the complete four-stack diff even though the intended application change is in
`ChaoranPropertyIntelligenceProduction`.

Expected foundation changes are a production bootstrap security group and
database ingress rule, two task roles, one Fargate task definition, one retained
30-day log group, CDK image asset metadata, and five stack outputs. Existing
stateful logical and physical identities must remain unchanged. Both schedules
must remain disabled.

The subsequent production deployment requires its own exact SHA, plan digest,
protected-environment approval, and migration confirmation under the existing
delivery workflow. It enables the bootstrap task; it does not create the user.

## Plan

After both infrastructure changes are deployed and their post-deploy diffs are
clean, open **Actions → Bootstrap production administrator → Run workflow**.
Select the exact deployed `main` SHA and enter:

```text
operation=plan
confirmation=plan-production-admin
approved_plan_digest=<empty>
```

Approve the `production-admin-bootstrap` environment for plan only. The plan
reads CloudFormation outputs, the task definition, immutable ECR image digest,
and the two schedule states. It does not create a secret, start a task, inspect
the database, or create a user.

Download `production-admin-bootstrap-plan-<run-id>-<attempt>` and verify:

- exact reviewed commit
- expected account boundary without publishing the account ID
- `stage` is `production`
- `adminEmailSha256` is a 64-character lowercase digest
- task family is `cpi-production-admin-bootstrap`
- container is `ProductionAdminBootstrap`
- command ends in `productionAdminBootstrap.js`
- ECR image digest has the `sha256:<64 hex>` form
- both schedules are `DISABLED`
- no credential or database value is present
- `approval.json` contains a 64-character approval digest

## Create

Only after the owner explicitly authorizes the reviewed exact SHA and digest,
run the workflow a second time:

```text
operation=create
confirmation=create-production-admin
approved_plan_digest=<reviewed-64-character-digest>
```

Approve the environment for this create run. The workflow must recompute the
same plan and digest before it may create the temporary secret or start the
task. It starts exactly one Fargate task and uses the AWS ECS waiter rather than
a fixed sleep.

## Evidence And Acceptance

Review only bounded evidence:

- the create run recomputed the reviewed digest
- the task stopped with container exit code `0`
- the temporary secret deletion request succeeded
- both schedules remained disabled
- no email, password, hash, cookie, token, row, or response body entered logs or
  artifacts

After the workflow succeeds, the owner may perform one manual browser login at
the production CloudFront hostname using the production credentials. Verify
the authenticated workspace loads, then sign out. Do not inspect or mutate
listing data, run a worker, enable schedules, or invoke a provider as part of
this acceptance.

## Failure Handling

- Before secret creation: retain the sanitized plan and stop.
- After secret creation but before task success: require the deletion step and
  inspect only bounded task metadata.
- Task failure: do not print provider or database errors; use the bounded code
  and prepare a new reviewed fix.
- Secret deletion failure: treat the run as failed, delete only the exact
  per-run secret under separate authorization, and retain evidence.
- Login failure after successful create: do not rerun create. Diagnose through
  a separate read-only plan and application logs without reading production
  rows or credential values.

This workflow does not implement password reset or account replacement.

## References

- [Authentication ADR](../adr/0004-single-user-authentication.md)
- [AWS public launch ADR](../adr/0017-aws-public-launch-and-operational-readiness.md)
- [Block 29 launch runbook](block-29-aws-public-launch.md)
- [Production delivery runbook](release-production-delivery.md)
- [Block 29.6f preparation record](../operations/block-29-6f-production-admin-bootstrap-preparation.md)
