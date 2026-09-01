# ADR 0018: Exact AWS DEV Release Promotion

## Status

Accepted for implementation by Block 30.

## Context

The repository accumulated overlapping source verification after the protected
DEV delivery path became operational. A deployable change could run the same
Vitest, typecheck, local Playwright smoke, and build work in the feature-to-DEV
PR gate, the DEV deployment workflow, the DEV-to-main release gate, the main
push workflow, and later Production operations.

The DEV-to-main boundary still has unique responsibilities that source tests do
not cover. It must prove that the candidate came from the protected `dev`
branch, corresponds to the exact or safely reusable AWS DEV release, reaches a
healthy public DEV origin, passes remote-safe browser regression, and has no
unexpected retry or quarantine evidence.

## Decision

Use one source-verification boundary and one release-promotion boundary:

- `PR Quality Gate / quality-gate` remains the required feature-to-DEV source
  verification. It selects conservative suites from the dependency graph and
  falls back to the complete gate for shared, dependency, workflow, toolchain,
  and unknown changes.
- `Release Promotion Gate / Promote exact AWS DEV release` remains the required
  DEV-to-main check. It performs no Vitest, typecheck, local build, or local
  Playwright smoke. It retains source-path enforcement, exact checkout,
  deployed-release ancestry and impact verification, bounded AWS DEV readiness,
  full remote-safe Playwright regression, retry/quarantine enforcement, and
  bounded evidence.
- The legacy root `CI / verify` workflow is removed. It no longer repeats the
  source gate for every pull request or after a merge to `main`.
- AWS DEV deployment keeps its exact-SHA build, ArcGIS bundle validation, CDK
  synthesis, account-backed plan, protected deployment, readiness, and remote
  smoke. Those steps create and validate the deployed artifact and are not a
  DEV-to-main source-test rerun.
- Production remains manual and digest-bound. Merging to `main` does not
  automatically deploy or authorize a migration.

## Required GitHub Ruleset Cutover

After this source reaches protected `dev`, update required checks before merging
the DEV-to-main PR:

- `dev` requires `PR Quality Gate / quality-gate`
- `main` requires
  `Release Promotion Gate / Promote exact AWS DEV release`
- remove `CI / verify` and the superseded release-gate context from required
  checks
- retain pull-request review, no-bypass, and branch-source protections

The cutover is an external GitHub configuration change. This ADR does not
authorize changing repository settings by itself.

## Consequences

Positive:

- deterministic source verification is no longer repeated at DEV-to-main or
  main push
- promotion remains bound to what actually ran on AWS DEV
- remote browser and flake evidence stays at the production promotion boundary
- required checks have distinct responsibilities and clearer names

Trade-offs:

- confidence in source verification depends on the protected `dev` ruleset
- ruleset check names must be changed in coordination with the workflow rollout
- Production plan/deploy still contains independent verification that may be
  optimized only through a future immutable build-attestation design

## References

- [Block 30 knowledge base](../knowledge-base/block-30-exact-aws-dev-release-promotion.md)
- [Testing framework](../testing/test-framework.md)
- [Release delivery runbook](../runbooks/release-production-delivery.md)
- [ADR 0016](0016-software-quality-platform-and-aws-delivery-modernization.md)
