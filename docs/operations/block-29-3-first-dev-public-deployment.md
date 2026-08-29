# Block 29.3 First DEV Public Deployment Record

## Record

- Date: 2026-08-28
- Source release: `245cf86c364f2db7e0b4da5db898cff8f06ff6a5`
- Deployment workflow: `Deploy DEV` run `33223275976` (run `#6`)
- Public DEV URL: `https://d2ppgfv0e954lb.cloudfront.net`
- AWS scope: three isolated DEV stacks only
- Production scope: none
- Result: infrastructure and release deployed; workflow smoke-contract
  remediation pending merge and a new exact-SHA run

No production stack, production database, production data, worker execution,
schedule enablement, RentCast request, OpenAI request, Telegram operation, or
production notification was authorized or executed.

## GitHub Protection Boundary

Before dispatch, the `development` environment was restricted to `dev`, a
required reviewer was configured, administrator bypass was disabled, and the
DEV alert recipient was stored as an environment secret. Repository rulesets
require pull requests and the appropriate quality gate for both `dev` and
`main`; deletes and force pushes are blocked.

GitHub's immutable owner and repository identifiers changed the OIDC subject
observed by AWS. The existing production and DEV role trust policies were
updated in place through a separately authorized Guardrails deployment. The
role ARNs were preserved and the post-deployment Guardrails diff was clean.

The automatic run created by closing PR `#10` was rejected by the DEV-only
environment because GitHub associated that event with the synthetic
`refs/pull/10/merge` ref. It performed no AWS operation. The first launch was
therefore dispatched manually from the exact `dev` SHA, as required by the
launch runbook.

## Verification And Plan

The release-candidate job completed before either AWS approval:

- Allure: 1,252 total, 1,251 passed, 0 failed, 1 skipped
- local Playwright smoke passed
- full typecheck passed
- production build passed
- DEV CDK synthesis passed

Approval one authorized plan only. The account-backed diff artifact was:

```text
CREATE: 86
UPDATE: 0
REPLACE: 0
DELETE: 0
```

Plan artifact:

```text
name:   dev-cdk-diff-33223275976-1
digest: sha256:72f4b9cdb8362f6badb0e48d29af385ec5f6ec1a3a1130f25603479244c15b91
```

The reviewed creates covered the isolated DEV VPC and Aurora foundation,
worker definitions with disabled schedules, `us-east-1` CloudFront WAF,
private Web S3 origin, App Runner API, CloudFront distribution, stage-specific
secrets, security groups, bounded IAM roles, failure topics, and deployment
evidence resources. No existing resource was updated, replaced, or deleted.

## Authorized Deployment

Approval two was recorded with the exact SHA, three stack names, classified
diff, seven bundled DEV migrations, disabled schedules, static publication,
and read-only smoke boundary. It authorized only:

- `ChaoranPropertyIntelligenceDev`
- `ChaoranPropertyIntelligenceDevEdge`
- `ChaoranPropertyIntelligenceDevPublicApplication`

All three stacks reached create completion. CDK ran with both schedule contexts
set to `false` and `--concurrency 1`. The verified Web artifact was published
to the private versioned bucket and CloudFront invalidation completed.

App Runner reached `CREATE_COMPLETE`. API startup runs migrations before it
opens the listener, and the subsequent `/api/health` readiness check passed.
This proves the new isolated DEV database accepted the seven bundled migrations
well enough for the API to become healthy. The workflow did not inspect table
contents or execute an authenticated request.

Deployment artifacts:

```text
web build digest:    sha256:d49ea443aeb58fd1daf19dc720e6a59ad2aa63deef0c363087dbbd89e94398b5
verification digest: sha256:4cb563d18c25a77e005e643c1aa8ea03c3b40a4121368f0cc229d1fa420cb399
deployment digest:   sha256:7b3da911d2e80b28bc54366121cc561774b19eb98edfa2acc5bbd7912e6fee8b
```

## Smoke Failure Classification

The workflow finished red after infrastructure deployment because one
read-only Playwright assertion expected this exact 401 body:

```json
{"error":{"code":"AUTHENTICATION_REQUIRED"}}
```

The deployed Express API correctly returned its canonical bounded contract:

```json
{"error":{"code":"AUTHENTICATION_REQUIRED","message":"Authentication is required"}}
```

The status was `401`; health passed; the unauthenticated sign-in page rendered;
and `/release.json` and `/api/release` both matched the expected DEV SHA. This
was test and local-fixture contract drift, not an infrastructure, migration, or
application availability failure.

The focused remediation branch is
`feature/block-29-3-dev-smoke-contract-fix`. It adds the canonical message to
the strict smoke expectation and synchronizes the local API stub. Verification
on that branch completed with:

- local Playwright smoke: 6 passed, 1 expected skip
- corrected read-only AWS DEV smoke: 4 passed, 3 intentional remote skips
- full Vitest: 1,260 passed
- full typecheck: passed
- production build: passed

## Architecture And Safety Decisions

- Keep CloudFront as the only public hostname; do not use a resolved IP.
- Keep S3 private and route `/api/*` through the same CloudFront origin.
- Preserve strict equality for the bounded authentication error contract and
  make the local test server mirror the production API.
- Treat a red post-deployment smoke separately from CloudFormation failure;
  retain evidence and diagnose before rerunning or rolling back.
- Do not roll back healthy infrastructure or schema for a test-only mismatch.
- Keep the release immutable: the remediation must merge through the DEV PR
  quality gate and be verified under a new exact `dev` SHA.

## Remaining Risks And Next Gate

- Merge the focused smoke-contract fix through a protected PR and run `Deploy
  DEV` manually from the resulting exact `dev` SHA. Do not rerun run `#6`;
  reruns remain pinned to the old test source.
- Review the new account-backed diff before another approval. It should contain
  no infrastructure change beyond an immutable release/image identity update.
- Replace the automatic `pull_request: closed` delivery trigger with a tested
  `push` trigger limited to `dev`; do not weaken the environment branch rule to
  permit synthetic pull-request refs.
- Confirm both deployed scheduler resources report `DISABLED` through a
  credentialed read-only check in Block 29.4.
- Confirm the new SNS email subscriptions before relying on email as an alert
  channel.
- Resolve the GitHub Actions Node.js 20 deprecation warnings in a separate,
  dependency-reviewed update.
- Do not set `CPI_AWS_DEV_BASE_URL` or begin promotion until the new deployment
  run and Block 29.4 acceptance are green.

## References

- [Block 29 launch runbook](../runbooks/block-29-aws-public-launch.md)
- [AWS DEV deployment runbook](../runbooks/aws-dev-deployment.md)
- [Block 29.2 execution record](block-29-2-bootstrap-and-guardrails.md)
- [Block 29 knowledge base](../knowledge-base/block-29-aws-public-launch-and-operational-readiness.md)
- [ADR 0017](../adr/0017-aws-public-launch-and-operational-readiness.md)
