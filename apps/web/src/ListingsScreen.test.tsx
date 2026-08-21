// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ListingsScreen,
  type ListingsMapViewProps,
} from "./ListingsScreen.js";
import type { ManualListingUpdater } from "./ManualListingForm.js";
import { coronaListing, eastvaleListing } from "./listingFixtures.js";
import {
  ManualListingValidationError,
  type ListingSummary,
} from "./listingsApi.js";

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
    expect(screen.getByRole("button", { name: "Add listing" })).toBeEnabled();
  });

  it("requires a confirmed map marker before creating a manual listing", async () => {
    const user = userEvent.setup();
    const createListing = vi.fn(async () => manualListing);
    render(
      <ListingsScreen
        createListing={createListing}
        loadListings={async () => []}
        mapView={DraftMap}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "Add listing" }));
    expect(
      screen.getByRole("heading", { name: "Create manual listing" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save listing" })).toBeDisabled();

    await user.type(screen.getByLabelText("Address line 1"), "456 Client Way");
    await user.type(screen.getByLabelText("City"), "Corona");
    await user.type(screen.getByLabelText("ZIP code"), "92879");
    await user.click(screen.getByRole("button", { name: "Map" }));
    await user.click(screen.getByRole("button", { name: "Place marker" }));
    expect(screen.getByRole("button", { name: "Save listing" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Confirm draft marker" }));
    await user.click(screen.getByRole("button", { name: "Details" }));
    await user.click(screen.getByRole("button", { name: "Save listing" }));

    expect(createListing).toHaveBeenCalledWith(
      expect.objectContaining({
        addressLine1: "456 Client Way",
        city: "Corona",
        latitude: 33.8753,
        longitude: -117.5664,
        state: "CA",
        status: "Active",
        zipCode: "92879",
      }),
    );
    expect(
      await screen.findByRole("heading", { name: manualListing.addressLine1 }),
    ).toBeInTheDocument();
    expect(screen.getByText("Listing created.")).toBeInTheDocument();
  });

  it("resets marker confirmation when coordinates move", async () => {
    const user = userEvent.setup();
    render(
      <ListingsScreen
        createListing={async () => manualListing}
        loadListings={async () => [eastvaleListing]}
        mapView={DraftMap}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "Add listing" }));
    await user.click(screen.getByRole("button", { name: "Map" }));
    await user.click(screen.getByRole("button", { name: "Place marker" }));
    await user.click(screen.getByRole("button", { name: "Confirm draft marker" }));
    expect(screen.getByTestId("draft-confirmed")).toHaveTextContent("confirmed");

    await user.click(screen.getByRole("button", { name: "Move marker" }));
    expect(screen.getByTestId("draft-confirmed")).toHaveTextContent("unconfirmed");
  });

  it("maps a bounded API field error back to its form control", async () => {
    const user = userEvent.setup();
    render(
      <ListingsScreen
        createListing={async () => {
          throw new ManualListingValidationError("zipCode");
        }}
        loadListings={async () => []}
        mapView={DraftMap}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "Add listing" }));
    await user.type(screen.getByLabelText("Address line 1"), "456 Client Way");
    await user.type(screen.getByLabelText("City"), "Corona");
    await user.type(screen.getByLabelText("ZIP code"), "92879");
    await user.click(screen.getByRole("button", { name: "Map" }));
    await user.click(screen.getByRole("button", { name: "Place marker" }));
    await user.click(screen.getByRole("button", { name: "Confirm draft marker" }));
    await user.click(screen.getByRole("button", { name: "Details" }));
    await user.click(screen.getByRole("button", { name: "Save listing" }));

    expect(await screen.findByText("Check the ZIP code field.")).toBeInTheDocument();
    expect(screen.getByLabelText("ZIP code")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
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

  it("renders manual listings without inventing missing property facts", async () => {
    const manualListing: ListingSummary = {
      ...eastvaleListing,
      source: "manual",
      sourceListingId: null,
      mlsName: null,
      mlsNumber: null,
      propertyType: null,
      bedrooms: null,
      bathrooms: null,
      price: null,
      listedDate: null,
    };

    render(
      <ListingsScreen
        loadListings={async () => [manualListing]}
        mapView={PassiveMap}
      />,
    );

    expect(
      await screen.findByRole("heading", { name: manualListing.addressLine1 }),
    ).toBeInTheDocument();
    expect(screen.getByText("Property type not provided")).toBeInTheDocument();
    expect(screen.getAllByText("Not provided")).toHaveLength(3);
  });

  it("offers edit and archive actions only for the selected manual listing", async () => {
    const user = userEvent.setup();
    render(
      <ListingsScreen
        loadListings={async () => [manualListing, eastvaleListing]}
        mapView={PassiveMap}
      />,
    );

    await user.click(
      await screen.findByRole("button", {
        name: new RegExp(eastvaleListing.addressLine1),
      }),
    );
    expect(screen.queryByRole("button", { name: "Edit listing" })).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", {
        name: new RegExp(manualListing.addressLine1),
      }),
    );
    expect(screen.getByRole("button", { name: "Edit listing" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Archive listing" })).toBeEnabled();
  });

  it("edits a manual listing with prefilled fields and reconfirms moved coordinates", async () => {
    const user = userEvent.setup();
    const updatedListing = {
      ...manualListing,
      city: "Norco",
      latitude: 33.9,
      longitude: -117.6,
    };
    const updateListing = vi.fn<ManualListingUpdater>(async () => updatedListing);
    render(
      <ListingsScreen
        loadListings={async () => [manualListing]}
        mapView={DraftMap}
        updateListing={updateListing}
      />,
    );

    await user.click(
      await screen.findByRole("button", {
        name: new RegExp(manualListing.addressLine1),
      }),
    );
    await user.click(screen.getByRole("button", { name: "Edit listing" }));

    expect(
      screen.getByRole("heading", { name: "Edit manual listing" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Address line 1")).toHaveValue(
      manualListing.addressLine1,
    );
    expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled();

    await user.clear(screen.getByLabelText("City"));
    await user.type(screen.getByLabelText("City"), "Norco");
    await user.click(screen.getByRole("button", { name: "Map" }));
    await user.click(screen.getByRole("button", { name: "Move marker" }));
    await user.click(screen.getByRole("button", { name: "Details" }));
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Map" }));
    await user.click(screen.getByRole("button", { name: "Confirm draft marker" }));
    await user.click(screen.getByRole("button", { name: "Details" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(updateListing).toHaveBeenCalledWith(
      manualListing.id,
      expect.objectContaining({
        city: "Norco",
        latitude: 33.9,
        longitude: -117.6,
      }),
    );
    expect(updateListing.mock.calls[0]?.[1]).not.toHaveProperty("notes");
    expect(await screen.findByText("Listing updated.")).toBeInTheDocument();
    expect(screen.getByText(/Norco, CA/)).toBeInTheDocument();
  });

  it("requires confirmation before archiving and removes the listing on success", async () => {
    const user = userEvent.setup();
    const archiveListing = vi.fn(async () => undefined);
    render(
      <ListingsScreen
        archiveListing={archiveListing}
        loadListings={async () => [manualListing]}
        mapView={PassiveMap}
      />,
    );

    await user.click(
      await screen.findByRole("button", {
        name: new RegExp(manualListing.addressLine1),
      }),
    );
    await user.click(screen.getByRole("button", { name: "Archive listing" }));
    expect(screen.getByRole("alertdialog", { name: "Archive manual listing" })).toBeInTheDocument();
    expect(archiveListing).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Confirm archive" }));

    expect(archiveListing).toHaveBeenCalledWith(manualListing.id);
    expect(await screen.findByText("Listing archived.")).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: manualListing.addressLine1 }),
    ).not.toBeInTheDocument();
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

function DraftMap({ draftMarker }: ListingsMapViewProps): React.JSX.Element {
  if (draftMarker === undefined) {
    return <div aria-label="Listings map" />;
  }

  return (
    <div aria-label="Listings map">
      <span data-testid="draft-confirmed">
        {draftMarker.confirmed ? "confirmed" : "unconfirmed"}
      </span>
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
      <button
        type="button"
        onClick={() =>
          draftMarker.onCoordinatesChange({ latitude: 33.9, longitude: -117.6 })
        }
      >
        Move marker
      </button>
      <button type="button" onClick={draftMarker.onConfirm}>
        Confirm draft marker
      </button>
    </div>
  );
}

const manualListing: ListingSummary = {
  ...eastvaleListing,
  id: "0198c7d2-7668-7775-b0fc-b789690a60d2",
  source: "manual",
  sourceListingId: null,
  formattedAddress: "456 Client Way, Corona, CA 92879",
  addressLine1: "456 Client Way",
  city: "Corona",
  zipCode: "92879",
  latitude: 33.8753,
  longitude: -117.5664,
};
