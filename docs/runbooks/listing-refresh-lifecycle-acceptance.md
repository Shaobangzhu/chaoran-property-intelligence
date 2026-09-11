# Listing Refresh Lifecycle Acceptance

## Status

Proposed acceptance plan for ADR 0019. Commands and resource names that do not
exist in the current implementation are described as required outcomes, not as
currently executable interfaces.

This runbook does not authorize a real RentCast request, Telegram message,
database migration outside a disposable local database, AWS deployment, queue
operation, task start, schedule update, or schedule enablement.

## Purpose

Accept the criteria-triggered refresh, current-inventory membership, lifecycle,
retention, and weekly schedule source changes without confusing source
completion with operational rollout.

The target behavior is:

```text
changed criteria save
  -> durable queued run
  -> asynchronous complete multi-market acquisition
  -> atomic membership publication and applied revision
  -> current Listings view

unchanged criteria
  -> no on-save run

disabled weekly schedule
  -> source expression Monday 08:00 America/Los_Angeles
  -> no AWS execution until separately enabled
```

## Safety Boundary

- Use fakes for all ordinary tests. A fake market request counts as no provider
  use.
- Use a disposable PostgreSQL container with synthetic credentials for
  migration and lifecycle acceptance. Never point those tests at `.env.local`,
  DEV Aurora, or Production Aurora.
- Keep the production and DEV property-alert and Showing List schedules
  `DISABLED` throughout planning, implementation, synth, diff, and deployment.
- Never infer `sold` from absence in an Active-only response.
- Never publish partial results when one selected market fails.
- Never log an API key, cookie, JWT, raw provider URL/body, street address,
  Telegram payload, or database credential.
- A live provider smoke, AWS diff, deployment, task execution, retry, or
  schedule change requires its own exact request budget and fresh approval.

## Documentation Gate

Before implementation, require agreement across:

- ADR 0019 lifecycle meanings and retention defaults
- one request per selected market, not one request per save
- latest-wins criteria coalescing
- last-successful inventory publication on failure
- Monday 08:00 Pacific target cadence with disabled state
- no automatic deletion of manual listings
- no automatic provider replay through Scheduler retries

Documentation must distinguish current implementation from proposed behavior.

## Offline Contract Gate

Add fixture-only tests for:

1. a changed save creates exactly one queued run for its revision
2. an unchanged save creates no run
3. repeated dispatch of one run ID produces one transactional claim
4. a newer queued criteria revision supersedes an older unstarted revision
5. a running profile refresh excludes a concurrent second refresh
6. one, five, six, and seven selected markets produce exact request plans
7. a failure in any market publishes no membership or applied revision
8. the first successful changed-revision run is a quiet baseline
9. a successful run atomically publishes current membership
10. narrowed criteria moves excluded history to `out_of_scope`, not `sold`
11. one complete absence produces `missing`
12. a second complete absence after a recurring interval produces `inactive`
13. a failed or partial run does not increment absence counts
14. below-minimum tracked observation remains available to alert logic without
    appearing as a normal full-criteria current result
15. safe failure DTOs and logs contain no sensitive data

Run the focused tests first, then require the complete repository gates:

```bash
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

## Disposable Migration Gate

Against a new disposable PostgreSQL database:

1. apply the pre-feature migrations
2. seed synthetic provider, manual, observation, event, Showing List, and
   unapplied-profile rows
3. run the new bundled migrations twice
4. require one migration record per version and no duplicate run/membership
   rows
5. require historical provider rows to remain historical until a complete
   refresh establishes current membership
6. require manual listing archive semantics to remain unchanged
7. roll application code back while leaving additive tables in place and prove
   the prior read path still starts safely, or document the exact compatibility
   boundary if it cannot
8. remove only the disposable database

Never run migration acceptance against the existing local `cpi_dev` database.

## API And Browser Gate

Use a local API, React app, disposable database, fake asynchronous dispatcher,
and fake RentCast transport.

Require the Search Criteria workspace to show:

- saved revision and queued state immediately after a changed save
- running and successful applied state without losing the saved form
- failed refresh while continuing to display the previous applied result
- one explicit retry action with planned market/request count
- no refresh for an unchanged save

Require the Listings workspace to show:

- `Current` by default
- the applied revision and last successful refresh time
- only the atomically published current result set
- explicit Historical/lifecycle access
- stable previous content during a newer failed refresh
- no misleading `sold` label for missing or out-of-scope records

Cover desktop, mobile, keyboard, focus, loading, empty, conflict, session-expiry,
and retry behavior through React and Playwright tests. Browser tests use fake
provider data only.

## Retention Gate

Seed synthetic rows on both sides of every retention boundary. Require a
cleanup dry run to report aggregate candidates without mutation, then require a
separately invoked cleanup execution to:

- remove expired run detail after 90 days
- remove expired inactive/out-of-scope membership after 90 days
- remove unreferenced RentCast rows after 180 days
- remove eligible retained alert history after 365 days
- preserve current/missing membership, current observations, pending alerts,
  current Showing List references, and all manual listings
- operate in deterministic bounded batches
- be safe to repeat

Do not assert that a PostgreSQL delete immediately reduces allocated storage;
verify logical row bounds and reusable database space instead.

## Infrastructure Gate

CDK tests and synthesized templates must require:

- the property-alert expression is Monday 08:00 in
  `America/Los_Angeles`
- its state is `DISABLED` for DEV and by default for Production
- deployment workflows continue to pass `scheduleEnabled=false`
- the existing schedule physical name is preserved for the initial update
- flexible time window is off
- Scheduler automatic retries are disabled for complete provider refreshes
- asynchronous dispatch resources and IAM permissions are stage-scoped
- the API cannot read the RentCast or Telegram credentials
- queue payloads contain only opaque run identity and bounded routing metadata
- the Weekly Showing List cannot be enabled at the same effective start time
  without a reviewed offset/dependency

An account-backed diff must classify every create, update, replacement, and
deletion. Any schedule replacement or enabled-state change blocks rollout.

## Live Provider Gate

Defer this gate until all offline acceptance passes and the current RentCast
plan and usage are known.

Before one live smoke:

1. select the smallest one-market synthetic-safe criteria that proves the
   contract
2. state the exact maximum request count and disable automatic retry
3. obtain fresh authorization for that exact provider use
4. verify no Telegram notification will be generated
5. execute one refresh
6. inspect aggregate run counts and bounded database metadata only
7. stop; do not broaden markets or repeat on failure without new authorization

The live smoke does not authorize AWS deployment or schedule enablement.

## AWS Rollout Gate

Roll out source and infrastructure with both schedules disabled. Require:

1. exact stage/account/region identity
2. reviewed account-backed diff with no unapproved replacement or deletion
3. migration authorization separated from deployment authorization
4. pre-deploy proof that both schedules are disabled
5. post-deploy proof that both schedules remain disabled
6. no queued refresh, Fargate run, provider call, or Telegram delivery caused
   by deployment
7. safe API/release smoke and bounded schema/run-state inspection
8. documented rollback to the previous Web/API/worker task definitions

Enabling criteria-triggered dispatch or the weekly recurring schedule is a
later operational decision. Weekly enablement, if ever approved, must use
Monday 08:00 Pacific and must not implicitly enable the Showing List schedule.

## Acceptance Record Template

| Evidence | Result |
| --- | --- |
| ADR and runbook review | Pending |
| Focused fixture tests | Pending |
| Complete test/type/build gate | Pending |
| Disposable migration/retry | Pending |
| API/browser lifecycle behavior | Pending |
| Retention dry run and execution | Pending |
| CDK disabled weekly schedule synth | Pending |
| Account-backed AWS diff | Not authorized |
| Live provider smoke | Not authorized |
| AWS deployment/migration | Not authorized |
| Schedule enabled state | Must remain `DISABLED` |

## References

- [ADR 0019](../adr/0019-criteria-triggered-listing-refresh-and-lifecycle.md)
- [Implementation plan](../listing-refresh/implementation-plan.md)
- [Listing Search Criteria acceptance](listing-search-criteria-acceptance.md)
- [Price-alert production readiness](price-alert-production-readiness.md)
- [AWS deployment](aws-deployment.md)
