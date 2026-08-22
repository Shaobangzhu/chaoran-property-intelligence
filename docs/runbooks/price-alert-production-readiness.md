# Price-Alert Production Readiness Runbook

## Purpose

This runbook controls the Block 20 price-drop worker rollout. It separates the
worker image deployment, PostgreSQL preparation, read-only verification, real
RentCast acquisition, Telegram delivery, and schedule enablement into distinct
approval boundaries.

The production Region is `us-west-2`. Both `cpi-daily-property-alert` and
`cpi-weekly-showing-list` must remain `DISABLED` throughout Block 20.7.

## Safety Boundary

Do not combine these operations into one approval:

1. deploy the reviewed image with both schedules disabled
2. inspect price-alert state without mutation
3. apply bundled migrations and initialize legacy price state
4. make one real RentCast request and permit resulting Telegram delivery
5. enable recurring execution

Never include listing rows, addresses, prices, database credentials, provider
keys, Telegram credentials, Secret values, or the AWS account ID in logs,
screenshots, issues, or this runbook. Record only task IDs, task-definition
revisions, timestamps, exit codes, booleans, and aggregate counts.

## Worker Modes

The reviewed image exposes two database-only Block 20 modes.

```text
node apps/alert-worker/dist/index.js --verify-price-alerts
node apps/alert-worker/dist/index.js --prepare-price-alerts
```

`--verify-price-alerts` is read-only. It loads only PostgreSQL configuration,
does not run migrations, and does not construct a RentCast or Telegram client.
It prints only:

```text
Production price-alert verification completed.
Schema ready: yes|no
Migration 006 applied: yes|no
Price baseline initialized: yes|no
Price observations: <count>
Pending alert events: <count>
Sent alert events: <count>
```

`--prepare-price-alerts` is a database-writing operation. It loads only
PostgreSQL configuration, applies unapplied bundled migrations transactionally,
and runs the idempotent legacy price-state initializer. It does not call
RentCast or Telegram. Success prints only:

```text
Production price-alert preparation completed.
```

The preparation command is safe to retry after inspection because migration
versions and the price baseline marker are durable and idempotent. A retry still
requires a new explicit approval.

## Offline Gate

Run before any Docker or AWS operation:

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build
pnpm aws:synth
git diff --check
```

Build the runtime image and execute only its fake-data path:

```bash
docker build --tag cpi-alert-worker:block20 .
docker run --rm cpi-alert-worker:block20 \
  timeout --signal=TERM 15m node apps/alert-worker/dist/index.js --dry-run
```

The dry run must state that no external services or production data were used.

## Local Migration Integration

Use a disposable PostgreSQL container and synthetic listing rows. Do not point
this procedure at `.env.local`, `cpi_dev`, or Aurora.

The Block 20.7B verification must prove:

- migrations `001` through `005` represent the starting schema
- `--verify-price-alerts` reports migration 006 absent before preparation
- `--prepare-price-alerts` applies migration 006 and converts synthetic legacy
  baseline state without provider or Telegram configuration
- migrated observations have `comparison_ready = false`
- legacy pending new-listing work is represented once in the durable event table
- a second preparation run makes no additional migration, observation, event,
  or marker rows
- the final read-only check reports schema, migration, and baseline ready
- the disposable container and its data are removed afterward

Starting, writing to, or removing that container requires the separate Block
20.7B approval.

### Local Execution Record: 2026-08-22

Block 20.7B completed against a disposable `postgres:18` container with a
random loopback port and temporary filesystem storage. The fixture contained
only synthetic legacy listing rows and did not load `.env.local`.

| Evidence | Result |
| --- | --- |
| Starting migrations | `001` through `005` recorded |
| Pre-preparation schema | Price-alert schema not ready |
| Pre-preparation migration 006 | Not applied |
| Pre-preparation aggregates | Baseline absent; observations 0; pending 0; sent 0 |
| Final migration count | 6 |
| Final migration 006 | Applied |
| Final price baseline | Initialized |
| Final observations | 2, one per synthetic canonical address |
| Non-comparable observations | 2 |
| Preserved pending events | 1 new-listing event |
| Sent events | 0 |
| Idempotent retry | Counts and event-key hash unchanged |
| Disposable container afterward | Removed |
| Existing `cpi-postgres` afterward | Healthy and unchanged |

The preparation and verification commands received only the disposable
`DATABASE_URL` in an otherwise empty environment. No RentCast, Telegram, AWS,
Aurora, or existing local-database operation occurred.

## AWS Read-Only Precheck

Block 20.7C requires a separate approval and a current IAM Identity Center
session. Before any deployment, verify without starting a task:

- STS resolves to the reviewed federated administrator identity in `us-west-2`
- Guardrails and Production CloudFormation stacks are complete
- both EventBridge Scheduler resources are `DISABLED`
- no production ECS task is pending or running
- Aurora is `available`
- both task-failure EventBridge rules are enabled
- the SNS subscription is confirmed
- `cdk diff` does not enable a schedule or replace database, networking,
  retained storage, Secret, or guardrail resources

Do not read Secret values during the precheck. Block 20.7C does not deploy an
image, start an ECS task, or connect to Aurora.

## Controlled Production Sequence

The following operations happen only after Block 20.7 readiness is complete.

1. Obtain approval to deploy the reviewed image with both schedules disabled.
2. Run one `--verify-price-alerts` Fargate task. Before preparation, the expected
   result is migration 006 absent and all new-table counts zero.
3. Obtain separate approval for one `--prepare-price-alerts` Fargate task.
4. Require exit code 0 and the exact preparation completion log.
5. Run a second read-only verification task. For the existing production
   baseline, require schema, migration 006, and price baseline all `yes`.
6. Review aggregate observation and event counts. Any unexpected pending event
   count stops the rollout for investigation.
7. Obtain separate approval for one default `--run` task. This operation makes
   one real RentCast request and may send one or more real Telegram alert
   messages.
8. Require exit code 0, `Production run completed.`, no failure notification,
   no running task afterward, and both schedules still disabled.
9. Run the read-only verification again and require zero pending events.
10. Treat recurring schedule enablement as another operational decision.

The migrated legacy observations begin with `comparison_ready = false`. Their
first fresh provider observation advances the comparison baseline without
creating a historical price-drop alert. A genuinely new matching listing may
still produce a `NEW LISTING` event, and preserved legacy pending work may still
be delivered.

## Telegram Verification

The fixed-message `--telegram-smoke-test` remains independently controlled by
the existing Telegram runbook. It proves transport and chat routing but does
not prove real listing formatting.

Block 20 formatting is verified offline with exact adapter tests. A production
`PRICE DROP` message is accepted only when it arises naturally from the
separately approved provider run. Do not insert or modify production listing,
observation, or event rows merely to force a Telegram message.

## Rollback

Migration 006 is additive. Roll back application code by restoring the previous
ECS task-definition revision while both schedules remain disabled. Do not run a
down migration and do not delete `listing_price_observations`,
`listing_alert_events`, or their migration record.

The previous worker ignores the additive tables, but it must not be started
blindly after preparation:

- preserved legacy pending events may still correspond to legacy pending rows
- price-drop events have no equivalent delivery path in the previous worker
- a failed new-worker delivery must retain its immutable pending event for a
  later new-worker retry

After any rollback, run the applicable read-only checks and reconcile aggregate
pending state before approving another worker execution. Never edit production
event status or listing notification status manually as a shortcut.

## Evidence Record

Record each approved stage in a table containing only:

| Stage | Task ID | Task revision | Exit | Aggregate result |
| --- | --- | --- | --- | --- |
| Pre-preparation inspection |  |  |  |  |
| Price-alert preparation |  |  |  |  |
| Post-preparation inspection |  |  |  |  |
| Controlled provider run |  |  |  |  |
| Final inspection |  |  |  |  |

## References

- [AWS system design and configuration](../aws-system-design.md)
- [AWS deployment runbook](aws-deployment.md)
- [Production baseline runbook](production-baseline.md)
- [Telegram production smoke-test runbook](telegram-production-smoke-test.md)
- [Block 20 Price-Drop Alerts](../knowledge-base/block-20-price-drop-alerts.md)
- [ADR 0008: Price-Drop Alert State and Outbox](../adr/0008-price-drop-alert-state-and-outbox.md)
