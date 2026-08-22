# Block 20 Price-Drop Alerts Knowledge Base

## Purpose

Block 20 extends the existing new-listing alert workflow so a strictly lower
asking price at the same canonical RentCast address also produces a durable
Telegram alert. Block 20.0 is complete in documentation only. It freezes the
requirements and implementation boundaries before any provider, database,
Telegram, application, or AWS operation.

The accepted user outcomes are:

- a price decrease is delivered through the same reliable notification path as
  a new listing
- a tracked listing that falls below `$780,000` still qualifies for a price-drop
  alert
- Telegram displays the previous and current prices
- React retains one current listing row and map point rather than one row per
  price transition

## Existing behavior

`CheckNewListings` currently:

1. fetches active RentCast sale listings
2. applies the MVP criteria
3. silently inserts matching listings on the first baseline run
4. derives one deduplication key from MLS identity plus `listedDate`, or source
   identity plus `listedDate`
5. stores unseen keys as `pending`
6. sends pending formatted addresses to Telegram
7. marks them `sent`

The same PostgreSQL `listings` row acts as a listing snapshot, identity record,
and notification outbox entry. `ON CONFLICT (deduplication_key) DO NOTHING`
makes ordinary retries idempotent, but also means a lower price on an existing
key is ignored. The React API reads those rows directly.

This shape cannot implement Block 20 by changing only the key. Price is mutable
state, not listing identity. Including it in the key would alert on increases
and add duplicate application-facing rows.

## Frozen product contract

### What "treated as a new listing" means

A price drop shares the new-listing workflow's durable detection, pending
delivery, retry, and sent-state guarantees. It does not become a new MLS
listing, does not receive a new `listedDate`, and does not reset
`firstDiscoveredAt`.

The UI remains a current-property workspace. Notification history remains an
internal operational concern unless a later block explicitly adds an alert
history screen.

### Price comparison

Compare the current integer-dollar price with the immediately previous
successfully persisted observation for the canonical address:

| Previous | Current | Result |
| ---: | ---: | --- |
| `$825,000` | `$825,000` | update last-seen metadata; no alert |
| `$825,000` | `$825,001` | update observation; no alert |
| `$825,000` | `$824,999` | create one price-drop event |
| `$825,000` | `$770,000` | create one price-drop event for a tracked address |

There is no minimum amount or percentage threshold. A strict decrease of `$1`
qualifies.

The previous observation, not the previous notification, is authoritative. For
`$825,000 -> $835,000 -> $830,000`, the third observation creates a `$5,000`
price-drop event.

### Identity precedence

Evaluate listing identity and price movement together:

1. A truly unseen accepted listing identity produces `new-listing`.
2. The same observation seeds or advances the canonical address price state.
3. Do not also produce `price-drop` for that observation.
4. A later strict decrease at that address produces `price-drop`.

This precedence prevents duplicate Telegram messages when a provider changes
listing identity at an address already known to the worker.

### Address key

Build the strict key from normalized structured fields:

- `addressLine1`
- `addressLine2`, including unit when present
- `city`
- `state`
- `zipCode`

Normalization trims, collapses whitespace, and lowercases. It does not perform
abbreviation expansion, geocoding, coordinate proximity, or fuzzy matching.
Strict matching is appropriate for one normalized provider and avoids joining
different units or nearby properties.

### Multiple and failed events

Every distinct observed decrease is preserved. If `$825,000 -> $815,000` is
pending because Telegram failed and the next observation is `$805,000`, the
outbox contains both transitions in order. A successful retry sends each event
once under the existing best-effort Telegram boundary.

Repeated processing of `$805,000` creates no additional event. Event payloads
remain immutable even if the current listing later changes again.

## Target architecture

### Listing snapshot

The application-facing RentCast listing remains one current row for a listing
identity. A same-listing price observation updates that row's current price and
last-seen data. It does not insert a second row. Existing manual-listing archive
and edit behavior remains independent.

### Observation state

Persist one latest observation per canonical RentCast address. At minimum it
must retain:

- canonical address key
- current listing reference and source identity
- latest price
- latest `listedDate` and provider `lastSeenDate`
- worker observation time

Updates must be transactionally serialized so concurrent or repeated workers
cannot compare against stale state and create duplicate transitions.

### Notification outbox

Move alert delivery identity away from mutable listing rows. The durable event
model distinguishes `new-listing` and `price-drop` and snapshots the address and
prices required to render the message.

The repository operation for one provider snapshot must atomically:

1. lock or otherwise serialize the address observation state
2. determine new-listing versus price-drop precedence
3. update the current listing snapshot
4. update the latest observation
5. insert at most one event for that observation

Telegram delivery occurs after commit. On success, only delivered event IDs
become `sent`. On failure, pending payloads remain unchanged for retry.

Block 20.4 will define the concrete migration and legacy compatibility. It must
carry forward any existing `pending` new-listing delivery and must not infer
historical price drops from stale listing prices.

## RentCast coverage

### Current gap

The provider request currently filters `price=780000:850000` and limits the
response to `500`. Application criteria repeat the same price range. Because
provider filtering happens first, a price below `$780,000` is invisible even
when its address was previously tracked.

### Required split

Block 20 separates acquisition from new-listing eligibility:

- provider acquisition should retain the existing radius, state, active
  status, property type, bedroom, bathroom, `$850,000` upper limit, and one-call
  budget while removing or lowering the minimum price
- a previously untracked listing is a new-listing candidate only inside
  `$780,000-$850,000`
- an already tracked address may create a price-drop event below `$780,000`

### Block 20.1 gate

First validate URL construction and behavior with fixtures. A real request is
not implied by starting Block 20.1. Before consuming one request, present the
exact request shape, target account-independent measurements, and quota impact
for explicit confirmation.

The audit passes only if one request provides complete enough coverage without
reaching the `500` result cap. Record:

- result count and cap margin
- target-city result counts
- response byte size
- request latency
- minimum and maximum returned prices
- whether every previously tracked address expected in the response is present

Do not store or commit the raw response, street-level audit output, or API key.
If the result reaches the cap or coverage is ambiguous, stop Block 20.1 and
revise the acquisition design. Do not silently add per-address requests,
pagination, or additional daily provider calls.

### Block 20.1A as-built result

Block 20.1A checked the official RentCast
[Search Queries](https://developers.rentcast.io/reference/search-queries) and
[GET Sale Listings](https://developers.rentcast.io/reference/sale-listings)
references on 2026-08-21. The documented one-sided range syntax uses `*` for an
omitted endpoint, so the candidate profile is `price=*:850000`. The endpoint
supports `limit=500`, `includeTotalCount=true`, and the `X-Total-Count` response
header. This allows one request to prove whether the broadened result fits in
one complete page.

The RentCast adapter now has two isolated internal request profiles:

- ordinary `searchSaleListings()` remains `price=780000:850000`, keeps the same
  location and property filters, and does not request a total-count header
- `searchSaleListingsForCoverageAudit()` uses `price=*:850000`, retains every
  other production filter and `limit=500`, and requests the total count

The separate maintenance command is:

```bash
pnpm rentcast:coverage-audit:execute-one-request
```

The executable refuses to call `fetch` when the exact confirmation argument is
missing. Its output contains only the total and returned counts, cap margin,
below-`$780,000` count, minimum/maximum returned price, target-city and
non-target-city counts, response-body byte count, elapsed milliseconds, and a
PASS/FAIL gate. It does not print the key, request URL, raw body, property ID,
or street address. It loads no database or Telegram configuration and performs
no write. PASS requires `X-Total-Count < 500` and a returned array length equal
to `min(X-Total-Count, 500)`; an unexpectedly incomplete page fails even when
the total is below the cap.

Block 20.1A added 22 focused adapter, aggregation, validation, cap, redaction,
and CLI-guard tests. All use injected fixture responses. The complete 641-test
suite, full repository typecheck, and alert-worker production build pass. A
local invocation without the confirmation argument exited before `fetch` with
the expected `No RentCast request was made` message. The command has not been
run with its confirmation argument, so no real RentCast request has been made.
At the end of 20.1A, Block 20.1B still required a separate review and explicit
authorization. The completed 20.1B measurement is recorded below; production
behavior remains unchanged.

### Block 20.1B coverage result

Block 20.1B executed one and only one real RentCast request on 2026-08-21 after
the user reviewed the exact endpoint, query parameters, quota impact, logging
boundary, and no-retry rule. An initial pnpm argument-separator invocation was
rejected by the CLI before `fetch` and explicitly reported that no request was
made. The corrected guarded CLI then consumed the single authorized request.

Aggregate result:

| Measurement | Result |
| --- | ---: |
| Coverage gate | `PASS` |
| `X-Total-Count` | `132` |
| Returned listings | `132` |
| Returned page complete | `yes` |
| Result limit | `500` |
| Cap margin | `368` |
| Listings below `$780,000` | `54` |
| Returned price range | `$575,875-$850,000` |
| Response body | `148,427` bytes |
| Elapsed time | `6,089` ms |
| Chino | `24` |
| Chino Hills | `0` |
| Corona | `11` |
| Eastvale | `4` |
| Jurupa Valley | `0` |
| Non-target cities | `93` |

The total stayed well below 500 and the returned page matched the total, so the
one-request broadened acquisition profile can cover prices below `$780,000`
without pagination under the measured market snapshot. Zero results for Chino
Hills and Jurupa Valley mean only that no listing matched all current provider
filters in those cities at this snapshot; they do not remove either city from
the application criteria.

No credential, request URL, raw response, property ID, or address was logged or
stored. The command did not connect to PostgreSQL, send Telegram, call AWS, or
change `searchSaleListings()`. Block 20.1 is complete. A future real audit is a
new quota-consuming operation and requires fresh approval.

## Baseline and migration

The first production-capable Block 20 run establishes the latest price for each
currently observed address without sending a historical price-drop alert. This
avoids interpreting an old stored listing snapshot as the previous daily
observation.

Existing new-listing behavior continues:

- an uninitialized installation creates its listing and price baselines
  silently
- an initialized installation must retain any pending new-listing delivery
- migration does not resend rows already marked sent
- the first price-state initialization does not suppress a genuinely unseen
  new listing detected in that same run

The exact initialization marker and migration transaction are Block 20.4
implementation decisions. Tests must prove recovery after interruption.

## Telegram contract

Replace the address-array boundary with an event-oriented notification port.
The application supplies typed, validated facts; the Telegram adapter owns
plain-text formatting and 4,096-character chunking.

Required price-drop representation:

```text
PRICE DROP

3420 New York Dr, Corona, CA 92882
$849,900 -> $829,900
Down $20,000 (2.4%)
```

Formatting rules:

- use the immutable event prices, not the latest mutable listing row
- show whole-dollar US currency
- show an absolute decrease and percentage
- keep one complete event together whenever it fits in one Telegram message
- reject malformed, non-finite, non-integer, zero, or increasing transitions at
  the application boundary

Block 20 does not add inline buttons, listing photos, MLS deep links, or rich
HTML formatting.

## React and API behavior

After a price drop:

- the listing card displays the latest price
- the map still contains one point for the listing
- list count does not increase because of the price transition
- selection and Showing List behavior continue to reference the same listing ID
- no price-history component is added in Block 20

A genuine relisting may still be represented by the existing accepted listing
identity rules. Block 20 only prohibits duplicates caused solely by price
changes.

## Failure and concurrency rules

- A RentCast request or schema failure makes no state change.
- A database failure commits neither observation changes nor alert events.
- A Telegram failure leaves events pending.
- An ambiguous Telegram timeout retains the existing possible duplicate-send
  limitation but never creates a second database event.
- Reprocessing the same snapshot is idempotent.
- Concurrent workers must not create duplicate events for one transition.
- A malformed address or price fails safely instead of creating a guessed key
  or message.

## Security, privacy, and cost

- No new secret is required.
- `RENTCAST_API_KEY`, Telegram credentials, and database credentials remain in
  their existing boundaries.
- Canonical address keys and alert events contain property data, not client
  identity, but remain private application data.
- Logs must not print the RentCast key, Telegram token, full provider response,
  or database URL.
- Block 20.1 is constrained to the existing one-request-per-worker-run model
  unless a later plan explicitly revises the monthly budget.
- Block 20.0 performs no external request and creates no AWS cost.

## Sub-block plan

### Block 20.0: Requirements and architecture documentation

Record the accepted semantics, address identity, observation/outbox split,
RentCast coverage gate, migration baseline, Telegram representation, React
projection, AWS runtime boundary, risks, and tests. Update the roadmap, README,
AWS system design, knowledge base, and ADR. **Complete in documentation only.**

### Block 20.1: RentCast coverage audit

Add fixture-based request tests and a controlled measurement command. After a
separate confirmation, consume at most one real RentCast request to verify that
removing the minimum price retains acceptable coverage below the `500` cap.
Do not change production search behavior in this sub-block. **Complete: 20.1A
implemented the isolated command and offline tests; 20.1B used one approved
request and passed with 132 complete results and 368 rows of cap margin.**

### Block 20.2: Domain and application contracts

Add canonical-address normalization, typed listing alert events, observation
records, event-oriented notification ports, and deterministic fakes. Keep
provider and database adapters unchanged while contract tests establish invalid
state rejection.

### Block 20.3: Detection workflow

Implement new-listing precedence, latest-observation comparison, below-floor
tracked transitions, increase updates, silent first price baseline, event
idempotency, and retry ordering against in-memory ports.

### Block 20.4: PostgreSQL migration and adapter

Add the observation state and durable notification outbox, transactionally
update current snapshots, migrate legacy pending delivery safely, and cover
constraints, concurrency, rollback, parsing, and migration idempotency.

### Block 20.5: Telegram and worker composition

Implement new-listing and price-drop formatting, safe chunking, runtime wiring,
and worker-level integration tests. Preserve production smoke-test and weekly
Showing List Telegram behavior.

### Block 20.6: API and React consistency

Prove that the API returns the latest price with stable listing identity and
that React renders one card and one map point. Add regression coverage for
selection, Showing List references, manual listings, and genuine relistings.

### Block 20.7: Verification and deployment readiness

Run full tests, type checking, builds, migration integration, local smoke tests,
and an AWS read-only precheck. Update production runbooks with migration,
rollback, first-run baseline, and controlled Telegram verification. Do not
deploy, enable a schedule, consume a real provider request, or send production
Telegram without separate confirmation.

Every executable sub-block requires a fresh explanation and explicit user
confirmation.

## Acceptance criteria

Block 20 is complete only when:

1. Every strict observed decrease at a tracked canonical address creates one
   typed price-drop event.
2. A tracked listing may trigger below `$780,000` without making an out-of-range
   unseen property a new listing.
3. Telegram displays the address, previous price, current price, absolute drop,
   and percentage.
4. Increases and unchanged prices create no alert but advance valid observation
   state as required.
5. New-listing precedence prevents two events for one provider observation.
6. First price-state initialization sends no historical price-drop message.
7. Pending events survive failure and retry without payload mutation.
8. React shows one current listing row and map marker with the latest price.
9. Existing new-listing, relisting, manual-listing, authentication, Showing
   List, production smoke-test, and weekly draft behavior remains green.
10. Provider requests, database writes, Telegram sends, and AWS changes occur
    only at their separately confirmed boundaries.

## Deferred work

- fuzzy or third-party address resolution
- price-history charts or an alert-history UI
- push channels other than Telegram
- percentage or dollar alert thresholds
- alerts for off-market, pending, sold, rental, or manually entered listings
- property valuation, affordability, or investment recommendations derived from
  a price change
- higher-frequency polling or a larger RentCast request budget

## References

- [ADR 0008: Price-Drop Alert State and Outbox](../adr/0008-price-drop-alert-state-and-outbox.md)
- [Project Roadmap](../roadmap.md)
- [Production Baseline Runbook](../runbooks/production-baseline.md)
- [Local Listings Vertical Slice](../runbooks/local-listings-vertical-slice.md)
