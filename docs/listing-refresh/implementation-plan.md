# Criteria-Triggered Listing Refresh Implementation Plan

## Status

Documentation-only implementation plan for
`feat/search-criteria-refresh-lifecycle`. ADR 0019 is authoritative when this
plan and an implementation detail differ.

No implementation phase authorizes a real provider request, Telegram message,
shared-database migration, AWS mutation, deployment, task execution, or
schedule enablement. The property-alert schedule must remain `DISABLED`.

## Target Outcome

After an administrator saves changed criteria:

1. the profile and one durable refresh run commit
2. the browser receives the new saved revision and queued state
3. an asynchronous stage-scoped signal wakes the worker
4. the worker claims the latest eligible run for the primary profile
5. every selected market is acquired and validated
6. one transaction publishes current membership, lifecycle changes, listing
   snapshots, alert observation state, and the applied revision
7. Listings displays the new applied inventory

Failure at steps 3-6 leaves the saved criteria visible, preserves the prior
applied inventory, and exposes a bounded retryable run state.

## Phase 1: Domain And Application Contracts

Add pure contracts before persistence or transport:

- refresh trigger reason: `criteria-change`, `scheduled`, or `manual-retry`
- run status: `queued`, `running`, `succeeded`, `failed`, or `superseded`
- membership lifecycle: `current`, `out_of_scope`, `missing`, `inactive`, with
  `sold` accepted only from explicit validated provider evidence
- planned/actual provider-request accounting
- transactional run claim and completion inputs/results
- current-inventory and historical query ports
- retention candidate and aggregate-report contracts

Keep full-criteria display eligibility separate from acquisition eligibility so
an already tracked below-minimum listing can remain price-comparison-ready
without appearing as a normal current search result.

Required tests cover exact shapes, deep immutability, invalid timestamps,
unsafe counts, impossible transitions, repeated completion, stale claims, and
criteria-revision conflicts.

## Phase 2: Additive PostgreSQL Migration

Add the next versioned migration after `007_create_listing_search_profile`.
Create `listing_search_runs` with:

- UUID primary key and `primary` profile foreign key
- saved/effective revision and trigger reason
- constrained status and bounded safe error code
- requested/started/completed timestamps with ordering checks
- selected-market, planned-request, actual-request, returned, and published
  counts
- optional superseding-run relationship
- partial unique constraints preventing duplicate criteria-revision triggers
  and more than one running primary-profile refresh

Create `listing_search_memberships` with:

- profile/listing primary key
- applied revision and last successful run foreign keys
- lifecycle state
- first/last matched and server-observed timestamps
- consecutive complete-run absence count
- inactive timestamp where applicable

Do not rewrite existing RentCast rows as current. They remain queryable history
until a complete successful refresh creates authoritative membership. Preserve
all existing manual listing constraints and migrations.

Add deterministic indexes for queued-run claim, current Listings reads,
lifecycle/history filters, and retention scans. Migration tests must exercise
fresh install, upgrade, second-run idempotence, constraints, and rollback
compatibility against a disposable database.

## Phase 3: PostgreSQL Repositories

Implement repositories for:

- atomic changed-profile save plus criteria-change run creation
- latest-wins queued-run selection and transactional claim
- superseding older unstarted criteria revisions
- complete refresh publication
- current and historical membership reads
- failure completion without membership mutation
- retention dry-run selection and bounded deletion

The existing listing upsert remains canonical. Refactor transaction boundaries
so profile applied revision, membership publication, relevant listing/
observation changes, and run success commit together.

Use database constraints as the final concurrency boundary. Application locks
alone are insufficient when a queue redelivers or two Fargate tasks overlap.

## Phase 4: Criteria And Refresh API

Extend the authenticated criteria response with bounded applied/run status. A
changed `PUT /api/listing-search-criteria` creates a queued run; an unchanged
save does not.

Add administrator-only endpoints for:

- latest refresh status
- explicit retry of the latest failed/supersedable revision
- current Listings query
- bounded historical Listings query with lifecycle filters and pagination

Keep Origin validation, no-store responses, exact DTO keys, request/body
limits, session-expiry behavior, and redacted telemetry. Retry returns the
planned selected-market request count before dispatch and is rate-limited.

Dispatch occurs after the database commit through a port. A dispatch failure
must return/report `refreshDispatch=failed` without pretending the criteria
save rolled back. The durable queued run remains recoverable.

## Phase 5: Worker Reconciliation

Adapt the existing `--run` production composition rather than introducing a
second copy of provider and alert logic.

On start:

1. claim the latest queued run, superseding older unstarted criteria changes;
   when invoked by the weekly schedule with no queued change, create/claim one
   scheduled run for the current revision
2. reject unsupported request plans before provider access
3. execute one sequential request per selected market
4. retain per-market completeness and all-or-nothing acquisition
5. canonicalize/deduplicate candidates
6. publish the result transactionally

Publication rules:

- fetched full-criteria candidates become `current`
- prior applied membership excluded by changed criteria becomes
  `out_of_scope`
- prior current membership absent from one complete same-scope run becomes
  `missing`
- a second complete absence after a recurring interval becomes `inactive`
- failed/partial runs change none of these states
- `sold` requires a separate explicit provider contract
- changed-revision publication remains a quiet baseline
- unchanged scheduled runs retain ordinary new-listing/price-drop semantics

Record actual request count after each attempted provider call without logging
the URL, market response, or address. A crash after provider access may require
manual reconciliation; do not automatically replay an ambiguous complete run.

## Phase 6: React Workspaces

Search Criteria adds:

- saved revision
- applied revision
- queued/running/succeeded/failed refresh state
- planned request count
- last successful refresh time
- explicit retry for the latest failed refresh

Listings adds:

- `Current` default view
- applied revision and freshness timestamp
- Historical view and lifecycle filters
- pagination for retained history
- stable previous applied content while a newer run is queued or failed

Do not label `missing`, `inactive`, or `out_of_scope` as sold. Preserve the
existing desktop/mobile map selection and manual listing workflows.

## Phase 7: Retention

Add a database-only cleanup composition with preview and execute modes. It must
not construct RentCast, Telegram, OpenAI, or S3 clients.

Defaults:

- run detail: 90 days
- inactive/out-of-scope membership: 90 days
- unreferenced provider listing: 180 days since last server observation
- retained alert event: 365 days
- manual listing: no automatic deletion

Delete in deterministic bounded batches. Preserve current/missing membership,
current observations, pending events, retained event/Showing List references,
and all manual records. Emit only aggregate counts and make execution safe to
repeat.

## Phase 8: AWS Dispatch And Disabled Weekly Schedule

Add stage-isolated asynchronous dispatch from the API to the existing Fargate
worker through an opaque run wake-up message. The database run ledger remains
the source of truth; the message contains no criteria, address, provider data,
credential, or Telegram content.

Grant the API only the minimum stage-scoped dispatch permission. It must not
receive the RentCast or Telegram secret values. Transactional run claiming
prevents concurrent/duplicate publication after at-least-once delivery.

Change the property-alert expression to Monday 08:00 in
`America/Los_Angeles`, disable flexible windows and complete-run Scheduler
retries, and preserve the physical schedule name for the first update. Keep:

```text
scheduleEnabled=false
```

for DEV, Production defaults, synth, deployment workflows, and rollout. Add a
test that fails if the schedule is synthesized as enabled. Do not change the
Showing List enabled state; document its required future offset.

## Phase 9: Verification And Rollout

Complete the gates in
[the acceptance runbook](../runbooks/listing-refresh-lifecycle-acceptance.md):

1. focused pure tests
2. complete test/type/build gate
3. disposable migration and lifecycle acceptance
4. fake-dispatch API/browser acceptance
5. retention preview/execute acceptance
6. CDK synthesis proving disabled Monday schedule
7. security, quota, failure, concurrency, and rollback review

Only after source acceptance may the owner separately authorize an account-
backed diff, deployment with schedules disabled, disposable/local live smoke,
or one exact-budget provider request. Schedule enablement is outside this
feature rollout.

## Planned Change Areas

Expected areas, subject to discovery during implementation:

- `packages/domain`: lifecycle and validation
- `packages/application`: refresh/run/membership/retention use cases and ports
- `packages/postgres`: migration, repositories, queries, transactional publish
- `packages/rentcast`: unchanged provider contract unless explicit sold-state
  evidence is separately approved
- `apps/alert-worker`: run claim, refresh reconciliation, cleanup composition
- `apps/api`: criteria/run/current/history/retry DTO and protected routes
- `apps/web`: saved/applied status and current/history UI
- `infra/aws`: asynchronous dispatch, least-privilege IAM, disabled weekly
  expression, retry policy
- `tests`: fixture, integration, API, browser, quota, infrastructure, and
  rollback coverage

## References

- [ADR 0019](../adr/0019-criteria-triggered-listing-refresh-and-lifecycle.md)
- [Acceptance runbook](../runbooks/listing-refresh-lifecycle-acceptance.md)
- [ADR 0009](../adr/0009-persisted-listing-search-criteria.md)
- [ADR 0014](../adr/0014-direct-market-rentcast-acquisition.md)
