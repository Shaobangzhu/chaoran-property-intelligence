# Block 29.2 Bootstrap And Guardrails Execution Record

## Record

- Date: 2026-08-28
- Branch: `feature/block-29-2-aws-bootstrap-guardrails`
- AWS profile: `cpi-admin`
- Principal: expected non-root AWS IAM Identity Center assumed role
- Account: confirmed; full account ID intentionally omitted
- Result: `29.2a` and `29.2b` complete

Block 29.2 used two separate owner authorizations. No application stack,
database, migration, worker, schedule, provider, Telegram, notification
publish, or production-data operation was executed.

## 29.2a Missing-Region CDK Bootstrap

### Preflight

- `us-west-2`: `CDKToolkit` already `CREATE_COMPLETE`, bootstrap version 32.
- `us-east-1`: `CDKToolkit` absent.
- Target was restricted to `us-east-1`; the existing western stack was not
  updated.
- Parameters were aligned with the existing western bootstrap:
  - qualifier `hnb659fds`
  - AWS-managed S3 encryption key
  - S3 public access block enabled
  - external-ID denial enabled
  - AWS-managed `AdministratorAccess` CloudFormation execution policy
  - no trusted deployment or lookup accounts
  - termination protection disabled

Expected classification:

```text
CREATE: CDKToolkit and 11 standard bootstrap resources
UPDATE: none
REPLACE: none
DELETE: none
```

### Outcome

The owner explicitly authorized creation in `us-east-1`. CloudFormation
completed with:

- stack status `CREATE_COMPLETE`
- bootstrap version 32
- one S3 staging bucket and bucket policy
- one ECR repository
- five named IAM roles
- two inline IAM policies
- one SSM bootstrap-version parameter

Every resource reported `CREATE_COMPLETE`. No KMS customer-managed key or
permissions-boundary policy was created under the selected parameters.

## 29.2b Guardrails And GitHub OIDC

### Account-Backed Plan

The authorized account-backed template diff was:

```text
CREATE: 2
UPDATE: 1
REPLACE: 0
DELETE: 0
```

Created:

- `cpi-github-deploy-dev`
- its bounded inline deployment policy

Updated in place:

- the existing `cpi-github-deploy` inline policy with the production public
  delivery permissions already defined and tested in source

The production role, production trust policy, OIDC provider, retained budget,
budget subscribers, and CloudFormation parameters were not replaced. Protected
local parameter values matched the deployed values before deployment; values
were not logged or committed.

The diff was regenerated immediately before deployment and produced the same
classification. The owner then separately authorized only the Guardrails
stack update.

### Outcome

`ChaoranPropertyIntelligenceGuardrails` reached `UPDATE_COMPLETE` with the
expected two creates and one in-place update. Post-deployment account-backed
diff reported zero differences.

Trust verification:

```text
production sub = repo:Shaobangzhu/chaoran-property-intelligence:ref:refs/heads/main
DEV sub        = repo:Shaobangzhu/chaoran-property-intelligence:environment:development
audience       = sts.amazonaws.com
```

DEV role verification:

- `sts:AssumeRole` names only the deploy, file-publishing, image-publishing,
  and lookup bootstrap roles in `us-west-2` and `us-east-1`.
- stack reads are limited to the named Guardrails and DEV stacks.
- S3 permissions are limited to the deterministic DEV Web bucket.
- CloudFront invalidation requires the DEV deployment-stage resource tag.
- App Runner describe is limited to the DEV service name.
- the only wildcard-resource action is read-only `apprunner:ListServices`,
  which does not support a service resource ARN.
- no long-lived AWS access key was introduced.

The only existing CPI schedule remained `DISABLED`; DEV and weekly schedules
remain absent.

## Architecture And Safety Decisions

- Preserve the production OIDC role identity and exact-main trust.
- Create the DEV role through the administrator-controlled Guardrails stack;
  it cannot create itself through GitHub OIDC.
- Keep the standard bootstrap qualifier and parameters consistent across both
  regions.
- Accept the existing broad bootstrap CloudFormation execution policy only for
  CDK deployment plumbing; runtime roles remain separate and bounded.
- Do not treat AWS readiness as deployment authorization. GitHub environment
  and branch protections remain mandatory before the first DEV deployment.

## Remaining Risks And Next Gate

- The `development` environment still has no required reviewer or `dev`-only
  branch restriction.
- `main` and `dev` still have no branch protection or repository ruleset.
- The protected `production` environment is still absent.
- Both bootstrap stacks and Guardrails have termination protection disabled.
- The bootstrap CloudFormation execution roles use `AdministratorAccess`.
- DEV application stacks and public runtime remain absent.

Block 29.3 must configure and verify the GitHub protection boundary before any
DEV plan or deployment. This record does not authorize Block 29.3.

## Local Verification

- Guardrails and DEV/production deployment workflow tests: 3 files and 18
  tests passed.
- Full monorepo typecheck passed.
- Production build passed. The existing Vite large-chunk warning remains and
  is unrelated to this documentation and deployment operation.
- `git diff --check` and the committed-evidence sensitive-value scan passed.

## References

- [Block 29 launch runbook](../runbooks/block-29-aws-public-launch.md)
- [Block 29 knowledge base](../knowledge-base/block-29-aws-public-launch-and-operational-readiness.md)
- [Block 29.1 preflight](block-29-1-read-only-launch-preflight.md)
- [ADR 0017](../adr/0017-aws-public-launch-and-operational-readiness.md)
