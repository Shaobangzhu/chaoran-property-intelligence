# Block 29.4a Dependency-Aware DEV Deployment Record

## Record

- Date: 2026-08-30
- Branch: `feature/block-29-4a-dependency-aware-dev-deployment`
- Scope: source, workflow contracts, tests, and documentation only
- AWS mutation: none
- Production scope: none
- Result: dependency-aware DEV deployment source prepared and locally verified

No AWS role was assumed, environment approval requested, CDK plan or deploy
run, migration, worker, provider request, schedule change, database operation,
or notification was executed while preparing this change.

## Problem

`Deploy DEV` previously ran its full release verification, account-backed CDK
plan, two environment approvals, deployment, migration startup, publication,
and smoke path after every push to `dev`. That preserved an exact Git SHA but
also redeployed identical runtime artifacts for documentation-only changes.

Simply adding `paths-ignore` would be unsafe. It would leave required workflow
status ambiguous and the Release Quality Gate and Nightly regression would
still expect the undeployed `dev` HEAD from `/release.json` and `/api/release`.

## Decision

The delivery model now distinguishes:

- **candidate SHA**: protected `dev` source under test
- **deployed SHA**: immutable Web/API release actually running in AWS DEV

The SHAs may differ only when the deployed SHA is an ancestor of the candidate
and every intervening file is explicitly classified as documentation or test
evidence. Runtime, infrastructure, delivery configuration, dependencies, and
unknown files remain deployable by conservative default.

## Deploy DEV Behavior

Every `dev` push still starts `Deploy DEV`, so the workflow itself remains
observable and can satisfy branch-policy expectations. Its first job generates
and uploads a `DEV Deployment Impact` artifact.

- Documentation/test-only push: record a successful intentional skip; request
  no AWS credential, environment approval, plan, migration, or deployment.
- Runtime/infrastructure/unknown push: run the existing verification, approval
  one plan, approval two deployment, migration startup, and remote smoke.
- Manual dispatch: always force the reviewed full deployment path.
- Empty or unclassified change set: deploy as the safe fallback.

Rename detection is disabled while calculating changed paths so moving or
deleting a runtime file cannot be disguised by its destination path.

## Release And Nightly Evidence

The Release Quality Gate and Nightly DEV Regression now:

1. check out full protected `dev` history;
2. wait for bounded public DEV health readiness;
3. read both public release identities without AWS credentials;
4. require Web/API equality and `stage=dev`;
5. require the deployed SHA to be a Git ancestor of the tested candidate;
6. classify every intervening changed path;
7. fail when any deployable or unknown file exists after the deployed SHA;
8. set Playwright's expected release SHA to the actual deployed SHA while
   retaining the candidate SHA as the tested source identity.

This preserves deterministic release evidence without pretending that a docs
commit changed the running application.

## Classification Examples

| Change | DEV plan/deploy |
| --- | --- |
| `docs/**`, `README.md`, Markdown | Skip |
| `tests/**`, `**/*.test.*`, `**/*.spec.*`, snapshots | Skip |
| `apps/**` runtime source | Required |
| `packages/**` runtime source | Required |
| `infra/aws/**` except explicit test files | Required |
| workflow, lockfile, config, deployment tooling | Required |
| unknown path or empty push comparison | Required |
| manual workflow dispatch | Required |

The 29.4 documentation range `3a95c51..8e5a56c` was replayed locally and
classified as four non-deployable documentation files with zero deployable
files. This 29.4a feature itself modifies workflows and deployment tooling, so
its first merge to `dev` intentionally requires one full reviewed deployment.

A read-only live verification also confirmed that the current public Web and
API identities both expose exact DEV SHA
`8e5a56ce16f5f8ffe4fa3fdd37cfc0f739c6cf16`. No AWS credential or
authenticated application request was used.

## Verification

- Focused workflow and release-tool tests: 5 files, 31 tests passed.
- Full repository test suite: 135 files, 1,304 tests passed.
- Full TypeScript typecheck: passed.
- Production build, including runtime, web, and AWS CDK: passed.
- Workflow YAML parsing, Node.js syntax checks, and `git diff --check`: passed.
- Historical documentation-only range `3a95c51..8e5a56c`: correctly skipped
  with four documentation files and zero deployable files.
- Public DEV Web/API release verification: passed for exact deployed SHA
  `8e5a56ce16f5f8ffe4fa3fdd37cfc0f739c6cf16` and `stage=dev`.

The web build retains its existing large-chunk warning for ArcGIS-heavy
bundles. It is non-blocking and outside this delivery-control change.

## Architectural Consequences

- GitHub environment approvals correspond to a real deployable change instead
  of every branch update.
- Documentation and test-only `dev` merges cannot acquire AWS credentials
  through the DEV workflow.
- Exact runtime identity remains mandatory whenever runtime could have changed.
- A stale, unrelated, divergent, or non-DEV public release fails closed.
- The classifier is shared by deployment, release promotion, and nightly
  evidence rather than duplicated as workflow shell conditions.

## Remaining Risks

- Path classification is security-sensitive delivery code. New runtime roots
  must be classified or they will conservatively deploy.
- Git history must be available to release and nightly jobs; both use full
  checkout history.
- The first 29.4a merge must exercise the full DEV plan/deploy path because it
  changes delivery workflows. A later docs-only merge should exercise the skip
  path and retain the prior deployed SHA.
- Production remains unchanged. Production plan/deploy continues to require an
  exact reviewed `main` SHA and separate authorization.

## References

- [Release and production delivery runbook](../runbooks/release-production-delivery.md)
- [Block 29 launch runbook](../runbooks/block-29-aws-public-launch.md)
- [ADR 0017](../adr/0017-aws-public-launch-and-operational-readiness.md)
- [Block 29.4 DEV acceptance](block-29-4-dev-public-acceptance.md)
