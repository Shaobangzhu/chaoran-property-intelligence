# Block 29.4 DEV Public Acceptance Record

## Record

- Date: 2026-08-30
- Public DEV origin: `https://d2ppgfv0e954lb.cloudfront.net`
- Exact DEV release: `3a95c51c6124e58ca989323f1daae3ba10e5163d`
- Release stage: `dev`
- Repository variable: `CPI_AWS_DEV_BASE_URL` configured to the exact origin
- Nightly workflow: `Nightly DEV Regression` run `33340950741` (run `#3`)
- Result: accepted for DEV use and `dev -> main` release evidence

This operation did not access production, inspect database rows, execute a
worker, enable a schedule, call RentCast, OpenAI, or Telegram, or send a
production notification.

## Administrator Prerequisite

The initial DEV administrator was created before this acceptance through the
separately protected Block 29.3a workflow. Its plan and create operations were
independently approved, digest-bound, and successful:

- plan run: `33325744574`
- create run: `33325829615`
- create task exit code: `0`
- temporary credential secret deletion: recorded by the workflow
- authenticated browser acceptance: manually passed by the repository owner

No credential, password digest, session, database row, secret ARN, or task ARN
is included in this record. Block 29.4 did not repeat the administrator create
operation.

## HTTP And Release Verification

Read-only requests to the exact CloudFront origin returned:

| Target | Result |
| --- | --- |
| `/` | HTTP `200`, React sign-in application rendered |
| `/api/health` | HTTP `200`, `{"status":"ok"}` |
| `/release.json` | `gitSha=3a95c51...`, `stage=dev` |
| `/api/release` | `gitSha=3a95c51...`, `stage=dev` |

The Web and API release identities matched each other and the exact protected
`dev` SHA. Responses exposed the expected controls, including HSTS,
`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy: strict-origin-when-cross-origin`, and a restrictive
permissions policy. Cross-origin browser requests disclose only the approved
origin, which allows referrer-restricted ArcGIS browser credentials without
exposing application paths. API
health responses were non-cacheable and carried a request identifier.

The generated CloudFront hostname remains the supported browser address. A
resolved CloudFront IP is not an application endpoint because TLS and request
routing depend on the hostname.

## Local Remote-Safe Smoke

Playwright was run locally against the exact HTTPS DEV origin with zero retries
and local Allure results replaced for the run:

```text
total:    7
passed:   4
failed:   0
skipped:  3
retries:  0
```

The three skips are intentional remote-safety controls for credentialed or
local-fixture-only flows. The remote suite remained read-only and used stable
role and label locators. No screenshot or trace was produced because no test
failed.

## Nightly DEV Regression Evidence

The manually dispatched workflow checked out the protected `dev` ref and
tested exact SHA `3a95c51c6124e58ca989323f1daae3ba10e5163d`. It completed
successfully with:

```text
Allure status:        passed
total:                7
passed:               4
failed:               0
broken:               0
skipped:              3
unexpected retries:   0
quarantined retries:  0
stale quarantines:    0
policy errors:        0
slow tests:           0
```

Evidence:

- [workflow run](https://github.com/Shaobangzhu/chaoran-property-intelligence/actions/runs/33340950741)
- job: `99336368629`
- artifact: `nightly-dev-regression-33340950741-1`
- artifact ID: `9740519343`
- artifact digest:
  `sha256:c1b8bc805ec4cd32141c856d9fef5550c24a6f3be47a6490294488399376bbaa`
- retention: 30 days, private GitHub Actions artifact

The downloaded artifact contained raw Allure results, generated Allure and
Playwright reports, quarantine policy evidence, and retry analysis. Retry
analysis reported seven discovered tests and empty arrays for unexpected
retries, quarantined retries, stale quarantines, slow tests, and policy errors.

## Repository Verification

The Block 29.4 documentation candidate completed the repository release gate:

```text
pnpm test:       133 files, 1,290 tests passed
pnpm typecheck:  passed
pnpm build:      passed
git diff --check: passed
```

The build retained the existing Vite advisory for large ArcGIS chunks; it did
not fail the production build. No Allure output, Playwright report, screenshot,
trace, generated build output, or environment file is part of this change.

## Architectural Decisions

- CloudFront remains the single HTTPS origin for both Web and `/api/*` traffic.
- Release acceptance is identity-bound, not only availability-bound.
- Remote automation intentionally excludes credentialed and mutating flows.
- The separately authorized manual administrator login supplies authenticated
  acceptance without weakening the read-only nightly contract.
- Flake evidence is a release signal: zero retries and zero active quarantines
  are required for this acceptance.

## Remaining Risks And Follow-Up

- GitHub reported a non-blocking Node.js 20 action-runtime deprecation warning;
  action versions should be upgraded in a focused maintenance change.
- Monitor the next scheduled Nightly DEV Regression to confirm the repository
  variable is consumed without manual dispatch context.
- Production remains untouched and unauthorized. A protected `production`
  environment and production workflow contract must be completed before any
  Block 29.6 plan or deployment.
- The generated CloudFront hostname is accepted; a custom domain remains a
  separately designed and approved Block 29.7 change.

## References

- [Block 29 launch runbook](../runbooks/block-29-aws-public-launch.md)
- [Block 29.3 deployment record](block-29-3-first-dev-public-deployment.md)
- [Block 29.3a preparation record](block-29-3a-dev-admin-bootstrap-preparation.md)
- [DEV administrator runbook](../runbooks/create-dev-admin.md)
