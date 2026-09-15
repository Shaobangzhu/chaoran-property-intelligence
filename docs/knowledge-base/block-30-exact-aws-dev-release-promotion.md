# Block 30: Exact AWS DEV Release Promotion

## Purpose

Block 30 removes duplicate deterministic verification from the DEV-to-main
path without weakening the exact AWS DEV release boundary.

Feature-to-DEV source confidence belongs to the protected dependency-aware PR
quality gate. DEV-to-main confidence belongs to promotion evidence from the
deployed DEV origin. These are separate questions and should not run the same
work twice.

ADR 0020 later preserved this exact DEV path as the application lane while
adding platform and documentation/tests-only routes. The required context name
is unchanged, but it is now emitted by a final aggregator rather than the
conditional application job.

## Workflow Ownership

### Feature To DEV

`PR Quality Gate / quality-gate` is the only source-verification workflow. It
uses changed-file classification to select frontend, backend, integration,
infrastructure, system-smoke, typecheck, and build coverage. Shared or unknown
changes use the complete fallback. Documentation-only changes produce an
intentional successful status without installing dependencies.

### Merge To DEV

`Deploy DEV` classifies deployment impact. Deployable changes retain the exact
DEV build, environment-specific ArcGIS bundle verification, CDK synthesis,
account-backed plan, protected deployment, readiness, and remote read-only
smoke. Documentation/test-only changes retain the intentional no-deploy record.

### DEV To Main

For application or mixed candidates, the application lane verifies:

1. the PR source is the same repository's protected `dev` branch
2. checkout matches the exact PR head SHA
3. the configured DEV target is a credential-free HTTPS origin
4. AWS DEV health is ready
5. the candidate is the deployed release or a permitted non-runtime descendant
6. the full remote-safe Playwright regression passes
7. retry and quarantine evidence contains no unexpected result

It intentionally does not run Vitest, typecheck, a local build, or local
Playwright smoke. Platform-only candidates instead synthesize the isolated
Guardrails stack without credentials and run a protected account-backed,
template-only plan. Documentation/tests-only candidates record an intentional
no-deployment result. A stable aggregator publishes
`Release Promotion Gate / Promote exact AWS DEV release` for every PR to
`main` and fails unless every selected lane succeeds.

### Main And Production

A merge to `main` produces no second generic source Verify. Production remains
a separate manual `plan -> review digest -> deploy` process. This block does not
change Production authorization, migration acknowledgement, schedules, AWS
roles, environments, or stack boundaries.

## Rollout

The original Block 30 cutover is complete. For the ADR 0020 amendment, follow
the [change-classified release promotion runbook](../runbooks/change-classified-release-promotion.md).
The first rollout deliberately requires both exact DEV application evidence
and the Guardrails plan when the trusted base classifier is not yet installed.
After merge, the base classifier owns normal routing.

Do not remove the stable required context during the amendment rollout. Its
name is unchanged; only its ownership moves from the application job to the
final aggregator.

## Non-Goals

- automatic Production deployment
- removing account-backed DEV plans or environment approvals
- weakening exact deployed-release ancestry checks
- replacing full remote-safe regression with local smoke
- reusing Production plan artifacts or builds across runs
- changing AWS, database, schedule, provider, or notification behavior

## References

- [ADR 0018](../adr/0018-exact-aws-dev-release-promotion.md)
- [ADR 0020](../adr/0020-change-classified-release-promotion.md)
- [Change-classified promotion runbook](../runbooks/change-classified-release-promotion.md)
- [Testing framework](../testing/test-framework.md)
- [Release delivery runbook](../runbooks/release-production-delivery.md)
