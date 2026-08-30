# Create The Initial AWS DEV Administrator

## Purpose And Authorization Boundary

This runbook creates the first administrator in the isolated AWS DEV Aurora
database. It is separate from public-launch smoke because it writes one user
row and handles administrator credentials. Preparing or merging the source does
not authorize a Guardrails deployment, DEV stack deployment, temporary secret,
Fargate task, database write, or authenticated browser session.

Production is out of scope. Never point this workflow, task definition, secret
prefix, security group, or OIDC role at production.

## Architecture

The manual `Bootstrap DEV administrator` workflow uses:

- protected GitHub environment `development-admin-bootstrap`, restricted to
  `dev` with a required reviewer
- OIDC role `cpi-github-dev-admin-bootstrap`
- a DEV-only Fargate task definition named `cpi-dev-admin-bootstrap`
- a dedicated outbound-only security group allowed to reach only DEV Aurora
  PostgreSQL
- one unique temporary Secrets Manager secret under
  `cpi/dev/admin-bootstrap/<run-id>-<attempt>`
- the existing Argon2id password policy and `CreateAdminUser` application use
  case

The task has no service, schedule, public endpoint, provider credentials, S3
permission, notification credentials, or production resource access. Without
both the exact `create-dev-admin` override and a matching temporary secret ARN,
it exits before opening a database connection. It does not run migrations.

## Source And Infrastructure Prerequisites

1. Merge the Block 29.3a PR into `dev` through the quality gate.
2. Run the full local gate and retain its changed-files and risk summary.
3. Produce an account-backed Guardrails diff. Deploy it only after a separate
   authorization and require no production-role or budget replacement.
4. Create GitHub environment `development-admin-bootstrap`, restrict it to
   `dev`, configure a required reviewer, and disable administrator bypass.
5. Store `CPI_DEV_ADMIN_EMAIL` and `CPI_DEV_ADMIN_PASSWORD` as environment
   secrets. Never store either value in source, an Actions input, an artifact,
   a shell command argument, or a CloudFormation parameter.
6. Produce an account-backed DEV diff for
   `ChaoranPropertyIntelligenceDev`. Review every `CREATE`, `UPDATE`, `REPLACE`,
   and `DELETE`; require both worker schedules disabled.
7. Deploy the reviewed DEV diff through the existing two-approval `Deploy DEV`
   workflow. Do not run the bootstrap workflow until its outputs exist.

Expected new DEV resources are a task definition revision, two IAM roles, one
security group and database ingress rule, one log group, image assets, and
bounded CloudFormation outputs. Any Aurora, VPC, database-secret, scheduler, or
production replacement blocks deployment.

## Plan Run

From the exact `dev` commit, manually run `Bootstrap DEV administrator` with:

```text
operation=plan
confirmation=plan-dev-admin
approved_plan_digest=<empty>
```

The protected job reads only runtime metadata. It verifies the account, active
task revision, command and ECR image digest, dedicated network outputs,
administrator email hash, and that both schedules are `DISABLED`. It uploads a sanitized plan and a
64-character approval digest. The plan contains no email, password, secret
value, database credential, or session material.

Stop if the plan refers to a different commit, account, stage, cluster, task
family, container command, email hash, or enabled schedule.

## Create Run

`MUTATING`: after reviewing the plan, obtain a new explicit authorization for
the same commit and digest. Start a second workflow run with:

```text
operation=create
confirmation=create-dev-admin
approved_plan_digest=<reviewed 64-character digest>
```

The create run recomputes the plan before mutation. It then:

1. writes the two protected GitHub secrets to a mode-`0600` runner file
2. creates one uniquely named temporary Secrets Manager secret from that file
3. removes the runner file through an exit trap
4. starts exactly one Fargate task with the reviewed task revision and network
5. waits with the ECS waiter, not a fixed sleep
6. requires the named container to stop with exit code `0`
7. requests immediate deletion of the temporary secret on success or failure
8. uploads only bounded task and deletion evidence

The insert is duplicate-safe. A rerun for the same normalized email fails and
does not replace the password hash. Password reset and user deletion are not
part of bootstrap.

## Verification

Task success proves that one active admin row was created through the existing
repository contract. Routine evidence must never select or print
`password_hash`.

Browser login and authenticated DEV reads are a separate acceptance scope.
Before that validation, confirm the temporary secret deletion step succeeded,
the task is stopped, both schedules remain disabled, and no provider worker ran.

## Failure And Recovery

- Plan mismatch: stop; do not create a secret or task.
- Secret creation failure: no task runs.
- Task start or application failure: retain bounded ECS evidence and confirm
  secret deletion; do not retry until the cause is understood.
- Task logs expose only a bounded failure category, never an email, password,
  hash, secret ARN, database credential, or underlying exception message.
- Duplicate email: do not introduce an update or reset path inside this task.
- Secret deletion failure: treat the run as failed and remove the exact
  temporary secret through a separately authorized operation.
- Wrong user identity: do not delete or edit the row manually; prepare a
  separately reviewed user-lifecycle operation.

## References

- [ADR 0004](../adr/0004-single-user-authentication.md)
- [ADR 0017](../adr/0017-aws-public-launch-and-operational-readiness.md)
- [AWS DEV deployment runbook](aws-dev-deployment.md)
- [Block 29 launch runbook](block-29-aws-public-launch.md)
