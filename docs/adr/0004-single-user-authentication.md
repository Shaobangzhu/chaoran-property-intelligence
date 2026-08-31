# ADR 0004: Single-User Authentication

## Status

Accepted

## Context

Block 15 established a local PostgreSQL-backed listings API and React map. The
API currently exposes `GET /api/listings` without authentication and is bound
only to loopback. ADR 0003 prohibits public deployment until the API enforces
authentication and authorization.

The first production release has one administrator, but the persistence and
application boundaries must support additional users later without replacing a
hard-coded credential. The application will use one CloudFront HTTPS origin:

```text
browser -> CloudFront -> private S3 React build
                     -> /api/* -> App Runner Express -> Aurora PostgreSQL
```

CloudFront routing, an App Runner origin header, and React route guards do not
authenticate a user. Express remains the authorization boundary.

Block 16.0 records decisions only. It does not install dependencies, create the
user table, add routes, provision AWS resources, or deploy either application.

## Decision

Implement authentication as separately confirmed Block 16 sub-blocks. Use a
normal user model, Argon2id password hashes, a short-lived signed JWT in an
HttpOnly cookie, live user-status checks, and server-enforced authorization.

### Dependency Direction

The existing dependency direction remains:

```text
entrypoints -> application -> domain
infrastructure -> application ports
```

Ownership is:

- `packages/domain` owns user identity, role, status, and pure normalization or
  validation rules
- `packages/application` owns authentication use cases plus `UserRepository`,
  `PasswordHasher`, and `TokenService` ports
- `packages/postgres` implements user persistence and defensive row parsing
- `apps/api` owns HTTP DTOs, cookie policy, origin checks, rate limiting,
  authentication middleware, safe logging, and runtime composition
- `apps/web` owns login form state, current-user bootstrap, logout, and the
  protected application experience

Password hashing, JWT, PostgreSQL, Express, and React types do not cross into
the domain package.

### User Model and Persistence

Add a `users` table in a separately approved migration with:

```text
id, normalized_email, password_hash, role, status, created_at, updated_at
```

- `id` is a database-generated UUID.
- `normalized_email` is trimmed, lowercased, bounded, and unique. Do not apply
  provider-specific rewriting such as removing Gmail dots or plus suffixes.
- the first supported role is `admin`
- supported statuses are `active` and `disabled`
- timestamps are server-generated `timestamptz` values
- the password hash is never returned by a profile query or HTTP DTO

The repository provides only the operations required by admin creation and
authentication. PostgreSQL uniqueness failures are translated to a bounded
application error rather than leaking driver details.

### Password and Admin Creation

Use Argon2id through an injected `PasswordHasher`. The initial work-factor
baseline is:

```text
memory: 19 MiB
iterations: 2
parallelism: 1
```

Block 16.2 benchmarks this baseline on the development machine and production
container shape. A hash operation should remain below one second without
weakening the documented minimum. Use the maintained `argon2` package so hash
parameters and salt are stored in its PHC string and verification does not rely
on a project-specific hash format. Node's built-in Argon2 was considered, but
using its raw derived key would make the project own salt, parameter, encoding,
and migration details that the established package already handles.

Passwords:

- are normalized with Unicode NFC consistently before hashing and verification
- have a minimum of 15 characters and a maximum of 128 characters
- permit spaces and Unicode and have no composition rules
- are checked against a bounded common and context-specific password blocklist
- are never trimmed, logged, printed, persisted in plaintext, or sent to an
  external password-checking service

Create the initial administrator only through `pnpm user:create-admin`. The CLI
uses a hidden interactive password prompt, requires confirmation, and rejects a
duplicate normalized email. It has no registration HTTP endpoint. A later
production admin-creation execution requires a separately reviewed private
database path and explicit operational approval.

Block 29.3a extends the same application use case to AWS DEV through a separate
non-interactive entry point. It runs only in a DEV-only, unscheduled Fargate
task, reads credentials from a per-run temporary Secrets Manager secret, uses
an isolated OIDC role and security group, does not run migrations, and never
prints the email, password, hash, or secret value. Plan and create are separate
manual workflow runs bound to an immutable digest. This does not authorize or
design production administrator creation.

Block 29.6f adds the separately reviewed production design. It does not reuse
the DEV role, environment, task family, secret prefix, confirmation phrase, or
credentials. A protected `production-admin-bootstrap` environment gates both
manual runs from exact `main`; a sanitized plan binds the email identity hash,
task revision, immutable image digest, networking, and disabled schedule state
to a 64-character approval digest. Only a second explicitly authorized run may
create one temporary secret and start one unscheduled Production Fargate task.
The task calls the same application use case with migrations disabled and emits
only bounded result codes. Source merge and infrastructure enablement do not
authorize the production-data mutation.

Authentication performs one Argon2 verification for both known and unknown
emails by using a fixed valid dummy hash for the unknown-user path. Public
credential failures use one generic response. This reduces useful account
enumeration signals without claiming perfectly constant request timing.

### JWT Profile

Use the maintained `jose` package. Sign one access-token type with `HS256` and a
random secret containing at least 256 bits of entropy. Verification explicitly
allows only `HS256`; the token header cannot select another algorithm.

Required claims are:

```text
sub, role, iat, exp, iss, aud, jti
```

- `sub` is the user UUID.
- `role` is `admin` in the first release.
- `iss` and `aud` are exact configured values and are always verified.
- `jti` is a cryptographically random identifier for traceability and future
  revocation support.
- expiration is initially 60 minutes with a small bounded clock tolerance.
- the token header uses an explicit application-specific `typ` value.

The token never contains email, password data, API keys, customer data, or
listing data. Signing configuration remains server-only.

JWT verification establishes a candidate identity, not final authorization.
Every protected request reloads the user by `sub`, requires `active` status,
and derives current authorization from the database record. A disabled or
missing user is rejected immediately even when a previously issued JWT has not
expired. A mismatched token and database role is rejected.

No refresh token or server-side JWT revocation list is added initially. Logout
clears the browser cookie but cannot invalidate a copied token for an otherwise
active user. HttpOnly storage, TLS, origin checks, live user checks, and the
one-hour expiration bound this accepted first-release risk. Disabling the user
remains the emergency invalidation mechanism.

### Cookie Contract

The API transports the JWT only in a cookie. It does not accept bearer tokens
from browser storage and the web application never reads the token.

Production cookie:

```text
name: __Host-cpi_session
HttpOnly: true
Secure: true
SameSite: Strict
Path: /
Domain: omitted
Max-Age: no longer than token lifetime
```

Local development uses `cpi_session` with `Secure=false` only through explicit
local configuration. All other attributes remain aligned. Login and logout use
one shared cookie-policy function so logout clears the exact name and path that
login set.

### HTTP Contract

The first authentication routes are:

```text
POST /api/auth/login
POST /api/auth/logout
GET  /api/auth/me
GET  /api/listings       protected
GET  /api/health         public and database-independent
```

- login accepts bounded JSON containing only `email` and `password`
- successful login returns the minimum user profile and sets the cookie
- invalid credentials, unknown users, and disabled users return the same public
  `401` error shape
- logout is idempotent, clears the cookie, and returns `204`
- current-user returns the minimum profile or a bounded `401`
- protected routes return `401` for missing or invalid authentication and `403`
  only when an authenticated user lacks required authorization
- malformed JSON and oversized bodies receive bounded errors
- authentication and listings responses retain `Cache-Control: no-store`

### Same-Origin, CSRF, and Origin Protection

Production and local Vite-proxy browser traffic are same-origin. Do not enable
CORS for the planned topology. A future cross-origin client requires a new
review and an exact credentialed allowlist; wildcard credentialed CORS is never
allowed.

For every unsafe HTTP method, including login and logout, Express requires an
exact configured `Origin` match before parsing credentials or executing a use
case. Missing, opaque, or mismatched origins are rejected. `SameSite=Strict`
provides an additional browser control but does not replace server validation.

For a default CloudFront hostname, whose value is unavailable before the
distribution is created, CloudFront's viewer-request function overwrites
`x-cpi-viewer-origin` from the accepted viewer `Host`. Production API
configuration may use only that exact trusted header name and only when
`API_PUBLIC_ORIGIN` is absent. Express compares the browser `Origin` to the
marker after the independent origin-verification secret succeeds. A viewer
cannot choose the marker value through CloudFront, and a direct App Runner
request cannot satisfy the secret boundary.

In production, the App Runner origin-verification middleware runs before body
parsing, rate limiting, and authentication. CloudFront overwrites the configured
header value, and App Runner rejects a missing or mismatched value. Local mode
can disable this check only through explicit validated configuration. The
origin secret never appears in React, source control, CDK synth output, or logs.
The sole exception is `GET /api/health`, which returns no application data and
does not query the database, so App Runner can perform its direct health probe.

### Login Abuse and Security Logging

Login protection is layered:

- an application limiter bounds attempts before expensive password verification
- CloudFront AWS WAF applies a rate-based rule scoped to
  `POST /api/auth/login` before public deployment
- the direct App Runner URL cannot bypass the WAF because it fails the origin
  header check
- no account hard lock is introduced because it would let an attacker deny the
  only administrator access

The in-process limiter is defense in depth, not the sole distributed control.
Proxy and viewer-IP behavior must be verified in the deployed topology before
using an address as a limiter key. Do not set Express `trust proxy` broadly or
trust a viewer-supplied forwarding header.

Security logs use event names, request IDs, and bounded outcomes. They never
include passwords, password hashes, JWTs, cookies, signing secrets, origin
secrets, or full request bodies. Raw email is not required in authentication
logs.

### React Boundary

The first protected UI does not require a routing library. The application
bootstraps with `GET /api/auth/me` and renders one of four bounded states:

```text
checking session | signed out | authenticated | recoverable error
```

The login form supports password-manager autofill, generic credential errors,
submitting and rate-limited states, and no public registration links. Logout is
a POST command. A React guard improves navigation and presentation, while every
API route independently authenticates and authorizes the request.

### Runtime Secrets

Local values remain in ignored `.env.local`. Production auth values use a
separate retained Secrets Manager secret such as `cpi/production/api-auth`:

```text
JWT_SIGNING_SECRET
JWT_ISSUER
JWT_AUDIENCE
ALLOWED_ORIGIN
ORIGIN_HEADER_SECRET
```

The App Runner instance role reads only the database and API-auth secrets. It
does not receive RentCast or Telegram credentials. No auth value is added to a
Vite-prefixed environment variable.

## Threat Model

| Threat | Primary controls | Residual risk |
| --- | --- | --- |
| Offline password cracking after DB theft | Argon2id, unique salt, strong password policy | User-chosen password strength still matters |
| Credential stuffing or brute force | Generic failures, dummy-hash path, app limiter, CloudFront WAF | Distributed low-rate attempts remain possible |
| User enumeration | Normalized lookup, generic body/status, one hash verification | Network and database timing cannot be perfectly identical |
| JWT forgery or substitution | Strong secret, fixed algorithm, exact issuer/audience/type/claims | Signing-secret compromise requires rotation and re-login |
| Cookie theft through browser script | HttpOnly, no browser token storage, CSP in security hardening | A compromised browser or endpoint remains dangerous |
| CSRF and login CSRF | SameSite Strict plus exact Origin validation | A same-origin XSS can still make authorized requests |
| Direct App Runner bypass | CloudFront-overwritten secret origin header | Header compromise requires coordinated rotation |
| Disabled user retaining access | Database user reload on every protected request | Database availability is required for authorization |
| Login denial of service | Body limits, pre-hash limiter, WAF, no hard account lock | Aggressive global limits can affect the administrator |
| Secret or personal-data leakage | Minimal claims/DTOs, bounded errors, safe logs | Operational access to secret stores remains privileged |

## Block 16 Sub-Blocks

1. `16.0` Record this ADR, threat model, contracts, and test inventory.
2. `16.1` Add the user domain model, migration, repository port, and PostgreSQL
   adapter.
3. `16.2` Add password policy, the Argon2id adapter, and hidden-input admin CLI.
4. `16.3` Add JWT configuration and the token service.
5. `16.4` Add login and current-user application use cases; logout has no
   application state under the accepted no-revocation design.
6. `16.5` Add Express auth routes, login/logout cookies, origin checks,
   middleware, protected listings, and database-independent health.
7. `16.6` Add React session bootstrap, login, logout, and protected workspace.
8. `16.7` Complete application rate limiting, security headers, authorization,
   CSRF/origin, and end-to-end security tests.

Blocks 16.0 through 16.7 are implemented. Block 16.7 uses a bounded global
per-process login key rather than an unverified viewer address, applies Helmet
to API responses, adds a static-document CSP for the selected map origin,
requires explicit admin authorization for listings, and emits server-generated
request IDs with credential-free security events. Distributed WAF enforcement,
CloudFront response headers, and deployment remain governed by the separate
production gate below.

Every sub-block requires a fresh explanation and explicit confirmation. This
ADR does not authorize a later sub-block.

## Test Strategy

- pure domain tests cover email normalization, roles, statuses, and password
  input policy
- migration and PostgreSQL adapter tests cover schema, unique normalized email,
  creation, lookups, disabled users, and defensive row parsing
- password tests cover Argon2id parameters, random salts, verification, dummy
  hash behavior, blocklist, Unicode normalization, and no plaintext output
- token tests cover exact algorithm, type, claims, lifetime, expiration, clock
  tolerance, signature, issuer, audience, and malformed input
- application tests cover valid login plus indistinguishable unknown, wrong,
  and disabled credential failures
- API tests cover cookie attributes, logout clearing, missing/invalid cookies,
  live user reload, `401`/`403`, body limits, origin checks, no-store, safe
  errors, and protected listings
- rate-limit tests use injected time and never wait in real time
- React tests cover session bootstrap, login states, generic errors, logout,
  retry, and protected content without reading a token
- CI uses fake time, fake ports, and test hashes; it never requires production
  secrets, calls external APIs, or provisions AWS resources

## Production Gate

Completing Block 16 code does not automatically authorize public deployment.
Before implementation or deployment of App Runner, CloudFront, WAF, and S3,
require a separately reviewed CDK diff, cost impact, secret shape, cookie/origin
configuration, rollback plan, and production smoke-test procedure. The worker
scheduler remains unchanged unless separately authorized.

## Options Considered

### Hard-code one administrator credential

Rejected because it prevents lifecycle management, secure password storage,
disabled status, auditability, and future users.

### Use an opaque server-side session instead of JWT

An opaque session would provide straightforward revocation and is reasonable
for this topology. JWT remains selected because it is an explicit product
requirement and supports a small replaceable token-service boundary. Live user
reload intentionally gives up fully stateless authorization in exchange for
immediate disabled-user enforcement.

### Store the JWT in localStorage

Rejected because browser JavaScript and an XSS defect could read and export the
token. The HttpOnly cookie keeps token handling at the HTTP boundary.

### Trust JWT role until expiration

Rejected because a disabled user or changed role would retain authorization for
the token lifetime. The API reloads current user state for protected requests.

### Add permissive CORS for local development

Rejected because Vite already proxies `/api` under the browser origin and
production is same-origin. CORS adds no value to the accepted flow and broadens
the request surface.

### Use only an in-memory login limiter

Rejected as the production control because process restart or scaling resets
local counters. It remains defense in depth behind a CloudFront WAF rule.

## Consequences

- authentication stays replaceable behind application ports
- disabled users lose access immediately but every protected request requires a
  database lookup
- the API remains unavailable while Aurora resumes, so clients need bounded
  loading and retry states
- the first release has no refresh token, registration, password reset, MFA, or
  copied-token revocation
- public deployment gains WAF and origin-secret cost and operational work
- Block 17 can build admin-only mutations on a tested authorization boundary

## References

- [RFC 8725: JSON Web Token Best Current Practices](https://www.rfc-editor.org/rfc/rfc8725.html)
- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [OWASP CSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
- [NIST SP 800-63B: Authentication and Authenticator Management](https://pages.nist.gov/800-63-4/sp800-63b.html)
- [MDN Set-Cookie reference](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie)
- [AWS WAF login rate-limit example](https://docs.aws.amazon.com/waf/latest/developerguide/waf-rate-based-example-limit-login-page.html)
