# Block 29: AWS Public Launch And Operational Readiness

## Purpose

Block 29 operationalizes the public AWS architecture completed in source by
Block 28. Its outcome is a browser-accessible, identity-attested HTTPS
application with reviewed deployment evidence, safe smoke tests, cost controls,
and a rehearsable rollback path.

Block 29.0 prepares documentation and operations only. It performs no AWS
login, diff, bootstrap, deployment, migration, secret access, worker run,
provider request, Telegram delivery, production notification, DNS change, or
database operation.

## Repository Reality At Start

- Production worker/database infrastructure already exists.
- DEV and production public Web/API CDK stacks exist in source but have not
  been deployed.
- DEV deployment is automatic only after a PR is merged into `dev`, with a
  manual `dev` dispatch available for first launch.
- Production deployment is manual-only from `main`, with separate digest-bound
  plan and deploy runs.
- WAF is in `us-east-1`; application, App Runner, private S3, VPC, and Aurora
  are in `us-west-2`.
- DEV uses separate database, secrets, schedules, and IAM trust. Schedules
  default to disabled.
- Remote smoke is unauthenticated, read-only, and release-identity bound.

## Public Access Contract

The first valid browser address will be the `ApplicationUrl` output:

```text
https://<generated-name>.cloudfront.net
```

It is a URL, not a stable IP address. CloudFront routes by hostname and HTTPS
certificate identity. Looking up an edge IP and entering it in a browser is not
a supported application access path.

The generated hostname is acceptable for portfolio demonstration and launch
verification. A custom domain is optional and deliberately separated because
the current CDK does not define a hosted zone, certificate, CloudFront alias,
or DNS record.

## Planned Sub-Blocks

### 29.0 Documentation And Operation Contract

Create ADR 0017, this knowledge base, the launch runbook, and roadmap plan.
Status: complete when local documentation verification, full typecheck, and
production build pass. No AWS operation is authorized.

### 29.1 Read-Only Launch Preflight

Authenticate with the non-root federated `cpi-admin` profile and collect only
read-only evidence: account/ARN, region, existing stack states, CDK bootstrap
presence in both regions, OIDC provider/roles, schedule states, and current
public-stack absence or status. Stop before any diff that creates a change set
or any mutating command.

Status: complete on 2026-08-28. The
[redacted preflight record](../operations/block-29-1-read-only-launch-preflight.md)
documents the missing `us-east-1` bootstrap, missing DEV OIDC role, absent
public runtime, and incomplete GitHub protection controls. Block 29.2 remains
separately authorized.

### 29.2 Bootstrap And Guardrails Enablement

Bootstrap only missing target regions after a dedicated approval. Then run an
account-backed Guardrails diff and classify every action. A second approval is
required before updating Guardrails to create or update the exact DEV OIDC role
and bounded two-region bootstrap permissions. Preserve the production OIDC
subject and budget identities.

Status: complete on 2026-08-28. The missing `us-east-1` bootstrap and bounded
Guardrails update were separately authorized and completed. The
[redacted execution record](../operations/block-29-2-bootstrap-and-guardrails.md)
captures the classified changes, verified trust policies, clean post-deploy
diff, and remaining GitHub protection blockers.

### 29.3 First AWS DEV Public Deployment

Configure the protected GitHub `development` environment, repository variables,
and DEV-only alert email. Manually dispatch `Deploy DEV` from the exact `dev`
commit. Approval one releases plan only. Approval two authorizes the reviewed
DEV changes and DEV API startup migration. Require schedules disabled and no
unsafe replacement or delete.

Status: the first isolated DEV stacks and release were deployed on 2026-08-28.
The public URL, health, unauthenticated UI, and exact Web/API release identity
were verified. A strict smoke assertion exposed local-fixture drift in the
authentication error body; the
[execution record](../operations/block-29-3-first-dev-public-deployment.md)
documents the focused remediation and the remaining green-run gate.

### 29.3a Initial DEV Administrator Bootstrap

The isolated DEV database is intentionally empty after migrations. Block 29.3a
adds a DEV-only, unscheduled Fargate task and a separate protected OIDC workflow
for one initial administrator insert. A sanitized `plan` run produces an
immutable approval digest; a separately authorized `create` run uses a unique
temporary secret and always requests its deletion. No account is seeded, no
registration endpoint is added, and no production administrator path is
created. See the
[preparation record](../operations/block-29-3a-dev-admin-bootstrap-preparation.md)
and [runbook](../runbooks/create-dev-admin.md).

### 29.4 DEV Acceptance And Release Evidence

Record the DEV CloudFront URL, configure `CPI_AWS_DEV_BASE_URL`, verify matching
`/release.json` and `/api/release`, run remote read-only smoke, and run the
nightly regression workflow manually once. Resolve retries or quarantine
findings before promotion; do not wait with arbitrary sleeps.

### 29.5 DEV-To-Main Promotion

Open the same-repository `dev -> main` PR. The release gate must prove that the
exact PR head SHA is the release exposed by both DEV paths and pass the full
regression. Merge only after the gate is green. Before production launch, add
and test a protected GitHub `production` environment if it is not yet declared
by the production workflow; manual inputs and an approval digest do not replace
an independent environment protection boundary.

### 29.6 Controlled Production Public Launch

Run `Deploy production` with `operation=plan`, review the account-backed diff,
and retain the approval digest. A new, explicit production authorization is
required before the separate deploy run. The deploy must reproduce the digest,
acknowledge the production API startup migration, force both schedules
disabled, and pass safe production smoke.

### 29.7 Optional Custom Domain

After generated-hostname launch is stable, decide whether a friendly domain is
needed. Implement ACM, CloudFront aliases, DNS, tests, diff review, and rollback
through CDK. Do not make console-only production changes.

### 29.8 Operational Handoff

Record CloudFormation outputs, release identity, artifact links, SNS
subscription state, cost/budget checks, alarms, rollback evidence, and owner.
Confirm nightly DEV regression and production deployment remain separate from
worker schedule enablement.

## Definition Of Done

Block 29 is complete only when:

- DEV and production have browser-accessible HTTPS hostnames
- Web and API release identities match the deployed commits and stages
- account-backed plans contain no unreviewed delete or unsafe replacement
- both worker schedules remain disabled
- DEV full regression and production safe smoke are green
- production deployment is protected by a configured GitHub environment in
  addition to its manual inputs and approval digest
- rollback evidence exists for App Runner and versioned S3 content
- budget and failure-notification subscriptions are confirmed
- the execution record contains no credential, secret, session, production
  data, or private request/response content

Public availability does not create a production application user. Any
production admin creation or authenticated acceptance is a separate,
data-mutating operation with its own authorization and evidence.

## References

- [Block 29 launch runbook](../runbooks/block-29-aws-public-launch.md)
- [Block 29.1 redacted preflight](../operations/block-29-1-read-only-launch-preflight.md)
- [Block 29.2 redacted execution record](../operations/block-29-2-bootstrap-and-guardrails.md)
- [Block 29.3 first DEV deployment record](../operations/block-29-3-first-dev-public-deployment.md)
- [Block 29.3a DEV administrator preparation](../operations/block-29-3a-dev-admin-bootstrap-preparation.md)
- [ADR 0017](../adr/0017-aws-public-launch-and-operational-readiness.md)
- [AWS DEV deployment runbook](../runbooks/aws-dev-deployment.md)
- [Release and production delivery runbook](../runbooks/release-production-delivery.md)
