# AWS Price Estimation Runtime Enablement

## Purpose And Scope

This runbook enables the already-merged Price Estimation application workflow
in an AWS App Runner stage. It is owned by
`feat/aws-price-estimation-runtime-enablement`; it is not a new Block 31
sub-block.

The source change alone does not enable a stage. DEV and Production remain
disabled unless their separate GitHub runtime and budget variables are set to
the exact string `true`. No deployment, secret update, or billable provider
request is authorized merely by merging this source.

## Architecture

When the stage runtime is enabled, CDK:

- adds one managed NAT Gateway and dedicated `ApiEgress` private subnets;
- keeps Aurora in the existing `Database` isolated subnets;
- replaces the App Runner VPC connector with the distinctly named
  `api-egress-connector` on the `ApiEgress` subnets, allowing CloudFormation to
  create it before retiring the fixed-name isolated connector;
- keeps S3 traffic on the gateway VPC endpoint;
- grants the App Runner instance role read access to the stage application
  Secret;
- injects only the `RENTCAST_API_KEY` JSON field into the API container; and
- injects `OPENAI_API_KEY` only when the independent OpenAI flag is enabled.

App Runner sends all custom-VPC outbound traffic through the VPC. AWS therefore
requires a NAT Gateway or an applicable VPC endpoint for public destinations.
RentCast and OpenAI are public HTTPS services and do not provide project-owned
PrivateLink endpoints. See
[AWS App Runner VPC access](https://docs.aws.amazon.com/apprunner/latest/dg/network-vpc.html).

One managed NAT Gateway is deliberately used instead of one per Availability
Zone to bound fixed cost. This accepts a single egress-AZ availability tradeoff;
the database and App Runner service remain multi-AZ. AWS lists NAT Gateway
hourly, data-processing, public IPv4, and internet transfer charges separately.
At the published USD 0.045 hourly example rate, the gateway alone is about
USD 32.85 for a 730-hour month before the other charges. Review current
[Amazon VPC pricing](https://aws.amazon.com/vpc/pricing/) before enablement.

## Stage Configuration

The `development` GitHub environment owns:

| Variable | Enable value | Purpose |
| --- | --- | --- |
| `CPI_DEV_PRICE_ESTIMATION_RUNTIME_ENABLED` | `true` | Creates egress and injects RentCast configuration |
| `CPI_DEV_PRICE_ESTIMATION_BUDGET_APPROVED` | `true` | Explicitly accepts NAT and provider billing |
| `CPI_DEV_PRICE_ESTIMATION_OPENAI_ENABLED` | `true` or `false` | Enables optional OpenAI narrative enhancement |

The `production` GitHub environment uses the corresponding
`CPI_PRODUCTION_PRICE_ESTIMATION_*` variables. All six variables default to
`false` when absent. OpenAI cannot be enabled unless the runtime and budget
approval are enabled.

The workflow validates the flags before synthesis and repeats the same context
for the account-backed diff and deployment. The resulting NAT, subnet,
VPC-connector, IAM, and App Runner changes are therefore visible in the
reviewed CDK diff. Production remains bound to its existing digest approval.

## Secret Preparation

Use a distinct ignored `.env.dev.local` file for DEV. It must contain all five
fields written to `cpi/dev/application`:

```text
RENTCAST_API_KEY
OPENAI_API_KEY
SHOWING_LIST_GENERATION_CONFIG
TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID
```

Do not copy Production credentials into DEV. Do not paste values into GitHub
variables, workflow inputs, terminal arguments, logs, issues, or documentation.
The existing secret synchronizer writes an owner-only temporary AWS CLI input
file, suppresses AWS CLI stdout, and removes the file in `finally`.

Validate without changing AWS:

```bash
pnpm --dir infra/aws application-secret:dev
```

Updating the DEV Secret is a separate AWS mutation and requires explicit
operator authorization:

```bash
pnpm --dir infra/aws application-secret:dev -- --apply
```

If OpenAI enhancement is disabled, `OPENAI_API_KEY` still remains part of the
shared application Secret validation but is not injected into App Runner.
App Runner reads referenced values only during deployment; after any Secret
change, redeploy the service. See
[AWS App Runner environment secrets](https://docs.aws.amazon.com/apprunner/latest/dg/env-variable.html).

## DEV Rollout

1. Obtain a fresh federated `cpi-admin` session and verify the account and
   `us-west-2` region.
2. Prepare distinct DEV values and, with separate approval, update
   `cpi/dev/application`.
3. Set DEV runtime and budget approval variables to `true`. Start with OpenAI
   set to `false` so the deterministic fallback can be verified independently.
4. Push the reviewed source to `dev`.
5. Review the first GitHub environment approval and classify the CDK diff. The
   expected material changes are one NAT Gateway, one Elastic IP, two
   `ApiEgress` subnets and routes, a replacement VPC connector, App Runner
   provider-secret references, and a bounded instance-role policy update.
6. Stop if Aurora, database subnets, database Secret, schedules, or unrelated
   retained Production resources show replacement or deletion.
7. Approve the DEV deployment separately. The workflow keeps both worker
   schedules disabled and waits for the existing health contract.
8. Sign in through CloudFront and perform exactly one Price Estimation request.
   A successful deterministic request can make at most four sequential
   RentCast requests. If OpenAI is later enabled, the same action can add at
   most one OpenAI request.
9. Verify that no address, provider payload, credential, prompt, or AI output
   appears in CloudWatch logs. Retain only bounded request counts and outcomes.

## Production Gate

Production flags remain `false` until DEV acceptance is complete. Production
requires its own stage Secret values, current cost review, account-backed CDK
diff, approval digest, explicit deploy confirmation, and one budgeted manual
acceptance request. Never infer Production enablement from DEV acceptance.

## Rollback

To disable future provider calls immediately at the application boundary,
deploy with the stage runtime variable set to `false`. The reviewed rollback
diff should remove the NAT/EIP and `ApiEgress` subnets, restore the App Runner
connector to isolated subnets, and remove provider secret references. The
Price Estimation route then returns the bounded 503 response while all other
application features remain available.

Secret rotation alone is not a rollback because App Runner retains the value
loaded at its last deployment. Do not delete the shared application Secret.
