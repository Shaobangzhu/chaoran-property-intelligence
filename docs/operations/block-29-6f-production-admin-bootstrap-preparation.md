# Block 29.6f Production Administrator Bootstrap Preparation

## Status

- Source phase: implementation prepared on
  `feature/block-29-6f-production-admin-bootstrap`
- Production user creation: not executed
- Production data access: not performed
- AWS Guardrails update: not authorized by this document
- AWS Production foundation update: not authorized by this document
- Bootstrap plan/create runs: not authorized by this document

This record distinguishes repository preparation from every subsequent AWS and
production-data mutation.

## Source Scope

The change adds:

- a Production-only administrator CLI boundary and entry point
- a no-schedule Production Fargate task with stage-specific IAM, networking,
  logging, secret prefix, command, and outputs
- a least-privilege GitHub OIDC role trusted only by the protected
  `production-admin-bootstrap` environment
- a manual, exact-`main`, digest-bound `plan → create` workflow
- a sanitized Production approval tool and deterministic tests
- the private Production administrator runbook

The change does not add registration, reset, seed, migration, direct SQL,
worker, schedule, RentCast, Telegram, OpenAI, or production notification
behavior.

## Preserved Identities

Existing Production construct IDs and physical names remain unchanged,
including Aurora, its credentials secret, VPC, worker tasks and schedules,
retained/public application resources, OIDC provider, and existing deployment
role. New Production bootstrap resources use new logical and physical
identities. DEV bootstrap identities and behavior remain unchanged.

## Required Future Decisions

After this source reaches protected `dev`, require these decisions in order:

1. Create and protect GitHub environment `production-admin-bootstrap`; add its
   two environment secrets without exposing their values.
2. Obtain and classify an account-backed Guardrails-only diff.
3. Separately authorize and deploy only the exact Guardrails diff; verify a
   clean post-deploy diff.
4. Run the protected AWS DEV plan/deploy for the exact DEV release. Require a
   clean Guardrails diff, disabled DEV schedules, and no administrator task run.
5. Pass the dev-to-main Release Quality Gate and merge the reviewed source.
6. Run the controlled Production plan for the exact `main` SHA and review all
   four stacks for `CREATE`, `UPDATE`, `REPLACE`, and `DELETE`.
7. Separately authorize the exact Production plan/deploy to enable the task;
   keep both schedules disabled and run only safe unauthenticated smoke.
8. Run Production administrator `plan` and review its sanitized artifact and
   64-character approval digest.
9. Obtain explicit authorization for the exact `create` input and approve the
   protected environment again.
10. Review bounded task/deletion evidence, then perform one manual login/logout
   acceptance without accessing business data.

No approval may be inferred from an earlier Production deployment or the DEV
administrator bootstrap.

## Expected AWS Diff Boundary

Guardrails should add only the Production administrator bootstrap OIDC role,
its bounded inline policy, and output. The Production foundation should add the
bootstrap task resources and one ingress path from its security group to
Aurora. Any delete, state-bearing replacement, resource rename, enabled
schedule, or unrelated runtime change is a stop condition.

The exact account-backed diff must be captured after merge because asset IDs,
task revisions, and deployed state cannot be approved from offline synthesis.

## Verification Required Before Merge

- Production and DEV bootstrap runtime tests
- Production approval and workflow contract tests
- account Guardrails and PropertyAlertStack CDK tests
- full unit/component/integration suite
- full TypeScript typecheck
- production build
- offline Production and DEV synthesis with schedules disabled
- `git diff --check`

## Preparation Verification Results

- Focused bootstrap, approval, workflow, runtime-image, Guardrails, and CDK
  suite: 9 files and 72 tests passed.
- Full Vitest suite: 138 files and 1,330 tests passed. The first sandboxed run
  correctly failed because API integration tests could not bind loopback ports;
  the permitted local rerun passed without source changes related to those
  tests.
- Full TypeScript typecheck: passed.
- Production build: passed. The existing ArcGIS large-chunk warning remains
  non-blocking and unrelated to this feature.
- Environment-agnostic Production and DEV synthesis: passed with both worker
  schedules disabled.
- Production template retained the existing Aurora, database secret, VPC,
  daily schedule, and weekly schedule logical IDs asserted by CDK tests.
- Production template contained the five bounded bootstrap outputs and the
  `cpi-production-admin-bootstrap` task; DEV retained
  `cpi-dev-admin-bootstrap`.
- Guardrails template contained distinct DEV and Production bootstrap roles.
- `git diff --check`: passed.

No account-backed diff or AWS mutation was performed. A synth attempt with a
dummy concrete account was rejected by CDK because no credentials were
configured; it made no AWS change and was replaced by the supported
environment-agnostic offline synth. The required real diff remains a future,
separately authorized operation.

## Remaining Risks

- GitHub environment protection and secrets are external state and must be
  verified before any workflow run.
- The OIDC role cannot create itself; an administrator-controlled,
  separately authorized Guardrails update remains necessary.
- The Production task does not exist until a reviewed Production deployment.
- Credential recovery/reset remains intentionally unimplemented.
- Successful user creation is non-reversible through this workflow.
