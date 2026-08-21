import { describe, expect, it } from "vitest";

import type { ScheduledShowingListConfiguration } from "./showingListProductionConfig.js";
import { createWeeklyShowingListGenerationId } from "./weeklyShowingListIdentity.js";

const generation: ScheduledShowingListConfiguration = {
  actorUserId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  request: {
    listingIds: ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"],
    preferences: {
      clientDisplayName: null,
      showingDate: null,
      agentInstructions: null,
    },
  },
};

describe("createWeeklyShowingListGenerationId", () => {
  it("returns the same UUID for retries in one local schedule week", () => {
    const first = createId("2026-08-24T15:00:00.000Z");
    const retry = createId("2026-08-24T15:45:00.000Z");
    const laterInWeek = createId("2026-08-28T15:00:00.000Z");

    expect(first).toBe(retry);
    expect(first).toBe(laterInWeek);
    expect(first).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("changes identity for the next local schedule week", () => {
    expect(createId("2026-08-24T15:00:00.000Z")).not.toBe(
      createId("2026-08-31T15:00:00.000Z"),
    );
  });

  it("changes identity when the server-side selection changes", () => {
    const first = createId("2026-08-24T15:00:00.000Z");
    const changed = createWeeklyShowingListGenerationId({
      now: new Date("2026-08-24T15:00:00.000Z"),
      timeZone: "America/Los_Angeles",
      generation: {
        ...generation,
        request: {
          ...generation.request,
          preferences: {
            ...generation.request.preferences,
            showingDate: "2026-08-30",
          },
        },
      },
    });

    expect(changed).not.toBe(first);
  });
});

function createId(timestamp: string): string {
  return createWeeklyShowingListGenerationId({
    now: new Date(timestamp),
    timeZone: "America/Los_Angeles",
    generation,
  });
}
