# Local Authentication Configuration

## Scope

Block 16.3 defines and validates the JWT signing configuration. The current API
does not consume these values until the authentication composition is connected
in Block 16.5. This runbook prepares local values without creating users,
issuing tokens, changing a database, or contacting AWS.

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

JWT verification establishes only a candidate identity. Block 16.5 must reload
the database user and enforce current role and status before authorizing a
protected request.

## Rotation Boundary

Changing `JWT_SIGNING_SECRET` invalidates every existing token. Rotation must be
coordinated with API deployment and requires users to log in again. Production
secret creation and rotation remain separately reviewed AWS operations.
