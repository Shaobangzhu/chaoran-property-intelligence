# Block 29.1 Read-Only Launch Preflight

## Record

- Date: 2026-08-28
- Scope: AWS and GitHub metadata inspection only
- AWS profile: `cpi-admin`
- Expected account: confirmed; full account ID intentionally omitted
- Principal: non-root AWS IAM Identity Center assumed role
- Configured region: `us-west-2`
- Repository branch: `feature/block-29-1-aws-preflight`
- Result: inventory complete; launch is blocked pending the actions below

No bootstrap, change set, CDK diff, deployment, migration, secret read or
write, schedule invocation, provider call, SNS publish, database access, or
production data operation was performed.

## AWS Inventory

### CloudFormation And Bootstrap

| Region | Resource | Observed state |
| --- | --- | --- |
| `us-west-2` | `CDKToolkit` | `CREATE_COMPLETE`; bootstrap version 32 |
| `us-west-2` | `ChaoranPropertyIntelligenceGuardrails` | `CREATE_COMPLETE` |
| `us-west-2` | `ChaoranPropertyIntelligenceProduction` | `UPDATE_COMPLETE` |
| `us-east-1` | `CDKToolkit` | Missing |

The three DEV stacks are absent:

- `ChaoranPropertyIntelligenceDev`
- `ChaoranPropertyIntelligenceDevEdge`
- `ChaoranPropertyIntelligenceDevPublicApplication`

The production public stacks are also absent:

- `ChaoranPropertyIntelligenceProductionEdge`
- `ChaoranPropertyIntelligenceProductionPublicApplication`

No App Runner service, CPI public Web bucket, or CloudFront distribution was
observed. This is consistent with the public runtime not having been deployed.

The active `us-west-2` stacks have termination protection disabled and drift
status `NOT_CHECKED`. No drift detection was started during this phase.

### GitHub OIDC

- The account has an OIDC provider for `token.actions.githubusercontent.com`
  with audience `sts.amazonaws.com`.
- `cpi-github-deploy` exists and trusts only
  `repo:Shaobangzhu/chaoran-property-intelligence:ref:refs/heads/main`.
- `cpi-github-deploy-dev` is missing.

The missing DEV role explains the previous GitHub Actions
`sts:AssumeRoleWithWebIdentity` failure on `dev`. The existing production role
and its `main` trust subject must be preserved.

### Schedules And Notifications

- `cpi-daily-property-alert`: `DISABLED`
- `cpi-weekly-showing-list`: missing
- `cpi-dev-daily-property-alert`: missing
- `cpi-dev-weekly-showing-list`: missing
- Monthly cost budget: configured with actual thresholds at 50%, 80%, and
  100%, plus a forecast threshold at 100%; current cost is below the first
  threshold.
- Budget email subscribers are configured, but the Budgets API did not expose
  confirmation state. Subscriber endpoints were not recorded.
- `cpi-production-worker-failures` has one confirmed email subscription and no
  pending subscription. The endpoint was not recorded.

## GitHub Inventory

### Branch And Environment Controls

- `main`: no classic branch protection and no repository ruleset.
- `dev`: no classic branch protection and no repository ruleset.
- `development`: exists, but has no required reviewers, wait timer, or branch
  restriction; administrator bypass is enabled.
- `production`: missing.

These controls do not meet the Block 29 launch contract. No GitHub setting was
changed during this phase.

### Actions Configuration

Repository variables present:

- `AWS_ACCOUNT_ID` (value confirmed; value omitted)
- `CPI_MONTHLY_BUDGET_USD` (configured)

Repository secret present:

- `CPI_ALERT_EMAIL` (name inspected only)

`CPI_AWS_DEV_BASE_URL` is not configured because the DEV CloudFront endpoint
does not exist yet. No `AWS_ACCESS_KEY_ID` or `AWS_SECRET_ACCESS_KEY` repository
secret is present. The `development` environment currently has no scoped
variables or secrets.

## Required Actions Before First DEV Deployment

1. Obtain explicit authorization for the `us-east-1` CDK bootstrap described
   by Block 29.2a, then review its resulting resources.
2. Prepare and review the bounded Guardrails change that creates
   `cpi-github-deploy-dev`; preserve the production role and trust subject.
3. Add branch protections or rulesets for `dev` and `main` with the required
   PR quality gates.
4. Restrict `development` deployments to `dev` and require review before the
   plan and deploy approvals described by the workflow.
5. Add a protected `production` environment and bind the production workflow
   job to it before any production public deployment.
6. Keep all DEV and production schedules disabled through initial launch.
7. Decide whether termination protection and an explicit drift baseline are
   required before production launch; do not change either without review.

## Decision

Block 29.1 is complete as a read-only inventory. Block 29.2 remains blocked on
new, explicit mutation authorization. This record is evidence of observed
state, not authorization to remediate it.

## References

- [Block 29 knowledge base](../knowledge-base/block-29-aws-public-launch-and-operational-readiness.md)
- [Block 29 launch runbook](../runbooks/block-29-aws-public-launch.md)
- [ADR 0017](../adr/0017-aws-public-launch-and-operational-readiness.md)
