# Weekly Showing List Production Runbook

## Purpose

This procedure deploys and verifies the Block 18.8 weekly Showing List task
without enabling recurring execution until a separate approval gate. It can
call PostgreSQL, OpenAI, S3, and Telegram and can replace the current production
draft, so it is never part of an ordinary local test or CI run.

## Required Configuration

Keep both schedules disabled while preparing `.env.local`. The application
Secret sync requires these five non-empty values:

```text
RENTCAST_API_KEY
OPENAI_API_KEY
SHOWING_LIST_GENERATION_CONFIG
TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID
```

`SHOWING_LIST_GENERATION_CONFIG` is one JSON document with this exact shape.
Use UUIDs already present in the production database. Do not commit the
document or paste its contents into logs, issues, or chat.

```json
{
  "actorUserId": "00000000-0000-4000-8000-000000000000",
  "request": {
    "listingIds": ["00000000-0000-4000-8000-000000000000"],
    "preferences": {
      "clientDisplayName": null,
      "showingDate": null,
      "agentInstructions": null
    }
  }
}
```

The checked-in default is Monday at 08:00 in `America/Los_Angeles`, with a
900-second URL lifetime. Deployment must still supply weekday, hour, minute,
time zone, and enabled state explicitly.

## Local Gate

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build
pnpm aws:synth
git diff --check
```

Validate the five local values without contacting AWS:

```bash
pnpm --dir infra/aws application-secret
```

Acquire SSO credentials and verify the unhyphenated 12-digit account and
`us-west-2` region. Review `cdk diff` with both schedules disabled and all
weekly schedule values explicit. The diff must add the separate Showing List
task definition, log group, DLQ, Scheduler, stable-object IAM policy, and
expanded Secret references without enabling or changing
`cpi-daily-property-alert`.

## Deployment And Secret Gate

Deployment and Secret synchronization each require explicit approval. Deploy
with these contexts while the weekly schedule remains disabled:

```text
-c scheduleEnabled=false
-c showingListScheduleEnabled=false
-c showingListScheduleWeekday=MON
-c showingListScheduleHour=8
-c showingListScheduleMinute=0
-c showingListScheduleTimeZone=America/Los_Angeles
```

After the reviewed stack deployment, synchronize the five-key Secret using the
file-backed helper:

```bash
pnpm --dir infra/aws application-secret -- --apply
```

Do not read or print the Secret values. Verify key names only.

## One-Time Production Smoke

Before recurring enablement, run exactly one manually approved task from the
Showing List task definition. Do not override the daily task definition. The
container command is:

```text
timeout --signal=TERM 15m node apps/alert-worker/dist/index.js --run-showing-list
```

Require all of the following:

1. Migration 005 and prior migrations complete successfully.
2. The task exits 0 with only `Weekly Showing List run completed.` in its
   application output.
3. S3 contains only `showing-lists/current.pdf`, with bucket versioning still
   disabled.
4. PostgreSQL contains one `current_showing_list_draft` row for the task's
   generation and `delivery_status = 'sent'`.
5. Telegram receives one unreviewed-draft message and its HTTPS link downloads
   the current PDF before expiry.
6. Neither log stream contains the presigned URL, artifact body, client text,
   credentials, or provider response body.
7. Both Scheduler resources remain disabled and no ECS task remains running.

A same-week recovery with unchanged configuration must reuse the existing
generation. It must not call OpenAI, render, or replace S3 again. Do not repeat
a task after a Telegram timeout without accepting the documented possibility
of one duplicate message.

## Recurring Enablement

Recurring execution is a separate production change. Review a fresh CDK diff,
confirm the exact local weekday, time, and time zone, confirm the monthly budget
and failure alerts, and obtain explicit approval before changing only
`showingListScheduleEnabled` to `true`. Keep `scheduleEnabled=false` unless the
daily RentCast workflow is independently approved.

After deployment, verify:

- `cpi-weekly-showing-list` is `ENABLED`
- `cpi-daily-property-alert` retains its separately approved state
- the next invocation time is correct in `America/Los_Angeles`
- the weekly DLQ is empty
- the final CDK diff is clean

## Rollback

Disable `cpi-weekly-showing-list` first. A failed generation or publication
preserves the previous current draft. A failed Telegram delivery preserves the
new draft with `failed` state. Do not delete the current S3 object or database
row during operational rollback; investigate the bounded CloudWatch error and
rerun only after the failure mode and duplicate-delivery risk are understood.
