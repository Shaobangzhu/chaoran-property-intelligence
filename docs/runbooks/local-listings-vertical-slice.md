# Local Listings Vertical-Slice Runbook

## Purpose

Verify the local read path and its authentication boundary:

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
curl --fail-with-body --include http://127.0.0.1:3000/api/health
curl --include http://127.0.0.1:3000/api/listings
curl --include http://127.0.0.1:5173/api/listings
curl --include http://127.0.0.1:3000/api/not-a-route
```

Require:

- health returns `200` without querying PostgreSQL application data
- both unauthenticated listing requests return bounded `401` JSON
- no response contains secrets
- the unknown route returns bounded `404` JSON with code `NOT_FOUND`

Block 16.6 supplies the login and session bootstrap UI. Automated API and React
tests cover successful cookie-authenticated listing reads without writing
credentials to shell history or exposing the JWT to browser code.

### Authenticated Content Check After Block 16.6

An empty listing array is a valid authenticated empty state. For a content-state
check, insert only disposable local fixtures through the local database tooling,
then open `http://127.0.0.1:5173`. Require the session check to resolve to the
login form, sign in with the local administrator created through the masked CLI,
and verify:

- browser reload restores the session without displaying protected content first
- sign out returns to login and a direct unauthenticated listings request is `401`
- no token appears in browser-managed local or session storage
- desktop list and map are visible together
- mobile List and Map modes remain usable
- every content row has a UUID plus finite latitude and longitude
- no response contains `deduplication_key` or `notification_status`
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
