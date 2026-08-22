# ADR 0008: Price-Drop Alert State and Outbox

## Status

Accepted for implementation planning. Block 20.0 records the product semantics,
state boundaries, data-acquisition gate, migration direction, and staged test
plan. No runtime code, database object, RentCast request, Telegram message, or
AWS resource was changed in Block 20.0.

## Context

The property-alert worker currently treats a listing as new when its MLS
identity and listed date, or its provider identity and listed date, produce a
deduplication key that is not already stored. The `listings` table also carries
the `baseline`, `pending`, and `sent` delivery states. This supports silent
initialization, durable Telegram retry, and relisting detection, but it does not
observe changes to an already-known listing.

A lower asking price at the same property address is now a user-visible alert.
The product requirement is:

- every strictly lower observed price triggers an alert, including a decrease
  below the existing `$780,000` search floor
- Telegram identifies the event as a price drop and shows the previous and
  current prices
- the React listings workspace keeps one current row for the listing instead
  of adding a duplicate row for each price transition

Simply adding price to the existing listing deduplication key is not sufficient.
It would turn increases into new events, lose the previous price needed for the
message, create duplicate listing rows, and make retry behavior depend on an
unstable snapshot identity. Comparing only with the last alerted price is also
incorrect: after `$825,000 -> $835,000 -> $830,000`, the last transition is a
real decrease even though `$830,000` is above the last alerted value.

## Decision

### Product semantics

Treat a price drop as a notification event that uses the same durable delivery
guarantees as a new-listing event. It is not a new MLS identity and must not
change `listedDate`, source identity, or first-discovery history.

The event kinds are:

```ts
type ListingAlertKind = "new-listing" | "price-drop";
```

A price-drop event is created when all of the following are true:

1. The source listing is an active RentCast sale listing within the tracked
   non-price criteria.
2. Its canonical address matches an existing observed address.
3. Its current integer-dollar price is strictly lower than the immediately
   previous successfully persisted observation for that address.
4. The transition has not already created an alert event.

There is no minimum dollar or percentage threshold. A `$1` decrease qualifies.
An equal price creates no event. A higher price updates the latest observation
state but creates no event, so a later decrease is compared with that higher
observation.

When one source result is simultaneously a new listing identity and a lower
price at a previously observed address, emit only one `new-listing` event. Do
not send a second price-drop message for the same observation. The new listing
snapshot becomes the next price comparison baseline.

Each distinct observed decrease is an independent durable event. If Telegram
delivery is pending while a later decrease is observed, preserve both events
and deliver them in observation order. Ordinary retries must not create another
event for an already-persisted transition.

Manual listings are excluded. They have no RentCast observation lifecycle and
must not create automated price alerts.

### Address identity

Use a canonical key built from structured address fields:

```text
addressLine1 | addressLine2 | city | state | zipCode
```

Normalize each component by trimming surrounding whitespace, collapsing
internal whitespace, and applying locale-independent lowercase comparison.
Normalize a missing unit to an empty component, but retain any present unit so
two units in the same building are different properties. Do not derive the key
from `formattedAddress`, coordinates, MLS number, or price.

Block 20 does not add fuzzy postal matching. It does not guess that `Street` and
`St`, altered ZIP codes, changed unit spelling, or materially different source
addresses identify the same property. RentCast currently supplies structured
fields from one provider, and strict normalization avoids false price-drop
alerts. A future address-resolution feature needs its own evidence and review.

### Observation state and notification outbox

Separate three responsibilities that are currently combined in `listings`:

1. The listing snapshot is the current application-facing representation used
   by the API and React workspace.
2. Observation state stores the latest successfully observed price per
   canonical RentCast address, including the source identity and observation
   metadata needed for deterministic comparison.
3. Notification events form a durable outbox with immutable event payloads and
   `pending` or `sent` delivery state.

Block 20.4 will select the exact PostgreSQL names and constraints, but the
minimum logical records are:

```ts
interface ListingObservationState {
  addressKey: string;
  listingKey: string;
  sourceListingId: string;
  latestPrice: number;
  latestListedDate: string;
  latestLastSeenDate: string;
  observedAt: string;
}

type ListingAlertEvent =
  | {
      eventKey: string;
      kind: "new-listing";
      listingKey: string;
      addressKey: string;
      formattedAddress: string;
      currentPrice: number;
      previousPrice: null;
      status: "pending" | "sent";
      observedAt: string;
    }
  | {
      eventKey: string;
      kind: "price-drop";
      listingKey: string;
      addressKey: string;
      formattedAddress: string;
      previousPrice: number;
      currentPrice: number;
      status: "pending" | "sent";
      observedAt: string;
};
```

Block 20.2 resolves application identity around deterministic `eventKey`,
`listingKey`, and the branded canonical `addressKey`; it does not expose a
database-generated UUID through the application port. Block 20.4 may add an
internal PostgreSQL primary key without changing this contract. The canonical
address representation is explicitly versioned as `address:v1:` and URI-encodes
each normalized component before joining it with `|`.

Block 20.3 implements the decision in a parallel `CheckListingAlerts` use case.
Acquisition and new-listing acceptance are separate predicates: acquisition
removes only the `$780,000` floor, while an unseen below-floor address is not
tracked. Existing addresses still advance their observation below the floor and
emit a price-drop event on a strict decrease. An accepted changed listing
identity takes new-listing precedence; a below-floor changed identity can only
produce a price-drop for an already tracked address. Event identity combines
versioned listing/address identity, immutable prices, the previous observation,
and provider last-seen data, so it remains stable when a storage retry uses a
later worker clock.

The event payload is immutable. Later listing updates must not rewrite the
previous or current price shown for an earlier pending event.

Persist the observation update, current listing snapshot update, and any new
outbox event in one database transaction. The observation state may advance
before Telegram succeeds because the durable pending event retains the exact
transition. After a send succeeds, mark only the delivered event keys as sent.
If the send fails or has an ambiguous timeout, events remain pending under the
project's existing retry boundary.

The eventual schema migration must preserve any legacy pending new-listing
notification. It must not silently mark a pending message sent or generate
historical price-drop events from old rows.

### Current listing projection

A price transition updates the current RentCast listing snapshot used by the
API. It does not insert another application-facing listing row. React therefore
continues to show one row and one map marker for that listing with the latest
observed price.

A genuine relisting with a new accepted listing identity remains a new listing
under the existing rule. Block 20 does not collapse separate relisting history
without a separate product decision. The application query must nevertheless
avoid adding a duplicate row solely because an asking price changed.

### RentCast acquisition boundary

The existing provider request applies `$780,000:$850,000` before the application
filter. A listing that falls from `$790,000` to `$770,000` therefore disappears
before the worker can compare prices. The confirmed requirement includes that
decrease.

Block 20.1 must evaluate a one-request strategy that removes or lowers the
provider-side minimum while retaining the current location, active status,
single-family, bedroom, bathroom, upper-price, and `limit=500` boundaries. The
application keeps two price concepts:

- new-listing eligibility remains `$780,000` through `$850,000`
- a previously tracked address remains eligible for a price-drop alert when its
  observed price falls below `$780,000`

The audit begins with deterministic fixtures and request construction tests. A
real RentCast request may occur only after a separate explanation and explicit
confirmation because it consumes the account quota. Record returned count,
whether the `500` cap is reached, target-city coverage, response size, and
latency without committing the API key or raw provider response.

Do not ship a broadened query if it reaches the cap or loses deterministic
coverage. If the one-request strategy fails, stop and revise the acquisition
plan; do not silently spend one request per tracked address or add pagination
that exceeds the monthly request budget.

Block 20.1A checked the current official RentCast search-query and sale-listing
references. Numeric range endpoints are inclusive, and an omitted endpoint is
represented by `*`; the audit profile therefore uses `price=*:850000` rather
than an empty or guessed zero lower bound. The endpoint supports at most 500
rows per page and returns the full match count in `X-Total-Count` when
`includeTotalCount=true`.

The implemented audit is isolated from `searchSaleListings()` and the scheduled
worker. Its maintenance command refuses to call `fetch` without the exact
`--execute-one-request` argument and reports only aggregate result count, cap
margin, returned-page completeness, below-floor count, target-city counts,
price range, response-body bytes, and elapsed time. A PASS requires both a total
below 500 and a returned page length equal to the expected page length.
Production remains `price=780000:850000`. Block 20.1A used fixtures only; Block
20.1B then executed exactly one approved audit request. `X-Total-Count` and the
returned array both contained 132 listings, leaving 368 rows below the page
cap. Fifty-four returned listings were below `$780,000`; the returned price
range was `$575,875-$850,000`. The complete 148,427-byte body arrived in 6,089
ms. The acquisition gate passed without pagination, and production remained
unchanged.

### Baseline and deployment behavior

The first successfully migrated Block 20 worker run initializes observation
state for currently visible tracked listings without sending historical
price-drop notifications. Existing new-listing baseline behavior remains in
force. Subsequent runs compare against that committed observation state.

The migration and first run must be recoverable:

- an empty observation state is not interpreted as a price decrease
- a transaction failure leaves neither a partial state update nor an event
- a Telegram failure leaves immutable pending events available for retry
- redeploying or rerunning at the same provider snapshot creates no duplicate
  event

Block 20.0 does not enable either AWS schedule. Deployment, database migration,
real-provider verification, and production Telegram delivery remain separate,
explicitly approved operations.

### Telegram representation

New-listing alerts may retain their existing concise behavior, but the adapter
contract becomes event-based rather than address-array based. A price-drop
message must include:

```text
PRICE DROP

3420 New York Dr, Corona, CA 92882
$849,900 -> $829,900
Down $20,000 (2.4%)
```

Amounts use whole-dollar US formatting. The percentage is derived from the
immutable event prices and rounded consistently. Formatting and chunking must
keep one event readable and must enforce Telegram's 4,096-character limit.

### Verification boundary

Block 20 must cover at least:

- strict canonical-address normalization, including units and whitespace
- first observation and migration initialization without a price alert
- unchanged price
- a `$1` decrease
- a decrease below `$780,000`
- a price increase followed by a decrease
- repeated processing of the same provider snapshot
- a new listing and lower price in the same observation without double alert
- two decreases while the first event remains pending
- Telegram failure and successful retry
- immutable previous/current prices after later observations
- API and React showing one current listing row and marker with the latest price
- manual listings remaining excluded
- existing relisting, baseline, and new-listing behavior remaining intact

No CI test may call RentCast, Telegram, PostgreSQL outside its controlled local
test boundary, OpenAI, or AWS.

## Consequences

- The worker can recognize price movement without confusing it with listing
  identity.
- Telegram explains why a known address was sent again.
- The web workspace remains a current-listing view instead of becoming an alert
  event log.
- Durable event payloads preserve retry correctness while latest observation
  state continues to advance.
- The database model and repository port become more explicit and require a
  migration from the current combined listing/delivery representation.
- Supporting below-floor decreases depends on proving that one broadened
  RentCast request remains complete under the existing quota and result cap.
- Strict structured-address matching may miss a transition when provider
  address components change; it intentionally avoids false matches.

## References

- [RentCast Search Queries](https://developers.rentcast.io/reference/search-queries)
- [RentCast GET Sale Listings](https://developers.rentcast.io/reference/sale-listings)
- [Project Roadmap](../roadmap.md)
- [Block 20 Price-Drop Alerts Knowledge Base](../knowledge-base/block-20-price-drop-alerts.md)
- [ADR 0001: Persistence Direction](0001-persistence-direction.md)
- [Production Baseline Runbook](../runbooks/production-baseline.md)
