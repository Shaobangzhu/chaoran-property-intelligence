# Block 29.6 Production Plan

## Status

- Date prepared: 2026-08-31
- Preparation branch: `feature/block-29-6c-production-plan`
- Preparation base: `3a94a3f`
- Plan run: pending
- Exact `main` SHA: pending promotion and authorization
- AWS mutation: not performed
- Production deployment or migration: not authorized and not performed

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
| Exact `main` SHA | Pending |
| Workflow run ID and URL | Pending |
| AWS account verified | Pending, record only bounded account identity |
| Plan artifact name | Pending |
| `approval.json` commit | Pending |
| `approval.json` stage | Pending |
| CDK diff SHA-256 | Pending |
| 64-character approval digest | Pending; do not place in deploy inputs yet |
| Both schedules disabled | Pending |

## Diff Review

Review the raw `cdk-diff.txt` and generated `cdk-diff-summary.md`. The
account-backed diff is authoritative; source-template expectations are not.

| Category | Count | Review outcome |
| --- | ---: | --- |
| `CREATE` | Pending | Every public runtime and CDK support resource identified |
| `UPDATE` | Pending | Every property update reviewed |
| `REPLACE` | Pending | Every replacement reviewed; state-bearing replacement blocks |
| `DELETE` | Pending | Must be zero; workflow fails otherwise |

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
  read them back immediately before the plan.
- A successful plan describes one exact commit and one observed AWS state. It
  becomes stale when either changes.
- CDK output can include framework support resources. Each still requires
  classification and ownership review.
- A green plan does not prove migrations are safe and never authorizes the
  separate deployment run.

## References

- [Block 29 launch runbook](../runbooks/block-29-aws-public-launch.md)
- [Block 29.5 production environment preparation](block-29-5-production-environment-protection.md)
- [Release and production delivery runbook](../runbooks/release-production-delivery.md)
- [ADR 0017](../adr/0017-aws-public-launch-and-operational-readiness.md)
