# Telegram Production Smoke-Test Runbook

## Purpose

This Block 14.1 procedure verifies that the deployed ECS worker can use the
production bot token and chat ID to deliver one Telegram message. It is
independent from listing detection and notification state transitions.

## Safety Boundary

The EventBridge Scheduler must remain `DISABLED`. Run exactly one manually
approved Fargate task and override its command to `--telegram-smoke-test`.

The smoke-test mode:

- loads only `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`
- sends exactly one fixed message through Telegram `sendMessage`
- does not load PostgreSQL configuration or connect to Aurora
- does not load the RentCast API key or call RentCast
- does not read or write listings, markers, or notification states
- never prints credentials, the chat ID, or Telegram response content

The fixed message is:

```text
CPI production smoke test
Telegram delivery is working.
No listing data was used.
```

## Local Gate

Require all of the following before deployment:

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm aws:synth
git diff --check
```

Review `cdk diff` with `scheduleEnabled=false`. Only the worker image and ECS
task-definition reference may change. Stop if the diff changes the database,
networking, Secrets, Scheduler state, or guardrail resources.

## Production Execution

1. Verify the `cpi-admin` SSO identity and `us-west-2` Region.
2. Verify `cpi-daily-property-alert` is `DISABLED`.
3. Verify no ECS tasks are pending or running in the production cluster.
4. Deploy the reviewed image with `scheduleEnabled=false`.
5. Run one Fargate task using the current production task definition and
   network configuration, overriding only the container command to:

```text
timeout --signal=TERM 15m node apps/alert-worker/dist/index.js --telegram-smoke-test
```

6. Wait for the task to stop and require container exit code 0.
7. Require CloudWatch to contain exactly:

```text
Telegram production smoke test completed.
```

8. Ask the operator to confirm receipt of the fixed message in the intended
   Telegram chat.
9. Verify there are no running ECS tasks and the Scheduler remains `DISABLED`.
10. Run `cdk diff` and require no remaining differences.

Any non-zero exit, failure email, unexpected message content, missing delivery,
or additional Telegram message ends the procedure. Do not retry without a new
inspection and explicit approval.

## Execution Record

AWS execution completed on 2026-08-20:

| Evidence | Result |
| --- | --- |
| ECS task ID | `fe15eaf19b8a4dee801d3d97156f8f07` |
| Task definition revision | 7 |
| Container exit code | 0 |
| CloudWatch | `Telegram production smoke test completed.` |
| Running ECS tasks afterward | 0 |
| Scheduler afterward | `DISABLED` |
| Final CDK diff | Guardrails and Production stacks: no differences |
| Operator receipt confirmation | Confirmed: exactly one expected three-line message received |

No credentials or chat ID are recorded. All Block 14.1 completion checks passed
on 2026-08-20.

## References

- [AWS system design and configuration](../aws-system-design.md)
- [AWS deployment runbook](aws-deployment.md)
- [Production baseline runbook](production-baseline.md)
- [Project roadmap](../roadmap.md)
