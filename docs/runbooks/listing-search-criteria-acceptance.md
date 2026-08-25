# Listing Search Criteria Acceptance Runbook

## Purpose

This runbook closes the local and offline gates for Block 21 configurable
listing search criteria. It verifies the migration upgrade, authenticated
criteria API, React form behavior, revision baseline, and cleanup without
calling RentCast, Telegram, Aurora, or any AWS API.

## Safety Boundary

- Use a disposable PostgreSQL container with a random loopback port and
  synthetic credentials. Never point this procedure at `.env.local`,
  `cpi_dev`, Aurora, or another shared database.
- Use only synthetic administrator and listing data.
- Keep API and Vite listeners on `127.0.0.1`.
- Do not print database passwords, JWT signing material, session cookies, or
  password hashes.
- Remove the disposable container and session-cookie file after acceptance.
- AWS inspection remains a separate read-only approval. This runbook does not
  authorize deployment, task execution, migration, Secret reads, provider
  traffic, Telegram delivery, or schedule changes.

## Offline Gate

```bash
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

The Vite build may retain the known advisory that its ArcGIS application chunk
is larger than 500 kB. Any test, type, or build error is blocking.

## Disposable Migration Gate

1. Start a disposable `postgres:18` container with a random loopback port.
2. Apply and record migrations `001` through `006` only.
3. Run the bundled migration runner twice.
4. Require exactly seven migration rows and latest version
   `007_create_listing_search_profile`.
5. Require exactly one `primary` profile with revision/applied revision `1/1`
   and the exact Domain defaults.
6. Stop the container and confirm the pre-existing local database container was
   not stopped or changed.

The second bundled migration run must add no migration or profile row.

## Authenticated Local Gate

Using the disposable database:

1. Create one synthetic active administrator through the real admin adapter.
2. Start Express on `127.0.0.1:3000` and Vite on `127.0.0.1:5173`.
3. Log in through `POST /api/auth/login` with the exact local Origin.
4. Read the seeded criteria at revision 1.
5. Save a changed criteria value and require revision 2.
6. Reload criteria and require the changed value to persist.
7. Inspect only non-secret profile metadata and require `state=CA`,
   `status=Active`, `applied_revision=1`, and a recorded actor.
8. Submit revision 1 again and require bounded `409
   LISTING_SEARCH_CRITERIA_CHANGED` without changing revision 2.
9. Log out and require the next protected criteria read to return bounded 401.

Browser acceptance additionally requires the `Search Criteria` workspace to
load all bounded controls, save without a layout shift, show the canonical city
selection, survive a reload, and return to login after sign-out. Never inspect
browser cookies or storage values; only verify that no token is displayed or
application-managed.

## Two-Revision Worker Smoke

Run the synthetic integration scenario:

```bash
pnpm exec vitest run \
  apps/alert-worker/src/listingAlertWorkflow.integration.test.ts \
  -t "silently baselines a revision before later new-listing and below-floor drop alerts"
```

The fixture selects Chino and Corona. The first run must issue two fake direct
city requests, baseline widened inventory, advance the fake applied revision,
and send no Telegram request. The second run must preserve the same two-request
market set and produce one batched fake Telegram call containing both a later
new listing and a tracked below-floor price drop.

## Local Execution Record: 2026-08-22

| Evidence | Result |
| --- | --- |
| Starting migrations | Exactly `001` through `006` |
| Final migration count | 7 |
| Migration 007 | `007_create_listing_search_profile` |
| Seed profile | One exact Domain-default `primary` row, revision `1/1` |
| Migration retry | Idempotent; migration/profile counts unchanged |
| Synthetic admin | Active administrator created through real adapters |
| Authenticated read | Default criteria returned at revision 1 |
| Authenticated update | Changed criteria persisted at revision 2 |
| Fixed scope | `CA` and `Active` preserved |
| Audit attribution | Updating actor recorded |
| Optimistic conflict | Stale revision returned bounded 409 |
| Logout boundary | Protected read returned bounded 401 |
| React automated acceptance | 28 Search Criteria/App tests passed |
| Two-revision worker smoke | Passed with fake provider and Telegram transports |
| Browser visual acceptance | Passed; user completed and confirmed the walkthrough |
| Disposable container | Removed |
| Existing `cpi-postgres` | Healthy on its original loopback port |
| External operations | AWS metadata only; no RentCast, Telegram, Aurora connection, deployment, or mutation |

## AWS Read-Only Precheck

Run only after fresh confirmation and a current IAM Identity Center session.
Follow the metadata-only checks in the
[AWS deployment runbook](aws-deployment.md) and the Block 20
[price-alert readiness runbook](price-alert-production-readiness.md). Do not
read Secret values, start an ECS task, create a change set, deploy, migrate,
enable a schedule, or contact RentCast or Telegram.

### Execution Record: 2026-08-22

The precheck used a renewed `cpi-admin` IAM Identity Center session in
`us-west-2`. It did not display the AWS account ID, ARN values, alert address,
Secret values, or production listing data.

| Evidence | Result |
| --- | --- |
| Identity | Matching federated `AdministratorAccess` identity |
| `CDKToolkit` | `CREATE_COMPLETE` |
| Guardrails stack | `CREATE_COMPLETE` |
| Production stack | `UPDATE_COMPLETE` |
| Daily Scheduler | `DISABLED`; flexible window off |
| Weekly Scheduler | Not deployed |
| ECS cluster | Active; running 0, pending 0 |
| Alert task definition | Active revision 7; default bounded `--run` command |
| Aurora | Available, private, encrypted, deletion-protected, 0-1 ACU |
| Database security group | PostgreSQL 5432 only from the worker group |
| Failure EventBridge rules | 2 of 2 `ENABLED` |
| SNS failure email | One confirmed email subscription |
| Secret resources | 2 of 2 complete and present; metadata only |
| Monthly budget | USD 20 gross-cost budget; 50/80/100 actual and 100 forecast alerts |
| GitHub OIDC | Correct audience and exact `main` branch subject |
| CDK comparison | Template-only; no change set created |
| Guardrails diff | No differences |
| Production diff | 15 reviewed resource changes; no deletions |
| Synthesized schedules | Daily and weekly both `DISABLED` |
| Protected topology | No database, VPC, subnet, or security-group change |
| Application Secret diff | Description only; non-description properties unchanged |
| Scheduler IAM diff | Action set unchanged, no wildcard; weekly grants remain resource-scoped |
| External effects | No task start, deploy, migration, schedule change, Secret-value read, RentCast, or Telegram call |

The Production diff contains the expected alert-worker task-definition image
replacement and the previously implemented but undeployed Showing List bucket,
task, roles, log group, queue, and disabled weekly Scheduler. Deployment of
those resources remains a separate approval boundary.
