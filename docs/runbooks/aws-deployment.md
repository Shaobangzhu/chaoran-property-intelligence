# AWS Deployment Runbook

Architecture, ownership boundaries, and the complete configuration contract are
documented in [AWS System Design and Configuration](../aws-system-design.md).

## Safety Boundary

The production region is `us-west-2`. The scheduled worker must remain disabled
through Block 13. Block 14 owns the first controlled baseline execution and any
later schedule enablement.

Never paste AWS credentials, RentCast credentials, Telegram credentials, or the
contents of `.env.local` into a terminal command, GitHub variable, issue, log,
or chat. AWS CLI access uses temporary IAM Identity Center credentials under
the `cpi-admin` profile.

## Local Configuration

`.env.local` must contain non-empty values for:

```text
RENTCAST_API_KEY
OPENAI_API_KEY
SHOWING_LIST_GENERATION_CONFIG
TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID
CPI_ALERT_EMAIL
CPI_MONTHLY_BUDGET_USD
```

The deployment email and budget amount become CloudFormation parameters. The
provider credentials and generation configuration are copied to
`cpi/production/application` only after the production stack exists, without
printing their values.

## Preflight

Verify the local toolchain:

```bash
aws --version
docker --version
node --version
pnpm --version
```

Acquire temporary credentials and verify the target identity:

```bash
aws sso login --profile cpi-admin
aws sts get-caller-identity --profile cpi-admin
aws configure get region --profile cpi-admin
```

Before any mutation, record and review the 12-digit account ID. The configured
region and the CDK target must both be `us-west-2`.

If `get-caller-identity` reports the root ARN, stop at the deployment approval
gate. Prefer IAM Identity Center or another federated administrator identity.
A one-time temporary root session may only be used for initial bootstrap after
the account owner explicitly accepts that elevated risk; log out immediately
after the local deployment.

Set `CPI_AWS_PROFILE` only when intentionally using a different federated AWS
CLI profile. The local secret synchronization command defaults to `cpi-admin`.

Run the complete local gate:

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build
pnpm aws:synth
git diff --check
```

## Deployment Order

Deployment requires a separate explicit approval after `cdk diff` review.

1. Bootstrap the reviewed account and `us-west-2` environment. CDK creates its
   `CDKToolkit` stack, asset bucket, ECR repository, and deployment roles.
2. Deploy `ChaoranPropertyIntelligenceGuardrails` with `AlertEmail` and
   `MonthlyBudgetUsd` from `.env.local`.
3. Verify the retained monthly budget and the exact GitHub OIDC subject before
   deploying application resources.
4. Deploy `ChaoranPropertyIntelligenceProduction` with its `AlertEmail`
   parameter and `scheduleEnabled=false`.
5. Replace the placeholder application secret with the five application values
   from `.env.local` without displaying their values.
6. Verify the Budget email subscriber and confirm the separate SNS subscription
   email. Only the SNS failure subscription requires its confirmation link.

The first deployment is local because it creates the OIDC role that future
GitHub Actions runs assume.

## Cost Envelope

The `$20` monthly budget intentionally excludes credits and refunds so it shows
gross service consumption before the account's credit balance masks it. Alerts
fire at `$10`, `$16`, and `$20` actual gross spend, plus a `$20` forecast.

For one short daily task, the expected low-usage month is approximately `$2-6`:

- two Secrets Manager secrets are approximately `$0.80` per month before API
  call charges
- Aurora storage, I/O, backup growth, and brief Serverless v2 ACU usage are the
  main variable costs
- Fargate compute and a public IPv4 assigned only while the task runs should be
  measured in cents to low tenths of a dollar at this schedule
- CloudWatch Logs, ECR storage, SQS, SNS, and EventBridge should be small at this
  traffic level
- ordinary AWS Budget monitoring and email notifications are free

This is an engineering estimate, not a quote. A database that fails to pause,
larger stored data, repeated task failures, or manual runs can increase it. AWS
Budgets data can also lag actual usage, so the budget is an alert rather than a
hard spending cap.

Validate the local application secret configuration without contacting AWS:

```bash
pnpm --dir infra/aws application-secret
```

After the production stack exists and deployment is approved, apply it with:

```bash
pnpm --dir infra/aws application-secret -- --apply
```

The command writes the secret document to a randomly named temporary file with
owner-only permissions, passes only that file path to AWS CLI, and removes the
directory immediately afterward. It does not place secret values in command
arguments or print them.

## GitHub Configuration

Configure these repository values after the first deployment:

```text
Repository variable: AWS_ACCOUNT_ID
Repository variable: CPI_MONTHLY_BUDGET_USD
Repository secret:   CPI_ALERT_EMAIL
```

`AWS_ACCOUNT_ID` is not a credential. `CPI_ALERT_EMAIL` is stored as a GitHub
secret to avoid unnecessary disclosure. Do not add AWS access key secrets.

The `Deploy production` workflow:

- can only be started manually from `main`
- requires the exact confirmation text `deploy-production`
- requests an OIDC token with `id-token: write`
- runs tests, typecheck, and build before deployment
- pins every action to an immutable commit SHA
- forces `scheduleEnabled=false`
- forces `showingListScheduleEnabled=false` and supplies its weekday, hour,
  minute, and IANA time zone explicitly

## Post-Deployment Verification

Verify without running the worker:

- both CloudFormation stacks are `CREATE_COMPLETE` or `UPDATE_COMPLETE`
- the monthly budget amount and four notification thresholds are correct
- the OIDC provider audience is `sts.amazonaws.com`
- the role subject is exactly
  `repo:Shaobangzhu/chaoran-property-intelligence:ref:refs/heads/main`
- both EventBridge Scheduler resources are `DISABLED`
- Aurora is encrypted, private, and configured for 0 to 1 ACU
- the database security group accepts port 5432 only from the worker group
- both failure EventBridge rules are enabled
- the SNS email subscription is confirmed
- the application secret contains all five required JSON keys without reading
  or logging their values

Do not run the ECS task during Block 13.

## Teardown

Application teardown and full cost teardown are different operations.

1. Confirm the scheduler is disabled.
2. Review `cdk diff` and destroy only the production stack.
3. The Aurora cluster, writer, subnet group, and database credentials secret are
   retained. Verify them explicitly after stack deletion.
4. To stop all database-related cost, take a final snapshot if required, remove
   deletion protection, delete the retained Aurora resources, and then delete
   the retained database credentials secret.
5. Keep the guardrails stack and budget until all retained billable resources
   are gone.
6. Delete the guardrails and `CDKToolkit` stacks only after confirming their S3
   and ECR assets are no longer needed.

Never treat a successful `cdk destroy` as proof that the AWS account has no
remaining billable resources.

## Feature Rollouts

The Block 20 worker image, migration 006, legacy price-state initialization,
real RentCast request, Telegram delivery, and schedule enablement use separate
approval boundaries. Follow the
[price-alert production readiness runbook](price-alert-production-readiness.md)
instead of allowing the default worker command to combine those operations.
