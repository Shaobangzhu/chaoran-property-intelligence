# Block 31.5 OpenAI Price Decision Explainer

## Status

The source implementation is complete on
`feat/block-31-5-openai-price-decision-explainer`. Full repository tests and
local acceptance remain under repository-owner control. No credential was read,
no real OpenAI request was made, and no API route, browser UI, persistence,
AWS resource, or deployment was added or changed.

Block 31.5 adds an optional narrative enhancement after the deterministic
pricing engine has already produced a valid recommendation. OpenAI cannot
calculate, change, or replace the anchor, recommendation, range, confidence,
scenario prices, factors, evidence IDs, or limitations.

## Ownership And Flow

The Application package owns:

- the minimized, deeply immutable `PriceDecisionExplanationContext`;
- the `PriceDecisionExplainerPort`;
- the strict narrative draft schema and relationship validation;
- the fixed prompt boundary;
- the deterministic template explainer; and
- orchestration that falls back without losing a valid numeric result.

The OpenAI package owns only the provider adapter, provider configuration,
bounded provider-error translation, and privacy-safe operational telemetry.

The flow is:

1. normalize and cross-check the evidence and deterministic result;
2. project only the evidence needed to explain that result;
3. make one optional Responses API call with strict structured output;
4. apply application-owned dynamic validation to the parsed draft; and
5. discard any failed or invalid AI draft and render deterministic wording.

Block 31.6 will compose this boundary into the authenticated API. Block 31.5
does not read an environment variable or create a composition root.

## Frozen Provider Configuration

The adapter uses:

| Setting | Value |
| --- | --- |
| Model | `gpt-5.6-terra` |
| Reasoning effort | `low` |
| Maximum output tokens | `2,000` |
| Request timeout | `30,000 ms` |
| SDK retries | `0` |
| Structured-output name | `price_decision_narrative` |
| Storage | `store: false` |
| Truncation | `disabled` |
| Tools / web search | none |

The model and reasoning effort were verified against the official model page on
2026-09-01. The implementation uses the Responses API because it supports
Structured Outputs, `store: false`, bounded output tokens, and explicit response
status. Configuration changes require a reviewed source change and test update;
callers cannot override the model, reasoning effort, token limit, or retry count.
The injected timeout exists only as a deterministic adapter-test seam.

## Data-Minimization Boundary

The model context contains only:

- normalized subject structural attributes;
- the deterministic result's selected comparable sale facts and similarity;
- only referenced listing events, ZIP market context, and external estimate;
- deterministic valuation, confidence, scenarios, factors, and limitations; and
- a bounded catalog of evidence IDs that narrative reasons may cite.

It excludes subject and comparable addresses, provider property IDs,
coordinates, owner/contact data, remarks, credentials, raw RentCast payloads,
database values, and unselected transaction history. The prompt is fixed
application text; no user-provided instruction field is accepted.

The adapter does not log or expose the prompt, response body, provider response
ID, request ID, address, or generated prose. Its optional telemetry contains
only a bounded outcome category, fixed model name, rounded duration, and token
counts. A telemetry callback failure cannot change the user-facing result.

## Structured Contract And Guardrails

The draft contains:

- one concise summary;
- one through five reasons, each with allowed evidence IDs;
- one strategy summary;
- exactly the three deterministic scenario kinds, each exactly once; and
- exactly the deterministic limitation-code set.

Static Zod parsing rejects extra or malformed fields. Application validation
then rejects unknown or duplicate evidence IDs, unknown or missing limitations,
missing or duplicate scenarios, currency symbols, percentages, seller-pressure
claims, seller private-intent claims, and invented numeric tokens.

The model is instructed not to state prices because the UI will render numeric
engine results separately. Existing deterministic factor, scenario, and
limitation wording is allowed verbatim so the non-AI fallback can preserve
trusted engine explanations even when those strings contain a number. Novel AI
text cannot add such numeric claims. Seller flexibility remains an inference
derived only from observable listing activity; the narrative cannot relabel it
as seller fact, distress, urgency, or motivation.

## Failure And Fallback Semantics

The provider adapter translates authentication/access, rate limiting, timeout,
refusal/content filtering, incomplete output, malformed/schema-invalid output,
and general unavailability into fixed error classes whose messages contain no
provider details.

`GeneratePriceDecisionExplanation` treats a provider error as
`provider-error` and a dynamically invalid draft as `invalid-output`. In either
case it:

- keeps the already valid deterministic price result untouched;
- creates reasons from the deterministic ranked factors;
- creates strategy text from the deterministic scenario tradeoffs;
- preserves every deterministic limitation; and
- adds `narrative-enhancement-unavailable` so the response can disclose that
  deterministic wording is being shown.

Observability callbacks are best-effort and cannot prevent the fallback.
Relationally invalid evidence/result input fails closed before any model call;
it is not masked as an OpenAI outage.

## Verification Record

Focused automated coverage includes:

- deeply frozen context projection and absence of addresses/property IDs;
- evidence, scenario, limitation, number, currency, and seller-motivation
  guardrails;
- deterministic fallback and valid-result preservation;
- fixed Responses API body with Structured Outputs and no tools;
- model configuration, `store: false`, bounded tokens, and zero retries;
- successful token/duration telemetry and callback isolation;
- refusal, content filter, incomplete, malformed JSON, invalid schema, and
  dynamic-invalid-output handling;
- bounded 401, 403, 429, 5xx, connection, timeout, and failed-response errors;
  and
- Application/OpenAI typecheck and package build gates.

No live model behavior or provider billing state was tested. Before Block 31 is
enabled in an environment, the repository owner must separately verify the
current OpenAI project access, budget, rate limit, key separation, model
availability, and acceptable production timeout/cost behavior.

## Official Documentation Reviewed

Reviewed on 2026-09-01:

- [Create a model response](https://developers.openai.com/api/reference/cli/resources/responses/methods/create)
- [GPT-5.6 Terra model](https://developers.openai.com/api/docs/models/gpt-5.6-terra)

