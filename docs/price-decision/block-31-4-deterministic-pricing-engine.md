# Block 31.4 Deterministic Pricing Engine

## Status

The pure, fixture-backed implementation is complete on
`feat/block-31-4-deterministic-pricing-engine`. It calls no provider, model,
database, AWS service, API route, or browser code. Full repository tests and
manual acceptance remain under repository-owner control.

The implementation is versioned as `cpi-price-decision-v1`. Anchors and
scenarios round to the nearest `$1,000`; range bounds round outward to the same
presentation increment. Calculation inputs remain unrounded until the result
boundary.

## Hard Evidence Gate

The engine requires:

- subject square footage;
- at least three eligible recorded-sale comparables after hard filtering;
- sale age no greater than 365 calendar days;
- distance no greater than 5 miles;
- a compatible broad property group;
- comparable square footage; and
- CPI similarity score of at least `0.45`.

The broad groups are:

- `Condo` + `Townhouse` as attached housing;
- `Multi-Family` + `Apartment` as multifamily housing; and
- `Single Family`, `Manufactured`, and `Land` each as separate groups.

Listing prices, AVM comparable listing prices, and ZIP listing statistics never
satisfy the three-recorded-sale minimum. Subject or comparable square footage
is not imputed. Failure of the gate raises
`InsufficientPriceDecisionEvidenceError`.

## Comparable Expansion

The first stage containing at least three comparables becomes the selected
pool. The pool is then outlier-screened, deterministically sorted, and capped at
the ten strongest scores.

### Preferred stage

- sale within 180 days;
- distance at most 1 mile;
- exact property type;
- square footage within 20%;
- bedrooms and bathrooms within 1 when both values exist;
- year built within 20 years when both values exist; and
- lot size within 35% for single-family/manufactured properties when both
  values exist.

### Expanded stage

- sale within the 365-day hard bound;
- distance at most 3 miles;
- exact property type;
- square footage within 35%;
- bedrooms and bathrooms within 2 when both values exist;
- year built within 30 years when both values exist; and
- applicable lot size within 50% when both values exist.

### Hard stage

The 365-day, 5-mile, broad-property-group, square-footage, and minimum-score
bounds remain. The engine never expands across incompatible broad property
groups or substitutes a listing price for an actual sale.

Expanded or hard-stage use emits a limitation and a confidence weakness.

## CPI Similarity Score

The fixed component weights are:

| Component | Weight | Similarity rule |
| --- | ---: | --- |
| Property type | 0.20 | exact `1.0`; compatible broad-group `0.7` |
| Square footage | 0.20 | linear to zero at 50% relative difference |
| Proximity | 0.20 | linear from 1 at 0 miles to 0 at 5 miles |
| Sale recency | 0.15 | linear from 1 today to 0 at 365 days |
| Bedrooms | 0.10 | linear to zero at a difference of 3 |
| Bathrooms | 0.05 | linear to zero at a difference of 3 |
| Year built | 0.05 | linear to zero at a difference of 50 years |
| Lot size | 0.05 | detached/manufactured only; linear to zero at 75% difference |

An optional component is omitted when either side is missing. The score divides
by the weights actually present, which redistributes the missing weight without
assigning a neutral score. Scores are rounded to four decimal places for the
result contract; subject-equivalent indications use the unrounded sale facts.

## Anchor And Outliers

Each selected comparable produces:

`sale price / comparable square footage * subject square footage`

The market-value anchor is the similarity-weighted median of those indications.
The weighted median prevents one high-scoring extreme from acting like a
weighted average.

When a stage contains at least five comparables, the engine examines sale price
per square foot with a fixed median-absolute-deviation rule:

- modified Z-score greater than `3.5` is extreme; or
- when MAD is zero, deviation greater than 30% from the median is extreme.

An extreme is excluded only if at least three comparables remain. Exclusion is
reported as both a factor and a limitation. The rule is symmetric and is not
conditioned on the requested offer/listing mode or desired result.

## Evidence Range

The unrounded anchor is the range center. Initial half-width is the greater of:

- 4% condition/renovation uncertainty floor; or
- median absolute subject-equivalent indication deviation multiplied by
  `1.4826`, divided by the anchor.

Additions are:

| Weakness | Half-width addition |
| --- | ---: |
| Exactly 3 selected comps | 2.0% |
| Exactly 4 selected comps | 1.0% |
| Expanded stage | 1.5% |
| Hard stage | 3.0% |
| Median optional-structural completeness below 75% | 1.0% |

If the AVM estimate differs from the anchor by more than 10% and its range does
not overlap the pre-AVM comparable range, half-width becomes at least half the
AVM/anchor difference. Half-width is capped at 20%. A difference greater than
35% with non-overlapping ranges is treated as contradictory evidence and raises
`ContradictoryPriceDecisionEvidenceError`.

The low boundary rounds outward down to `$1,000`; the high boundary rounds
outward up. The anchor rounds to nearest `$1,000` and always remains inside the
range.

## Offer Strategy

`flexibilitySignal` is derived only from observable listing activity:

- days on market at least `1.15x` ZIP median: 1 point;
- days on market at least `1.5x` ZIP median: 2 points;
- one or more explicit `price-change` events: 1 point;
- verified cumulative reduction at least 5%: 2 points; and
- an explicit `relisted` event: 1 point.

Scores map to `low` (0), `medium` (1–2), and `high` (3+). Missing listing
evidence maps to `unknown`. The signal is always disclosed as an inference.
The cumulative reduction percentage is used only when at least one sequential
`price-change` event is a verified decrease. A lower price in a separate
listing episode is not relabeled as a price reduction; the explicit relisting
signal is scored separately.

- low/unknown recommended adjustment: 0%;
- medium: 1% below anchor;
- high: 2.5% below anchor, which is the hard leverage cap;
- conservative: another 2% below the adjusted recommendation, bounded by the
  evidence low;
- competitive: 1% above anchor, bounded by the evidence high.

The current asking price is context and does not replace the recorded-sale
anchor or automatically determine a scenario.

## Listing Strategy

- `Quick sale`: 2% below anchor, bounded by evidence low;
- `Balanced`: anchor; and
- `Stretch`: 2.5% above anchor, bounded by evidence high.

The review checkpoint is half the ZIP median days on market, rounded to a whole
day and bounded from 7 through 21 days. It defaults to 14 days when market days
on market is unavailable. This is a review point, not a promised or automatic
price reduction.

## Confidence

Each of these is one material weakness:

- fewer than five selected comparables;
- expanded or hard-stage pool;
- median similarity below `0.75`;
- robust indication dispersion above 8%;
- median optional-structural completeness below 75%;
- material non-overlapping AVM disagreement; or
- missing/stale-over-60-days ZIP market context.

Zero weaknesses produces `high`, one produces `medium`, and two or more produce
`low`. Evidence below the hard gate is unavailable rather than low confidence.
AVM or listing absence is disclosed as a limitation; AVM absence alone does not
weaken a strong recorded-sale valuation, and listing absence changes
flexibility to `unknown` rather than corrupting market value.

## Traceability And Purity

Every factor references existing normalized evidence IDs. Factors distinguish
recorded sales, listing activity, RentCast AVM calibration, and ZIP active-
listing context. Limitations are stable codes, deterministically ordered by the
existing result normalizer, and bounded by the application contract.

Golden fixtures cover normal and hot markets, offer/listing strategies, stale
listing and verified reduction sequences, expanded/rural-like evidence, fewer
than three comps, missing square footage, condominium lot-size behavior,
anomalous sales, AVM disagreement/contradiction, absent listing context, stable
repeat execution, immutability, and result traceability.
