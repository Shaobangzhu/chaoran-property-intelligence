# Listing Retention

## Purpose

This runbook operates the database-only cleanup introduced by ADR 0019. The
composition opens PostgreSQL and does not construct RentCast, Telegram,
OpenAI, or S3 clients. It does not run migrations and it does not change or
enable any AWS schedule.

The default policy retains search-run detail for 90 days, inactive and
out-of-scope membership for 90 days, unreferenced RentCast listings for 180
days after their last server-backed update, and sent alert events for 365 days.
Manual listings are never cleanup candidates.

## Safety Boundary

- Preview first and retain its exact `As of` timestamp and four candidate
  counts.
- Execute only with that timestamp and those counts. Execution fails closed if
  the aggregate candidate batch has changed.
- Output contains aggregate counts only. It does not contain listing IDs,
  addresses, provider payloads, event identities, or credentials.
- Each invocation handles at most 500 candidates by default, in deterministic
  oldest-first order. Repeat preview and execute while `More eligible rows` is
  `yes`.
- Cleanup preserves current/missing membership, observations, pending or
  retained events, current Showing List references, and all manual listings.
- PostgreSQL deletion makes space reusable through autovacuum; it does not
  promise an immediate reduction in allocated storage.

## Preview

Confirm the target database independently, then run:

```bash
pnpm listing-retention:preview
```

Preview is read-only. Retain the displayed ISO timestamp and aggregate counts
for a separately reviewed execution.

## Execute One Approved Batch

Replace every placeholder with the exact preview output:

```bash
pnpm listing-retention:execute -- \
  --as-of=<ISO timestamp> \
  --expected-search-runs=<count> \
  --expected-search-memberships=<count> \
  --expected-provider-listings=<count> \
  --expected-alert-events=<count>
```

The execute path reselects the batch inside its deletion transaction and
rejects changed aggregate counts. Protected rows are rechecked again in each
DELETE statement so a concurrent lifecycle/reference change prevents unsafe
deletion.

## Optional Policy Configuration

Use positive whole numbers only. Day values are capped at 3,650 and batch size
at 1,000.

| Variable | Default |
| --- | ---: |
| `LISTING_RETENTION_RUN_DETAIL_DAYS` | 90 |
| `LISTING_RETENTION_INACTIVE_MEMBERSHIP_DAYS` | 90 |
| `LISTING_RETENTION_OUT_OF_SCOPE_MEMBERSHIP_DAYS` | 90 |
| `LISTING_RETENTION_PROVIDER_LISTING_DAYS` | 180 |
| `LISTING_RETENTION_ALERT_EVENT_DAYS` | 365 |
| `LISTING_RETENTION_BATCH_SIZE` | 500 |

The same policy environment must be used for preview and execute.

## Scheduling State

ADR 0019 targets this cleanup monthly and independently of provider
acquisition. Step 7 supplies only the database operation. AWS dispatch and
scheduling remain out of scope here, and the existing AWS schedules remain
disabled.
