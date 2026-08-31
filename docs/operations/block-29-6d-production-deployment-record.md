# Block 29.6d Production Deployment Record

## Status

- Date prepared: 2026-08-31
- Preparation branch: `feature/block-29-6d-production-deploy-record`
- Exact deployable `main` SHA:
  `4c5e6e07ef3a0341814eb9815f6d4ac5d7f9beb3`
- Reviewed plan run: `33410204420`
- Reviewed approval digest:
  `41d571584df3f3fb9038b98cd019597ce8eca0243574f5a589a5358610af196f`
- Deployment authorization: pending
- Production API migration authorization: pending
- Production deployment: not dispatched
- Production data access: not performed
- Promotion constraint: keep this documentation branch unmerged until the
  digest-bound deployment finishes or the plan is intentionally replaced

This document is an execution record and stop checklist. Preparing or merging
it does not authorize `Deploy production`, a CloudFormation mutation, API
startup migration, S3 publication, CloudFront invalidation, authenticated
request, worker execution, provider request, notification, or schedule change.

Do not merge this branch into `main` before using the reviewed plan. Any merge
would change the current `main` SHA, while the approval digest is bound to
`4c5e6e07ef3a0341814eb9815f6d4ac5d7f9beb3`. If `main` changes first, discard
this approval digest and create and review a new account-backed plan.

## Immutable Plan Linkage

The deploy candidate is bound to the successful account-backed production
plan below:

| Evidence | Reviewed value |
| --- | --- |
| Exact commit | `4c5e6e07ef3a0341814eb9815f6d4ac5d7f9beb3` |
| Plan run | [`33410204420`](https://github.com/Shaobangzhu/chaoran-property-intelligence/actions/runs/33410204420) |
| Plan artifact | `production-plan-33410204420-1` |
| Artifact SHA-256 | `4e66304a94f685676a63c48fae3e10e90f828580eb5869e35391bf2291e9557b` |
| CDK diff SHA-256 | `2063c0958f64a095a4f8f3523eda69ead64384f363ce5b053b5776f627f0cc54` |
| Approval digest | `41d571584df3f3fb9038b98cd019597ce8eca0243574f5a589a5358610af196f` |
| Diff classification | `CREATE 41 / UPDATE 2 / REPLACE 1 / DELETE 0` |
| Guardrails | No differences |
| Schedule contexts | Property-alert and showing-list schedules both `false` |

The plan's one replacement is an expected stateless ECS task-definition
revision. It does not replace Aurora, the database secret, VPC, retained
buckets, retained API-auth secrets, OIDC provider, or deployment role.

## Required Fresh Authorization

Do not dispatch the deployment until the repository owner explicitly
authorizes all of these exact inputs in one decision:

```text
exact main SHA=4c5e6e07ef3a0341814eb9815f6d4ac5d7f9beb3
operation=deploy
confirmation=deploy-production
approved_plan_digest=41d571584df3f3fb9038b98cd019597ce8eca0243574f5a589a5358610af196f
migration_confirmation=authorize-production-api-migration
```

Immediately before dispatch, confirm that `main` still resolves to the exact
SHA, the `production` environment still requires review and disallows
administrator bypass, only `main` may deploy, and the OIDC role still trusts
only the exact `environment:production` subject. Any source or AWS-state drift
must produce a new plan and digest.

## Reviewed Mutation Boundary

The authorized workflow may name only these four stacks and must keep
deployment concurrency at one:

- `ChaoranPropertyIntelligenceGuardrails`
- `ChaoranPropertyIntelligenceProduction`
- `ChaoranPropertyIntelligenceProductionEdge`
- `ChaoranPropertyIntelligenceProductionPublicApplication`

Both worker schedules must remain disabled. The API starts by applying the
seven bundled, idempotently tracked PostgreSQL migrations before listening.
Migration authorization permits only that startup path; it does not authorize
manual SQL, production row inspection, seed data, an administrator creation,
or a worker run.

## Execution Evidence

Complete this section only after a separately authorized deployment run.

| Evidence | Recorded value |
| --- | --- |
| Deployment run ID and URL | Pending |
| Environment approval event | Pending |
| Recomputed approval digest | Pending; must equal the reviewed digest |
| AWS account verification | Pending; bounded result only |
| Four explicit stack results | Pending |
| Production `ApplicationUrl` | Pending |
| Web and API release SHA/stage | Pending |
| App Runner readiness | Pending |
| CloudFront invalidation | Pending |
| Safe production smoke | Pending |
| Both schedules disabled after deploy | Pending |
| Deployment evidence artifact and digest | Pending |
| SNS subscription state | Pending; never record the recipient address |

## Safe Smoke Boundary

Production smoke may verify only the public sign-in page, response security
headers, database-independent `/api/health`, exact `/api/release` and
`/release.json` identity, and unauthenticated protected-route rejection. It
must not sign in, query listings with a session, mutate data, create an
administrator, run a worker, invoke RentCast or OpenAI, send Telegram, or
publish a test notification.

## Stop And Recovery Conditions

Stop without bypassing controls when the recomputed digest differs, any delete
appears, a state-bearing replacement appears, either schedule is enabled, the
target account differs, an unlisted stack is present, or the environment/OIDC
boundary has drifted.

Do not automatically roll back infrastructure or schema. For a Web-only
failure, retain evidence and prepare restoration of reviewed S3 object
versions plus a CloudFront invalidation. For an API image failure, prepare a
new digest-bound plan restoring the previous immutable image. For a migration
failure, stop promotion and prepare a separately reviewed forward fix or
database recovery operation; application rollback does not reverse schema.

## Preparation Verification

- Downloaded plan artifact SHA-256 matched the GitHub Actions artifact digest.
- Raw `approval.json`, CDK diff, and classified summary matched the successful
  run and the values recorded above.
- Full Vitest: 135 files, 1,307 tests passed.
- Full TypeScript typecheck: passed.
- Production runtime, Web, and AWS CDK build: passed.
- Offline synthesis of the four explicit production stacks: passed using the
  exact planned release SHA.
- Synthesized `DailySchedule68BF5767`: `DISABLED`.
- Synthesized `WeeklyShowingListScheduleAE80C2CD`: `DISABLED`.
- `git diff --check`: passed.

The Web build retains its existing ArcGIS-heavy large-chunk warning. It is
non-blocking and unrelated to the deployment evidence change.

## Completion Criteria

Block 29.6 production deployment is complete only when the exact approved
digest is reproduced, all four explicit stacks finish, both schedules remain
disabled, Web publication and bounded readiness complete, Web and API expose
the exact production release identity, safe smoke passes, and the private
deployment evidence artifact is reviewed. Until then this record remains
`Pending` and Block 29.8 handoff must not begin.

## References

- [Block 29.6 production plan](block-29-6-production-plan.md)
- [Block 29 launch runbook](../runbooks/block-29-aws-public-launch.md)
- [Release and production delivery runbook](../runbooks/release-production-delivery.md)
- [ADR 0017](../adr/0017-aws-public-launch-and-operational-readiness.md)
