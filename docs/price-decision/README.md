# Price Decision

## Status

Blocks 31.1 through 31.6 are complete and merged into the Block 31 parent. The
authenticated Block 31.7 Price Estimation workspace source is ready for owner
verification. The separately authorized RentCast provider contract audit
remains pending. No RentCast or OpenAI credential was read, no real
provider/model request was made, and no database migration, AWS resource, real
provider-backed browser acceptance, or deployment was performed.

## Product Goal

Add a fourth authenticated workspace tab named `Price Estimation`. An
administrator enters a California street address, city, and ZIP code and chooses
one of two explicit actions:

- `Set Offer Price`
- `Set Listing Price`

The result combines recorded comparable sales, a current RentCast value estimate,
ZIP-level market context, and observable listing signals. It shows a recommended
price, a reasonable range, confidence and limitations, comparable evidence,
reasons, and bounded negotiation or listing strategies.

This feature is a decision aid, not a licensed appraisal, broker price opinion,
legal opinion, or guarantee of sale price.

## Accepted MVP Decisions

1. Numeric pricing is deterministic and testable. OpenAI does not choose or
   alter the price.
2. Recorded sale prices and dates are distinct from listing prices and from the
   RentCast listing-based AVM. The UI labels each evidence type accurately.
3. Seller pressure is never asserted as fact. The product may describe only
   observable flexibility signals such as days on market, price reductions, or
   relisting history, and must label the conclusion as an inference.
4. The MVP is California-only because the requested form does not include a
   state field and the current product markets are in California. The server
   supplies `CA`; it does not infer a state from free text.
5. The request is synchronous and stateless. Search inputs, results, AI output,
   and provider payloads are not saved to PostgreSQL in Block 31.
6. The browser calls only the authenticated same-origin API. Provider keys and
   provider-specific raw schemas stay server-side.
7. An OpenAI failure degrades to a deterministic explanation and strategy; it
   does not discard a valid valuation.
8. Insufficient or contradictory evidence produces a bounded unavailable result,
   not a confident-looking price.
9. Owner names, owner mailing addresses, and other unneeded property-record
   fields are neither requested for product use nor returned to the browser.
10. Maps and heatmaps are deferred to Block 32.

## Document Index

- [Block 31.1 Implementation Plan](block-31-1-implementation-plan.md): delivery
  sequence, package ownership, expected files, gates, tests, and rollout.
- [Block 31.3 RentCast Evidence Adapter](block-31-3-rentcast-evidence-adapter.md):
  endpoint composition, call budget, source semantics, privacy controls, error
  mapping, verification, and the pending live-audit gate.
- [Block 31.4 Deterministic Pricing Engine](block-31-4-deterministic-pricing-engine.md):
  exact comparable selection, scoring, anchor, range, strategy, confidence,
  traceability, and golden-fixture rules.
- [Block 31.5 OpenAI Price Decision Explainer](block-31-5-openai-explanation-adapter.md):
  minimized model context, strict structured narrative, hallucination
  guardrails, bounded provider errors, privacy-safe telemetry, and deterministic
  fallback.
- [Block 31.6 Protected Price Estimation API](block-31-6-protected-price-estimation-api.md):
  authenticated composition, DTO boundary, deadlines, request budgets,
  duplicate suppression, safe errors, and redacted telemetry.
- [Block 31.7 Price Estimation UI](block-31-7-price-estimation-ui.md): strict
  browser client, fourth workspace, complete result/failure states,
  accessibility, responsive evidence presentation, and late-result isolation.
- [Product and API Contract](product-and-api-contract.md): user flow, endpoint,
  DTO shape, states, errors, accessibility, and product language.
- [Valuation Methodology](valuation-methodology.md): evidence hierarchy,
  comparable selection, deterministic pricing, confidence, AI boundary, and
  model limitations.

## Current Repository Seams

The implementation can reuse these existing boundaries:

- `apps/web/src/App.tsx` already owns the authenticated workspace tabs and
  session-expiry behavior.
- `apps/api/src/createApp.ts` already owns same-origin request protection,
  authentication, administrator authorization, no-store responses, request IDs,
  and safe JSON error handling.
- `packages/rentcast` already contains a server-side, timeout-bounded RentCast
  client with strict parsing patterns, but it currently supports active sale
  listing acquisition rather than Price Decision evidence.
- `packages/openai` already uses the Responses API, Zod structured output,
  `store: false`, bounded errors, and injected fetch/testing seams.
- `packages/application` and `packages/domain` already provide the project-wide
  business-rule and orchestration boundaries.

Price Decision should extend these patterns rather than placing valuation rules
inside React, Express route handlers, or provider adapters.

## Block 32 Boundary

The following remain out of Block 31:

- ArcGIS subject and comparable markers
- sale-price, price-per-square-foot, or days-on-market heatmaps
- neighborhood, school, crime, hazard, or walkability scoring
- polygon or drive-time comparable searches
- saved estimation history, sharing, comparison lists, and collaboration
- automatic offer documents, listing publication, messaging, or CRM actions
- image-based condition analysis and renovation estimates
- portfolio or batch valuation

Block 31 response contracts should preserve stable subject/comparable IDs and
coordinates when legitimately available so Block 32 can add visualization
without moving pricing logic into the map.

## External Documentation Reviewed

The following official documentation was reviewed on 2026-09-01. Provider
schemas, plans, models, and limits may change, so executable provider work still
requires the Block 31.3 contract audit.

- [RentCast Property Valuation](https://developers.rentcast.io/reference/property-valuation)
- [RentCast Value Estimate](https://developers.rentcast.io/reference/value-estimate)
- [RentCast Property Records](https://developers.rentcast.io/reference/property-records)
- [RentCast Property Valuation Schema](https://developers.rentcast.io/reference/property-valuation-schema)
- [RentCast Property Listings Schema](https://developers.rentcast.io/reference/property-listings-schema)
- [RentCast Market Statistics](https://developers.rentcast.io/reference/market-statistics)
- [RentCast Market Data Schema](https://developers.rentcast.io/reference/market-data-schema)
- [RentCast Billing and Pricing](https://developers.rentcast.io/reference/billing-and-pricing)
- [RentCast Rate Limits](https://developers.rentcast.io/reference/rate-limits)
- [OpenAI Developer Quickstart](https://platform.openai.com/docs/quickstart/make-your-first-api-request)
