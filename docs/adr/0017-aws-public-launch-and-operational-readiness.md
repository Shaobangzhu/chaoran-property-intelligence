# ADR 0017: AWS Public Launch And Operational Readiness

## Status

Accepted for staged preparation by Block 29.0. Every AWS mutation remains
separately authorized at execution time.

## Context

Block 28 completed the source architecture for public Web/API delivery but did
not run a real AWS plan, deployment, migration, remote smoke test, or
notification. The repository now defines:

- CloudFront as the public HTTPS entry point
- a private, versioned S3 web origin
- `/api/*` routing through CloudFront to App Runner
- an App Runner VPC Connector to private Aurora
- CloudFront WAF, security headers, and origin verification
- isolated DEV and preserved production stack identities
- GitHub OIDC deployment roles and guarded DEV/production workflows
- immutable Web/API release identity and remote Playwright acceptance

The next objective is to turn that source-complete architecture into an
operationally controlled public deployment.

CloudFront does not provide this application with a stable, user-facing IP
address. It assigns a hostname such as `d111111abcdef8.cloudfront.net` and
selects a distribution from the request `Host` header. Direct IP access would
not be a reliable routing or TLS contract. Initial launch therefore uses the
generated CloudFront HTTPS URL. A friendly custom domain is a later, explicit
CDK change requiring DNS ownership and a matching certificate.

## Decision

Block 29 is named **AWS Public Launch And Operational Readiness**.

The launch order is:

```text
local release gate
  -> read-only AWS inventory
  -> per-region CDK bootstrap approval where required
  -> Guardrails/OIDC plan and approval
  -> first isolated DEV plan and deployment
  -> separately approved initial DEV administrator bootstrap
  -> DEV identity, health, API, UI, and nightly acceptance
  -> dev-to-main release gate
  -> production plan with approval digest
  -> separately authorized production deployment
  -> safe production smoke and operational handoff
```

The first browser-accessible endpoint is the DEV CloudFront URL. Production is
not used to discover infrastructure defects that could first be found in DEV.

No direct local production deployment is introduced. Local federated admin
access is limited to bootstrap and the account-level Guardrails update needed
before GitHub OIDC can operate. DEV application deployment uses the protected
`development` environment. Production public delivery uses the existing
manual, two-run `Deploy production` workflow from `main`. Before its first real
run, the production job is also bound to a protected GitHub `production`
environment with required review and an exact-`main` deployment restriction.

The existing worker, scheduler, provider, notification, database, and retained
production-resource boundaries remain unchanged. Both worker schedules remain
disabled throughout public launch. Public launch does not authorize a RentCast
request, OpenAI call, Telegram message, scheduled worker, production data read,
or authenticated production mutation.

## Access URL Decision

Phase one uses:

```text
https://<generated-name>.cloudfront.net
```

The actual hostname comes from the `ApplicationUrl` CloudFormation output. It
must not be replaced with a resolved CloudFront edge IP.

An optional custom domain requires all of the following in source before
deployment:

- an owned domain and controlled DNS zone
- an ACM certificate valid for the hostname and usable by CloudFront
- CloudFront alternate-domain-name configuration
- Route 53 alias records, or equivalent DNS records at another provider
- updated CDK tests, synth, diff, smoke targets, rollback, and ownership docs

Console-only DNS or CloudFront edits are prohibited because they would create
configuration drift outside the repository.

## Operational Gates

Each mutating phase requires:

1. exact account, identity, and region confirmation
2. relevant tests, full typecheck, and production build
3. account-backed CDK diff classified as `CREATE`, `UPDATE`, `REPLACE`, and
   `DELETE`
4. explicit review of every replacement and deletion
5. separate authorization for any API startup migration
6. both schedules proven disabled before and after deployment
7. rollback evidence and last-known-good identity captured
8. safe, read-only smoke against the immutable deployed release

Production deploy authorization is never inferred from DEV approval, a green
test run, a successful production plan, or this ADR.

## Consequences

- Browser access uses a valid HTTPS hostname immediately after CloudFront and
  web publication complete.
- The launch has more approval boundaries, but each boundary has bounded
  evidence and a clear rollback decision.
- The initial Guardrails/OIDC bootstrap remains an administrator-controlled
  operation because the GitHub role cannot create itself.
- App Runner startup may apply bundled migrations to the selected stage, so
  migration authorization remains explicit.
- A healthy sign-in page does not imply that an administrator exists. The first
  DEV user is a separate, digest-bound data mutation through a DEV-only task;
  it is not seeded, copied from production, or exposed through registration.
- A custom domain is deferred until its ownership and desired hostname are
  known; the generated CloudFront hostname is sufficient for initial launch.

## References

- [Block 29 knowledge base](../knowledge-base/block-29-aws-public-launch-and-operational-readiness.md)
- [Block 29 launch runbook](../runbooks/block-29-aws-public-launch.md)
- [ADR 0016](0016-software-quality-platform-and-aws-delivery-modernization.md)
- [AWS system design](../aws-system-design.md)
