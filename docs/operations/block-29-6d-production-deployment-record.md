# Block 29.6d Production Deployment Record

## Status

- Date prepared: 2026-08-31
- Preparation branch: `feature/block-29-6d-production-deploy-record`
- Exact deployable `main` SHA:
  `4c5e6e07ef3a0341814eb9815f6d4ac5d7f9beb3`
- Reviewed plan run: `33410204420`
- Reviewed approval digest:
  `41d571584df3f3fb9038b98cd019597ce8eca0243574f5a589a5358610af196f`
- Deployment authorization: granted for the exact inputs recorded below
- Production API migration authorization: granted for the bundled startup path
- Production deployment: successful in `Deploy production` run `33419336461`
- Production data access: not performed
- Public application URL: `https://d1ayoi79dg623p.cloudfront.net`

This document is the bounded execution record for the first controlled
production public launch. The deployment authorization applied only to the
exact SHA, approval digest, four named stacks, bundled API startup migration,
immutable Web publication, and safe unauthenticated smoke recorded here. It did
not authorize production data inspection, authenticated access, administrator
creation, worker execution, provider calls, or schedule enablement.

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

| Evidence | Recorded value |
| --- | --- |
| Deployment run ID and URL | [`33419336461`](https://github.com/Shaobangzhu/chaoran-property-intelligence/actions/runs/33419336461), successful in 17m 44s |
| Environment approval event | Repository owner approved the protected `production` environment for the exact SHA, reviewed digest, migration boundary, and disabled schedules |
| Recomputed approval digest | `41d571584df3f3fb9038b98cd019597ce8eca0243574f5a589a5358610af196f`; matched the reviewed plan |
| AWS account verification | Matched the bounded repository `AWS_ACCOUNT_ID`; full account identity omitted |
| Four explicit stack results | Guardrails: no changes; production foundation: update complete; edge/WAF: create complete; public application: create complete |
| Production `ApplicationUrl` | `https://d1ayoi79dg623p.cloudfront.net` |
| Web and API release SHA/stage | Both smoke targets matched `4c5e6e07ef3a0341814eb9815f6d4ac5d7f9beb3` and `production` |
| App Runner readiness | `cpi-api` recorded as `RUNNING`; bounded `/api/health` readiness passed |
| CloudFront invalidation | Immutable Web sync, no-store `release.json`, invalidation creation, and bounded invalidation wait passed |
| Safe production smoke | Passed public UI, security-header, health/release identity, and unauthenticated protected-route checks without worker or provider behavior |
| Both schedules disabled after deploy | Deploy and synth contexts forced both values to `false`; the reviewed templates declared `DISABLED`, and both CloudFormation schedule operations completed successfully |
| Deployment evidence artifact and digest | `production-diagnostics-33419336461-1`; SHA-256 `c73a50a137c5f1051474d3f02d2a8714f3d7a6977a21873aea43c412889587f6` |
| Recomputed plan artifact and digest | `production-plan-33419336461-1`; SHA-256 `1ce86b71ce2e1b6eacb66101d463a42ac130d933f6735d0f7da0ca5b449fb1c3` |
| SNS subscription state | Subscription resource reached `CREATE_COMPLETE`; endpoint confirmation was not independently read back and no recipient address is recorded |

The downloaded diagnostics ZIP matched its GitHub artifact digest. Its bounded
evidence recorded the exact run/SHA/digest linkage, App Runner `RUNNING` state,
CDK outputs, versioned Web objects, Playwright results, and Allure report. The
run reported 1,290 passed, zero failed, zero broken, three skipped, and 21
retries across 1,293 Allure results. The retries include the repository's
multi-stage local and remote reporting behavior and did not produce a failed
production smoke result.

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

Block 29.6 production deployment is complete. The exact approved digest was
reproduced, all four explicit stacks finished, the disabled-schedule contract
was retained, Web publication and bounded readiness completed, Web and API
exposed the exact production release identity, safe smoke passed, and the
private deployment evidence artifact was reviewed. Block 29.8 operational
handoff may begin; optional Block 29.7 custom-domain work remains separate.

## Remaining Risks

- A separate live `get-schedule` readback was not captured in the workflow
  artifact. The disabled state is supported by the immutable deployment
  contexts, synthesized templates, and successful CloudFormation schedule
  operations. Add an explicit post-deploy readback before any future schedule
  policy change.
- The SNS subscription resource was created, but recipient confirmation was
  not independently verified in this phase.
- No production application user was created and no authenticated production
  acceptance was performed. Either operation requires separate authorization.
- The pinned GitHub actions emit a Node.js 20 deprecation warning while GitHub
  currently forces them onto Node.js 24; the run remained successful.

## References

- [Block 29.6 production plan](block-29-6-production-plan.md)
- [Block 29 launch runbook](../runbooks/block-29-aws-public-launch.md)
- [Release and production delivery runbook](../runbooks/release-production-delivery.md)
- [ADR 0017](../adr/0017-aws-public-launch-and-operational-readiness.md)
