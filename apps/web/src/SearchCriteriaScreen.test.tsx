// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SearchCriteriaScreen } from "./SearchCriteriaScreen.js";
import {
  ListingSearchCriteriaChangedError,
  type SavedListingSearchCriteriaSnapshot,
  type ListingSearchCriteriaSnapshot,
  type UpdateListingSearchCriteriaInput,
} from "./listingSearchCriteriaApi.js";
import type { ListingRefreshSnapshot } from "./listingRefreshApi.js";
import type {
  RetryListingRefreshInput,
  RetryListingRefreshResult,
} from "./listingRefreshApi.js";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("SearchCriteriaScreen", () => {
  it("loads all bounded controls without exposing fixed criteria", async () => {
    renderScreen();

    expect(
      await screen.findByRole("heading", { name: "Search Criteria" }),
    ).toBeInTheDocument();
    const propertyType = screen.getByLabelText("Property type");
    expect(within(propertyType).getAllByRole("option")).toHaveLength(7);
    expect(propertyType).toHaveValue("Single Family");
    expect(screen.getByLabelText("Minimum price")).toHaveValue("780000");
    expect(screen.getByLabelText("Maximum price")).toHaveValue("850000");
    expect(screen.getByLabelText("Minimum bedrooms")).toHaveValue("4");
    expect(screen.getByLabelText("Minimum bathrooms")).toHaveValue("2.5");
    expect(
      screen.getByRole("button", { name: "5 cities selected" }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("State")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Status")).not.toBeInTheDocument();
  });

  it("keeps a five-market profile unchanged while offering opt-in markets", async () => {
    const user = userEvent.setup();
    renderScreen();

    expect(
      await screen.findByRole("button", { name: "5 cities selected" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Select between one and seven cities."),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "5 cities selected" }));
    expect(
      screen.getByRole("checkbox", { name: "Stevenson Ranch" }),
    ).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Irvine" })).not.toBeChecked();
  });

  it("loads an explicitly saved six-market profile without creating a dirty draft", async () => {
    const user = userEvent.setup();
    renderScreen({
      loadCriteria: async () =>
        snapshot({
          criteria: {
            ...snapshot().criteria,
            cities: [
              "Chino",
              "Chino Hills",
              "Eastvale",
              "Corona",
              "Jurupa Valley",
              "Stevenson Ranch",
            ],
          },
          revision: 3,
        }),
    });

    const trigger = await screen.findByRole("button", {
      name: "6 cities selected",
    });
    expect(screen.getByText("Revision 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save criteria" })).toBeDisabled();

    await user.click(trigger);
    expect(
      screen.getByRole("checkbox", { name: "Stevenson Ranch" }),
    ).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Irvine" })).not.toBeChecked();
  });

  it("opts a pre-Irvine profile into Irvine and adopts the next revision", async () => {
    const user = userEvent.setup();
    const preIrvineCriteria = {
      ...snapshot().criteria,
      cities: [
        "Chino",
        "Chino Hills",
        "Eastvale",
        "Corona",
        "Jurupa Valley",
        "Stevenson Ranch",
      ] as const,
    };
    const saveCriteria = vi.fn(
      async (input: UpdateListingSearchCriteriaInput) =>
        savedSnapshot({ criteria: input.criteria, revision: 4 }),
    );
    renderScreen({
      loadCriteria: async () =>
        snapshot({ criteria: preIrvineCriteria, revision: 3 }),
      saveCriteria,
    });

    const trigger = await screen.findByRole("button", {
      name: "6 cities selected",
    });
    expect(screen.getByRole("button", { name: "Save criteria" })).toBeDisabled();

    await user.click(trigger);
    await user.click(screen.getByRole("checkbox", { name: "Irvine" }));
    expect(
      screen.getByRole("button", { name: "7 cities selected" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save criteria" }));

    expect(saveCriteria).toHaveBeenCalledWith({
      expectedRevision: 3,
      criteria: {
        ...preIrvineCriteria,
        cities: [...preIrvineCriteria.cities, "Irvine"],
      },
    });
    expect(
      await screen.findByText(
        "Saved as revision 4. Refresh queued.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save criteria" })).toBeDisabled();
  });

  it("opts into Stevenson Ranch explicitly and adopts the next revision", async () => {
    const user = userEvent.setup();
    const saveCriteria = vi.fn(
      async (input: UpdateListingSearchCriteriaInput) =>
        savedSnapshot({ criteria: input.criteria, revision: 3 }),
    );
    renderScreen({ saveCriteria });

    const trigger = await screen.findByRole("button", {
      name: "5 cities selected",
    });
    await user.click(trigger);
    await user.click(
      screen.getByRole("checkbox", { name: "Stevenson Ranch" }),
    );
    expect(
      screen.getByRole("button", { name: "6 cities selected" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save criteria" }));

    expect(saveCriteria).toHaveBeenCalledTimes(1);
    expect(saveCriteria).toHaveBeenCalledWith({
      expectedRevision: 2,
      criteria: {
        ...snapshot().criteria,
        cities: [
          "Chino",
          "Chino Hills",
          "Eastvale",
          "Corona",
          "Jurupa Valley",
          "Stevenson Ranch",
        ],
      },
    });
    expect(
      await screen.findByText(
        "Saved as revision 3. Refresh queued.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Revision 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save criteria" })).toBeDisabled();
  });

  it("retries an unavailable initial load", async () => {
    const user = userEvent.setup();
    const loadCriteria = vi
      .fn()
      .mockRejectedValueOnce(new Error("private detail"))
      .mockResolvedValueOnce(snapshot());
    renderScreen({ loadCriteria });

    expect(
      await screen.findByRole("heading", {
        name: "Search Criteria unavailable",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText("private detail")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(
      await screen.findByRole("heading", { name: "Search Criteria" }),
    ).toBeInTheDocument();
    expect(loadCriteria).toHaveBeenCalledTimes(2);
  });

  it("validates prices locally without calling save", async () => {
    const user = userEvent.setup();
    const saveCriteria = vi.fn();
    renderScreen({ saveCriteria });
    await screen.findByRole("heading", { name: "Search Criteria" });

    await user.clear(screen.getByLabelText("Minimum price"));
    await user.click(screen.getByRole("button", { name: "Save criteria" }));

    expect(
      screen.getByText(
        "Enter a whole-dollar amount from $0 to $2,147,483,647.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Minimum price")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(saveCriteria).not.toHaveBeenCalled();
  });

  it("tracks dirty state and discards edits", async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByRole("heading", { name: "Search Criteria" });

    const discard = screen.getByRole("button", { name: "Discard changes" });
    expect(discard).toBeDisabled();
    await user.selectOptions(screen.getByLabelText("Property type"), "Condo");
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    expect(discard).toBeEnabled();

    await user.click(discard);
    expect(screen.getByLabelText("Property type")).toHaveValue("Single Family");
    expect(screen.getByText("Saved")).toBeInTheDocument();
    expect(discard).toBeDisabled();
  });

  it("saves canonical criteria once and adopts the returned revision", async () => {
    const user = userEvent.setup();
    const saveCriteria = vi.fn(
      async (input: UpdateListingSearchCriteriaInput) =>
        savedSnapshot({ criteria: input.criteria, revision: 3 }),
    );
    renderScreen({ saveCriteria });
    await screen.findByRole("heading", { name: "Search Criteria" });

    await user.selectOptions(screen.getByLabelText("Property type"), "Condo");
    await user.clear(screen.getByLabelText("Minimum price"));
    await user.type(screen.getByLabelText("Minimum price"), "700000");
    await user.selectOptions(screen.getByLabelText("Minimum bedrooms"), "3");
    await user.selectOptions(screen.getByLabelText("Minimum bathrooms"), "2");
    await user.click(screen.getByRole("button", { name: "5 cities selected" }));
    await user.click(screen.getByRole("checkbox", { name: "Chino Hills" }));
    await user.click(screen.getByRole("button", { name: "Save criteria" }));

    expect(saveCriteria).toHaveBeenCalledTimes(1);
    expect(saveCriteria).toHaveBeenCalledWith({
      expectedRevision: 2,
      criteria: {
        propertyType: "Condo",
        minimumPrice: 700000,
        maximumPrice: 850000,
        minimumBedrooms: 3,
        minimumBathrooms: 2,
        cities: ["Chino", "Eastvale", "Corona", "Jurupa Valley"],
      },
    });
    expect(
      await screen.findByText(
        "Saved as revision 3. Refresh queued.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Revision 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save criteria" })).toBeDisabled();
  });

  it("reports an immediate dispatch failure without spinning forever", async () => {
    const user = userEvent.setup();
    const retryRefresh = vi.fn(async (): Promise<RetryListingRefreshResult> => ({
      refresh: refreshRun("queued"),
      refreshDispatch: "dispatched",
    }));
    renderScreen({
      retryRefresh,
      saveCriteria: async (input) => ({
        ...savedSnapshot({ criteria: input.criteria, revision: 3 }),
        refreshDispatch: "failed",
      }),
    });
    await screen.findByRole("heading", { name: "Search Criteria" });

    await user.selectOptions(screen.getByLabelText("Property type"), "Condo");
    await user.click(screen.getByRole("button", { name: "Save criteria" }));

    expect(
      await screen.findByText(
        "Saved as revision 3. Refresh dispatch failed; the queued run remains available.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Dispatch unavailable / not started"),
    ).toBeInTheDocument();
    expect(document.querySelector(".refresh-status-card .spin")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Retry refresh (5 requests)" }),
    ).toBeEnabled();
  });

  it("shows a failed refresh without changing the applied revision and retries explicitly", async () => {
    const user = userEvent.setup();
    const retryRefresh = vi.fn(async (): Promise<RetryListingRefreshResult> => ({
      refresh: refreshRun("queued", {
        runId: "retry-3",
        triggerReason: "manual-retry",
      }),
      refreshDispatch: "dispatched",
    }));
    renderScreen({
      loadCriteria: async () =>
        snapshot({
          revision: 3,
          appliedRevision: 2,
          refresh: refreshRun("failed", {
            actualProviderRequestCount: 2,
            failureCode: "provider-unavailable",
          }),
        }),
      retryRefresh,
    });

    expect(
      await screen.findByText("Revision 3 refresh failed; showing revision 2"),
    ).toBeInTheDocument();
    expect(screen.getByText(/Previous applied listings remain unchanged/)).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Retry refresh (5 requests)" }),
    );

    expect(retryRefresh).toHaveBeenCalledWith({
      expectedRevision: 3,
      confirmedPlannedProviderRequestCount: 5,
    });
    expect(await screen.findByText("Refresh retry queued.")).toBeInTheDocument();
    expect(screen.getByText("Saved revision 3; refresh queued")).toBeInTheDocument();
  });

  it("stops polling an unclaimed queued run and exposes an explicit retry", async () => {
    const user = userEvent.setup();
    const loadRefresh = vi.fn(async () => refreshRun("queued"));
    const retryRefresh = vi.fn(async (): Promise<RetryListingRefreshResult> => ({
      refresh: refreshRun("queued"),
      refreshDispatch: "dispatched",
    }));
    renderScreen({
      loadCriteria: async () =>
        snapshot({
          revision: 3,
          appliedRevision: 2,
          refresh: refreshRun("queued"),
        }),
      loadRefresh,
      now: () => Date.parse("2026-08-24T15:05:00.000Z"),
      retryRefresh,
    });

    expect(
      await screen.findByText("Dispatch unavailable / not started"),
    ).toBeInTheDocument();
    expect(document.querySelector(".refresh-status-card .spin")).toBeNull();
    expect(loadRefresh).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole("button", { name: "Retry refresh (5 requests)" }),
    );

    expect(retryRefresh).toHaveBeenCalledWith({
      expectedRevision: 3,
      confirmedPlannedProviderRequestCount: 5,
    });
    expect(await screen.findByText("Refresh retry queued.")).toBeInTheDocument();
    expect(screen.getByText("Saved revision 3; refresh queued")).toBeInTheDocument();
  });

  it("reaches the queued start deadline even when no status poll can run", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-24T14:59:00.000Z"));
    renderScreen({
      loadCriteria: async () =>
        snapshot({
          revision: 3,
          appliedRevision: 2,
          refresh: refreshRun("queued"),
        }),
      now: Date.now,
      retryRefresh: async () => ({
        refresh: refreshRun("queued"),
        refreshDispatch: "dispatched",
      }),
    });

    await act(async () => Promise.resolve());
    expect(screen.getByText("Saved revision 3; refresh queued")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(queuedStartTimeoutForTest);
    });

    expect(
      screen.getByText("Dispatch unavailable / not started"),
    ).toBeInTheDocument();
    expect(document.querySelector(".refresh-status-card .spin")).toBeNull();
  });

  it("reports running and last-successful refresh state", async () => {
    const { rerender } = render(
      <SearchCriteriaScreen
        loadCriteria={async () =>
          snapshot({
            revision: 3,
            appliedRevision: 2,
            refresh: refreshRun("running"),
          })
        }
        now={() => Date.parse("2026-08-24T15:01:00.000Z")}
        saveCriteria={async (input) =>
          savedSnapshot({ criteria: input.criteria, revision: 4 })
        }
      />,
    );

    expect(
      await screen.findByText("Refreshing revision 3"),
    ).toBeInTheDocument();
    expect(screen.getByText(/Showing revision 2 until/)).toBeInTheDocument();

    rerender(
      <SearchCriteriaScreen
        loadCriteria={async () =>
          snapshot({
            revision: 3,
            appliedRevision: 3,
            refresh: refreshRun("succeeded", {
              actualProviderRequestCount: 5,
              completedAt: "2026-08-24T15:00:00.000Z",
              publishedCurrentCount: 3,
              returnedListingCount: 3,
            }),
          })
        }
        now={() => Date.parse("2026-08-24T15:06:00.000Z")}
        saveCriteria={async (input) =>
          savedSnapshot({ criteria: input.criteria, revision: 4 })
        }
      />,
    );

    expect(await screen.findByText("Showing revision 3")).toBeInTheDocument();
    expect(screen.getByText(/Last successful refresh/)).toBeInTheDocument();
  });

  it("continues polling a queued refresh after a transient status failure", async () => {
    const loadCriteria = async () =>
      snapshot({
        revision: 3,
        appliedRevision: 2,
        refresh: refreshRun("queued"),
      });
    const loadRefresh = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce(
        refreshRun("succeeded", {
          actualProviderRequestCount: 5,
          completedAt: "2026-08-24T15:05:00.000Z",
          publishedCurrentCount: 3,
          returnedListingCount: 3,
        }),
      );
    const view = render(
      <SearchCriteriaScreen
        loadCriteria={loadCriteria}
        now={() => Date.parse("2026-08-24T15:01:00.000Z")}
        saveCriteria={async (input) =>
          savedSnapshot({ criteria: input.criteria, revision: 4 })
        }
      />,
    );
    expect(
      await screen.findByText("Saved revision 3; refresh queued"),
    ).toBeInTheDocument();

    vi.useFakeTimers();
    view.rerender(
      <SearchCriteriaScreen
        loadCriteria={loadCriteria}
        loadRefresh={loadRefresh}
        now={() => Date.parse("2026-08-24T15:01:00.000Z")}
        saveCriteria={async (input) =>
          savedSnapshot({ criteria: input.criteria, revision: 4 })
        }
      />,
    );
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(loadRefresh).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Saved revision 3; refresh queued")).toBeInTheDocument();

    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(loadRefresh).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Showing revision 3")).toBeInTheDocument();
  });

  it("prevents duplicate submission while saving", async () => {
    const user = userEvent.setup();
    const saveCriteria = vi.fn(
      () => new Promise<ListingSearchCriteriaSnapshot>(() => {}),
    );
    renderScreen({ saveCriteria });
    await screen.findByRole("heading", { name: "Search Criteria" });

    await user.selectOptions(screen.getByLabelText("Property type"), "Land");
    await user.click(screen.getByRole("button", { name: "Save criteria" }));

    const saving = screen.getByRole("button", { name: "Saving criteria" });
    expect(saving).toBeDisabled();
    await user.click(saving);
    expect(saveCriteria).toHaveBeenCalledTimes(1);
  });

  it("preserves edits when save is unavailable", async () => {
    const user = userEvent.setup();
    renderScreen({
      saveCriteria: async () => {
        throw new Error("private upstream detail");
      },
    });
    await screen.findByRole("heading", { name: "Search Criteria" });

    await user.selectOptions(screen.getByLabelText("Property type"), "Townhouse");
    await user.click(screen.getByRole("button", { name: "Save criteria" }));

    expect(
      await screen.findByText(
        "Saving is unavailable. Your unsaved changes are still here.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Property type")).toHaveValue("Townhouse");
    expect(screen.queryByText("private upstream detail")).not.toBeInTheDocument();
  });

  it("requires reload after conflict and replaces the stale draft", async () => {
    const user = userEvent.setup();
    const latest = snapshot({
      criteria: { ...snapshot().criteria, propertyType: "Manufactured" },
      revision: 4,
    });
    const loadCriteria = vi
      .fn()
      .mockResolvedValueOnce(snapshot())
      .mockResolvedValueOnce(latest);
    renderScreen({
      loadCriteria,
      saveCriteria: async () => {
        throw new ListingSearchCriteriaChangedError();
      },
    });
    await screen.findByRole("heading", { name: "Search Criteria" });

    await user.selectOptions(screen.getByLabelText("Property type"), "Condo");
    await user.click(screen.getByRole("button", { name: "Save criteria" }));

    expect(
      await screen.findByText(/Criteria changed in another session/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Property type")).toHaveValue("Condo");
    expect(screen.getByRole("button", { name: "Save criteria" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Discard changes" }),
    ).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Reload latest" }));
    expect(screen.getByLabelText("Property type")).toHaveValue("Manufactured");
    expect(screen.getByText("Revision 4")).toBeInTheDocument();
    expect(loadCriteria).toHaveBeenCalledTimes(2);
  });

  it("retains the stale draft when conflict reload is unavailable", async () => {
    const user = userEvent.setup();
    const loadCriteria = vi
      .fn()
      .mockResolvedValueOnce(snapshot())
      .mockRejectedValueOnce(new Error("private detail"));
    renderScreen({
      loadCriteria,
      saveCriteria: async () => {
        throw new ListingSearchCriteriaChangedError();
      },
    });
    await screen.findByRole("heading", { name: "Search Criteria" });

    await user.selectOptions(screen.getByLabelText("Property type"), "Apartment");
    await user.click(screen.getByRole("button", { name: "Save criteria" }));
    await user.click(await screen.findByRole("button", { name: "Reload latest" }));

    expect(
      await screen.findByText(
        "The latest revision is unavailable. Your unsaved changes are still here.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Property type")).toHaveValue("Apartment");
    expect(screen.queryByText("private detail")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload latest" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Save criteria" })).toBeDisabled();
  });

  it("supports city selection, Escape focus return, and click-away closure", async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByRole("heading", { name: "Search Criteria" });
    const trigger = screen.getByRole("button", { name: "5 cities selected" });

    await user.click(trigger);
    expect(screen.getByRole("group", { name: "Choose cities" })).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Chino" }));
    expect(
      screen.getByRole("button", { name: "4 cities selected" }),
    ).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("group", { name: "Choose cities" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    await user.click(trigger);
    await user.click(screen.getByRole("heading", { name: "Price range" }));
    expect(screen.queryByRole("group", { name: "Choose cities" })).not.toBeInTheDocument();
  });
});

const queuedStartTimeoutForTest = 5 * 60 * 1_000;

function renderScreen(
  overrides: Partial<{
    loadCriteria: (signal: AbortSignal) => Promise<ListingSearchCriteriaSnapshot>;
    saveCriteria: (
      input: UpdateListingSearchCriteriaInput,
    ) => Promise<
      ListingSearchCriteriaSnapshot | SavedListingSearchCriteriaSnapshot
    >;
    loadRefresh: (
      signal: AbortSignal,
    ) => Promise<ListingRefreshSnapshot | null>;
    retryRefresh: (
      input: RetryListingRefreshInput,
    ) => Promise<RetryListingRefreshResult>;
    now: () => number;
  }> = {},
): void {
  render(
    <SearchCriteriaScreen
      loadCriteria={overrides.loadCriteria ?? (async () => snapshot())}
      {...(overrides.loadRefresh === undefined
        ? {}
        : { loadRefresh: overrides.loadRefresh })}
      {...(overrides.retryRefresh === undefined
        ? {}
        : { retryRefresh: overrides.retryRefresh })}
      now={
        overrides.now ??
        (() => Date.parse("2026-08-22T20:01:00.000Z"))
      }
      saveCriteria={
        overrides.saveCriteria ??
        (async (input) =>
          savedSnapshot({ criteria: input.criteria, revision: 3 }))
      }
    />,
  );
}

function savedSnapshot(
  overrides: Partial<ListingSearchCriteriaSnapshot> = {},
): SavedListingSearchCriteriaSnapshot {
  const revision = overrides.revision ?? 3;
  return {
    ...snapshot(overrides),
    refresh: overrides.refresh ?? queuedRefresh(revision),
    refreshDispatch: "dispatched",
  };
}

function queuedRefresh(revision: number): ListingRefreshSnapshot {
  const cities = snapshot().criteria.cities;
  return {
    runId: `run-${revision}`,
    requestedRevision: revision,
    effectiveRevision: null,
    triggerReason: "criteria-change",
    status: "queued",
    requestedAt: "2026-08-22T20:00:00.000Z",
    startedAt: null,
    completedAt: null,
    selectedMarkets: cities,
    selectedMarketCount: cities.length,
    plannedProviderRequestCount: cities.length,
    actualProviderRequestCount: 0,
    returnedListingCount: 0,
    publishedCurrentCount: 0,
    failureCode: null,
    supersededByRunId: null,
  };
}

function refreshRun(
  status: ListingRefreshSnapshot["status"],
  overrides: Partial<ListingRefreshSnapshot> = {},
): ListingRefreshSnapshot {
  const cities = snapshot().criteria.cities;
  const hasStarted = status !== "queued";
  const hasCompleted =
    status === "succeeded" || status === "failed" || status === "superseded";
  return {
    runId: "run-3",
    requestedRevision: 3,
    effectiveRevision: status === "queued" ? null : 3,
    triggerReason: "criteria-change",
    status,
    requestedAt: "2026-08-24T14:59:00.000Z",
    startedAt: hasStarted ? "2026-08-24T15:00:00.000Z" : null,
    completedAt: hasCompleted ? "2026-08-24T15:05:00.000Z" : null,
    selectedMarkets: cities,
    selectedMarketCount: cities.length,
    plannedProviderRequestCount: cities.length,
    actualProviderRequestCount: hasStarted ? cities.length : 0,
    returnedListingCount: 0,
    publishedCurrentCount: 0,
    failureCode: status === "failed" ? "refresh-failed" : null,
    supersededByRunId: status === "superseded" ? "run-4" : null,
    ...overrides,
  };
}

function snapshot(
  overrides: Partial<ListingSearchCriteriaSnapshot> = {},
): ListingSearchCriteriaSnapshot {
  return {
    criteria: {
      propertyType: "Single Family",
      minimumPrice: 780000,
      maximumPrice: 850000,
      minimumBedrooms: 4,
      minimumBathrooms: 2.5,
      cities: ["Chino", "Chino Hills", "Eastvale", "Corona", "Jurupa Valley"],
    },
    revision: 2,
    appliedRevision: 2,
    updatedAt: "2026-08-22T20:00:00.000Z",
    refresh: null,
    ...overrides,
  };
}
