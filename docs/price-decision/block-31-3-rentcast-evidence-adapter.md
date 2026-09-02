# Block 31.3 RentCast Evidence Adapter

## Status

The fixture-backed implementation is complete on
`feat/block-31-3-rentcast-price-decision-evidence`. No RentCast credential was
read and no real provider request was made. The separately authorized provider
contract audit remains pending and must be accepted before environment rollout.

## Implemented Endpoint Composition

Each offer or listing estimation uses the same sequential, fail-fast sequence.
There are at most four provider requests and no automatic retries.

| Order | Endpoint | Product meaning | Required behavior |
| --- | --- | --- | --- |
| 1 | `GET /v1/avm/value` | Subject resolution and separately labeled RentCast value estimate/range | A 404 becomes subject-not-found. AVM comparables are listing records and are never mapped as recorded sales. |
| 2 | `GET /v1/properties` | Nearby property records with actual `lastSalePrice` and `lastSaleDate` | Uses a 5-mile radius, 365-day sale range, subject property type, and limit 25. Records without usable sale facts or coordinates are skipped. |
| 3 | `GET /v1/listings/sale/{id}` | Subject sale-listing status and documented listing episodes | A 404 becomes optional `null`. History entries create listed/relisted/removed events only. The adapter does not infer price reductions from separate listing episodes. |
| 4 | `GET /v1/markets` | ZIP-level active sale-listing context | Uses `dataType=Sale` and current top-level `saleData`. A 404 or absent `saleData` becomes optional `null`. |

Successful-request count is therefore four for offer mode and four for listing
mode. Early failures stop later calls. The provider client uses a 30-second
per-request timeout by default and a retry count of zero. Block 31.6 must add a
shorter workflow deadline, authorization, throttling, in-flight suppression,
and an environment feature switch without increasing this budget.

## Semantic Boundaries

- `/properties` `lastSalePrice` and `lastSaleDate` are the only RentCast values
  mapped into the MVP's `recorded-sale` collection.
- `/avm/value` is mapped only to the external RentCast estimate and range. Its
  comparables are documented sale listings, not confirmed closed sales.
- `/markets` sale statistics describe active sale listings. `medianPrice` is
  mapped and labeled as median list price, never median closed-sale price.
- Documented sale-listing history represents listing episodes. Until a real
  provider audit proves an explicit price-change event, the adapter does not
  generate `price-change` evidence or a price-reduction count.
- The deterministic pricing engine remains application-owned in Block 31.4.
  The RentCast package acquires and normalizes evidence but makes no price
  recommendation.

## Privacy, Security, And Observability

The client sends the API key only through `X-Api-Key`. It never places the key
in a URL. The input address is necessarily sent to RentCast but is not included
in errors or request-accounting events.

Each response is projected through a field allowlist. Owner names, owner
mailing addresses, agent/contact fields, remarks/descriptions, AVM listing
comparables, provider-only market segments, and the raw payload do not cross
the adapter boundary. Tests include synthetic forbidden fields and prove that
they are removed.

Request telemetry contains only:

- endpoint category
- bounded outcome category
- duration in milliseconds
- HTTP status when available

An injected telemetry callback cannot change request behavior. Error messages
contain neither full addresses nor raw response values.

## Error Contract

- AVM 404 -> `PriceDecisionSubjectNotFoundError`
- provider timeout, network failure, non-404 HTTP failure, malformed JSON, or
  malformed schema -> `PriceDecisionEvidenceUnavailableError`
- subject state/ZIP contradiction or an invalid normalized evidence graph ->
  `PriceDecisionEvidenceUnavailableError`
- optional listing or market 404 -> `null`

The provider executes sequentially so that a required-source failure cannot
spend the remaining request budget. Insufficient but structurally valid
recorded-sale evidence is left for Block 31.4 to reject deterministically.

## Separately Authorized Real Provider Audit

The code and tests use synthetic fixtures derived from the official data
dictionaries. They do not establish current account access, county coverage,
actual nullability, billing behavior, or production suitability.

The smallest proposed live audit is exactly four attempted requests for one
owner-approved, non-sensitive California test address—one request to each
endpoint above, sequentially, with zero retries. Before execution, the owner
must explicitly approve that exact budget and confirm the current RentCast
plan, remaining quota, overage setting, API-key environment, and permissible
test address. Audit output must be redacted and must not persist the full
address, owner/contact data, credential, or raw responses.

The audit acceptance record must answer:

1. whether the returned property records contain usable actual sale dates and
   prices for the approved California location;
2. which subject, sale, listing-history, and market fields are absent or null;
3. whether listing history exposes any explicit price-change semantics beyond
   listing episodes;
4. whether all four calls materially contribute evidence or one can be removed;
5. the actual successful/billable request count and rate-limit responses; and
6. whether the fixture parsers require a reviewed, fail-closed adjustment.

Any broader county-coverage sample requires a new explicit request budget. It
must not be silently folded into this four-request audit.

## Verification Scope

Automated coverage proves URL construction, header-only credentials, strict
allowlist projection, four-call accounting, no retries, timeout classification,
optional 404 behavior, fail-fast sequencing, bounded errors, stable evidence
IDs, distance calculation, immutable normalized evidence, and the separation of
recorded sales from AVM/listing values.

The repository owner retains the Block 31 workflow gate for full `pnpm test`
and any local manual verification.
