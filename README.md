# chaoran-property-intelligence

A TypeScript-powered real estate intelligence platform for listing alerts, showing-list visualization, school proximity, and wildfire risk analysis across five Southern California cities.

## Local verification

Run the complete local integration scenario without external services:

```bash
pnpm verify:local
```

Run the CLI with in-memory adapters and fixture listings:

```bash
pnpm alert-worker:dry-run
```

## Production runtime

Local production-mode execution accepts a PostgreSQL connection string:

```text
DATABASE_URL
RENTCAST_API_KEY
TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID
```

The AWS task receives equivalent split PostgreSQL parameters from CDK and
Secrets Manager:

```text
PGHOST
PGPORT
PGDATABASE
PGUSER
PGPASSWORD
PGSSLMODE=verify-full
```

Use `.env.example` for local development. Never commit secret values.

After building, the explicit production entrypoint is:

```bash
node apps/alert-worker/dist/index.js --run
```

This command runs bundled PostgreSQL migrations, fetches RentCast listings, and
can send Telegram notifications. The database connection is closed before the
process exits.

## AWS deployment foundation

Block 12 defines the deployment without creating AWS resources:

- The deployment region defaults to `us-west-2`. Set `CPI_AWS_REGION` only when
  an intentional project-level override is needed.
- EventBridge Scheduler starts one ECS Fargate task at 8:00 AM in
  `America/Los_Angeles`.
- The task runs in a public subnet with no inbound access and connects to Aurora
  through a security-group rule. Aurora stays in isolated subnets, and the VPC
  has no NAT gateway.
- Aurora PostgreSQL Serverless v2 is encrypted, retained on stack deletion, and
  configured for automatic pause after five idle minutes.
- Database credentials and application credentials are supplied through AWS
  Secrets Manager. PostgreSQL verifies the RDS certificate chain.
- The scheduler is disabled by default so synthesis or an initial deployment
  cannot execute the worker before secrets are configured.

Run the local infrastructure checks:

```bash
pnpm test
pnpm typecheck
pnpm aws:synth
docker build --tag cpi-alert-worker:block12 .
docker run --rm cpi-alert-worker:block12 \
  timeout --signal=TERM 15m node apps/alert-worker/dist/index.js --dry-run
```

Do not run `cdk bootstrap` or `cdk deploy` during Block 12. Block 13 will first
configure AWS budget alerts and secrets, review the synthesized changes, and
then require explicit confirmation before creating billable resources. The
schedule may only be enabled after that setup with the CDK context
`scheduleEnabled=true`.

## Project planning

- [Project roadmap](docs/roadmap.md)
- [AWS deployment decision](docs/adr/0002-aws-deployment-foundation.md)
- [Blocks 16-18 feature knowledge base](docs/knowledge-base/blocks-16-18.md)
