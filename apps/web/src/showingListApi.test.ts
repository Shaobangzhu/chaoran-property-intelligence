import { describe, expect, it, vi } from "vitest";

import { SessionAuthenticationRequiredError } from "./listingsApi.js";
import {
  ShowingListChangedError,
  ShowingListNotFoundError,
  downloadCurrentShowingList,
  fetchCurrentShowingList,
  markCurrentShowingListReviewed,
  saveCurrentShowingList,
} from "./showingListApi.js";

describe("Showing List API client", () => {
  it("loads and strictly parses the current review DTO", async () => {
    const fetchImplementation = vi.fn(async () =>
      jsonResponse({ current: currentDto }),
    );

    await expect(
      fetchCurrentShowingList({ fetchImplementation }),
    ).resolves.toEqual(currentDto);
    expect(fetchImplementation).toHaveBeenCalledWith(
      "/api/showing-list/current",
      expect.objectContaining({
        credentials: "same-origin",
        method: "GET",
      }),
    );
  });

  it("accepts an empty current workspace", async () => {
    await expect(
      fetchCurrentShowingList({
        fetchImplementation: async () => jsonResponse({ current: null }),
      }),
    ).resolves.toBeNull();
  });

  it("rejects unknown response fields", async () => {
    await expect(
      fetchCurrentShowingList({
        fetchImplementation: async () =>
          jsonResponse({ current: { ...currentDto, model: "private" } }),
      }),
    ).rejects.toThrow("Showing List API returned an invalid response");
  });

  it("rejects malformed stop ordering", async () => {
    await expect(
      fetchCurrentShowingList({
        fetchImplementation: async () =>
          jsonResponse({
            current: {
              ...currentDto,
              draft: {
                ...currentDto.draft,
                stops: [
                  { ...currentDto.draft.stops[0], proposedOrder: 2 },
                ],
              },
            },
          }),
      }),
    ).rejects.toThrow("Showing List API returned an invalid response");
  });

  it("sends optimistic save and review commands", async () => {
    const fetchImplementation = vi.fn(async () =>
      jsonResponse({ current: currentDto }),
    );
    const identity = {
      expectedUpdatedAt: currentDto.updatedAt,
      generationId: currentDto.generationId,
    };

    await saveCurrentShowingList(
      { ...identity, draft: currentDto.draft },
      { fetchImplementation },
    );
    await markCurrentShowingListReviewed(identity, { fetchImplementation });

    expect(fetchImplementation).toHaveBeenNthCalledWith(
      1,
      "/api/showing-list/current",
      expect.objectContaining({
        body: JSON.stringify({ ...identity, draft: currentDto.draft }),
        method: "PATCH",
      }),
    );
    expect(fetchImplementation).toHaveBeenNthCalledWith(
      2,
      "/api/showing-list/current/review",
      expect.objectContaining({ body: JSON.stringify(identity), method: "POST" }),
    );
  });

  it("maps authentication, missing, and concurrency responses", async () => {
    await expect(
      fetchCurrentShowingList({
        fetchImplementation: async () => jsonResponse({}, 401),
      }),
    ).rejects.toBeInstanceOf(SessionAuthenticationRequiredError);
    await expect(
      downloadCurrentShowingList({
        fetchImplementation: async () => jsonResponse({}, 404),
      }),
    ).rejects.toBeInstanceOf(ShowingListNotFoundError);
    await expect(
      saveCurrentShowingList(
        {
          draft: currentDto.draft,
          expectedUpdatedAt: currentDto.updatedAt,
          generationId: currentDto.generationId,
        },
        { fetchImplementation: async () => jsonResponse({}, 409) },
      ),
    ).rejects.toBeInstanceOf(ShowingListChangedError);
  });

  it("downloads only a PDF artifact", async () => {
    await expect(
      downloadCurrentShowingList({
        fetchImplementation: async () =>
          new Response(new Uint8Array([37, 80, 68, 70]), {
            headers: { "Content-Type": "application/pdf" },
          }),
      }),
    ).resolves.toMatchObject({ fileName: "showing-list-draft.pdf" });

    await expect(
      downloadCurrentShowingList({
        fetchImplementation: async () =>
          new Response("not a PDF", {
            headers: { "Content-Type": "text/plain" },
          }),
      }),
    ).rejects.toThrow("Showing List API returned an invalid response");
  });
});

const listingId = "0198c7d2-7668-7775-b0fc-b789690a60c1";
const currentDto = {
  artifact: {
    fileName: "showing-list-draft.pdf" as const,
    kind: "generated-snapshot" as const,
  },
  deliveryStatus: "pending" as const,
  draft: {
    clientMessage: "Please review these homes.",
    reviewWarnings: ["Confirm availability."],
    stops: [{
      considerations: ["Confirm showing instructions"],
      highlights: ["Four bedrooms"],
      listingId,
      orderReason: "Suggested first stop.",
      proposedOrder: 1,
    }],
    summary: "A draft route.",
    title: "Saturday Showing List",
  },
  generatedAt: "2026-08-20T20:00:00.000Z",
  generationId: "0198c7d2-7668-7775-b0fc-b789690a60f1",
  preferences: {
    clientDisplayName: "Alex",
    showingDate: "2026-08-23",
  },
  status: "draft" as const,
  updatedAt: "2026-08-20T20:00:00.000Z",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}
