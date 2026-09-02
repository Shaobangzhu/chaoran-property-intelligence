# Price Decision Valuation Methodology

## Principle

Price Decision separates three questions:

1. What do recorded nearby sales support as current market value?
2. How do current listing and ZIP-market conditions affect strategy?
3. How should the evidence be explained to the user?

Recorded sale evidence answers the first question. Deterministic rules answer
the second. OpenAI may help phrase the third. These responsibilities must not be
collapsed into one opaque AI-generated number.

## Evidence Hierarchy

Evidence is labeled and weighted by meaning, not merely by availability.

### Tier 1: Recorded Sale Comparables

Primary evidence consists of actual recorded sale price and sale date from
property records. Each record must have:

- unique property identity
- recorded sale price greater than zero
- valid sale date
- subject-comparison attributes sufficient for scoring
- unambiguous distinction from listing price

County/state disclosure and provider coverage may make a sale price unavailable.
Missing data is not inferred from a listing's last asking price.

### Tier 2: Subject And Listing Evidence

Used for strategy, not as proof of seller motivation:

- current asking price
- listed date and days on market
- price-change history
- removal/relisting history when unambiguous
- subject property type, beds, baths, square footage, year, and lot size

Text remarks and agent descriptions are excluded from the AI prompt in the MVP
because they are untrusted, promotional, and potential prompt-injection input.

### Tier 3: RentCast AVM

The official RentCast documentation describes `/avm/value` as a current value
estimate using comparable sale listings. It returns an estimate, a range, subject
attributes, and comparable listing metadata.

This is useful calibration, but its comparable `price` values must not be shown
as recorded closed-sale prices unless the provider contract separately proves
that meaning. The UI labels the value as `RentCast value estimate`.

### Tier 4: ZIP Market Context

RentCast `/markets` provides aggregate sale-listing statistics and monthly
history by ZIP, including price, price per square foot, days on market, and
counts. It describes listing-market context, not a substitute for recorded
closed-sale comparables.

ZIP context may influence confidence and strategy, but it must not dominate a
strong subject-specific comparable set.

## Comparable Selection

The following are planning defaults to be implemented as named, tested
configuration after the provider audit. They are not hidden constants in route
or UI code.

### Hard Eligibility

- different property from the subject
- recorded sale price/date present and valid
- sale no older than 365 days
- distance no greater than 5 miles
- same broad property type; do not mix land, apartment buildings, or
  multi-family with single-family residences
- positive square footage when price-per-square-foot is used

### Preferred Pool

- sold within 180 days
- within 1 mile in dense Southern California markets
- exact property type
- bedrooms within 1
- bathrooms within 1
- square footage within 20%
- year built within 20 years when available
- lot size within 35% for detached homes when available

If fewer than three preferred comps remain, the search may expand in explicit
steps up to the hard bounds. Every expansion adds a limitation and lowers
confidence. The engine never silently relaxes property type or actual-sale
requirements.

### Similarity Score

Use a deterministic normalized score from 0 to 1. Candidate planning weights:

| Component | Weight |
| --- | ---: |
| property-type match | 0.20 |
| square-footage similarity | 0.20 |
| proximity | 0.20 |
| sale recency | 0.15 |
| bedroom similarity | 0.10 |
| bathroom similarity | 0.05 |
| year-built similarity | 0.05 |
| lot-size similarity when applicable | 0.05 |

If an optional attribute is unavailable for both subject and comp, redistribute
only that optional component across the available structural components using a
documented deterministic rule. Missing required data does not receive a neutral
score.

Provider correlation, when returned, remains separately named. It may be used as
a diagnostic or tie-breaker after audit, but it is not silently substituted for
the CPI score.

## Outliers And Duplicate Evidence

- deduplicate by canonical property/provider identity before scoring
- keep only the most recent valid recorded sale per comparable property
- reject non-arm's-length or zero/nominal transactions when the provider exposes
  an authoritative flag; otherwise add a limitation rather than guessing
- use median absolute deviation or an equivalent robust test on price per square
  foot to flag extremes when at least five comps exist
- never remove an outlier solely because it disagrees with the desired result
- expose excluded-count and exclusion-reason telemetry without logging addresses

## Market-Value Anchor

The engine calculates a comparable-sales anchor from the selected recorded sales.
A candidate algorithm for 31.4 is:

1. Calculate each comparable's price per square foot when valid.
2. Multiply by subject square footage to create an unadjusted subject-equivalent
   indication.
3. Apply only small, explicitly modeled structural adjustments that have test
   evidence; condition, view, school, and renovation adjustments remain absent
   in the MVP.
4. Calculate a similarity-weighted median indication.
5. Calculate dispersion from weighted percentiles or robust deviation.
6. Compare, but do not automatically overwrite, the result with the RentCast
   AVM and its range.

If square footage is missing or unreliable, an alternate whole-price comparable
path may be used only when the comp set is sufficiently homogeneous and the
limitation is explicit. Otherwise the engine returns insufficient evidence.

The exact formula and tuning constants must be frozen by golden tests before
API/UI work begins. They are versioned as `methodologyVersion` in the internal
result even though Block 31 does not persist estimations.

## Evidence Range

The market-value range is derived from comparable dispersion, data completeness,
and source disagreement. It must not merely copy an arbitrary percentage around
the recommendation.

Planning constraints:

- the range always contains the market-value anchor
- sparse/expanded comp pools widen the range
- missing condition data establishes a minimum uncertainty floor
- material AVM/comparable disagreement widens the range and lowers confidence
- range values are calculated before presentation rounding
- display rounding uses a predictable market-appropriate increment, initially
  `$1,000`, with scenarios remaining inside permitted bounds

## Offer Recommendation

Offer mode starts from market value and adjusts only for observable evidence.

Inputs may include:

- current asking price relative to the evidence range
- subject days on market relative to ZIP/property-type context
- verified price-reduction count and cumulative percentage
- relisting pattern when provider semantics are unambiguous
- market inventory/listing trend when available and current

The `flexibilitySignal` is `low`, `medium`, `high`, or `unknown` and is always an
inference. It cannot mention private motivation.

Candidate constraints for 31.4 calibration:

- observable leverage may move the recommended scenario only within a bounded
  percentage of the market-value anchor
- no strategy price may exceed the evidence high bound merely to appear
  competitive
- the conservative/recommended/competitive scenarios are monotonically ordered
- the current list price is context, not an automatic recommendation
- condition and inspection uncertainty is expressed as a limitation or
  contingency, not an invented dollar deduction

## Listing Recommendation

Listing mode distinguishes expected market value from go-to-market list price.

Scenarios:

- `Quick sale`: lower position inside the supported range, intended to increase
  early interest
- `Balanced`: recommended launch price supported by evidence and search-band
  considerations that are explicitly modeled
- `Stretch`: higher supported test price with a defined review checkpoint and
  a higher stale-listing risk

The strategy includes an evidence-based review checkpoint, such as a number of
days relative to current market days-on-market statistics. It must not prescribe
a future reduction as certain before observing traffic and offers.

Search-threshold pricing effects may not be claimed in the MVP unless a reliable
source or product analytics supports them. A familiar-looking `$999,000` rule is
not accepted as evidence by itself.

## Confidence

Confidence is deterministic and separate from narrative tone.

Candidate scoring dimensions:

| Dimension | Examples |
| --- | --- |
| comparable quantity | count after dedupe and hard filters |
| similarity | median/minimum CPI similarity score |
| recency | age distribution of recorded sales |
| proximity | distance distribution |
| completeness | subject and comparable structural fields |
| dispersion | robust spread of price indications |
| source agreement | comparable anchor versus AVM range |
| current context | freshness/availability of listing and ZIP statistics |

Minimum evidence gate:

- normally at least three eligible recorded-sale comps; and
- enough subject/comp attributes to calculate a meaningful similarity score; and
- no unresolved semantic ambiguity between sale and listing price.

The provider audit and fixture evaluation may justify a carefully documented
fallback using the AVM plus fewer recorded sales, but this must be separately
accepted. The default plan fails closed rather than presenting AVM-only output
as a CPI comparable-sales recommendation.

Suggested confidence behavior:

- `high`: at least five strong, recent comps, low dispersion, and no material
  AVM disagreement
- `medium`: minimum evidence passes with one material weakness
- `low`: minimum evidence passes but two or more prominent weaknesses remain
- unavailable: minimum evidence fails

## Reasons And Evidence Traceability

The deterministic engine emits factors before any AI call. Each factor has:

- stable evidence ID references
- direction: supports higher, supports lower, or neutral/contextual
- bounded impact classification rather than a fabricated exact causal amount
- human-readable fallback text

Examples:

- strongest recorded-sale comps cluster below the current ask
- subject days on market exceeds the current ZIP/property-type median
- one verified reduction lowered the asking price by a bounded percentage
- AVM range overlaps the comparable-sales range
- comp pool required expansion beyond preferred time/distance bounds

## OpenAI Boundary

OpenAI receives a minimized structured object containing:

- mode
- precomputed recommendation, range, and scenario prices
- subject attributes needed for explanation
- selected evidence facts with stable IDs
- precomputed factor directions
- allowed limitations

It does not receive:

- owner identity/contact/mailing data
- API keys or system configuration
- provider remarks or arbitrary free text
- raw provider JSON
- authority to add or change any price
- tools, web search, or external actions

The structured output permits only a summary, evidence-backed reasons, strategy
phrasing tied to existing scenarios, and known limitations. Post-validation
rejects unknown evidence IDs, unknown dollar values, unsupported claims, and
seller-motivation language. The deterministic fallback is always available.

## Known Limitations

- public-record sale availability and timeliness vary by jurisdiction
- off-market, family, distressed, or otherwise non-arm's-length transactions may
  not be fully identifiable
- interior condition, renovations, view, noise, floor level, HOA litigation,
  concessions, inspection findings, and precise school-boundary effects are not
  modeled in the MVP
- ZIP listing statistics can hide meaningful neighborhood variation
- an AVM is an external modeled estimate, not an appraisal
- listing removal price may differ from closed sale price
- seller intent cannot be known from public listing behavior
- fast markets can change between source dates and user action

Every result displays applicable limitations and a data-as-of time. Users should
verify material facts with current MLS/public records and qualified real-estate
professionals before acting.

## Methodology Acceptance Before Release

Before DEV rollout, review at least a bounded fixture set across the supported
California markets and record:

- selected/excluded comp rationale
- anchor and range calculations
- offer/listing scenario monotonicity
- confidence and limitation correctness
- AVM disagreement behavior
- missing-data behavior
- zero hallucinated or mislabeled sale prices
- stable results for identical input fixtures

This is a software correctness and product-language gate, not a claim of
statistical validation. Formal backtesting against known future sales is a
separate enhancement and should precede any marketing claim about accuracy.
