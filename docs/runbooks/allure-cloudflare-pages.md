# Protected Allure Portal On Cloudflare Pages

## Purpose And Scope

This runbook covers the protected online Allure portal published by
`.github/workflows/nightly-dev-regression.yml` to the existing Cloudflare Pages
Direct Upload project `cpi-allure-reports`.

The portal is a quality-observability surface, not an application runtime. It
does not deploy CPI Web/API code, mutate AWS, run migrations, enable worker
schedules, call RentCast or OpenAI, send Telegram messages, or replace GitHub
Actions as the authoritative test runner.

Only the nightly workflow publishes online. Pull-request, release, DEV deploy,
and Production workflows continue to retain downloadable diagnostics without
receiving the Cloudflare credential. This prevents pull-request code from
accessing the Pages deployment token and keeps screenshots, traces, raw result
files, and deployment evidence out of the online portal.

## Portal Layout And Retention

Each Cloudflare Pages production deployment contains a complete static site:

```text
/
├── index.html
├── reports.json
├── latest/
└── runs/
    └── YYYY-MM-DD-GITHUB_RUN_ID/
```

The workflow uses `America/Los_Angeles` calendar dates and keeps the newest
report for each date. A later rerun on the same date removes the earlier dated
folder. Dates outside the inclusive 30-calendar-day window are deleted before
deployment. `latest/` is rebuilt from the newest retained report rather than
implemented as an HTTP redirect or symlink.

The nightly workflow is also the daily cleanup. Its portal job uses `if:
always()`, so it restores retained daily bundles, prunes expired dates, and
deploys the cleaned site even when regression fails or no new Allure report is
available. If the workflow itself never starts, no external scheduler can clean
the project; GitHub schedule health must therefore remain monitored.

Cloudflare Pages deployments are immutable. The workflow rebuilds the logical
site from one `allure-pages-report-GITHUB_RUN_ID` artifact per prior nightly run
instead of repeatedly storing the full 30-day site. Each bundle has 30-day
retention, contains only one generated report below `runs/`, and is read only
from completed runs of this same workflow. This avoids quadratic GitHub artifact
storage growth. A separate `allure-history-state` artifact carries Allure 3's
`history.jsonl` into the next report generation. The checked-in `allurerc.mjs`
limits the trend file to 30 launches. Because the portal keeps at most one launch
per day, this aligns the visible trend horizon with the portal's 30-day retention
policy.

Allure uses its Awesome single-file mode so 30 daily reports remain practical
under Pages limits. The portal builder rejects symbolic links, malformed stored
report entries, unsafe archive layouts, files above 25,000,000 bytes, and sites
above a 19,000-file safety ceiling. Those ceilings leave headroom below the
Pages free-plan limits. `_headers` and `robots.txt` set no-store, no-referrer,
no-sniff, framing denial, and search-index exclusion headers. Cloudflare Access
remains the actual confidentiality boundary.

## One-Time Cloudflare Configuration

The Pages project must be a Direct Upload project whose production branch is
`main`:

```text
cpi-allure-reports
```

Two Cloudflare Access self-hosted applications protect the generated hostnames:

| Application | Public hostname |
| --- | --- |
| `cpi-allure-reports-production` | `cpi-allure-reports.pages.dev` |
| `cpi-allure-reports-previews` | `*.cpi-allure-reports.pages.dev` |

Both applications use an `Allow` policy with exact approved email selectors.
Google, GitHub, and One-time PIN can be enabled as login methods; each proves
the user's identity but does not replace the exact-email authorization rule.
Never use `Everyone` or `Login Methods: One-time PIN` as the policy's Include
selector.

Validate both an approved and an unapproved email in a private browser window
before uploading real reports. An approved OTP expires and is single-use;
blocked email addresses do not receive a usable code.

## One-Time GitHub Configuration

Create a GitHub Environment named `allure-reports`. Add:

| Kind | Name | Value |
| --- | --- | --- |
| Environment secret | `CLOUDFLARE_API_TOKEN` | Account token with only Pages Edit |
| Environment variable | `CLOUDFLARE_ACCOUNT_ID` | Target Cloudflare account ID |
| Environment variable | `CLOUDFLARE_PAGES_PROJECT_NAME` | `cpi-allure-reports` |

The Cloudflare account token must contain only the account-scoped `Pages:
Edit` permission. Do not use a Global API Key, add DNS/Workers/Access
permissions, print the token, or put it in a repository variable. GitHub-hosted
runner addresses change, so a static client-IP restriction is not compatible
with this workflow. If the token has an expiration date, rotate the Environment
secret before that date.

The `allure-reports` Environment may require owner review. Because the job runs
daily, required review changes the portal from automatic publication/cleanup to
a daily approval queue; use that tradeoff deliberately.

## Workflow Contract

The nightly workflow:

1. Checks out protected `dev` and records the exact tested SHA.
2. Runs the existing read-only AWS DEV regression and flake analysis.
3. Restores the last `allure-history-state` from a prior run of the same
   workflow into `allure-history/history.jsonl`.
4. Generates the report with the Allure 3 history configuration and renews the
   history artifact only when restoration was successful (including a normal
   first run with no prior artifact).
5. Uploads the existing full diagnostic artifact for 30 days.
6. Starts an isolated `publish-allure` job even when regression fails.
7. Restores the prior per-run report bundles and downloads only the current
   workflow's diagnostic artifact.
8. Adds the current report when available, keeps the newest report for the day,
   prunes dates outside 30 days, rebuilds `latest/`, and validates file count
   and size.
9. Uploads only the current dated report as a 30-day per-run bundle; it does not
   upload another nested copy of the complete portal.
10. Uses pinned Wrangler `4.129.0` to deploy the complete directory with
    `--branch=main`, making it the Pages production deployment.

The Cloudflare secret is referenced only by the validation and deployment steps
inside `publish-allure`. It is not available in the regression job.

## First Run And Acceptance

On the first successful run there are no prior report bundles or history. This
is normal: the workflow creates one dated report and initializes both artifacts.

After the run:

1. Confirm `regression` reflects the actual test and flake result.
2. Confirm `publish-allure` completed or inspect its independent failure.
3. Open `https://cpi-allure-reports.pages.dev` in a private browser window.
4. Complete Cloudflare Access authentication with an approved email.
5. Confirm the index contains no more than one entry for the current Pacific
   date.
6. Open `latest/` and the dated report; confirm they show the same run ID.
7. Confirm an unapproved email remains blocked.
8. Confirm GitHub Actions retained `nightly-dev-regression-*`,
   `allure-pages-report-GITHUB_RUN_ID`, and `allure-history-state` artifacts.

The second daily run is the first run that can prove history continuation.
Inspect Allure trend/history widgets after it completes.

## Failure And Recovery

| Failure | Expected behavior | Recovery |
| --- | --- | --- |
| No previous bundles | Build a new portal | Accept only on the first run or after artifact expiry |
| No current Allure report | Deploy cleanup with the newest retained report | Fix the upstream test/report failure |
| GitHub artifact API failure | Fail without using an unknown state | Retry after GitHub recovers |
| File count above 19,000 | Stop before Pages deployment | Reduce attachment/report volume or retention |
| File above 25,000,000 bytes | Stop before Pages deployment | Reduce attached report data or retention |
| Invalid/missing Cloudflare variables | Stop before Wrangler | Correct the `allure-reports` Environment |
| Cloudflare deployment failure | Preserve the per-run report artifacts | Retry the workflow after Cloudflare recovers |
| Access unexpectedly bypassed | Treat portal as exposed | Disable/delete the Pages deployment or restore Access before continuing |

Cloudflare Pages production deployment is atomic. A failed Wrangler upload does
not partially replace the last successful site. To roll back visible content,
use Cloudflare Pages deployment rollback to a known protected deployment, then
repair or rerun the nightly workflow. Do not weaken Access to diagnose a report
publication failure.

## Privacy Boundary

The online site contains generated Allure HTML and its Allure attachments. Test
authors must not attach credentials, cookies, authorization headers, private
customer data, full provider payloads, or secret environment values. Playwright
HTML, traces, screenshots, raw Allure results, flake JSON, and AWS deployment
evidence remain downloadable GitHub artifacts only.

Access authentication reduces exposure but does not sanitize report content.
If sensitive content appears, revoke/rotate affected credentials, remove the
affected Pages deployment and per-run report bundle, then regenerate from
reviewed test output. Deleting the bundle prevents a later rebuild from
restoring the affected report.
