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
