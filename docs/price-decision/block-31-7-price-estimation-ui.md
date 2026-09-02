# Block 31.7 Price Estimation UI

## Status

The source implementation is complete on
`feat/block-31-7-price-estimation-ui`. Full repository tests and local desktop/
mobile acceptance remain under repository-owner control. No real RentCast or
OpenAI request was made, no credential was read, and no API, database, AWS,
ArcGIS, deployment, or release change was performed in this block.

Block 31.7 adds `Price Estimation` as the fourth authenticated workspace while
keeping `Listings` as the post-sign-in default. It reuses the existing workspace
width, typography, teal/orange accents, surfaces, form controls, status bands,
buttons, icons, and mobile breakpoints.

## User Flow

Opening the tab does not call the API. The form accepts:

- street number and name;
- California city; and
- five-digit ZIP code.

State remains server-owned as `CA`. `Set Offer Price` submits `mode: offer` and
`Set Listing Price` submits `mode: listing`. Client validation uses the shared
Domain normalizer, so invalid input shows a field-level message without a
provider request.

During an estimate, all address fields and both actions are disabled and a live
loading status explains that recorded sales and market evidence are being
analyzed. A new request clears the earlier result. Navigating away unmounts the
workspace, aborts its request, increments the client generation, and prevents a
late response from being rendered.

After a result, a normalized address edit keeps the prior result visible but
marks it as based on the earlier address. A failed estimate preserves the form
and exact attempted mode. Its retry action reuses that validated request.

## Result Presentation

Success is presented in this order:

1. subject address and core property attributes;
2. recommended offer/listing price, range, comparable-sales anchor, confidence,
   and data-as-of timestamp;
3. evidence-backed reasons;
4. three mode-specific scenarios and matching strategy guidance;
5. a semantic, keyboard-scrollable recorded-sales table;
6. separately labeled recorded-sale, AVM, ZIP listing-market, and observable
   listing-signal freshness;
7. limitations and the decision-aid disclosure.

The comparable table retains all columns on narrow screens through deliberate
horizontal scrolling; fields are not hidden to fit. Currency and source labels
keep recorded sale prices, the external AVM, current list price, and ZIP-level
listing statistics distinct.

If OpenAI enhancement is unavailable, the result remains a success. A green
status band states that deterministic guidance is displayed and that the
verified valuation is unchanged. The UI never presents this condition as a
price-estimation failure.

## Failure And Session Behavior

The browser client maps the protected API statuses to bounded UI states:

| Status | UI state |
| --- | --- |
| 400 | invalid request |
| 404 | property not found |
| 409 | another estimate is active |
| 422 | insufficient valuation evidence |
| 429 | recent estimate limit reached |
| 502 | required evidence unavailable |
| 503 | Price Estimation service unavailable |
| 504 | estimate timed out |
| other | response/request could not be verified |

A `401` remains a session-boundary event: `App` returns to sign-in and the
screen does not show it as a provider failure. Error bodies and internal details
are not displayed.

## Browser Response Boundary

`priceEstimationApi.ts` validates every success response at runtime. It rejects:

- missing or unknown keys at every DTO level;
- invalid CPI public property IDs and evidence IDs;
- invalid dates, timestamps, ranges, money, attributes, coordinates, and
  nullability;
- mode/scenario ordering mismatches;
- strategy steps not paired with their scenarios;
- duplicate comparable evidence IDs;
- inconsistent OpenAI/fallback state; and
- a valid response whose mode differs from the requested action.

The client sends exact normalized input with `credentials: same-origin`, JSON
headers, and the workspace `AbortSignal`. It does not persist results or expose
provider request accounting.

## Accessibility And Responsive Behavior

- every input has a programmatic label, autocomplete purpose, and associated
  field error;
- loading uses a live status and both actions expose their busy mode in text;
- success and failure summaries receive focus after completion;
- confidence and flexibility are written as text rather than color alone;
- the comparable table has a caption, scoped column headers, and a focusable
  scroll region;
- the fourth tab remains keyboard operable using the existing workspace-nav
  pattern;
- two-column and three-column result sections collapse without hiding data;
- the four workspace buttons become a two-by-two grid at the smallest existing
  breakpoint.

## Verification Record

Focused tests cover strict browser request/response validation, every safe API
status mapping, nullable provider context, deterministic fallback, action mode,
no-call validation, busy-state duplicate prevention, complete result content,
retry preservation, stale-result labeling, focus movement, request abort/late
result isolation, fourth-tab integration, and session expiry.

No dependency or lockfile change is required. Full `pnpm test`, local responsive
review, and any selected Playwright acceptance remain with the repository owner
under the accepted Block 31 workflow.
