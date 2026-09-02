# Block 31.1: Price Decision MVP Implementation Plan

## Purpose

Block 31.1 converts the accepted Price Estimation concept into an executable,
reviewable plan. It freezes product semantics and boundaries before source code,
provider calls, dependencies, data persistence, or cloud changes are authorized.

The implementation target is the smallest trustworthy vertical slice:

```text
Authenticated form
  -> protected CPI API
  -> normalized California subject address
  -> RentCast evidence acquisition
  -> deterministic valuation and confidence
  -> optional OpenAI explanation
  -> validated Price Estimation response
```

The numeric recommendation must remain available and explainable without
OpenAI. The product must not display a recommendation when the deterministic
evidence gate fails.

## Scope

### Included

- fourth authenticated tab named `Price Estimation`
- street address, city, and five-digit ZIP inputs; server-owned state `CA`
- separate `Set Offer Price` and `Set Listing Price` actions
- one subject-property summary
- recorded-sale comparable evidence where provider data supports it
- RentCast AVM estimate and range as a separately labeled calibration source
- current target-listing history and ZIP market statistics when available
- deterministic recommendation, range, confidence, reasons, and strategy bands
- optional structured OpenAI explanation with deterministic fallback
- authenticated same-origin API with cost, timeout, privacy, and abuse controls
- complete unit, integration, black-box API, browser, accessibility, and failure
  coverage

### Excluded

- any map or heatmap
- result persistence, saved searches, sharing, exports, or notifications
- an appraisal, broker price opinion, legal advice, or guaranteed sale price
- private seller intent, motivation, finances, identity, or contact information
- automatic offer submission or listing publication
- arbitrary US states in the MVP form
- batch analysis or background jobs
- a new database table or migration
- AWS deployment until source acceptance and a separate release authorization

## Delivery Strategy

Implementation uses Red-Green-Refactor and the repository's package boundaries.
Every numbered sub-block is independently reviewed and authorized.

### 31.2 Domain And Application Contracts

Define provider-neutral business types and fakes before writing any adapter.

Expected ownership:

- `packages/domain/src/priceDecision.ts`
- `packages/domain/src/priceDecision.test.ts`
- `packages/domain/src/index.ts`
- `packages/application/src/priceDecisionEvidence.ts`
- `packages/application/src/estimatePropertyPrice.ts`
- `packages/application/src/estimatePropertyPrice.test.ts`
- `packages/application/src/fakePriceDecisionEvidence.ts`
- `packages/application/src/index.ts`

Required contracts:

- normalized `PriceDecisionAddress`
- mode enum: `offer` or `listing`
- subject attributes and data provenance
- recorded-sale comparable with sale price/date and similarity inputs
- target-listing timeline with observable price changes
- ZIP market context
- external AVM estimate and range
- deterministic result, range, scenarios, factors, limitations, and confidence
- bounded invalid-input, subject-not-found, insufficient-evidence, provider-
  unavailable, and contradictory-evidence errors

Tests must prove immutability, money/date bounds, exact California/ZIP rules,
comparable identity uniqueness, deterministic ordering, rounding, confidence
downgrades, and fail-closed evidence behavior.

### 31.3 RentCast Evidence Adapter And Contract Audit

First add fixtures and parsers against documented schemas. A real provider audit
is a separate, explicitly authorized action with an exact request budget and a
redacted record. The audit determines the final minimal endpoint composition.

Candidate evidence sources to verify:

1. `/v1/avm/value` for the current value estimate, estimate range, subject
   attributes, and listing-based comparable metadata.
2. `/v1/properties` for subject resolution and nearby recent property records
   with actual recorded sale prices/dates.
3. `/v1/listings/sale` for a subject's current/previous listing timeline,
   including days on market and observable price changes.
4. `/v1/markets` for ZIP-level sale market statistics and monthly history.

The audit must answer:

- Does a property-record query reliably distinguish recorded sale price/date
  from listing price/date in target California counties?
- Can the query produce enough nearby records without collecting owner fields
  for product use?
- Which exact fields are absent, null, or county-dependent?
- Does listing history preserve price reductions and relistings well enough for
  a bounded flexibility signal?
- Can one call be removed without materially weakening the result?
- What is the successful-request count for offer and listing modes?
- What current plan quota, overage setting, endpoint restriction, and API-key
  separation apply to local, DEV, and Production?

Expected files after audit acceptance:

- extensions under `packages/rentcast/src/` for Price Decision only
- strict parser and URL-construction tests with captured redacted fixtures
- an ignored local audit executable or a guarded repository CLI, if needed
- a redacted provider-audit record under `docs/price-decision/`

The existing active-listing acquisition contract must not be broadened or
silently changed to serve Price Decision.

### 31.4 Deterministic Pricing Engine

Implement the methodology in
[Valuation Methodology](valuation-methodology.md) as pure application/domain
logic. No code in this step calls RentCast, OpenAI, PostgreSQL, AWS, or the
browser.

The engine must:

- select and score recorded-sale comparables deterministically
- compute a robust comparable anchor and evidence dispersion
- keep the RentCast AVM as a separately visible calibration input
- derive different offer and listing strategies from the same market-value
  evidence
- cap observable listing leverage adjustments
- emit evidence IDs for every factor and reason
- downgrade or refuse confidence when inputs are stale, sparse, contradictory,
  or incomplete
- round presentation prices predictably without hiding underlying calculations

Golden fixtures should cover a normal market, hot market, stale listing, price-
reduction sequence, low-comp rural-like case, condominium, missing square
footage, anomalous sale, AVM disagreement, and insufficient evidence.

### 31.5 OpenAI Explanation Adapter

Reuse the existing OpenAI package patterns without coupling the pricing engine
to an OpenAI model.

Expected ownership:

- application-level `PriceDecisionExplainerPort`
- evidence-only prompt builder and strict Zod output schema
- deterministic template explainer
- OpenAI adapter under `packages/openai/src/`
- injected fetch, timeout, refusal, incomplete, schema, authentication, and
  rate-limit tests

Output is limited to:

- concise summary
- evidence-backed reasons referencing allowed evidence IDs
- mode-specific strategy text tied to precomputed scenario prices
- limitations selected from the deterministic result

The adapter must use the server-side Responses API, strict structured output,
`store: false`, bounded output, and no tools or web search. It may not receive
owner data, raw provider payloads, credentials, internal database values, or
unneeded full transaction history. Every number in generated content is
validated against the deterministic result. Invalid or unavailable AI output is
discarded and replaced by the deterministic template.

The model identifier and reasoning effort are configuration owned by the
adapter and must be verified at implementation time; this plan does not pin a
future model by name.

### 31.6 Protected API Composition

Add `POST /api/price-estimations` behind the existing session and administrator
checks. The route consumes a small JSON body and returns the provider-neutral
contract in [Product and API Contract](product-and-api-contract.md).

Expected ownership:

- `apps/api/src/priceEstimationDto.ts`
- `apps/api/src/priceEstimationDto.test.ts`
- focused route tests in `apps/api/src/createApp.test.ts`
- composition/config changes in `apps/api/src/server.ts`, `apiConfig.ts`, and
  their tests
- dependency/build-graph updates only if needed to compose the existing
  RentCast and OpenAI workspace packages into the API

Required controls:

- authentication and administrator authorization before provider work
- existing unsafe-request Origin enforcement
- strict exact-field parsing and a small route-specific body limit
- per-user/IP request throttling and one active estimation per user
- short-window in-flight duplicate suppression for repeated button clicks
- independent provider and total-request deadlines with abort propagation
- no retries that can multiply billable requests unless explicitly bounded and
  documented
- `Cache-Control: no-store`
- no address, owner data, API key, raw provider body, prompt, or AI output in
  logs
- request ID, mode, ZIP, durations, evidence counts, confidence, outcome, and
  provider-call counts as bounded telemetry
- deterministic result returned when only OpenAI fails
- provider errors mapped to stable safe client errors

No PostgreSQL migration or repository is planned. If later review concludes a
durable cost counter is mandatory, that is a scope change requiring a new
sub-block rather than an incidental migration.

### 31.7 Web Workspace And Acceptance

Extend the existing authenticated tab shell with a fourth workspace. Keep the
current `Listings` default.

Expected ownership:

- `apps/web/src/PriceEstimationScreen.tsx`
- `apps/web/src/PriceEstimationScreen.test.tsx`
- `apps/web/src/priceEstimationApi.ts`
- `apps/web/src/priceEstimationApi.test.ts`
- `apps/web/src/App.tsx` and its focused tests
- scoped styles in `apps/web/src/index.css`
- Playwright stub/fixtures and UI/API smoke only where the dependency-aware
  quality plan requires them

Required states:

- initial form
- validation feedback without a provider call
- one explicit action loading at a time
- success with subject, price, range, confidence, factors, comps, strategy,
  freshness, and limitations
- subject not found
- insufficient evidence
- provider unavailable/rate limited
- retry preserving user inputs
- session expiry returning to sign-in
- AI fallback clearly preserving the valuation without presenting an error as
  if the price failed

Accessibility requirements include programmatic labels, field-level errors,
focus movement to the result/error summary, keyboard-operable tab/action flow,
non-color confidence and direction labels, table headers/captions, live loading
status, and usable layouts at existing desktop/mobile breakpoints.

## Test Matrix

### Unit And Contract

- address normalization and exact input rejection
- provider schema parsing, nullability, unknown fields, and immutability
- comparable selection, scoring, outlier handling, range, scenarios, confidence
- exact separation of sale price, listing price, AVM, and market statistics
- AI prompt allowlist, structured response, evidence references, and fallback
- API DTO request/response runtime validation
- frontend client runtime validation and error mapping
- React state, retries, stale request isolation, and session expiry

### Integration

- fake RentCast -> application -> Express -> typed browser response
- OpenAI success, invalid output, refusal, timeout, and unavailable fallback
- provider timeout/abort without a second hidden billable request
- authentication/origin/rate/body-size security matrix
- duplicate submission produces one orchestrated provider sequence
- no provider call for invalid, unauthenticated, or unauthorized requests

### Black-Box And Browser

- signed-in user can open `Price Estimation`
- both actions submit the correct mode
- result content is readable on desktop and mobile
- comparable table and strategy sections are keyboard/screen-reader usable
- insufficient-evidence and provider-unavailable recovery
- session loss returns to sign-in
- real provider and OpenAI services are replaced by deterministic local fakes

### Completion Gate

- focused tests pass
- full `pnpm test` passes
- full `pnpm typecheck` passes
- runtime, web, and infrastructure production builds pass
- Playwright smoke/regression selected by the repository quality gate passes
- dependency and lockfile changes are reviewed
- no secret, address fixture belonging to a real person, provider payload, or
  generated report is tracked
- changed-file and architecture review confirms no valuation rule leaked into
  React, Express, or provider code
- a user confirms desktop/mobile product language and result readability
- DEV/Production rollout remains separately authorized

## Cost And Operational Gate

RentCast documents request-based billing, possible overages, and no provider-side
hard usage cap. Consequently, Block 31 must not be deployed until the owner
reviews the current account plan and the application has a bounded call plan.

Before a real provider audit or rollout, record:

- exact maximum successful RentCast calls per estimation mode
- maximum estimations per user/time window
- environment-specific keys and endpoint/IP restrictions where supported
- current quota and overage behavior
- timeout and retry count
- observability for successful provider-call count and rate-limit outcomes
- rollback switch that disables Price Estimation without affecting Listings

OpenAI usage receives separate timeout, token, and request controls. Its outage
must never trigger repeated RentCast acquisition or make the deterministic
result unavailable.

## Security And Privacy Review

Threats and controls:

| Threat | Required control |
| --- | --- |
| Credential exposure | Server-only env/secrets; never return or log keys |
| Provider-cost abuse | Auth/admin gate, throttle, one in-flight request, call budget |
| Address leakage | No full address in logs; no persistent result in MVP |
| Owner-data overcollection | Ignore and strip owner/contact/mailing fields |
| Prompt injection from provider text | Do not send remarks/descriptions; structured allowlist only |
| AI hallucinated numbers | Deterministic numbers; post-validate all AI references |
| Misleading certainty | Confidence/limitations required; fail closed on weak evidence |
| Seller-motivation claim | Observable signals only; explicitly label inference |
| Stale async response | Abort and request-generation guards in API and React |
| Cross-site request | Existing exact Origin guard and same-origin session cookie |

## Rollout And Rollback

1. Implement and accept 31.2-31.7 locally with fakes.
2. Run the separately authorized minimal RentCast contract audit and finalize
   provider mappings.
3. Review exact provider/OpenAI cost controls and configuration.
4. Promote through the protected feature-to-DEV quality gate.
5. Deploy to DEV only through the existing protected workflow and accept with
   bounded non-production addresses and controlled provider requests.
6. Promote the exact accepted DEV release through the existing release gate.
7. Production plan/deploy remains manual and digest-bound.

Rollback disables the Price Estimation composition and hides/removes its tab in
one source rollback. Because the MVP has no persistence or migration, rollback
requires no data repair. Existing Listings, Showing List, Search Criteria,
worker, schedule, notification, ArcGIS, and wildfire behavior must remain
unchanged.

## Block 31.1 Exit Criteria

Block 31.1 exits when:

- roadmap phases and authorization boundaries are recorded
- MVP product/API/valuation contracts are documented
- actual-sale and listing-based AVM semantics are separated
- OpenAI's non-authoritative role is explicit
- cost, privacy, failure, test, rollout, and rollback gates are explicit
- Block 32 scope is separated

These criteria are satisfied by this documentation set. Executable work begins
only after separate approval for Block 31.2.

