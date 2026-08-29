# Block 29.3a DEV Administrator Bootstrap Preparation

## Scope

Block 29.3a prepares a safe path for creating the initial administrator in the
new isolated DEV Aurora database. This source phase performs no AWS login,
account-backed diff, deployment, secret creation, Fargate execution, database
read/write, browser login, provider call, worker execution, schedule change, or
production operation.

## Repository Finding

Migration `003_create_users.sql` creates the user schema but intentionally does
not seed an account. API startup runs migrations and never creates an
administrator. The first DEV deployment therefore produced a healthy sign-in
page with no copied local or production credentials. The public generic login
error cannot distinguish an unknown email from a wrong password by design.

## Prepared Design

- Dedicated `Dockerfile.admin`; no API or worker runtime reuse.
- Non-interactive DEV entry point reads one exact JSON secret from Secrets
  Manager and emits no identity or credential material.
- Existing `CreateAdminUser`, Argon2id policy, and duplicate-email protection
  remain authoritative.
- The task uses PostgreSQL parameter configuration with `verify-full`, does not
  run migrations, and closes its database connection on every outcome.
- DEV-only Fargate task, log group, task/execution roles, security group, and
  CloudFormation outputs; production synthesis remains unchanged.
- Separate GitHub environment and immutable OIDC subject for the bootstrap
  role, with no CDK, production, provider, S3, or `GetSecretValue` permission.
- Separate `plan` and `create` workflow runs. The digest binds exact commit,
  task revision and ECR image digest, account, region, network, disabled
  schedules, and a hash of the normalized administrator email.
- Per-run temporary secret, file-backed AWS CLI input, ECS waiter, bounded
  evidence, and unconditional deletion request.

## Required Future Authorizations

1. Account-backed Guardrails plan and exact deployment authorization.
2. Account-backed DEV stack plan and exact deployment authorization.
3. Read-only bootstrap `plan` run authorization.
4. Separate digest-bound `create` authorization for one DEV user insert.
5. Separate authenticated browser acceptance authorization if DEV application
   data will be read after login.

No authorization above is implied by this preparation record.

## Local Verification

- Focused administrator, approval, workflow, image, and CDK tests: 56 passed.
- Full Vitest suite: 133 files and 1,289 tests passed.
- Full TypeScript typecheck: passed.
- Production build: passed with the existing Vite chunk-size warning only.
- Production and DEV CDK synthesis: passed without AWS credentials.
- Dedicated Docker image: built successfully from `Dockerfile.admin`.
- Network-disabled container preflight: rejected missing confirmation and
  secret identity without attempting a database operation.
- Container identity: non-root `node` user (`uid=1000`).

The local templates show only additive DEV bootstrap resources and a new
Guardrails role/policy/output. This is not an account-backed diff and must not
be used as deployment authorization.

## Remaining Risks

- GitHub environment and secrets do not exist until configured and verified.
- Account-backed diffs may differ from local synthesis and remain authoritative.
- Forced secret deletion is asynchronous in Secrets Manager; the deletion
  request and any cleanup failure must be retained as evidence.
- A successful insert has no automatic rollback. Password reset, disablement,
  or deletion requires a separate user-lifecycle design.
- The existing `Deploy DEV` pull-request-closed trigger still requires its
  separately planned correction to a tested `push`-to-`dev` trigger.

## References

- [DEV administrator runbook](../runbooks/create-dev-admin.md)
- [Block 29.3 deployment record](block-29-3-first-dev-public-deployment.md)
- [ADR 0004](../adr/0004-single-user-authentication.md)
- [ADR 0017](../adr/0017-aws-public-launch-and-operational-readiness.md)
