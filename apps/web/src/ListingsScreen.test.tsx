// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ListingsScreen } from "./ListingsScreen.js";
import type { ListingSummary } from "./listingsApi.js";

afterEach(cleanup);

describe("ListingsScreen", () => {
  it("shows a stable loading state while listings are pending", () => {
    render(<ListingsScreen loadListings={() => new Promise(() => {})} />);

    expect(
      screen.getByRole("status", { name: "Loading listings" }),
    ).toBeInTheDocument();
  });

  it("shows the empty state when no stored listings exist", async () => {
    render(<ListingsScreen loadListings={async () => []} />);

    expect(
      await screen.findByRole("heading", { name: "No stored listings" }),
    ).toBeInTheDocument();
  });

  it("shows a safe error and retries the request", async () => {
    const user = userEvent.setup();
    const loadListings = vi
      .fn<(signal: AbortSignal) => Promise<ListingSummary[]>>()
      .mockRejectedValueOnce(
        new Error("postgresql://user:password@private-host/database"),
      )
      .mockResolvedValueOnce([listing]);
    render(<ListingsScreen loadListings={loadListings} />);

    expect(
      await screen.findByRole("heading", { name: "Listings unavailable" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/private-host/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(
      await screen.findByRole("heading", { name: listing.addressLine1 }),
    ).toBeInTheDocument();
    expect(loadListings).toHaveBeenCalledTimes(2);
  });

  it("renders the listing content returned by the API client", async () => {
    render(<ListingsScreen loadListings={async () => [listing]} />);

    expect(
      await screen.findByRole("heading", { name: listing.addressLine1 }),
    ).toBeInTheDocument();
    expect(screen.getByText("$825,000")).toBeInTheDocument();
    expect(screen.getByText("4 bd")).toBeInTheDocument();
    expect(screen.getByText("2.5 ba")).toBeInTheDocument();
    expect(screen.getByText(/CRMLS #IG26000001/)).toBeInTheDocument();
    expect(screen.getByText("1 stored listing")).toBeInTheDocument();
  });
});

const listing: ListingSummary = {
  id: "0198c7d2-7668-7775-b0fc-b789690a60c1",
  source: "rentcast",
  sourceListingId: "rentcast-listing-id",
  mlsName: "CRMLS",
  mlsNumber: "IG26000001",
  formattedAddress: "123 Main St, Eastvale, CA 92880",
  addressLine1: "123 Main St",
  addressLine2: null,
  city: "Eastvale",
  state: "CA",
  zipCode: "92880",
  latitude: 33.9525,
  longitude: -117.5848,
  propertyType: "Single Family",
  bedrooms: 4,
  bathrooms: 2.5,
  price: 825000,
  status: "Active",
  listedDate: "2026-08-19",
  lastSeenDate: "2026-08-19",
  firstDiscoveredAt: "2026-08-19T17:00:00.000Z",
};
