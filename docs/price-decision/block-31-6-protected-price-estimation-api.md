# Block 31.6 Protected Price Estimation API

## Status

The source implementation is complete on
`feat/block-31-6-price-estimation-api`. Full repository tests and local
acceptance remain under repository-owner control. No real RentCast or OpenAI
request was made, no credential value was read, and no database migration, AWS
resource mutation, browser UI, deployment, or release was performed.

Block 31.6 composes the Block 31.3 evidence adapter, Block 31.4 deterministic
engine, and Block 31.5 optional narrative explainer behind:

```text
POST /api/price-estimations
```

The route is authenticated, administrator-only, same-origin, request-scoped,
stateless, and `Cache-Control: no-store`.

## Request Boundary

The route accepts exactly:

```json
{
  "streetAddress": "100 Test Ave",
  "city": "Irvine",
  "zipCode": "92618",
  "mode": "offer"
}
```

The four fields are parsed through the existing Domain normalization rules.
The server supplies `CA`; a browser-supplied state or any other extra field is
rejected. Authentication and administrator authorization run before the
route-specific JSON parser. The unsafe-request Origin guard runs before both.

The JSON limit is 2,048 bytes. Malformed JSON, oversized JSON, arrays, missing
fields, additional fields, invalid address components, invalid ZIP codes, and
unknown modes all map to `INVALID_PRICE_ESTIMATION_REQUEST`. The request body
and full address are never logged.

## Composition And Call Budget

Each original execution creates request-scoped provider adapters and performs:

1. RentCast AVM/subject lookup;
2. RentCast recorded-sale lookup;
3. optional RentCast subject listing lookup;
4. optional RentCast ZIP sale-market lookup; and
5. at most one optional OpenAI explanation request after deterministic pricing
   succeeds.

RentCast remains sequential and has zero retries. Its independent timeout is 15
seconds per request. OpenAI has zero retries and a 30-second request timeout.
The complete estimation has a 75-second deadline whose `AbortSignal` propagates
through both adapters. The total deadline can therefore stop a slow provider
sequence before the sum of all independent deadlines is reached.

OpenAI is optional. If `OPENAI_API_KEY` is absent, or the single OpenAI request
fails or returns invalid output, the response keeps the valid deterministic
price and returns `strategy.source = deterministic-fallback` with the Block
31.5 enhancement-unavailable limitation. No OpenAI request occurs when no key
is configured.

`RENTCAST_API_KEY` enables the endpoint composition. Without it the API still
starts, but this route returns the bounded `PRICE_ESTIMATION_UNAVAILABLE`
response. Supplying OpenAI configuration without required RentCast
configuration fails startup validation. Provider credentials remain
server-side and are never accepted in the HTTP body or response.

No AWS secret injection was changed in this block. Consequently, an existing
deployed API remains disabled for Price Estimation until a separately reviewed
environment/secret wiring and provider-budget gate is completed.

## Concurrency, Deduplication, And Throttling

The in-process request controller applies:

- six requests per authenticated user per 15-minute fixed window;
- twenty requests per direct peer IP per 15-minute fixed window;
- exactly one active provider sequence per user; and
- SHA-256 request fingerprints containing no readable address.

Two simultaneous requests from the same user with the same normalized address
and mode share one promise and therefore one provider sequence. A simultaneous
request for a different address or mode returns
`PRICE_ESTIMATION_IN_PROGRESS`. Rejected and duplicate HTTP attempts still
consume the application request budget, but duplicate requests do not create
provider calls.

The counters are intentionally process-local because Block 31 is single-admin,
stateless, and has no persistence migration. They are a protective throttle,
not a durable billing ledger. A future multi-instance hard cost ledger would be
a separately approved scope change.

## Response Boundary

The DTO returns:

- an opaque request-scoped `analysisId`;
- methodology version and decision mode;
- subject facts with a CPI SHA-256-derived public property ID;
- deterministic recommendation, range, anchor, confidence, and data-as-of time;
- the three deterministic scenarios;
- evidence-backed narrative reasons;
- only selected recorded-sale comparables, each with a CPI public property ID;
- nullable AVM, ZIP market, and observable listing-signal context;
- mode-specific strategy with scenario kinds and narrative source; and
- stable limitation code/message objects.

Raw RentCast property identifiers are hashed before leaving the API. Raw
provider bodies, provider names from internal contracts, request counts,
credentials, prompts, model response IDs, chain of thought, and internal errors
are not returned. Recorded sale prices, listing prices, and AVM values remain
separately labeled.

## Safe Error Contract

| Status | Code | Meaning |
| --- | --- | --- |
| 400 | `INVALID_PRICE_ESTIMATION_REQUEST` | Exact request validation failed |
| 401 | `AUTHENTICATION_REQUIRED` | Session missing, invalid, or expired |
| 403 | `ADMIN_AUTHORIZATION_REQUIRED` | User is not an administrator |
| 404 | `PROPERTY_NOT_FOUND` | RentCast could not resolve the subject |
| 409 | `PRICE_ESTIMATION_IN_PROGRESS` | A different user estimation is active |
| 422 | `INSUFFICIENT_VALUATION_EVIDENCE` | Evidence is insufficient or contradictory |
| 429 | `PRICE_ESTIMATION_RATE_LIMITED` | User or IP application budget is exhausted |
| 502 | `PRICE_EVIDENCE_UNAVAILABLE` | Required evidence failed validation/acquisition |
| 503 | `PRICE_ESTIMATION_UNAVAILABLE` | Required server composition is disabled |
| 504 | `PRICE_ESTIMATION_TIMED_OUT` | Total request deadline expired |
| 500 | `INTERNAL_SERVER_ERROR` | Unexpected bounded failure |

OpenAI-only failure is not an endpoint error.

## Telemetry And Privacy

Successful and failed route events use only bounded fields:

- request ID;
- mode;
- ZIP code;
- rounded total duration;
- selected comparable count and confidence on success;
- stable outcome category; and
- RentCast/OpenAI request counts.

No street address, subject/comparable ID, request body, API key, provider URL,
raw response, prompt, AI prose, or exception message is logged. Provider-call
callbacks are isolated so an observability failure cannot change the result.

## Verification Record

Focused tests cover:

- exact DTO parsing and nullable response mapping;
- public property-ID hashing and raw provider-ID exclusion;
- authentication, administrator authorization, and Origin ordering;
- malformed, extra-field, and oversized body rejection;
- no-store success response and safe telemetry;
- 404, 409, 422, 429, 502, 503, and 504 mappings;
- separate per-user and per-IP throttles;
- identical in-flight sharing and different-request exclusion;
- total deadline abort propagation;
- request-scoped four-call RentCast composition;
- OpenAI single-call failure fallback and missing-key fallback; and
- API typecheck, build, package regression, and quality gates.

