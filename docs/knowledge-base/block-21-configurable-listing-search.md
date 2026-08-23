# Block 21: Configurable Listing Search Criteria

## Status

Blocks 21.0 through 21.3 are complete. Domain exposes the strict version-1
criteria value; migration 007 and the PostgreSQL adapter are bundled; and the
strict Get/Update application use cases plus deterministic fake are available.
Existing API and worker composition remain unchanged. Migration 007 has not
been executed against a local or Aurora database. No database state, RentCast
quota, Telegram delivery, deployment, schedule, or AWS resource has changed.

## Product Goal

Allow the authenticated administrator to inspect and update the criteria used
by future property-alert runs without editing source code. The saved criteria
must remain a backend-owned, extensible Domain contract rather than becoming a
React-only filter.

## Confirmed Scope

The React form contains:

- `propertyType`: one required selection from `Single Family`, `Condo`,
  `Townhouse`, `Manufactured`, `Multi-Family`, `Apartment`, or `Land`
- `minimumPrice` and `maximumPrice`: required whole-dollar currency inputs
- `minimumBedrooms`: a bounded minimum selector
- `minimumBathrooms`: a bounded minimum selector with half-bath values
- `cities`: a dropdown/disclosure containing checkboxes for `Chino`,
  `Chino Hills`, `Eastvale`, `Corona`, and `Jurupa Valley`; one to five must be
  selected

California and active-listing status remain fixed backend invariants and do not
appear as editable form controls.

### Version-1 defaults

Migration 007 seeds the exact current behavior:

```json
{
  "schemaVersion": 1,
  "state": "CA",
  "status": "Active",
  "propertyType": "Single Family",
  "minimumPrice": 780000,
  "maximumPrice": 850000,
  "minimumBedrooms": 4,
  "minimumBathrooms": 2.5,
  "cities": [
    "Chino",
    "Chino Hills",
    "Eastvale",
    "Corona",
    "Jurupa Valley"
  ]
}
```

## Behavior Boundaries

1. Saving criteria writes only PostgreSQL. It does not call RentCast or send
   Telegram.
2. The next production worker run loads the saved primary profile before it
   constructs the provider request or Domain predicates.
3. Existing stored RentCast and manual listing records remain visible. Saving
   criteria does not delete, archive, or immediately hide historical snapshots.
4. Showing List selections and stable listing UUIDs remain unchanged.
5. An unapplied criteria revision silently baselines current matching market
   inventory. It does not call those rows newly listed merely because the
   administrator widened the search.
6. Previously durable pending alert events remain deliverable and are never
   deleted by a criteria edit.
7. After baseline, every later eligible new listing and every tracked price
   decrease keeps the existing Block 20 semantics.
8. A tracked property that falls below `minimumPrice` still produces a price
   drop. The provider query therefore uses `*:<maximumPrice>` while the Domain
   new-listing predicate enforces the minimum.
9. A selected city affects Domain eligibility, not the number of provider
   requests. The worker keeps one bounded regional request.
10. If `X-Total-Count` exceeds the 500-row response cap, the run fails before
    persistence rather than processing an incomplete market snapshot.

## Domain Contract

Block 21 replaces module constants with an immutable criteria value:

```ts
type ListingPropertyType =
  | "Single Family"
  | "Condo"
  | "Townhouse"
  | "Manufactured"
  | "Multi-Family"
  | "Apartment"
  | "Land";

type ListingSearchCity =
  | "Chino"
  | "Chino Hills"
  | "Eastvale"
  | "Corona"
  | "Jurupa Valley";

interface ListingSearchCriteriaV1 {
  schemaVersion: 1;
  state: "CA";
  status: "Active";
  propertyType: ListingPropertyType;
  minimumPrice: number;
  maximumPrice: number;
  minimumBedrooms: number;
  minimumBathrooms: number;
  cities: readonly ListingSearchCity[];
}
```

Validation is owned by Domain/application code and must:

- require exact case-sensitive enum values
- reject duplicate or empty city selections
- canonicalize city ordering before equality checks or persistence
- require whole-dollar prices from `0` through PostgreSQL integer maximum
  `2,147,483,647`, with `minimumPrice <= maximumPrice`
- require whole-number bedrooms from `0` through `10`
- require bathrooms from `0` through `10` in half-step increments
- reject unknown keys and unsupported schema versions
- keep `CA` and `Active` immutable outside trusted server composition

A zero bedroom or bathroom minimum means `Any`; a candidate may therefore have
a null value for that field. A positive minimum still requires the candidate
field to exist and meet the threshold. This keeps `Land` usable without
weakening residential criteria.

Pure functions parameterize both alert predicates:

- acquisition eligibility: selected city/type, CA, Active, maximum price,
  bedrooms, and bathrooms
- new-listing eligibility: acquisition eligibility plus minimum price

## Persistence Model

Migration `007_create_listing_search_profile.sql` defines one profile table:

```text
listing_search_profiles
  profile_key        text primary key (`primary` in version 1)
  schema_version     integer
  criteria           jsonb
  revision           bigint
  applied_revision   bigint
  updated_by_user_id uuid nullable -> users.id
  created_at         timestamptz
  updated_at         timestamptz
```

Database checks bound the key, versions, revision relationship, object-shaped
JSON, and timestamps. The PostgreSQL adapter parses every row back through the
strict criteria contract; malformed persisted configuration fails closed.

The seed row uses revision 1 and applied revision 1 because its criteria are
identical to the already initialized production behavior. The repository locks
the primary row in a transaction before comparing `expectedRevision`. A
changed save updates with `WHERE revision = expectedRevision`, increments only
revision, and leaves appliedRevision unchanged. A stale save returns a typed
conflict without issuing an update.

Submitting criteria canonically equal to the saved profile is idempotent and
does not increment revision or update actor/timestamp metadata. PostgreSQL
JSONB, bigint strings, timestamps, and nullable actor UUIDs are parsed through
strict bounded contracts; malformed or missing seeded state fails closed.

## Application And API Boundaries

Application owns:

- `ListingSearchProfileQueryPort`
- `ListingSearchProfileRepositoryPort`
- `GetListingSearchCriteria`
- `UpdateListingSearchCriteria`
- invalid-input and stale-revision errors
- deterministic profile repository behavior for tests
- planned criteria-revision baseline orchestration used by the worker

Get returns only editable criteria, revision, and update timestamp. Update
strictly accepts actor identity, expected revision, and the six editable fields.
It injects `schemaVersion = 1`, `state = CA`, and `status = Active`, obtains a
canonical UTC timestamp from its injected clock, and delegates one save to the
repository. Canonical no-op returns retain existing revision and audit metadata;
changed saves attribute the actor and leave appliedRevision behind for the
future worker baseline.

Stale state and simulated lost races map to
`ListingSearchCriteriaChangedError`. Missing or malformed profiles and
inconsistent adapter results fail closed through internal result errors. The
application never returns actor identity, appliedRevision, fixed criteria,
provider details, or persistence shapes to the API boundary.

The authenticated API adds:

```text
GET /api/listing-search-criteria
PUT /api/listing-search-criteria
```

Both routes require the existing session and administrator role. `PUT` uses a
small bounded JSON parser and accepts only:

```json
{
  "expectedRevision": 1,
  "criteria": {
    "propertyType": "Single Family",
    "minimumPrice": 780000,
    "maximumPrice": 850000,
    "minimumBedrooms": 4,
    "minimumBathrooms": 2.5,
    "cities": ["Chino", "Chino Hills", "Eastvale", "Corona", "Jurupa Valley"]
  }
}
```

The API supplies the authenticated actor while Application injects fixed
state/status and returns a bounded DTO with editable criteria, revision, and
update time. It never returns database JSON shape,
`updatedByUserId`, provider credentials, Telegram values, or AWS metadata.

Expected public failures are:

- `400 INVALID_LISTING_SEARCH_CRITERIA`
- `401 AUTHENTICATION_REQUIRED`
- `403 ADMIN_AUTHORIZATION_REQUIRED`
- `409 LISTING_SEARCH_CRITERIA_CHANGED`
- bounded `500` without logging criteria values

## React Experience

Add `Search Criteria` as a third authenticated workspace tab using the existing
session boundary. The page is an unframed operational form, not a marketing
surface or a card nested inside the Listings workspace.

Controls:

- property type: standard single-select dropdown
- price range: side-by-side currency inputs with responsive stacking
- minimum bedrooms: select with `Any`/zero through the bounded maximum
- minimum bathrooms: select with `Any`/zero and half-step values
- cities: disclosure button showing the selected count; its menu contains five
  checkboxes and supports keyboard focus, Escape, and click-away closure
- commands: `Save criteria` and `Discard changes`

States:

- loading and retry
- ready/clean
- ready/dirty
- field validation without a request
- saving with duplicate-submit prevention
- saved confirmation indicating the next alert run boundary
- optimistic conflict requiring reload
- unavailable while retaining unsaved form values
- session expiry routed through the existing signed-out boundary

The form does not fetch listings, preview provider counts, mutate the current
Listings screen, or expose CA/Active as editable or hidden fields.

## RentCast And Worker Projection

The RentCast client accepts a typed provider-search projection instead of
reading constants:

```text
address=<existing regional anchor>
radius=20
state=CA
status=Active
propertyType=<selected type>
price=*:<maximumPrice>
bedrooms=<minimumBedrooms>:
bathrooms=<minimumBathrooms>:
limit=500
includeTotalCount=true
```

The worker loads the primary profile after migrations and before constructing
the source or criteria predicate. City and minimum-price filtering remain in
Domain. Provider responses still pass strict schema parsing and canonical
address deduplication.

For a new revision, the worker transaction silently upserts eligible listing
snapshots and comparison observations, then sets `appliedRevision = revision`.
No revision is marked applied until all baseline writes succeed. Existing
pending outbox delivery must still run on the baseline path.

## Security And Operations

- Only an authenticated administrator may read or update criteria.
- Existing unsafe-request Origin verification applies to `PUT`.
- Request bodies are strict, bounded, and value-redacted from logs.
- The browser receives no RentCast, Telegram, database, or AWS secret.
- Saving does not consume provider quota.
- No new AWS service or secret is required.
- The daily Scheduler remains disabled until a separately confirmed deployment
  and smoke sequence.
- The React/Express AWS deployment remains a separate unfinished boundary.

## Test Plan

### Domain

- all seven property types and five cities
- fixed CA/Active rejection
- price boundaries and minimum/maximum ordering
- bedroom and half-bath boundaries
- duplicate/empty city rejection and canonical ordering
- acquisition versus new-listing minimum-price behavior

### PostgreSQL

- migration seed exactly matches current constants
- JSON parsing and malformed-row failure
- optimistic revision update and no-op update
- revision/applied-revision constraints
- atomic silent baseline and rollback
- pending outbox preservation

### Application And API

- get/update use cases against fakes
- actor attribution and stale revision
- `401`, `403`, strict `400`, bounded `409`, and redacted `500`
- no provider call from either endpoint
- session expiry and Origin rejection

### React

- all controls and default values
- one-to-five city selection and accessibility
- local validation and dirty-state commands
- save, no-op, conflict, retry, unavailable, and session-expiry states
- desktop and mobile non-overlap visual acceptance

### Worker And Provider

- exact URL projection for every property type and numeric boundary
- one request regardless of selected city count
- total-count cap failure before state mutation
- profile load before provider construction
- criteria revision silent baseline without Telegram flood
- later new listing and below-floor tracked price drop
- previous pending event delivery during revision baseline

### Completion

- full test suite
- full runtime and CDK typecheck
- production build
- disposable PostgreSQL `001-006 -> 007` migration integration
- local authenticated browser walkthrough
- fake-data worker smoke across two criteria revisions
- documentation and production runbook update
- separately approved AWS read-only precheck; no deploy or provider request

## Implementation Sequence

1. `21.0` Freeze product semantics, fixed invariants, one-request provider
   strategy, profile schema, revision baseline, API/UI contracts, risks, and
   test plan. **Complete in documentation only.**
2. `21.1` Add versioned Domain criteria, enums, validation, defaults, and
   parameterized acquisition/new-listing predicates. Keep production composed
   with the seeded default behavior. **Complete:** the immutable criteria,
   strict parser, canonical cities, bounded numeric contract, dynamic
   predicates, and backwards-compatible default exports are implemented. All
   793 tests, full runtime/CDK typecheck, and the production build pass.
3. `21.2` Add migration 007, profile ports, PostgreSQL adapter, optimistic
   revision updates, exact current-value seed, and migration/repository tests.
   **Complete:** the bundled migration, typed ports, transactional row lock,
   strict parsing, canonical no-op, changed-save, and stale-conflict paths are
   implemented. All 812 tests, full runtime/CDK typecheck, and the production
   build pass. No local or AWS database migration was executed.
4. `21.3` Add get/update application use cases, canonical no-op behavior,
   actor attribution, revision conflict, and deterministic fakes. **Complete:**
   strict input normalization, fixed-value injection, bounded result
   projection, stable errors, adapter-result validation, defensive call
   recording, changed/no-op/conflict behavior, and failure injection are
   implemented. All 837 tests, full runtime/CDK typecheck, and the production
   build pass. No API, database, provider, Telegram, deployment, or AWS
   operation occurred.
5. `21.4` Add authenticated administrator GET/PUT API routes, strict DTOs,
   error mappings, composition, and security tests.
6. `21.5` Add the React `Search Criteria` workspace, typed client, complete
   control states, accessibility, responsiveness, and component tests.
7. `21.6` Parameterize the RentCast URL and production worker, enforce one
   regional request and the 500-row coverage gate, and load the persisted
   profile before acquisition.
8. `21.7` Implement revision-aware silent baseline, pending-event preservation,
   and cross-layer tests proving later new-listing and price-drop behavior.
9. `21.8` Run full verification, disposable migration integration, local
   authenticated acceptance, fake-data two-revision smoke, runbook updates, and
   an independently confirmed AWS read-only precheck.

Every executable sub-block requires a fresh explanation and explicit
confirmation. Provider calls, database mutations outside disposable/local test
fixtures, production Telegram, deployment, schedule changes, and AWS operations
remain separately gated.

## Source References

- [RentCast search query syntax](https://developers.rentcast.io/reference/search-queries)
- [RentCast sale listings endpoint](https://developers.rentcast.io/reference/sale-listings)
- [RentCast property types](https://developers.rentcast.io/reference/property-types)
- [ADR 0009](../adr/0009-persisted-listing-search-criteria.md)
