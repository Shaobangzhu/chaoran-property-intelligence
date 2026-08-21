// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App.js";
import type { ListingsMapViewProps } from "./ListingsScreen.js";
import type { ListingSummary } from "./listingsApi.js";
import { createSessionClient } from "./sessionApi.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("manual listing browser workflow integration", () => {
  it("uses the HTTP clients to create, edit, and archive one listing", async () => {
    const user = userEvent.setup();
    const http = new StatefulBrowserApi();
    vi.stubGlobal("fetch", http.fetch);

    render(
      <App
        mapView={WorkflowMap}
        sessionClient={createSessionClient(http.fetch)}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "Add listing" }));
    await user.type(screen.getByLabelText("Address line 1"), "456 Client Way");
    await user.type(screen.getByLabelText("City"), "Corona");
    await user.type(screen.getByLabelText("ZIP code"), "92879");
    await user.type(screen.getByLabelText("Notes"), "Private client context");
    await user.click(screen.getByRole("button", { name: "Map" }));
    await user.click(screen.getByRole("button", { name: "Place marker" }));
    await user.click(screen.getByRole("button", { name: "Confirm marker" }));
    await user.click(screen.getByRole("button", { name: "Details" }));
    await user.click(screen.getByRole("button", { name: "Save listing" }));

    expect(await screen.findByText("Listing created.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit listing" })).toBeEnabled();
    expect(http.createdDraft).toMatchObject({
      addressLine1: "456 Client Way",
      city: "Corona",
      latitude: 33.8753,
      longitude: -117.5664,
      notes: "Private client context",
    });

    await user.click(screen.getByRole("button", { name: "Edit listing" }));
    await user.clear(screen.getByLabelText("City"));
    await user.type(screen.getByLabelText("City"), "Norco");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("Listing updated.")).toBeInTheDocument();
    expect(screen.getAllByText(/Norco, CA/)).toHaveLength(2);
    expect(http.updatedPatch).toEqual({ city: "Norco" });

    await user.click(screen.getByRole("button", { name: "Archive listing" }));
    await user.click(screen.getByRole("button", { name: "Confirm archive" }));

    expect(await screen.findByText("Listing archived.")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "No stored listings" }),
    ).toBeInTheDocument();
    expect(http.archivedListingId).toBe(manualListing.id);
    expect(http.requests.map(({ method, url }) => `${method} ${url}`)).toEqual([
      "GET /api/auth/me",
      "GET /api/listings",
      "POST /api/listings/manual",
      `PATCH /api/listings/${manualListing.id}`,
      `POST /api/listings/${manualListing.id}/archive`,
    ]);
  });
});

class StatefulBrowserApi {
  archivedListingId: string | null = null;
  createdDraft: Record<string, unknown> | null = null;
  updatedPatch: Record<string, unknown> | null = null;
  readonly requests: Array<{ method: string; url: string }> = [];
  private listing: ListingSummary | null = null;

  readonly fetch = async (
    input: RequestInfo | URL,
    init: RequestInit = {},
  ): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init.method ?? "GET";
    this.requests.push({ method, url });

    if (url === "/api/auth/me" && method === "GET") {
      return jsonResponse({
        user: {
          email: "admin@example.com",
          id: "0198c7d2-7668-7775-b0fc-b789690a60c1",
          role: "admin",
        },
      });
    }
    if (url === "/api/listings" && method === "GET") {
      return jsonResponse({ listings: this.listing === null ? [] : [this.listing] });
    }
    if (url === "/api/listings/manual" && method === "POST") {
      this.createdDraft = readJsonBody(init);
      this.listing = manualListing;
      return jsonResponse({ listing: this.listing }, 201);
    }
    if (url === `/api/listings/${manualListing.id}` && method === "PATCH") {
      this.updatedPatch = readJsonBody(init);
      this.listing = {
        ...(this.listing ?? manualListing),
        city: "Norco",
        formattedAddress: "456 Client Way, Norco, CA 92879",
      };
      return jsonResponse({ listing: this.listing });
    }
    if (
      url === `/api/listings/${manualListing.id}/archive` &&
      method === "POST"
    ) {
      this.archivedListingId = manualListing.id;
      this.listing = null;
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected browser API request: ${method} ${url}`);
  };
}

function WorkflowMap({ draftMarker }: ListingsMapViewProps): React.JSX.Element {
  return (
    <div aria-label="Listings map">
      {draftMarker === undefined ? null : (
        <>
          <button
            type="button"
            onClick={() =>
              draftMarker.onCoordinatesChange({
                latitude: 33.8753,
                longitude: -117.5664,
              })
            }
          >
            Place marker
          </button>
          <button type="button" onClick={draftMarker.onConfirm}>
            Confirm marker
          </button>
        </>
      )}
    </div>
  );
}

const manualListing: ListingSummary = {
  id: "0198c7d2-7668-7775-b0fc-b789690a60d2",
  source: "manual",
  sourceListingId: null,
  mlsName: null,
  mlsNumber: null,
  formattedAddress: "456 Client Way, Corona, CA 92879",
  addressLine1: "456 Client Way",
  addressLine2: null,
  city: "Corona",
  state: "CA",
  zipCode: "92879",
  latitude: 33.8753,
  longitude: -117.5664,
  propertyType: null,
  bedrooms: null,
  bathrooms: null,
  price: null,
  status: "Active",
  listedDate: null,
  lastSeenDate: "2026-08-20",
  firstDiscoveredAt: "2026-08-20T19:30:00.000Z",
};

function readJsonBody(init: RequestInit): Record<string, unknown> {
  if (typeof init.body !== "string") throw new Error("Expected a JSON body");
  const value: unknown = JSON.parse(init.body);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected a JSON object body");
  }
  return value as Record<string, unknown>;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}
