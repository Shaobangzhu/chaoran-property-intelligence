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

The production worker requires these environment variables:

```text
DATABASE_URL
RENTCAST_API_KEY
TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID
```

Use `.env.example` as the list of required names. Never commit their values.

After building, the explicit production entrypoint is:

```bash
node apps/alert-worker/dist/index.js --run
```

This command runs bundled PostgreSQL migrations, fetches RentCast listings, and
can send Telegram notifications. The database connection is closed before the
process exits. Deployment configuration is intentionally deferred to the next
block.

## Project planning

- [Project roadmap](docs/roadmap.md)
- [Blocks 16-18 feature knowledge base](docs/knowledge-base/blocks-16-18.md)
