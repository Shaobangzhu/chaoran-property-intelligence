export const listingMembershipLifecycleStates = Object.freeze([
  "current",
  "out_of_scope",
  "missing",
  "inactive",
  "sold",
] as const);

export type ListingMembershipLifecycleState =
  (typeof listingMembershipLifecycleStates)[number];

export interface ListingMembershipLifecycleTransition {
  readonly previousState: ListingMembershipLifecycleState | null;
  readonly nextState: ListingMembershipLifecycleState;
  readonly hasRecurringIntervalElapsed: boolean;
  readonly hasExplicitSoldEvidence: boolean;
}

export class InvalidListingMembershipLifecycleTransitionError extends Error {
  constructor() {
    super("Listing membership lifecycle transition was invalid");
    this.name = "InvalidListingMembershipLifecycleTransitionError";
  }
}

const lifecycleStateSet: ReadonlySet<string> = new Set(
  listingMembershipLifecycleStates,
);

const allowedNextStates: Readonly<
  Record<
    ListingMembershipLifecycleState,
    ReadonlySet<ListingMembershipLifecycleState>
  >
> = Object.freeze({
  current: new Set<ListingMembershipLifecycleState>([
    "current",
    "out_of_scope",
    "missing",
    "sold",
  ]),
  out_of_scope: new Set<ListingMembershipLifecycleState>([
    "out_of_scope",
    "current",
    "sold",
  ]),
  missing: new Set<ListingMembershipLifecycleState>([
    "missing",
    "current",
    "out_of_scope",
    "inactive",
    "sold",
  ]),
  inactive: new Set<ListingMembershipLifecycleState>([
    "inactive",
    "current",
    "out_of_scope",
    "sold",
  ]),
  sold: new Set<ListingMembershipLifecycleState>(["sold"]),
});

export function isListingMembershipLifecycleState(
  value: unknown,
): value is ListingMembershipLifecycleState {
  return typeof value === "string" && lifecycleStateSet.has(value);
}

export function assertListingMembershipLifecycleTransition(
  transition: unknown,
): void {
  if (!isLifecycleTransition(transition)) {
    throw new InvalidListingMembershipLifecycleTransitionError();
  }
  const {
    previousState,
    nextState,
    hasRecurringIntervalElapsed,
    hasExplicitSoldEvidence,
  } = transition;
  const validInitialState = previousState === null && nextState === "current";
  const validExistingState =
    previousState !== null && allowedNextStates[previousState].has(nextState);
  const soldEvidenceMatches =
    (nextState === "sold") === hasExplicitSoldEvidence;
  const recurringIntervalMatches =
    hasRecurringIntervalElapsed ===
    (nextState === "inactive" &&
      (previousState === "missing" || previousState === "inactive"));

  if (
    (!validInitialState && !validExistingState) ||
    !soldEvidenceMatches ||
    !recurringIntervalMatches
  ) {
    throw new InvalidListingMembershipLifecycleTransitionError();
  }
}

function isLifecycleTransition(
  value: unknown,
): value is ListingMembershipLifecycleTransition {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  return (
    keys.length === 4 &&
    keys.every((key) =>
      [
        "previousState",
        "nextState",
        "hasRecurringIntervalElapsed",
        "hasExplicitSoldEvidence",
      ].includes(key),
    ) &&
    (record.previousState === null ||
      isListingMembershipLifecycleState(record.previousState)) &&
    isListingMembershipLifecycleState(record.nextState) &&
    typeof record.hasRecurringIntervalElapsed === "boolean" &&
    typeof record.hasExplicitSoldEvidence === "boolean"
  );
}
