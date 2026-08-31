# Block 29.5 Production Environment Protection Preparation

## Status

- Date: 2026-08-30
- Branch: `feature/block-29-5-production-environment-protection`
- Base: `73da040`
- Scope: source contract, tests, documentation, and operational preparation
- GitHub mutation: not performed during source preparation
- AWS mutation: not performed
- Production plan or deployment: not performed

This phase does not authorize a production plan, deployment, migration,
authenticated request, database access, worker execution, provider request,
notification, schedule change, or production data operation.

## Decision

The manual `Deploy production` job is bound to the protected GitHub
`production` environment. GitHub must issue an OIDC token whose immutable
subject is:

```text
repo:Shaobangzhu@8231137/chaoran-property-intelligence@1338908571:environment:production
```

The existing IAM role name `cpi-github-deploy`, CDK construct ID
`GitHubDeployRole`, CloudFormation logical ID, permissions, and production
resource identities remain unchanged. Only the role trust subject moves from
the `main` ref to the protected environment. The environment itself supplies
the exact-`main` deployment restriction.

Both `operation=plan` and `operation=deploy` require environment review because
both obtain an account-scoped OIDC token. The existing plan digest and explicit
migration confirmation remain additional controls; they do not replace the
environment approval.

## Source Contract

- Workflow trigger remains manual-only with no push trigger.
- Job execution still requires `refs/heads/main`.
- Checkout explicitly pins `${{ github.sha }}`.
- The production job declares `environment.name=production`.
- Plan and deploy confirmations, immutable digest verification, migration
  authorization, schedule disablement, and safe smoke remain unchanged.
- Production stack names and retained physical/logical identities are not
  renamed or replaced for symmetry with DEV.

## GitHub Environment Configuration

Create or update repository environment `production` with:

1. Required reviewer: repository owner `Shaobangzhu`.
2. Prevent self-review: disabled while the repository has only one authorized
   operator; otherwise no production run could be approved.
3. Allow administrators to bypass configured protection rules: disabled.
4. Deployment branches and tags: selected branches and tags.
5. Allowed branch rule: exact branch `main` only; no wildcard and no tag.
6. Environment secrets and variables: none are required for this change.

Repository variables and secrets already used by the workflow remain at their
existing scope. Do not duplicate sensitive values into the environment merely
to create an apparent boundary.

After configuration, verify through the GitHub API or settings UI that the
environment has one `main` branch policy, required reviewers, and
`can_admins_bypass=false`. Do not test the configuration by approving a real
production plan.

## Guardrails Transition

Binding a job to an environment changes the OIDC subject. The currently
deployed production role trusts the old branch-ref subject, so a separately
authorized federated administrator update is required before GitHub can assume
the role under the new contract.

Safe transition order:

1. Merge and verify this source through `dev` and `main` quality gates. The
   source change is deployable, so the protected DEV workflow must complete its
   reviewed DEV-only plan/deploy path; that workflow does not include the
   shared Guardrails stack.
2. Configure and read back the protected GitHub `production` environment.
3. Authenticate through the approved AWS IAM Identity Center administrator
   profile.
4. Capture an account-backed diff for
   `ChaoranPropertyIntelligenceGuardrails` only.
5. Classify `CREATE`, `UPDATE`, `REPLACE`, and `DELETE` explicitly.
6. Require an in-place update to the existing production role trust policy.
7. Obtain separate authorization for that exact Guardrails diff.
8. Deploy only `ChaoranPropertyIntelligenceGuardrails`.
9. Read back the exact OIDC subject and confirm a clean post-deploy diff.

Do not temporarily trust both subjects and do not widen the subject with a
repository wildcard. A bounded interval in which production automation cannot
assume the role is acceptable because no production operation is authorized.

## Expected Guardrails Diff

The local source model expects:

- `CREATE`: 0
- `UPDATE`: existing `cpi-github-deploy` IAM role trust policy and description
- `REPLACE`: 0
- `DELETE`: 0

An account-backed CDK diff is authoritative. Stop if the diff changes the OIDC
provider, budget, role name, role permissions, retained resource identity,
production application stack, or any resource outside the exact role metadata
and trust update.

## Acceptance Criteria

Block 29.5 is complete only when:

- source tests, full tests, typecheck, and production build pass;
- main CI is green for the merged source;
- the GitHub `production` environment is read back with the exact controls;
- the account-backed Guardrails diff is reviewed and separately authorized;
- the preserved IAM role trusts only the exact production environment subject;
- the post-update Guardrails diff is clean;
- no production plan or deployment has been run.

Only then may Block 29.6 begin with a separately authorized plan-only run.

## Source Verification

- Focused Guardrails and production workflow tests: 2 files, 13 tests passed.
- Full repository test suite: 135 files, 1,304 tests passed.
- Full TypeScript typecheck: passed.
- Production runtime, web, and AWS CDK build: passed.
- Production CDK synthesis: passed without AWS credentials or context lookup.
- Production workflow YAML parsing: passed.
- `git diff --check`: passed.
- Synthesized production role logical ID: `GitHubDeployRoleED73FD64`.
- Synthesized production role physical name: `cpi-github-deploy`.
- Synthesized OIDC subject: exact `environment:production` immutable repository
  identity.

The web build retains its existing large-chunk warning for ArcGIS-heavy
bundles. It is non-blocking and unrelated to this protection change.

The first sandboxed full-test attempt could not bind API tests to local
`127.0.0.1` and reported `listen EPERM`. The unchanged suite was rerun with
local loopback permission and all 1,304 tests passed; this was an execution
environment restriction rather than a product failure.

## Remaining Risks

- GitHub environment review and branch policies live outside CloudFormation and
  can drift; read them before every production release.
- A sole reviewer requires self-review to remain possible. Team growth should
  introduce an independent reviewer and then enable prevent self-review.
- Until the Guardrails trust update is applied, environment-bound production
  jobs will fail OIDC assumption by design.
- A green production plan still does not authorize deployment or migration.

## References

- [ADR 0017](../adr/0017-aws-public-launch-and-operational-readiness.md)
- [Block 29 launch runbook](../runbooks/block-29-aws-public-launch.md)
- [Release and production delivery runbook](../runbooks/release-production-delivery.md)
- [AWS system design](../aws-system-design.md)
