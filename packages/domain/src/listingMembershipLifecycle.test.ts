import { describe, expect, it } from "vitest";

import {
  InvalidListingMembershipLifecycleTransitionError,
  assertListingMembershipLifecycleTransition,
  isListingMembershipLifecycleState,
  listingMembershipLifecycleStates,
} from "./listingMembershipLifecycle.js";

describe("listing membership lifecycle", () => {
  it("publishes the complete bounded lifecycle vocabulary", () => {
    expect(listingMembershipLifecycleStates).toEqual([
      "current",
      "out_of_scope",
      "missing",
      "inactive",
      "sold",
    ]);
    expect(Object.isFrozen(listingMembershipLifecycleStates)).toBe(true);
    expect(isListingMembershipLifecycleState("current")).toBe(true);
    expect(isListingMembershipLifecycleState("withdrawn")).toBe(false);
  });

  it.each([
    [null, "current", false, false],
    ["current", "missing", false, false],
    ["missing", "inactive", true, false],
    ["inactive", "current", false, false],
    ["out_of_scope", "current", false, false],
    ["current", "sold", false, true],
  ] as const)(
    "accepts %s -> %s with valid interval and sold evidence",
    (
      previousState,
      nextState,
      hasRecurringIntervalElapsed,
      hasExplicitSoldEvidence,
    ) => {
      expect(() =>
        assertListingMembershipLifecycleTransition({
          previousState,
          nextState,
          hasRecurringIntervalElapsed,
          hasExplicitSoldEvidence,
        }),
      ).not.toThrow();
    },
  );

  it.each([
    [null, "missing", false, false],
    ["current", "inactive", true, false],
    ["missing", "inactive", false, false],
    ["out_of_scope", "missing", false, false],
    ["sold", "current", false, false],
    ["missing", "sold", false, false],
  ] as const)(
    "rejects impossible %s -> %s transition",
    (
      previousState,
      nextState,
      hasRecurringIntervalElapsed,
      hasExplicitSoldEvidence,
    ) => {
      expect(() =>
        assertListingMembershipLifecycleTransition({
          previousState,
          nextState,
          hasRecurringIntervalElapsed,
          hasExplicitSoldEvidence,
        }),
      ).toThrow(InvalidListingMembershipLifecycleTransitionError);
    },
  );

  it("rejects sold evidence on a transition that does not publish sold", () => {
    expect(() =>
      assertListingMembershipLifecycleTransition({
        previousState: "missing",
        nextState: "inactive",
        hasRecurringIntervalElapsed: true,
        hasExplicitSoldEvidence: true,
      }),
    ).toThrow(InvalidListingMembershipLifecycleTransitionError);
  });

  it.each([
    null,
    {},
    {
      previousState: "current",
      nextState: "missing",
      hasRecurringIntervalElapsed: false,
      hasExplicitSoldEvidence: false,
      extra: true,
    },
    {
      previousState: "unknown",
      nextState: "current",
      hasRecurringIntervalElapsed: false,
      hasExplicitSoldEvidence: false,
    },
  ])("rejects an inexact transition contract", (transition) => {
    expect(() =>
      assertListingMembershipLifecycleTransition(transition),
    ).toThrow(InvalidListingMembershipLifecycleTransitionError);
  });
});
