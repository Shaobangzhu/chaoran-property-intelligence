# Change-Classified Release Promotion Runbook

## Purpose

This runbook operates the `main` pull-request gate after ADR 0020. It covers
classification, the one-time bootstrap, stable required-check policy, and
recovery. It does not authorize a Guardrails deployment, Production deployment,
migration, worker run, provider call, notification, or schedule enablement.

## Routing Matrix

| Candidate | Allowed source | Required jobs | AWS mutation |
| --- | --- | --- | --- |
| Application only | Protected `dev` | Exact DEV application release | None |
| Platform only | Same repository | Guardrails candidate synthesis and trusted-base source-template comparison | None |
| Application plus platform | Protected `dev` | Exact DEV application release and both Guardrails jobs | None |
| Documentation/tests only | Any reviewed branch permitted by repository policy | No-deployment record | None |
| Unknown or empty | None | Classification and aggregate gate fail | None |

The stable branch-protection context is always:

```text
Release Promotion Gate / Promote exact AWS DEV release
```

The name is compatibility-stable even when the selected concern is platform or
documentation. Read the job summary for the actual classification and lane
results. Do not require the conditional job names in a repository ruleset.

## One-Time Rollout

The workflow runs on the pull request merge revision, but classification checks
out and trusts the `main` base SHA. During the first rollout the base does not
yet contain the classifier, so the workflow records
`bootstrap_fallback=true` and conservatively selects both deployable lanes.

Use this sequence without removing the existing Main required check:

1. Merge the complete refactor into protected `dev` through
   `PR Quality Gate / quality-gate`.
2. Let `Deploy DEV` finish for that exact `dev` SHA. The pre-refactor DEV impact
   classifier treats workflow/tooling changes conservatively, so do not open
   the release PR while DEV is behind.
3. Confirm both DEV schedules remain disabled. No schedule enablement is part
   of this rollout.
4. Open the same-repository `dev -> main` PR.
5. In `Release Change Classification`, confirm the summary says the trusted
   base classifier is not installed and the conservative application and
   platform fallback is active. The candidate classifier must not run.
6. Inspect the credential-free Guardrails source-template comparison and reject
   any deletion. Its review digest is not an AWS deployment approval.
7. Confirm the application lane validates the exact deployed DEV identity and
   remote regression.
8. Confirm the final stable required check succeeds, then merge to `main`.
9. Synchronize `main` back into `dev` if the merge strategy produced divergent
   history.
10. On the next harmless test PR, confirm classification reports
    `bootstrap_fallback=false` and uses the classifier stored on `main`.

The existing required-check name is emitted by both the old gate and the new
aggregator, so there is no interval in which Main should have zero release
protection. Do not delete and recreate the required check during rollout.

## Normal Branch Policy

Configure repository rulesets as follows:

### `dev`

- require a pull request and review according to the repository's ownership
  policy
- require `PR Quality Gate / quality-gate`
- require conversations to be resolved
- prevent bypass according to the repository's administrator policy

### `main`

- require a pull request and review according to the repository's ownership
  policy
- require `Release Promotion Gate / Promote exact AWS DEV release`
- require the branch to be current with the base if the repository uses strict
  status checks
- require conversations to be resolved
- prevent bypass according to the repository's administrator policy
- do not require `Classify release changes`, `Verify exact AWS DEV application
  release`, `Synthesize account Guardrails candidate`, `Compare Guardrails
  source templates`, or `Confirm no deployment required`

The release workflow must continue to trigger for every PR targeting `main`.
Do not add workflow-level `paths` or `paths-ignore`; lane selection happens
inside the workflow so the stable required context is always emitted.

## Normal Change Flow

### Application or mixed change

1. Open the feature PR to `dev` and pass the source quality gate.
2. Merge to `dev`; wait for the exact DEV deployment and smoke evidence.
3. Open `dev -> main`.
4. For mixed changes, review the additional Guardrails source-template
   comparison.
5. Merge only after the stable aggregate check passes.

### Platform-only change

1. Update the trusted classifier first if the proposal introduces a new path.
2. Open a same-repository PR to `main`.
3. Review the unprivileged candidate synthesis and trusted-base source-template
   comparison. Reject deletions and merge only after the stable aggregate check
   passes.
4. If an AWS mutation is required, run the protected `Deploy account guardrails`
   plan separately after merge and review its live account-backed diff.
5. Authorize a second run to deploy only when its recomputed account-backed
   digest matches the reviewed plan.
6. Synchronize `main` into `dev`.

### Documentation/tests-only change

1. Open the reviewed PR to `main` or route it through `dev` when it belongs to
   an application delivery series.
2. Confirm only `Confirm no deployment required` runs after classification.
3. Confirm the final stable aggregate check passes without AWS or environment
   access.
4. Synchronize a direct Main change into `dev`.

## Classifier Evolution

The classifier is security-sensitive base-branch policy. When adding a new
runtime or platform root:

1. Submit only the classifier rule and its tests through a path already known
   to the current base classifier.
2. Merge that policy change to `main` under the lane selected by the old policy.
3. Submit the new path in a later PR.

This two-phase policy rollout is intentional. If the new path is submitted at
the same time and the old classifier cannot assign it, the gate must fail
closed. Never copy or execute the candidate classifier to make the PR pass.

## Verification

Before merging a release-gate change, run:

```bash
pnpm exec vitest run \
  tools/release/classifyReleaseChanges.test.mjs \
  infra/aws/test/releaseQualityGateWorkflow.test.ts
pnpm --dir infra/aws typecheck
pnpm test:infra
```

The workflow contract tests cover application-only, platform-only, mixed, and
documentation/tests-only success; invalid classification; failed required
lanes; unexpected lane execution; conflicting routing; shell syntax; action
pinning; absence of workflow path filters; and the first-run bootstrap fallback.

## Failure And Recovery

- If classification fails, add an explicit classifier rule in a separate
  policy PR; do not relabel the file as documentation.
- If a selected job fails, fix that concern and rerun the workflow. Do not make
  the aggregator ignore the result.
- If the Guardrails source comparison fails before a runner starts, confirm the
  job has no `environment` or `id-token: write`; pull-request comparison must not
  depend on Production deployment-branch rules or AWS credentials.
- If trusted base synthesis reports a missing `dist/bin/guardrails.js`, confirm
  the job selected the legacy `dist/bin/app.js` fallback and wrote its assembly
  under the runner temporary directory rather than inside the checkout.
- If the first-run fallback cannot validate exact DEV, complete or repair the
  DEV deployment before retrying.
- If the workflow itself is invalid, keep the existing required check in place,
  revert through a reviewed PR, and restore the last known-good workflow. Do not
  bypass or delete Main protection to clear a pending merge.

Record the classification summary, Guardrails source-comparison artifact when
applicable, application evidence when applicable, final aggregate summary, PR
URL, and merge SHA as rollout evidence. Record the later protected account plan
and deployment separately if Guardrails are changed after merge.

## References

- [ADR 0020](../adr/0020-change-classified-release-promotion.md)
- [GitHub pull request workflow event](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request)
- [Production delivery](release-production-delivery.md)
