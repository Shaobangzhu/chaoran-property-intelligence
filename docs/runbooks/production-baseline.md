# Production Baseline Runbook

## Purpose

This runbook controls the first production execution of the property alert
worker. The run establishes a durable baseline from current matching RentCast
listings without sending Telegram notifications.

The first run is a one-time Block 14 operation. It does not enable the daily
EventBridge Scheduler.

## Safety Boundary

The production schedule `cpi-daily-property-alert` must remain `DISABLED` for
the entire procedure. Only one baseline task may be pending or running at a
time, and every attempt requires explicit approval after a read-only inspection.
A failed attempt requires another inspection and a new explicit approval before
recovery execution.

Never include listing rows, addresses, database credentials, RentCast keys,
Telegram credentials, or Secret values in commands, logs, screenshots, issues,
or chat.

Stop immediately if any of the following is true:

- the AWS identity is root or is not the reviewed account
- the Region is not `us-west-2`
- the Scheduler is not `DISABLED`
- another ECS task is pending or running in the production cluster
- pre-baseline inspection finds an initialized marker or any listing rows
- the deployed task definition does not support `--verify-baseline`
- the baseline task does not stop with container exit code 0
- an ECS failure email arrives during the procedure

## Baseline Contract

The production use case reads the marker before any notification work. When the
marker is absent, it filters the current RentCast results, writes every matching
listing with `notification_status = 'baseline'`, writes the independent
`baseline_initialized` marker in the same PostgreSQL transaction, and returns.

The transaction must leave one of two outcomes:

- success: marker present and all current matches committed as baseline
- failure: neither the marker nor a partial baseline commit is visible

The first-run branch never queries pending notifications and never calls the
Telegram notification port.

## Verification Mode

The deployed image provides a read-only command:

```text
node apps/alert-worker/dist/index.js --verify-baseline
```

It connects to the same private Aurora cluster as the worker and prints only:

```text
Production baseline verification completed.
Schema ready: yes|no
Migration applied: yes|no
Baseline initialized: yes|no
Baseline listings: <count>
Pending listings: <count>
Sent listings: <count>
```

It does not run migrations, call RentCast, construct the Telegram client, or
return listing fields. If the production schema does not exist yet, it reports
`Schema ready: no` and zero counts without querying missing tables.

## Local Gate

Run before deploying the verification-capable image:

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build
AWS_PROFILE=cpi-admin pnpm aws:synth
git diff --check
```

Review `cdk diff` with `scheduleEnabled=false`. A Block 14 image update must not
enable or replace the Scheduler, database, Secrets, or networking resources.

## AWS Preflight

1. Authenticate with IAM Identity Center under the `cpi-admin` profile.
2. Verify the STS ARN is an assumed `AWSReservedSSO_AdministratorAccess` role.
3. Verify `CDKToolkit`, `ChaoranPropertyIntelligenceGuardrails`, and
   `ChaoranPropertyIntelligenceProduction` are complete.
4. Verify `cpi-daily-property-alert` is `DISABLED`.
5. Verify the production ECS cluster has no pending or running tasks.
6. Verify Aurora is `available` before starting a task.
7. Verify the SNS failure subscription remains confirmed.
8. Deploy the image and task-definition update with `scheduleEnabled=false`.
9. Recheck the Scheduler state after deployment.

## Pre-Baseline Inspection

Run one Fargate task using the production task definition, network configuration,
and security group, overriding only the container command to
`--verify-baseline`. Assign a public IP because the task uses the same public
subnet execution model, even though this inspection performs no external HTTP
request.

Wait for the task to stop. Require exit code 0 and one of these states:

```text
Schema ready: no
Migration applied: no
Baseline initialized: no
Baseline listings: 0
Pending listings: 0
Sent listings: 0
```

or:

```text
Schema ready: yes
Migration applied: yes
Baseline initialized: no
Baseline listings: 0
Pending listings: 0
Sent listings: 0
```

The second state is acceptable if migrations were previously applied without a
baseline. Any marker or non-zero count means the database is not untouched;
stop and investigate instead of running production.

## Controlled Baseline Execution

Obtain explicit approval after the pre-baseline inspection. Then run exactly one
Fargate task with the production task definition's default `--run` command and
the same reviewed network configuration.

Do not enable the Scheduler and do not start a second task while the first is
pending or running. Wait for the task to stop, then verify:

- ECS task `stopCode` is `EssentialContainerExited`
- the application container exit code is 0
- CloudWatch contains `Production run completed.`
- no worker-failure SNS email was delivered
- no Telegram listing message was delivered

A timeout, non-zero exit, `TaskFailedToStart`, RentCast error, database error,
or unexpected notification ends the procedure. Keep the Scheduler disabled and
inspect the stopped reason, CloudWatch logs, and database state before proposing
a retry. Do not add an automatic RentCast retry to this controlled operation.

## Post-Baseline Inspection

Run a second `--verify-baseline` Fargate task. Require:

```text
Schema ready: yes
Migration applied: yes
Baseline initialized: yes
Baseline listings: <zero or more>
Pending listings: 0
Sent listings: 0
```

`Baseline listings: 0` is valid when RentCast returns no current matches. The
independent marker is what distinguishes that successful empty baseline from an
uninitialized database.

Also verify:

- `001_initial_alert_schema` is recorded in `schema_migrations`
- there are no pending or running ECS tasks after inspection stops
- the Scheduler remains `DISABLED`
- both EventBridge task-failure rules remain enabled
- the final CDK diff has no differences

## Execution Record: 2026-08-20

The table records ECS task IDs rather than full ARNs so the AWS account ID is
not duplicated in the repository. No listing fields or Secret values are
recorded.

| Stage | ECS task ID | Task revision | Exit | Aggregate result |
| --- | --- | --- | --- | --- |
| Initial precheck | `cf329d1bdf9147b1a370c661e980a067` | 5 | 0 | Schema absent; marker absent; all counts 0 |
| Initial baseline attempt | `27150712282e441d87b802672d82a6ee` | 5 | 1 | RentCast request exceeded the 10-second client timeout |
| Post-failure inspection | `a26f09578e454a9085f87f66cbcdb9a8` | 5 | 0 | Migration applied; marker absent; all counts 0 |
| Recovery precheck | `732b888e304c4c8486ab1b09fc5b446e` | 6 | 0 | Migration applied; marker absent; all counts 0 |
| Approved recovery baseline | `38930ad9df7540a5912f46dcb3c847a7` | 6 | 0 | `Production run completed.` |
| Post-baseline inspection | `ec6ba45184e1498cb50b2fe6dee0de15` | 6 | 0 | Marker present; baseline 28; pending 0; sent 0 |

RentCast reported the initial API request as successful with an observed latency
of 19,006 ms and no API error. The worker's single-request timeout was therefore
raised from 10 seconds to 30 seconds. Automatic API retries remain disabled.

After the final inspection, there were no running ECS tasks and
`cpi-daily-property-alert` remained `DISABLED`. The database state proves that
no listing entered the pending or sent notification states. The operator also
confirmed that no Telegram listing message was received. All Block 14
completion checks passed on 2026-08-20.

## Completion and Next State

Record task ARNs, start/stop timestamps, exit codes, aggregate baseline counts,
and the verification date. Do not record listing data or Secret values.

Block 14 completes with the Scheduler still disabled. Enabling recurring daily
execution is a separate operational decision after the baseline evidence has
been reviewed.

## References

- [AWS system design and configuration](../aws-system-design.md)
- [AWS deployment runbook](aws-deployment.md)
- [Project roadmap](../roadmap.md)
