# Local Listings Vertical-Slice Runbook

## Purpose

Verify the local read path end to end:

```text
React -> Vite /api proxy -> Express -> PostgreSQL
```

This procedure never calls RentCast, Telegram, or AWS. It uses only the local
Docker database and loopback HTTP services.

## Safety Boundary

- Confirm `DATABASE_URL` points to `localhost`, `127.0.0.1`, or `::1` before
  starting the API.
- Never print or commit `.env.local`.
- Do not run this procedure against Aurora or any remote PostgreSQL host.
- Do not use production listing data as a fixture.
- Keep temporary fixture keys prefixed with `block-15-5-` and remove only those
  exact rows after the content-state check.

## Preflight

```bash
docker ps --filter name=cpi-postgres
node --env-file-if-exists=.env.local -e 'const u=new URL(process.env.DATABASE_URL); console.log({host:u.hostname,port:u.port,database:u.pathname.slice(1)})'
lsof -nP -iTCP:3000 -iTCP:5173 -sTCP:LISTEN
```

Stop if the displayed database host is not loopback. Start the API and web app
in separate terminals:

```bash
pnpm api:start
pnpm web:dev
```

The API runs bundled migrations before listening. Migration execution against
AWS remains a separately approved production operation.

## Read Contract

```bash
curl --fail-with-body --include http://127.0.0.1:3000/api/listings
curl --fail-with-body --include http://127.0.0.1:5173/api/listings
curl --include http://127.0.0.1:3000/api/not-a-route
```

Require:

- both listing requests return `200` and `Cache-Control: no-store`
- direct and proxied responses have the same listing count
- every content row has a UUID plus finite latitude and longitude
- no response contains `deduplication_key`, `notification_status`, or secrets
- the unknown route returns bounded `404` JSON with code `NOT_FOUND`

An empty listing array is a valid empty-state result. For a content-state check,
insert only disposable local fixtures through the local database tooling, then
open `http://127.0.0.1:5173` and verify:

- desktop list and map are visible together
- mobile List and Map modes remain usable
- every valid coordinate produces a marker
- selecting a row focuses its marker
- selecting a marker selects the corresponding row
- loading, empty, and error states remain covered by automated tests

Remove the disposable rows by their exact keys:

```bash
docker exec cpi-postgres psql -U cpi_user -d cpi_dev \
  -c "DELETE FROM listings WHERE deduplication_key IN ('block-15-5-eastvale', 'block-15-5-corona');"
```

Then require an empty fixture count:

```bash
docker exec cpi-postgres psql -U cpi_user -d cpi_dev -Atc \
  "SELECT count(*) FROM listings WHERE deduplication_key LIKE 'block-15-5-%';"
```

## Quality Gate

```bash
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

Inspect `apps/web/dist` for server-only configuration names. The build must not
contain `DATABASE_URL`, `RENTCAST_API_KEY`, `TELEGRAM_BOT_TOKEN`,
`TELEGRAM_CHAT_ID`, or the future CloudFront origin verification value.

Stop the API process started by this runbook. Do not stop a pre-existing web
development server owned by another task.
