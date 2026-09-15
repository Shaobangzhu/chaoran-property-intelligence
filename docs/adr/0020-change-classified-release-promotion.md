# ADR 0020: Change-Classified Release Promotion

## Status

Accepted and implemented on 2026-09-14. This ADR amends ADR 0018 by retaining
exact AWS DEV evidence only for application changes and making its required
check a stable aggregate decision.

## Context

The original `dev -> main` gate treated every candidate as an application
release. That was safe for runtime changes, but it coupled account-level
Guardrails and release-policy maintenance to an unrelated AWS DEV application
deployment. A Guardrails permission needed to plan a release could therefore
be blocked by a gate that first required the same release machinery to be
deployed. Documentation and test-only changes also paid for remote application
regression despite having no deployable effect.

Changing the workflow trigger with path filters is not a safe answer. A
required check that is never emitted can remain pending, and a classifier that
assumes an unknown path is harmless can silently bypass needed evidence. The
workflow also needs a safe first rollout because its trusted classifier does
not yet exist on the `main` base revision.

## Decision

Use a trusted, fail-closed change classifier to select independent release
concerns:

| Classification | Required evidence |
| --- | --- |
| Application | Same-repository protected `dev` source, exact or permitted non-runtime-descendant AWS DEV identity, readiness, and full remote-safe Playwright regression |
| Platform | Same-repository candidate synthesis followed by a credential-free comparison against the trusted base Guardrails template, with deletion rejection |
| Documentation/tests only | Explicit successful no-deployment record; no checkout, dependencies, AWS, environment, or remote regression |
| Mixed application and platform | Both application and platform evidence |
| Unknown or empty | Fail closed |

Tests, fixtures, snapshots, and Markdown take precedence over their parent
directory. Shared delivery and toolchain files intentionally select both
application and platform evidence. New paths are unknown until the trusted
classifier explicitly assigns them.

The classifier is executed from the pull request base SHA. Candidate code does
not decide whether its own platform lane is required. Candidate Guardrails code
is synthesized only in an unprivileged job. A second unprivileged job checks out
the trusted base planning tools, synthesizes the trusted base template, consumes
the candidate cloud assembly, and uses `cdk diff --method template --template`
to compare source templates. It never obtains AWS credentials, enters a GitHub
Environment, reads live account state, or calls `cdk deploy`.

The pull-request comparison is source-review evidence, not a deployable
approval. After merge, the separately triggered `Deploy account guardrails`
workflow remains responsible for a protected, account-backed plan and for
recomputing that live plan before an explicitly authorized deployment.

All conditional jobs feed one `if: always()` aggregator. Its check context
remains:

```text
Release Promotion Gate / Promote exact AWS DEV release
```

The historical name is retained to avoid a branch-protection gap during the
cutover. The aggregator succeeds only when every selected lane succeeds and
every unselected lane is skipped. Classification failure, missing output,
cancelled work, a failed selected lane, an unexpectedly executed lane, or a
conflicting no-deployment classification fails the aggregate check.

## Bootstrap Rule

The first pull request containing this workflow runs from the pull request
merge revision while its trusted base is still the old `main`. If the base does
not contain `tools/release/classifyReleaseChanges.mjs`, the workflow does not
execute the candidate copy. It selects a bounded conservative fallback instead:

- application evidence required
- platform evidence required
- documentation-only disabled

The first rollout must therefore come from `dev`, match the deployed DEV
application identity, and pass the credential-free Guardrails source-template
comparison. After merge, the classifier exists on `main`; all later runs use
normal fail-closed classification and report `bootstrap_fallback=false`.

The trusted base can also predate the isolated `guardrails.js` CDK entrypoint.
The comparison prefers that isolated entrypoint when it exists and otherwise
synthesizes only the named Guardrails target through the legacy `app.js`. Base
assembly output stays outside the checkout so the legacy application's asset
staging cannot recursively copy its own output. This compatibility path runs no
candidate code and uses no AWS credentials.

Future classifier evolution is two-phase when a change introduces a previously
unknown path: first merge the classifier policy update through an already-known
platform path, then introduce the new path. Do not execute a candidate
classifier or temporarily classify unknown files as documentation to combine
those phases.

## Branch Policy

- Protected `dev` requires `PR Quality Gate / quality-gate`.
- Protected `main` requires
  `Release Promotion Gate / Promote exact AWS DEV release`.
- Do not require conditional lane names such as application verification,
  Guardrails synthesis/plan, or no-deployment; they are intentionally skipped
  for other classifications.
- Do not add `paths` or `paths-ignore` to the release workflow trigger.
- Application or mixed work follows `feature -> dev -> main`.
- Platform-only and documentation/tests-only work may open a same-repository PR
  directly to `main`; synchronize `main` back into `dev` after merge.
- Unknown paths and forked platform candidates remain blocked.
- Retain review, conversation resolution, and no-bypass requirements. Protected
  environment approval remains on post-merge account planning and deployment,
  not on pull-request source comparison.

## Consequences

Application confidence remains tied to the exact DEV artifact. Platform
maintenance can be reviewed without manufacturing an application deployment,
and documentation/test maintenance emits a successful required status without
AWS access. One required context exists for every pull request to `main`, so
conditional jobs cannot leave branch protection waiting for a status that will
never arrive.

The platform lane no longer assumes the production deployment role, so a pull
request merge ref cannot be rejected by Production deployment-branch rules and
untrusted candidate code cannot request production credentials. The comparison
does not detect live AWS drift; the required post-merge, account-backed plan is
the authoritative deployment evidence. Guardrails deployment remains a
separate administrator-triggered workflow after merge.

This decision does not enable either worker schedule, deploy Production, run a
migration, call RentCast/OpenAI/Telegram, or change application data.

## References

- [GitHub pull request workflow event](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request)
- [ADR 0018](0018-exact-aws-dev-release-promotion.md)
- [Release promotion rollout and branch policy](../runbooks/change-classified-release-promotion.md)
- [Production delivery](../runbooks/release-production-delivery.md)
- [Testing framework](../testing/test-framework.md)
