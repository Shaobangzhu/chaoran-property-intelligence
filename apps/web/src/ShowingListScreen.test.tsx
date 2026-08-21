// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ShowingListScreen } from "./ShowingListScreen.js";
import { eastvaleListing } from "./listingFixtures.js";
import {
  ShowingListChangedError,
  type CurrentShowingList,
  type SaveShowingListInput,
} from "./showingListApi.js";

afterEach(cleanup);

describe("ShowingListScreen", () => {
  it("loads the current draft and preserves the generated-snapshot boundary", async () => {
    renderScreen();

    expect(await screen.findByLabelText("Title")).toHaveValue(
      "Saturday Showing List",
    );
    expect(screen.getByText("Draft")).toBeInTheDocument();
    expect(
      screen.getByText(/Saved text edits do not rewrite it/),
    ).toBeInTheDocument();
    expect(screen.getByText("123 Main St")).toBeInTheDocument();
    expect(screen.getByText("456 Client Way")).toBeInTheDocument();
  });

  it("edits, reorders, saves, and then marks the latest draft reviewed", async () => {
    const user = userEvent.setup();
    const saveDraft = vi.fn(async (input: SaveShowingListInput) => ({
      ...current,
      draft: input.draft,
      updatedAt: "2026-08-20T20:05:00.000Z",
    }));
    const markReviewed = vi.fn(async () => ({
      ...current,
      status: "reviewed" as const,
      updatedAt: "2026-08-20T20:06:00.000Z",
    }));
    renderScreen({ markReviewed, saveDraft });

    const title = await screen.findByLabelText("Title");
    await user.clear(title);
    await user.type(title, "Agent-reviewed Saturday route");
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark reviewed" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Move 123 Main St down" }));
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(saveDraft).toHaveBeenCalledTimes(1));
    const savedInput = saveDraft.mock.calls[0]?.[0];
    expect(savedInput).toMatchObject({
      expectedUpdatedAt: current.updatedAt,
      generationId: current.generationId,
      draft: { title: "Agent-reviewed Saturday route" },
    });
    expect(savedInput?.draft.stops.map((stop) => [
      stop.listingId,
      stop.proposedOrder,
    ])).toEqual([
      [secondListing.id, 1],
      [eastvaleListing.id, 2],
    ]);

    await user.click(screen.getByRole("button", { name: "Mark reviewed" }));
    await waitFor(() => expect(markReviewed).toHaveBeenCalledWith({
      expectedUpdatedAt: "2026-08-20T20:05:00.000Z",
      generationId: current.generationId,
    }));
  });

  it("copies editable content and downloads the generated PDF", async () => {
    const user = userEvent.setup();
    const copyText = vi.fn(async () => undefined);
    const saveFile = vi.fn();
    const download = {
      blob: new Blob([new Uint8Array([37, 80, 68, 70])], {
        type: "application/pdf",
      }),
      fileName: "showing-list-draft.pdf" as const,
    };
    renderScreen({
      copyText,
      downloadArtifact: async () => download,
      saveFile,
    });

    await user.click(await screen.findByRole("button", { name: "Copy" }));
    expect(copyText).toHaveBeenCalledWith(
      expect.stringContaining("123 Main St, Eastvale, CA 92880"),
    );

    await user.click(screen.getByRole("button", { name: "PDF snapshot" }));
    expect(saveFile).toHaveBeenCalledWith(download);
  });

  it("holds local edits when a save detects a newer generation", async () => {
    const user = userEvent.setup();
    renderScreen({
      saveDraft: async () => {
        throw new ShowingListChangedError();
      },
    });

    const title = await screen.findByLabelText("Title");
    await user.clear(title);
    await user.type(title, "Unsaved local title");
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    expect(
      await screen.findByText("A newer draft is available. Reload before editing."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toHaveValue("Unsaved local title");
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
  });
});

function renderScreen(
  overrides: Partial<React.ComponentProps<typeof ShowingListScreen>> = {},
): void {
  render(
    <ShowingListScreen
      copyText={async () => undefined}
      downloadArtifact={async () => ({
        blob: new Blob(["pdf"], { type: "application/pdf" }),
        fileName: "showing-list-draft.pdf",
      })}
      loadCurrent={async () => current}
      loadListings={async () => [eastvaleListing, secondListing]}
      markReviewed={async () => ({ ...current, status: "reviewed" })}
      saveDraft={async (input) => ({ ...current, draft: input.draft })}
      saveFile={() => undefined}
      {...overrides}
    />,
  );
}

const secondListing = {
  ...eastvaleListing,
  addressLine1: "456 Client Way",
  formattedAddress: "456 Client Way, Corona, CA 92879",
  id: "0198c7d2-7668-7775-b0fc-b789690a60d2",
};

const current: CurrentShowingList = {
  artifact: {
    fileName: "showing-list-draft.pdf",
    kind: "generated-snapshot",
  },
  deliveryStatus: "pending",
  draft: {
    clientMessage: "Please review these homes.",
    reviewWarnings: ["Confirm availability before sharing."],
    stops: [
      {
        considerations: ["Confirm showing instructions"],
        highlights: ["Four bedrooms"],
        listingId: eastvaleListing.id,
        orderReason: "Suggested first stop.",
        proposedOrder: 1,
      },
      {
        considerations: ["Review travel time"],
        highlights: ["Updated kitchen"],
        listingId: secondListing.id,
        orderReason: "Suggested second stop.",
        proposedOrder: 2,
      },
    ],
    summary: "A draft route for agent review.",
    title: "Saturday Showing List",
  },
  generatedAt: "2026-08-20T20:00:00.000Z",
  generationId: "0198c7d2-7668-7775-b0fc-b789690a60f1",
  preferences: {
    clientDisplayName: "Alex",
    showingDate: "2026-08-23",
  },
  status: "draft",
  updatedAt: "2026-08-20T20:00:00.000Z",
};
