# Local Authentication Configuration

## Scope

Block 16.5 connects the JWT signing configuration to the Express API. The API
will not start without valid JWT values. This runbook prepares local values
without creating users, issuing tokens, changing a database, or contacting AWS.

## Generate the Signing Secret

Generate 32 random bytes and encode them as canonical base64url:

```bash
node -e 'console.log(require("node:crypto").randomBytes(32).toString("base64url"))'
```

Place the output only in ignored `.env.local` as `JWT_SIGNING_SECRET`. Never put
the output in `.env.example`, Git, GitHub variables, logs, documentation, shell
commands, or browser-prefixed environment variables.

Add the non-secret identifiers:

```text
JWT_ISSUER=urn:chaoran-property-intelligence:auth
JWT_AUDIENCE=urn:chaoran-property-intelligence:api
```

Keep the local HTTP boundary explicit:

```text
API_DEPLOYMENT_MODE=local
API_PORT=3000
API_PUBLIC_ORIGIN=http://127.0.0.1:5173
```

Local mode binds only to `127.0.0.1`, uses the `cpi_session` cookie without the
`Secure` attribute, and does not consume `PORT` or
`API_ORIGIN_VERIFICATION_SECRET`. Production mode must never be used as a local
shortcut because it binds to all interfaces and requires the CloudFront origin
guard contract.

The signing secret must decode to 32-64 bytes. The adapter rejects padded,
non-canonical, malformed, short, and oversized base64url values without
printing the configured value.

## Token Profile

The access-token adapter uses:

```text
algorithm: HS256 only
type: cpi-access+jwt
lifetime: 3600 seconds
clock tolerance: 5 seconds
claims: sub, role, iat, exp, iss, aud, jti
```

The subject and token ID are UUIDs. The first supported role is `admin`.
Verification rejects additional headers or claims, audience arrays, a different
algorithm or type, nonstandard lifetime, and invalid issuer or audience. Every
failure is translated to the bounded application error `Access token is
invalid`.

JWT verification establishes only a candidate identity. The Block 16.5
authentication middleware reloads the database user and enforces current role
and status before authorizing `/api/auth/me` or `/api/listings`.

## Local API Preflight

Before `pnpm api:start`, require a loopback `DATABASE_URL`, the three JWT values,
and the local HTTP settings above. The API runs bundled migrations before
listening. Creating an administrator remains a separate explicit operation
through `pnpm user:create-admin`; starting the API does not create one.

`GET http://127.0.0.1:3000/api/health` is public. Login and logout require the
exact `Origin: http://127.0.0.1:5173` header, and listings require the HttpOnly
session cookie. The API ignores bearer tokens. Block 16.6 uses these endpoints
through same-origin browser requests and never reads or stores the JWT in React.

## Rotation Boundary

Changing `JWT_SIGNING_SECRET` invalidates every existing token. Rotation must be
coordinated with API deployment and requires users to log in again. Production
secret creation and rotation remain separately reviewed AWS operations.
