# Block 29.6 Production Plan

## Status

- Date prepared: 2026-08-31
- Date reviewed: 2026-08-31
- Preparation branch: `feature/block-29-6c-production-plan`
- Preparation base: `3a94a3f`
- Plan run: `33410204420` (`Deploy production` run `#1`)
- Exact `main` SHA: `4c5e6e07ef3a0341814eb9815f6d4ac5d7f9beb3`
- Plan result: successful and reviewed from the downloaded artifact
- AWS access: temporary OIDC credentials used for account verification and
  read-only deployed-state comparison
- AWS mutation: not performed
- Production deployment or migration: not authorized and not performed

Historical scope note: the statements above describe plan run `33410204420`.
A separately authorized digest-bound deployment later completed successfully
in run [`33419336461`](https://github.com/Shaobangzhu/chaoran-property-intelligence/actions/runs/33419336461).
See the Block 29.6d execution record for the mutation and smoke evidence.

This record prepares the first account-backed production plan. It does not
authorize a production deployment, API startup migration, static web
publication, CloudFront invalidation, authenticated request, production data
access, worker execution, provider request, notification, or schedule change.

## Decision

The first production operation is a plan-only manual dispatch of the existing
`Deploy production` workflow from an exact `main` SHA. The run may enter the
protected GitHub `production` environment, obtain temporary OIDC credentials,
verify the target AWS account, synthesize the production application, and read
deployed state through an account-backed template-method CDK diff.

The plan must stop after producing its classified diff and immutable approval
digest. Every stack deployment, web publication, invalidation, remote
production smoke test, migration startup, and failure notification remains
guarded by `operation=deploy` and is outside this phase.

## Promotion Prerequisites

Before dispatch:

1. Merge this preparation through the protected `dev` branch.
2. Open a same-repository `dev -> main` pull request.
3. Require the Release Quality Gate against AWS DEV and main CI to pass.
4. Record the resulting 40-character `main` SHA below.
5. Confirm the `production` environment still requires the repository owner,
   disallows administrator bypass, and permits only exact branch `main`.
6. Confirm `cpi-github-deploy` trusts only the exact
   `environment:production` OIDC subject.
7. Obtain explicit authorization for a plan-only run against that exact SHA.

The dispatch inputs are exactly:

```text
operation=plan
confirmation=plan-production
approved_plan_digest=<empty>
migration_confirmation=<empty>
```

Do not use `operation=deploy` to test environment or OIDC configuration.

## Plan-Only Contract

The reviewed source contract requires all of the following:

- manual `workflow_dispatch` only;
- exact `refs/heads/main` execution and `${{ github.sha }}` checkout;
- protected GitHub environment `production`;
- temporary GitHub OIDC credentials and exact AWS account verification;
- complete deterministic tests, local smoke, typecheck, build, and production
  synthesis before the account-backed diff;
- four explicit stack names, never `--all`;
- `scheduleEnabled=false` and `showingListScheduleEnabled=false`;
- CDK diff `--method template`, avoiding a deploy-time change set;
- explicit `CREATE`, `UPDATE`, `REPLACE`, and `DELETE` classification;
- automatic failure when any `DELETE` is detected;
- SHA-256 approval digest bound to exact commit, normalized diff, and
  `production` stage;
- 90-day plan artifact retention;
- no CDK deploy, S3 write, CloudFront invalidation, SNS publish, migration, or
  remote production request during `operation=plan`.

## Exact Plan Evidence

Complete this section only from the successful GitHub Actions run and its
downloaded artifact. Do not use a screenshot or copied summary as the approval
token.

| Evidence | Recorded value |
| --- | --- |
| Exact `main` SHA | `4c5e6e07ef3a0341814eb9815f6d4ac5d7f9beb3` |
| Workflow run ID and URL | [`33410204420`](https://github.com/Shaobangzhu/chaoran-property-intelligence/actions/runs/33410204420) |
| AWS account verified | Matched the bounded repository `AWS_ACCOUNT_ID`; full account identity omitted |
| Plan artifact name | `production-plan-33410204420-1` |
| Plan artifact SHA-256 | `4e66304a94f685676a63c48fae3e10e90f828580eb5869e35391bf2291e9557b` |
| `approval.json` commit | `4c5e6e07ef3a0341814eb9815f6d4ac5d7f9beb3` |
| `approval.json` stage | `production` |
| CDK diff SHA-256 | `2063c0958f64a095a4f8f3523eda69ead64384f363ce5b053b5776f627f0cc54` |
| 64-character approval digest | `41d571584df3f3fb9038b98cd019597ce8eca0243574f5a589a5358610af196f` |
| Both schedules disabled | Confirmed by the exact workflow contexts and production synthesis contract |

The downloaded ZIP SHA-256 matched the GitHub Actions artifact digest. The
three extracted files were `approval.json`, `cdk-diff.txt`, and
`cdk-diff-summary.md`. The approval commit, stage, CDK diff hash, and approval
digest matched the successful job summary. Evidence was reviewed from those
raw files rather than from the screenshot or copied summary.

## Diff Review

Review the raw `cdk-diff.txt` and generated `cdk-diff-summary.md`. The
account-backed diff is authoritative; source-template expectations are not.

| Category | Count | Review outcome |
| --- | ---: | --- |
| `CREATE` | 41 | Reviewed: 13 production showing-list resources, 4 edge/WAF support resources, and 24 public Web/API resources |
| `UPDATE` | 2 | Reviewed: application-secret description and scheduler target policy only; neither changes a physical identity |
| `REPLACE` | 1 | Reviewed: existing ECS task-definition revision only; stateless and expected for the immutable image change |
| `DELETE` | 0 | Passed: no resource deletion detected |

`ChaoranPropertyIntelligenceGuardrails` reported no differences. Three stacks
contained changes: the existing production foundation, the new edge stack,
and the new public-application stack. The plan creates the private Web bucket,
CloudFront distribution, WAF, App Runner service and VPC connector, bounded
security groups and IAM roles, API-auth secrets, deployment alerting, and
cross-region CDK support resources. It also adds the showing-list task,
artifact bucket, dead-letter queue, and disabled schedule to the existing
production foundation.

The application-secret update changes only its description. The scheduler
policy update grants the existing scheduler role the bounded permissions
needed to pass the new showing-list task roles, run that task definition, and
send to its dead-letter queue. The sole replacement is the property-alert ECS
task definition caused by its immutable container image revision. The plan
does not replace Aurora, the database secret, VPC, retained Web bucket,
retained API-auth secrets, OIDC provider, or deployment role.

Stop and do not authorize deployment if the diff replaces or deletes Aurora,
the database secret, VPC, retained S3 buckets, retained API-auth secrets,
OIDC roles/providers, or another state-bearing identity. Also stop for an
unexpected production foundation identity change, enabled worker schedule,
unreviewed migration implication, widened IAM trust, or any stack outside the
four explicit production stack names.

## Approval Digest Boundary

The successful plan produces `deployment-plan/approval.json` with:

```json
{
  "approvalDigest": "<64 lowercase hexadecimal characters>",
  "commit": "<exact 40-character main SHA>",
  "diffSha256": "<64 lowercase hexadecimal characters>",
  "schemaVersion": 1,
  "stage": "production"
}
```

The digest is evidence for a later decision, not deployment authorization.
Block 29.6b requires a new explicit authorization, the same exact `main` SHA,
the reviewed digest, and separate production API migration confirmation. Any
source or AWS-state drift requires a new plan.

## Acceptance Criteria

The production plan phase is complete only when:

- preparation tests, full tests, typecheck, production build, and offline
  production synth pass;
- protected promotion produces a green exact `main` SHA;
- the plan-only run is separately authorized and approved through the
  `production` environment;
- the run verifies the expected AWS account and succeeds without entering any
  deploy-only step;
- the 90-day artifact is downloaded and reviewed from raw evidence;
- all four diff categories and schedule states are recorded above;
- `DELETE` is zero and no unsafe state-bearing replacement exists;
- the approval digest is exactly 64 lowercase hexadecimal characters;
- no deployment, migration, production smoke, production data operation,
  worker behavior, provider request, or notification occurs.

Result: the production plan phase is complete. Run `33410204420` passed its
protected-environment review, exact-source verification, deterministic test
suite, local smoke, typecheck, build, production synthesis, account check,
account-backed diff, delete guard, and immutable approval generation. No
deploy-only workflow step ran.

## Source Verification

- Focused DEV and production workflow tests: 2 files, 17 tests passed.
- Full repository suite: 135 files, 1,307 tests passed.
- Full TypeScript typecheck: passed.
- Production runtime, Web, and AWS CDK build: passed.
- Offline synthesis of the four explicit production stacks: passed with
  lookups disabled and a non-deployable zero-SHA placeholder.
- Synthesized production worker schedules: two
  `AWS::Scheduler::Schedule` resources, both `DISABLED`.
- Synthesized monitoring rules: two `AWS::Events::Rule` resources remain
  `ENABLED` only to report ECS task startup and non-zero-exit failures; they do
  not start worker tasks.
- Production deployment role logical ID remains
  `GitHubDeployRoleED73FD64`; production database logical ID remains
  `DatabaseB269D8BB`.
- `git diff --check`: passed.

The Web build retains its existing ArcGIS-heavy large-chunk warning. It is
non-blocking and unrelated to the production plan contract.

## Remaining Risks

- GitHub environment controls and IAM trust can drift outside this repository;
  read them back immediately before a deployment.
- A successful plan describes one exact commit and one observed AWS state. It
  becomes stale when either changes; the deploy workflow must reproduce the
  exact digest or stop.
- CDK output can include framework support resources. Each still requires
  classification and ownership review.
- The production API starts by applying seven idempotently tracked bundled
  migrations. A green plan does not prove the production migration outcome
  and never authorizes the separate deployment run.
- The first public launch creates 41 resources across three stacks. Partial
  stack success, CloudFront propagation, App Runner readiness, SNS subscription
  confirmation, and forward-only migration recovery remain deployment-time
  risks.

## References

- [Block 29 launch runbook](../runbooks/block-29-aws-public-launch.md)
- [Block 29.5 production environment preparation](block-29-5-production-environment-protection.md)
- [Release and production delivery runbook](../runbooks/release-production-delivery.md)
- [ADR 0017](../adr/0017-aws-public-launch-and-operational-readiness.md)
