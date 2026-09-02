# Price Decision Product And API Contract

## User Flow

After authentication, the workspace tabs appear in this order:

1. `Listings`
2. `Showing List`
3. `Search Criteria`
4. `Price Estimation`

`Listings` remains the default after sign-in. Switching tabs is client-side and
does not start a provider request.

The Price Estimation form contains:

- `Street number and name`
- `City`
- `ZIP code`
- primary action `Set Offer Price`
- secondary action `Set Listing Price`

The MVP is California-only. The UI states `California properties only`, and the
API supplies state `CA`. The street field may include a unit designator when
needed, but must not contain the city, state, or ZIP again.

Submitting one action disables both actions until the request settles. Repeated
clicks must not create concurrent estimations. Changing an input after a result
marks the visible result as based on the previous address until the next
submission or clears it according to the final UX acceptance decision; it must
never silently relabel old evidence as current.

## Result Layout

The success state is presented in this order:

1. subject property identity and core attributes
2. recommended price, reasonable range, mode, confidence, and data-as-of time
3. concise evidence-backed reasons
4. strategy scenarios
5. recorded comparable-sales table
6. AVM and ZIP-market context
7. limitations and decision-aid disclosure

### Offer Mode

Display:

- `Recommended offer`
- `Reasonable offer range`
- `Conservative`, `Recommended`, and `Competitive` scenarios
- negotiation strategy tied to observable leverage signals

The product must not claim the recommended offer will be accepted.

### Listing Mode

Display:

- `Recommended listing price`
- `Expected market-value range`
- `Quick sale`, `Balanced`, and `Stretch` scenarios
- review checkpoint and bounded future price-adjustment guidance

The product must not present the stretch scenario as expected proceeds or claim
that a list price guarantees a sale.

## HTTP Endpoint

```text
POST /api/price-estimations
Content-Type: application/json
```

The endpoint is session-cookie authenticated, administrator-only, same-origin,
and `Cache-Control: no-store`.

### Request

```json
{
  "streetAddress": "123 Main St",
  "city": "Irvine",
  "zipCode": "92612",
  "mode": "offer"
}
```

Rules:

- exactly these four keys; reject unknown keys
- `streetAddress`: trimmed, bounded length, contains a street number and name
- `city`: trimmed, bounded California city name; no state/ZIP suffix
- `zipCode`: exactly five ASCII digits
- `mode`: exactly `offer` or `listing`
- state is not accepted from the browser in the MVP
- never log the request body

### Success Response

This is the planning contract. Exact TypeScript names may change during 31.2,
but the semantics and provenance boundaries must remain.

```json
{
  "analysisId": "request-scoped-opaque-id",
  "mode": "offer",
  "subject": {
    "propertyId": "provider-neutral-stable-id",
    "formattedAddress": "123 Main St, Irvine, CA 92612",
    "propertyType": "Single Family",
    "bedrooms": 4,
    "bathrooms": 3,
    "squareFootage": 2450,
    "yearBuilt": 1998,
    "latitude": 33.0,
    "longitude": -117.0
  },
  "recommendation": {
    "recommendedPrice": 1385000,
    "rangeLow": 1350000,
    "rangeHigh": 1420000,
    "marketValueAnchor": 1400000,
    "currency": "USD",
    "confidence": "medium",
    "dataAsOf": "2026-09-01T18:00:00.000Z"
  },
  "scenarios": [
    {
      "kind": "conservative",
      "price": 1350000,
      "label": "Conservative",
      "tradeoff": "Lower entry point with greater rejection risk."
    },
    {
      "kind": "recommended",
      "price": 1385000,
      "label": "Recommended",
      "tradeoff": "Balances comparable evidence and observable listing leverage."
    },
    {
      "kind": "competitive",
      "price": 1415000,
      "label": "Competitive",
      "tradeoff": "Improves competitiveness while remaining inside the evidence range."
    }
  ],
  "reasons": [
    {
      "title": "Recent recorded sales",
      "detail": "The strongest comparable evidence centers near the market-value anchor.",
      "evidenceIds": ["sale-comp-1", "sale-comp-2", "sale-comp-3"]
    }
  ],
  "comparables": [
    {
      "evidenceId": "sale-comp-1",
      "propertyId": "provider-neutral-comp-id",
      "formattedAddress": "Comparable address",
      "salePrice": 1395000,
      "saleDate": "2026-06-15",
      "distanceMiles": 0.6,
      "propertyType": "Single Family",
      "bedrooms": 4,
      "bathrooms": 3,
      "squareFootage": 2380,
      "pricePerSquareFoot": 586.13,
      "similarityScore": 0.88,
      "latitude": 33.0,
      "longitude": -117.0
    }
  ],
  "context": {
    "avm": {
      "estimate": 1405000,
      "rangeLow": 1340000,
      "rangeHigh": 1460000,
      "label": "RentCast value estimate"
    },
    "market": {
      "zipCode": "92612",
      "medianListPrice": 1420000,
      "medianPricePerSquareFoot": 590,
      "medianDaysOnMarket": 31,
      "lastUpdatedDate": "2026-09-01"
    },
    "listingSignals": {
      "currentListPrice": 1450000,
      "daysOnMarket": 47,
      "priceReductionCount": 1,
      "totalReductionPercent": 2.7,
      "flexibilitySignal": "medium",
      "isInference": true
    }
  },
  "strategy": {
    "summary": "Begin with the recommended scenario and preserve room for inspection findings.",
    "steps": [
      "Confirm condition and material upgrades before relying on the upper range.",
      "Use documented days on market and price history as negotiation context."
    ],
    "source": "openai"
  },
  "limitations": [
    "The estimate does not account for unreported interior condition or renovations.",
    "Seller flexibility is inferred from observable listing activity, not private motivation."
  ]
}
```

Response rules:

- all money values are whole USD except derived price-per-square-foot
- missing optional provider data is `null` or omitted according to the final DTO
  convention; it is never fabricated
- recorded sale price and listing price use different field names
- `similarityScore` is a CPI score, not silently relabeled provider correlation
- every AI-generated reason references existing evidence IDs
- `strategy.source` is `openai` or `deterministic-fallback`
- raw provider response, provider key, model prompt, chain of thought, owner
  details, and internal error text are never returned

## Error Contract

All errors use the repository's bounded JSON pattern with the response request
ID. Proposed status mapping:

| Status | Code | Meaning |
| --- | --- | --- |
| 400 | `invalid_price_estimation_request` | Input failed exact validation |
| 401 | `authentication_required` | Session missing, invalid, or expired |
| 403 | `administrator_required` | Authenticated user lacks required role |
| 404 | `property_not_found` | Subject address could not be resolved |
| 422 | `insufficient_valuation_evidence` | Subject exists but evidence cannot support a price |
| 429 | `price_estimation_rate_limited` | Application throttle rejected the request before provider work |
| 502 | `price_evidence_unavailable` | Required provider evidence failed or was invalid |
| 504 | `price_estimation_timed_out` | Bounded total request deadline expired |
| 500 | `internal_error` | Unexpected safe generic failure |

OpenAI-only failure is not an endpoint error. A valid deterministic result is
returned with `strategy.source = "deterministic-fallback"` and a limitation
indicating that automated narrative enhancement was unavailable.

## Evidence Language

Allowed:

- `Recorded sale price`
- `Last known sale date`
- `Current list price`
- `Listing price reduction`
- `Days on market`
- `RentCast value estimate`
- `ZIP-level listing statistics`
- `Observable flexibility signal`
- `The available evidence suggests...`

Disallowed unless a later authoritative source is added:

- `The seller is desperate/motivated/under financial pressure`
- `This home will sell for...`
- `Guaranteed value`
- `Appraised value`
- `The comparable sold for X` when X is only a removed/listed price
- `Market median sold price` when the source is active-listing statistics

## Data Quality Presentation

Confidence is always accompanied by plain-language limitations:

- `High`: sufficient recent, similar, recorded sales with low dispersion and no
  major source disagreement
- `Medium`: usable evidence with one material limitation
- `Low`: result may be displayed only when the minimum evidence gate passes and
  multiple limitations are prominent

If the minimum evidence gate does not pass, return `422` instead of `low`.

The UI must show freshness independently for recorded sales, AVM, market data,
and current listing signals when their source dates differ.

## Frontend State Contract

The web client runtime-validates every success/error response. It must ignore a
late response after the user signs out, changes request generation, navigates
away, or submits a newer estimation.

Retry preserves the validated address and selected mode. It creates a new
request only after the previous request has settled or been aborted. Client-side
validation prevents obviously invalid calls but never replaces server
validation.

The comparable table must remain usable on narrow screens through a deliberate
responsive table/card pattern; fields may not disappear solely to fit the
viewport.

