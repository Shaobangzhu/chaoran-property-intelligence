// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ListingsScreen,
  type ListingsMapViewProps,
} from "./ListingsScreen.js";
import { coronaListing, eastvaleListing } from "./listingFixtures.js";
import type { ListingSummary } from "./listingsApi.js";

afterEach(cleanup);

describe("ListingsScreen", () => {
  it("shows a stable loading state while listings are pending", () => {
    render(
      <ListingsScreen
        loadListings={() => new Promise(() => {})}
        mapView={PassiveMap}
      />,
    );

    expect(
      screen.getByRole("status", { name: "Loading listings" }),
    ).toBeInTheDocument();
  });

  it("shows the empty state when no stored listings exist", async () => {
    render(
      <ListingsScreen loadListings={async () => []} mapView={PassiveMap} />,
    );

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
    render(
      <ListingsScreen loadListings={loadListings} mapView={PassiveMap} />,
    );

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
    render(
      <ListingsScreen
        loadListings={async () => [eastvaleListing]}
        mapView={PassiveMap}
      />,
    );

    expect(
      await screen.findByRole("heading", { name: eastvaleListing.addressLine1 }),
    ).toBeInTheDocument();
    expect(screen.getByText("$825,000")).toBeInTheDocument();
    expect(screen.getByText("4 bd")).toBeInTheDocument();
    expect(screen.getByText("2.5 ba")).toBeInTheDocument();
    expect(screen.getByText(/CRMLS #IG26000001/)).toBeInTheDocument();
    expect(screen.getByText("1 stored listing")).toBeInTheDocument();
  });

  it("coordinates selection from the listing into the map", async () => {
    const user = userEvent.setup();
    render(
      <ListingsScreen
        loadListings={async () => [eastvaleListing, coronaListing]}
        mapView={FakeMap}
      />,
    );

    const row = await screen.findByRole("button", {
      name: new RegExp(eastvaleListing.addressLine1),
    });
    await user.click(row);

    expect(row).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("map-selection")).toHaveTextContent(
      eastvaleListing.id,
    );
  });

  it("coordinates map selection back to the list and mobile list mode", async () => {
    const user = userEvent.setup();
    render(
      <ListingsScreen
        loadListings={async () => [eastvaleListing, coronaListing]}
        mapView={FakeMap}
      />,
    );

    await screen.findByRole("heading", { name: eastvaleListing.addressLine1 });
    await user.click(screen.getByRole("button", { name: "Map view" }));
    expect(screen.getByRole("button", { name: "Map view" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await user.click(screen.getByRole("button", { name: "Select Corona marker" }));

    expect(
      screen.getByRole("button", { name: new RegExp(coronaListing.addressLine1) }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "List view" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});

const listing: ListingSummary = eastvaleListing;

function FakeMap({
  onSelect,
  selectedListingId,
}: ListingsMapViewProps): React.JSX.Element {
  return (
    <div>
      <span data-testid="map-selection">{selectedListingId ?? "none"}</span>
      <button type="button" onClick={() => onSelect(coronaListing.id)}>
        Select Corona marker
      </button>
    </div>
  );
}

function PassiveMap(): React.JSX.Element {
  return <div aria-label="Listings map" />;
}
