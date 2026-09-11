# ADR 0019: Criteria-Triggered Listing Refresh And Lifecycle

## Status

Proposed for documentation and implementation on
`feat/search-criteria-refresh-lifecycle`.

This decision does not authorize a RentCast request, Telegram delivery,
database migration, AWS deployment, schedule enablement, or mutation of an
existing DEV or Production resource. Both AWS business schedules remain
disabled throughout source implementation and deployment planning.

## Context

The current `Search Criteria` save path persists a validated primary profile
and advances its administrator revision. It does not start provider
acquisition. A later alert-worker execution reads the profile, performs one
RentCast request per selected market, silently baselines an unapplied revision,
and advances `applied_revision` only with the committed baseline.

The current `Listings` read path is independent from the saved criteria. It
returns every unarchived row in `listings`, so provider snapshots accumulated
under older criteria remain visible. Provider rows are upserted by stable
deduplication key rather than copied once per run, but listings from successive
market inventories accumulate without a lifecycle or retention boundary.

An Active-only RentCast search cannot prove why a previously returned listing
is absent. It may have sold, moved to another provider status, been temporarily
removed, changed identity, fallen outside edited criteria, or been omitted by
an unsuccessful/incomplete acquisition. Absence must not be represented as a
confirmed sale.

The current direct-market design also makes provider cost proportional to the
selected market count. One refresh uses one request for Irvine alone and seven
sequential requests for all supported markets. Criteria-triggered refreshes and
recurring reconciliation therefore need one shared request budget and explicit
run evidence.

## Decision

### Save configuration, then refresh asynchronously

A changed criteria save commits the new profile revision and one durable
refresh run request. An unchanged save creates no run. The HTTP request does
not wait for RentCast, database reconciliation, or Telegram delivery.

The response exposes the saved revision and bounded refresh state so the
browser can distinguish `queued`, `running`, `succeeded`, and `failed`. A
failed dispatch does not roll back an already committed criteria edit; its
durable queued/failed run remains visible and explicitly retryable.

Use the database run record as the source of truth and pass only its opaque ID
through the asynchronous dispatch boundary. AWS dispatch is stage-scoped and
uses a queue-to-Fargate path; provider credentials remain in the worker task,
never in React or the API response. Delivery is at-least-once, so the worker
must claim a run transactionally and make persistence idempotent.

Use latest-wins coalescing for criteria-triggered work. If revision 6 is queued
and revision 7 is saved before provider access starts, revision 6 is marked
superseded and only revision 7 is acquired. A trigger represents one complete
refresh attempt, not one HTTP request: request count equals selected market
count. Concurrent runs for the primary profile are prohibited.

### Publish only a complete successful inventory

Retain the existing sequential per-market completeness gate. A timeout,
provider error, invalid row, response-cap overflow, conflicting canonical
address, database failure, or missing selected market fails the entire run.
Failure creates no partial membership publication, does not increment absence
counters, does not advance `applied_revision`, and leaves the last successful
Listings view intact.

The first successful run for a changed revision remains a quiet baseline. It
must not emit new-listing alerts for inventory that already existed when the
criteria were widened. Existing durable pending alert events remain eligible
for their normal delivery path.

### Separate listing identity from search membership

Keep `listings` as the latest canonical provider/manual record. Add a
revision-aware search-membership model rather than overloading the manual-only
`archived_at` field.

Add a durable run ledger with, at minimum:

- run ID, primary profile key, requested/effective revision, and trigger reason
- `queued`, `running`, `succeeded`, `failed`, or `superseded` status
- request, start, and completion timestamps
- selected-market count, provider-request count, returned count, and published
  current count
- a bounded safe error code with no address, credential, request URL, or raw
  provider body

Add search membership with, at minimum:

- profile key and listing ID
- applied criteria revision and last successful run ID
- first matched, last matched, and server-observed timestamps
- lifecycle state and consecutive complete-run absence count

The default Listings response is the current membership for the last
successfully applied criteria revision, not a dynamic SQL re-evaluation of all
historical rows. Alert observation may continue tracking a previously eligible
listing below the minimum-price floor without forcing that record into the
default full-criteria result. Historical and tracked-below-floor records remain
available through explicit views rather than silently mixing with current
results.

Existing provider rows cannot be truthfully backfilled as current when their
applied historical criteria are unknown. Migration keeps them as historical
records. The first complete successful refresh establishes authoritative
current membership.

### Use conservative lifecycle states

Use these meanings:

- `current`: returned by the latest complete refresh and eligible for the
  current result view
- `out_of_scope`: retained history that no longer matches the newly applied
  criteria
- `missing`: previously current and in the same applied scope, but absent from
  one complete successful refresh
- `inactive`: absent from two consecutive complete successful refreshes, with
  at least one recurring reconciliation interval between observations
- `sold`: reserved for explicit, validated provider evidence of a sold/closed
  state; never inferred from Active-search absence

Criteria edits do not apply lifecycle changes until the new revision publishes
successfully. A narrowed revision moves excluded prior membership to
`out_of_scope`; it does not increment absence counts or imply sale. Provider
`lastSeenDate` is retained as evidence but is not, by itself, authoritative
sale confirmation.

### Combine on-save refresh with weekly reconciliation

Criteria save requests an immediate asynchronous refresh. Recurring
reconciliation is still required because a profile may remain unchanged while
market inventory changes.

Change the planned property-alert cadence from daily to every Monday at
08:00 in `America/Los_Angeles`, with no flexible window. Preserve
`scheduleEnabled=false` as the source, DEV, deployment-workflow, and rollout
default. This ADR does not authorize enabling it.

Preserve the existing physical schedule name during the initial infrastructure
update to avoid an unnecessary replacement; its semantic rename can be a
separately reviewed migration. The Weekly Showing List schedule must not share
the same enabled execution time. Before either schedule is enabled, move the
Showing List start to at least 30 minutes after listing reconciliation or prove
another explicit dependency mechanism.

Do not automatically replay a complete multi-market provider run through
Scheduler retries. Record failure and require an explicit retry until
per-market resume semantics and quota accounting exist. Queue redelivery and
worker crashes remain protected by transactional run claiming and bounded
manual recovery.

### Bound operational retention

Use configurable defaults with batch cleanup and a dry-run report:

- search-run detail: 90 days
- `out_of_scope` and `inactive` membership: 90 days
- unreferenced RentCast listing rows: eligible for deletion 180 days after the
  last server observation
- immutable alert-event history: 365 days
- manual listings: never automatically delete; retain the existing explicit
  archive workflow

Do not delete a listing still referenced by current membership, price
observation, a pending alert, retained alert history, or the current Showing
List draft. If retained evidence needs the identity after payload expiration,
keep a minimal tombstone rather than breaking referential integrity.

Cleanup runs monthly, independently from provider acquisition, and performs no
RentCast or Telegram call. It deletes in bounded batches, emits aggregate
counts only, and leaves PostgreSQL autovacuum to reclaim reusable space.

## API And Browser Contract

The Search Criteria workspace reports both saved and applied state:

- `Saved revision N; refresh queued`
- `Refreshing revision N`
- `Showing revision N from <time>`
- `Revision N refresh failed; showing revision N-1`

The Listings workspace defaults to `Current`. It provides explicit
`Historical` and lifecycle filters, shows the last successful refresh, and
does not replace current content with a loading failure from a newer run.

An administrator may explicitly retry the latest failed run. Retry is not an
implicit second provider attempt, and the UI must display the planned selected-
market request count before dispatch.

## Security, Cost, And Observability

- Keep the RentCast key and provider URLs server-side.
- Apply administrator authentication, Origin protection, body limits, and a
  bounded save/refresh rate limit.
- Never log raw criteria bodies, addresses, provider rows, tokens, secrets, or
  Telegram payloads.
- Record planned and actual provider-request counts per run.
- Reject a run before provider access when the stage request budget is
  exhausted or its selected-market count is unsupported.
- Keep DEV and Production queues, tasks, databases, roles, metrics, and failure
  notifications isolated.
- A source deployment must prove both recurring schedules remain disabled
  before and after deployment.

## Consequences

Positive:

- saved criteria produce a prompt, observable refresh without coupling the
  browser request to provider latency
- the default Listings view represents one complete applied inventory
- historical records no longer masquerade as current search results
- ambiguous absence is handled conservatively instead of being labeled sold
- upsert, lifecycle, and retention controls bound long-term PostgreSQL growth
- weekly reconciliation materially reduces provider use relative to the
  currently defined daily cadence

Trade-offs:

- asynchronous dispatch, run status, membership, and cleanup add schema and
  operational complexity
- a listing may remain `missing` until the following successful weekly run
- exactly-once external provider access cannot be guaranteed across process
  crashes; the design guarantees idempotent publication and explicit attempt
  accounting instead
- the 50-request planning reference can still be exceeded by frequent criteria
  saves, broad market selection, audits, or manual retries
- existing historical rows do not become authoritative current membership
  until a complete refresh succeeds

## Rejected Alternatives

### Call RentCast synchronously inside criteria PUT

Rejected because provider latency, multi-market fan-out, and failure would make
configuration persistence unreliable and encourage duplicate user retries.

### Replace or delete all listings after every refresh

Rejected because absence is ambiguous, partial acquisition must fail closed,
and alert/Showing List history may still reference prior records.

### Treat all saved rows as a cache and re-filter them in React

Rejected because stale stored rows do not prove current provider availability,
and browser filtering cannot establish complete market acquisition.

### Run only when criteria change

Rejected because unchanged criteria would never observe later price, status, or
availability changes.

### Keep the daily recurring schedule

Rejected because current product freshness does not justify daily multi-market
provider cost. Weekly reconciliation plus an on-save refresh provides the
accepted balance, while schedule enablement remains a separate decision.

## Implementation Sequence

1. Add Domain/Application run and lifecycle contracts with fixture-only tests.
2. Add additive PostgreSQL migrations for the run ledger and membership.
3. Make changed criteria saves transactionally create one durable run request.
4. Extend the worker with run claiming, latest-wins coalescing, complete
   publication, quiet revision baseline, and lifecycle reconciliation.
5. Add protected run-status/current/history API contracts and React states.
6. Add retention planning, dry-run inspection, and bounded monthly cleanup.
7. Add the stage-isolated asynchronous AWS dispatch path.
8. Change the disabled property-alert expression to Monday 08:00 Pacific,
   remove automatic Scheduler replay, and prove disabled synth/deploy defaults.
9. Complete offline, disposable-database, local browser, quota, infrastructure,
   and rollback acceptance before any live provider or AWS mutation.

## References

- [ADR 0008: Price-Drop Alert State And Outbox](0008-price-drop-alert-state-and-outbox.md)
- [ADR 0009: Persisted Listing Search Criteria](0009-persisted-listing-search-criteria.md)
- [ADR 0014: Direct Market RentCast Acquisition](0014-direct-market-rentcast-acquisition.md)
- [AWS system design](../aws-system-design.md)
- [Implementation plan](../listing-refresh/implementation-plan.md)
- [Listing refresh lifecycle acceptance](../runbooks/listing-refresh-lifecycle-acceptance.md)
