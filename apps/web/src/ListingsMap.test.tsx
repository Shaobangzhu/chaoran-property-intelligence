// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getWorkerUrl } from "maplibre-gl";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ListingsMap,
  type CreateListingsMap,
  type ListingsMapDriver,
} from "./ListingsMap.js";
import { coronaListing, eastvaleListing } from "./listingFixtures.js";
import type { WildfireHazardMetadata } from "./wildfireHazardMetadata.js";

afterEach(cleanup);

describe("ListingsMap", () => {
  it("configures MapLibre to use the Vite-bundled worker", () => {
    expect(getWorkerUrl()).toContain("maplibre-gl-worker");
  });

  it("creates, updates, focuses, resizes, and destroys one map driver", () => {
    const harness = createDriverHarness();
    const onSelect = vi.fn();
    const view = render(
      <ListingsMap
        createMap={harness.createMap}
        listings={[eastvaleListing]}
        onSelect={onSelect}
        selectedListingId={null}
      />,
    );

    expect(harness.createMap).toHaveBeenCalledOnce();
    expect(harness.driver.updateListings).toHaveBeenLastCalledWith(
      [eastvaleListing],
      null,
    );
    expect(harness.driver.updateDraftMarker).toHaveBeenLastCalledWith(null);
    expect(harness.driver.setWildfireHazardVisible).not.toHaveBeenCalled();

    act(() => harness.options?.onReady());
    expect(screen.queryByText("Loading map")).not.toBeInTheDocument();
    expect(harness.driver.fitToListings).toHaveBeenCalledWith([
      eastvaleListing,
    ]);
    window.dispatchEvent(new Event("resize"));
    expect(harness.driver.resize).toHaveBeenCalledOnce();

    view.rerender(
      <ListingsMap
        createMap={harness.createMap}
        listings={[eastvaleListing, coronaListing]}
        onSelect={onSelect}
        selectedListingId={coronaListing.id}
      />,
    );

    expect(harness.createMap).toHaveBeenCalledOnce();
    expect(harness.driver.updateListings).toHaveBeenLastCalledWith(
      [eastvaleListing, coronaListing],
      coronaListing.id,
    );
    expect(harness.driver.focusListing).toHaveBeenCalledWith(coronaListing);

    act(() => harness.options?.onSelect(eastvaleListing.id));
    expect(onSelect).toHaveBeenCalledWith(eastvaleListing.id);

    view.unmount();
    expect(harness.driver.destroy).toHaveBeenCalledOnce();
  });

  it("coordinates draft placement and explicit marker confirmation", async () => {
    const user = userEvent.setup();
    const harness = createDriverHarness();
    const onCoordinatesChange = vi.fn();
    const onConfirm = vi.fn();
    render(
      <ListingsMap
        createMap={harness.createMap}
        draftMarker={{
          confirmed: false,
          coordinates: { latitude: 33.8753, longitude: -117.5664 },
          onConfirm,
          onCoordinatesChange,
        }}
        listings={[]}
        onSelect={() => undefined}
        selectedListingId={null}
      />,
    );

    expect(harness.driver.updateDraftMarker).toHaveBeenLastCalledWith({
      confirmed: false,
      coordinates: { latitude: 33.8753, longitude: -117.5664 },
    });

    act(() => harness.options?.onReady());
    act(() =>
      harness.options?.onDraftCoordinatesChange({
        latitude: 33.9,
        longitude: -117.6,
      }),
    );
    expect(onCoordinatesChange).toHaveBeenCalledWith({
      latitude: 33.9,
      longitude: -117.6,
    });

    expect(screen.getByText("33.875300, -117.566400")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Confirm marker" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("wires the wildfire switch, status, visibility, and retry to the driver", async () => {
    const user = userEvent.setup();
    const harness = createDriverHarness();
    render(
      <ListingsMap
        createMap={harness.createMap}
        listings={[eastvaleListing]}
        onSelect={() => undefined}
        selectedListingId={null}
      />,
    );

    expect(
      screen.queryByRole("switch", { name: "Wildfire hazard zones" }),
    ).not.toBeInTheDocument();
    act(() => harness.options?.onReady());

    const toggle = screen.getByRole("switch", {
      name: "Wildfire hazard zones",
    });
    expect(toggle).not.toBeChecked();
    expect(harness.driver.setWildfireHazardVisible).not.toHaveBeenCalled();

    await user.click(toggle);
    expect(toggle).toBeChecked();
    expect(harness.driver.setWildfireHazardVisible).toHaveBeenCalledWith(true);

    act(() =>
      harness.options?.onWildfireHazardStateChange({
        status: "loading",
        visible: false,
      }),
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading hazard zones",
    );

    const metadata = createWildfireHazardMetadata();
    act(() =>
      harness.options?.onWildfireHazardStateChange({
        status: "ready",
        visible: true,
        metadata,
      }),
    );
    expect(
      screen.getByLabelText("Fire Hazard Severity Zone legend"),
    ).toBeInTheDocument();

    await user.click(toggle);
    expect(harness.driver.setWildfireHazardVisible).toHaveBeenLastCalledWith(
      false,
    );
    act(() =>
      harness.options?.onWildfireHazardStateChange({
        status: "ready",
        visible: false,
        metadata,
      }),
    );
    expect(
      screen.queryByLabelText("Fire Hazard Severity Zone legend"),
    ).not.toBeInTheDocument();

    act(() =>
      harness.options?.onWildfireHazardStateChange({
        status: "error",
        visible: false,
      }),
    );
    expect(toggle).not.toBeChecked();
    await user.click(screen.getByRole("button", { name: "Retry hazard layer" }));
    expect(harness.driver.setWildfireHazardVisible).toHaveBeenLastCalledWith(
      true,
    );
  });

  it("shows a bounded map error and can retry initialization", async () => {
    const user = userEvent.setup();
    const firstHarness = createDriverHarness();
    const secondHarness = createDriverHarness();
    const createMap = vi
      .fn<CreateListingsMap>()
      .mockImplementationOnce(firstHarness.createMap)
      .mockImplementationOnce(secondHarness.createMap);

    render(
      <ListingsMap
        createMap={createMap}
        listings={[eastvaleListing]}
        onSelect={() => undefined}
        selectedListingId={null}
      />,
    );

    act(() => firstHarness.options?.onError(new Error("private tile detail")));
    expect(screen.getByRole("alert")).toHaveTextContent("Map unavailable");
    expect(screen.queryByText(/private tile detail/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Retry map" }));

    expect(createMap).toHaveBeenCalledTimes(2);
    expect(firstHarness.driver.destroy).toHaveBeenCalledOnce();
  });
});

function createDriverHarness(): {
  createMap: CreateListingsMap;
  driver: ListingsMapDriver;
  options: Parameters<CreateListingsMap>[0] | undefined;
} {
  const driver: ListingsMapDriver = {
    destroy: vi.fn(),
    fitToListings: vi.fn(),
    focusListing: vi.fn(),
    resize: vi.fn(),
    setWildfireHazardVisible: vi.fn(),
    updateDraftMarker: vi.fn(),
    updateListings: vi.fn(),
  };
  const harness: {
    createMap: ReturnType<typeof vi.fn<CreateListingsMap>>;
    driver: ListingsMapDriver;
    options: Parameters<CreateListingsMap>[0] | undefined;
  } = {
    createMap: vi.fn<CreateListingsMap>(),
    driver,
    options: undefined,
  };
  harness.createMap.mockImplementation((options) => {
    harness.options = options;
    return driver;
  });

  return harness;
}

function createWildfireHazardMetadata(): WildfireHazardMetadata {
  return {
    artifactVersion: "2025.1",
    snapshotAt: "2026-08-22T00:29:56Z",
    sourceName: "CAL FIRE / Office of the State Fire Marshal",
    sourceUrl:
      "https://osfm.fire.ca.gov/what-we-do/community-wildfire-preparedness-and-mitigation/fire-hazard-severity-zones",
    sourceVersions: {
      lra: "FHSZLRA25_1",
      sra: "FHSZSRA_23_3",
    },
    jurisdictions: [
      { name: "Chino", status: "locally-adopted" },
      { name: "Chino Hills", status: "locally-adopted" },
      { name: "Corona", status: "locally-adopted" },
      { name: "Eastvale", status: "recommended" },
      { name: "Jurupa Valley", status: "locally-adopted" },
    ],
  };
}
