// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SearchCriteriaScreen } from "./SearchCriteriaScreen.js";
import {
  ListingSearchCriteriaChangedError,
  type ListingSearchCriteriaSnapshot,
  type UpdateListingSearchCriteriaInput,
} from "./listingSearchCriteriaApi.js";

afterEach(cleanup);

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

  it("keeps a five-market profile unchanged while offering Stevenson Ranch", async () => {
    const user = userEvent.setup();
    renderScreen();

    expect(
      await screen.findByRole("button", { name: "5 cities selected" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Select between one and six cities."),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "5 cities selected" }));
    expect(
      screen.getByRole("checkbox", { name: "Stevenson Ranch" }),
    ).not.toBeChecked();
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
        snapshot({ criteria: input.criteria, revision: 3 }),
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
        "Saved as revision 3. The next alert run will apply these criteria.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Revision 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save criteria" })).toBeDisabled();
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

function renderScreen(
  overrides: Partial<{
    loadCriteria: (signal: AbortSignal) => Promise<ListingSearchCriteriaSnapshot>;
    saveCriteria: (
      input: UpdateListingSearchCriteriaInput,
    ) => Promise<ListingSearchCriteriaSnapshot>;
  }> = {},
): void {
  render(
    <SearchCriteriaScreen
      loadCriteria={overrides.loadCriteria ?? (async () => snapshot())}
      saveCriteria={
        overrides.saveCriteria ??
        (async (input) => snapshot({ criteria: input.criteria, revision: 3 }))
      }
    />,
  );
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
    updatedAt: "2026-08-22T20:00:00.000Z",
    ...overrides,
  };
}
