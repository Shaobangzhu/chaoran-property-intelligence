# chaoran-property-intelligence

A TypeScript-powered real estate intelligence platform for listing alerts,
showing-list visualization, school proximity, and wildfire hazard visualization
across five Southern California cities.

## Local verification

Run the complete test suite, including the manual-listing PostgreSQL adapter,
authenticated API, and browser workflow integration harnesses:

```bash
pnpm test
```

Run the alert-worker local integration scenario without external services:

```bash
pnpm verify:local
```

Run the CLI with in-memory adapters and fixture listings:

```bash
pnpm alert-worker:dry-run
```

## Local listings API

Set `DATABASE_URL` in `.env.local`, then start the loopback-only API:

```bash
pnpm api:start
```

The command builds the API, loads `.env.local` with Node's built-in env-file
support, runs bundled PostgreSQL migrations, and listens on
`http://127.0.0.1:3000` by default. Set `API_PORT` to use another local port.
The local script disables the AWS Showing List artifact reader even when
unrelated AWS deployment values are present in `.env.local`.

The first endpoint is:

```text
GET http://127.0.0.1:3000/api/listings
```

This endpoint is intentionally local-only. Do not bind it to a public interface
or point it at the AWS production database. The Block 16 security code gate is
complete; public deployment still requires the separate AWS infrastructure,
cost, secrets, WAF, response-header, rollback, and smoke-test review.

Block 16.3 defines server-only JWT configuration in `.env.example`. Follow the
[local authentication configuration runbook](docs/runbooks/local-auth-configuration.md)
to generate a base64url signing secret for ignored `.env.local`. The API loads
these values at startup and issues the session JWT only in an HttpOnly cookie.

## Local administrator

After confirming `DATABASE_URL` points to the local Docker PostgreSQL database,
create the initial administrator with:

```bash
pnpm user:create-admin --email admin@example.com
```

The command builds the dedicated admin CLI, loads `.env.local`, runs bundled
migrations, and requests the password twice with masked input. It never prints
the password or hash. Follow the
[local administrator runbook](docs/runbooks/create-local-admin.md) before
executing this database-writing command. Block 16.2 implemented and tested the
command but did not create a real user.

## Local web application

With the local API running, start the Vite development server in a second
terminal:

```bash
pnpm web:dev
```

Open `http://127.0.0.1:5173`. Vite proxies `/api` requests to the loopback API at
`http://127.0.0.1:3000`, so no development CORS policy is required.

The React application checks the current session before mounting protected
content and provides login, logout, bounded recovery, and automatic sign-out on
an expired listings session. It renders loading, empty, error, retry, and
listing content states alongside a MapLibre map using the OpenFreeMap Liberty
style. Listings are converted to a minimal client-side GeoJSON point source,
and selecting a listing or marker keeps the two views synchronized. An
authenticated administrator can also enter a manual listing, place or drag its
draft marker, explicitly confirm the coordinates, and submit it through the
protected API. Moving the marker clears confirmation, and successful creation
adds the returned normalized listing to the shared list and map. A selected
manual listing can be edited through the same confirmed-marker workflow or
archived after an inline confirmation; RentCast records remain read-only and
archived rows leave the default active query without being deleted. The client
validates API responses at runtime and never receives database, RentCast,
Telegram, or AWS credentials. The browser never reads or stores the JWT. The
web application remains local-only and is not deployed.

The API limits failed login responses to ten per 15 minutes per process before
password verification, emits only request-ID-based security events, and requires
explicit admin authorization for listings. API responses use Helmet security
headers. The web document CSP permits the selected OpenFreeMap tile service but
does not permit inline scripts or eval.

OpenFreeMap requires no browser API key, but its public service is an external
development dependency without a project-specific availability guarantee. Map
driver tests use fakes and never contact the style or tile service.

The approved production target is AWS: CloudFront serves the React/Vite build
from a private S3 origin and routes `/api/*` under the same HTTPS origin to an
AWS-hosted Express application. Vercel is not part of the current production
plan. App Runner is the selected Express compute target: it preserves the
container and `node-postgres` runtime, reaches private Aurora through a VPC
Connector, and receives traffic through a CloudFront-protected origin. The API
and web application remain undeployed until the separately reviewed App Runner,
CloudFront, WAF, response-header, secrets, and rollback plan is implemented.

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

Block 20.1A adds an isolated RentCast price-drop coverage audit command. It
does not run through the production worker, connect to PostgreSQL, or send
Telegram. Running the script without its explicit confirmation argument exits
before `fetch`:

```bash
pnpm rentcast:coverage-audit
```

The separately approved one-request form is:

```bash
pnpm rentcast:coverage-audit:execute-one-request
```

The command loads only `RENTCAST_API_KEY`, uses the audit-only `*:850000`
price range plus `includeTotalCount=true`, and prints aggregate counts, price
range, response-body bytes, elapsed time, and the 500-result cap margin. It
never prints credentials, the request URL, raw response, or street addresses.
Block 20.1A implemented and tested this command without making a real RentCast
request. Block 20.1B later executed it once under explicit approval and recorded
only aggregate evidence in the Block 20 knowledge base. A future repeat still
requires a fresh quota and request review.

The production image also provides a read-only aggregate baseline check:

```bash
node apps/alert-worker/dist/index.js --verify-baseline
```

This mode queries only schema readiness, migration state, the baseline marker,
and baseline/pending/sent counts. It does not run migrations or call RentCast
or Telegram. Follow the
[production baseline runbook](docs/runbooks/production-baseline.md) before its
first AWS use.

The image also provides an isolated Telegram production smoke test:

```bash
node apps/alert-worker/dist/index.js --telegram-smoke-test
```

This mode loads only the Telegram bot token and chat ID, sends one fixed test
message, and does not connect to PostgreSQL or call RentCast. Follow the
[Telegram production smoke-test runbook](docs/runbooks/telegram-production-smoke-test.md).

## AWS deployment

The production deployment is defined with AWS CDK:

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

Block 13 adds a retained monthly gross-cost budget, a branch-restricted GitHub
OIDC deployment role, and email alerts for ECS startup failures and non-zero
container exits. Production deployment is manual-only, and the schedule remains
disabled until the controlled baseline run in Block 14.

Follow the [AWS deployment runbook](docs/runbooks/aws-deployment.md). Never run
`cdk bootstrap`, `cdk deploy`, or `cdk destroy` without reviewing the target AWS
account, region, parameters, and retained resources first.
Local AWS access uses temporary IAM Identity Center credentials through the
`cpi-admin` CLI profile.

The [AWS system design and configuration](docs/aws-system-design.md) documents
the deployed topology, stack ownership, identity model, network boundaries,
runtime flow, security controls, resource lifecycle, and the explicitly labeled
planned React/Express production boundary.

## Project planning

- [Project roadmap](docs/roadmap.md)
- [AWS system design and configuration](docs/aws-system-design.md)
- [AWS deployment decision](docs/adr/0002-aws-deployment-foundation.md)
- [API, web, and map foundation decision](docs/adr/0003-api-web-map-foundation.md)
- [Manual listing model decision](docs/adr/0005-manual-listing-model.md)
- [Latest-only Showing List publication decision](docs/adr/0006-latest-only-showing-list-publication.md)
- [Wildfire hazard overlay decision](docs/adr/0007-wildfire-hazard-overlay.md)
- [Price-drop alert state and outbox decision](docs/adr/0008-price-drop-alert-state-and-outbox.md)
- [Block 19.1 wildfire hazard source audit](docs/data/wildfire-hazard-source-audit.md)
- [Wildfire hazard data builder](tools/wildfire-hazard/README.md)
- [AWS deployment runbook](docs/runbooks/aws-deployment.md)
- [Production baseline runbook](docs/runbooks/production-baseline.md)
- [Telegram production smoke-test runbook](docs/runbooks/telegram-production-smoke-test.md)
- [Weekly Showing List production runbook](docs/runbooks/showing-list-production.md)
- [Blocks 16-18 feature knowledge base](docs/knowledge-base/blocks-16-18.md)
- [Block 19 wildfire hazard overlay knowledge base](docs/knowledge-base/block-19-wildfire-hazard-overlay.md)
- [Block 20 price-drop alerts knowledge base](docs/knowledge-base/block-20-price-drop-alerts.md)
