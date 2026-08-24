// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const { createArcgisListingsMap, createArcgisTerrainListingsScene } =
  vi.hoisted(() => ({
    createArcgisListingsMap: vi.fn(),
    createArcgisTerrainListingsScene: vi.fn(),
  }));

vi.mock("./arcgisListingsMap.js", () => ({ createArcgisListingsMap }));
vi.mock("./arcgisTerrainListingsScene.js", () => ({
  createArcgisTerrainListingsScene,
}));

import {
  ListingsMap,
  type CreateListingsMap,
  type ListingsMapDriver,
} from "./ListingsMap.js";
import { coronaListing, eastvaleListing } from "./listingFixtures.js";
import type { WildfireHazardMetadata } from "./wildfireHazardMetadata.js";

afterEach(cleanup);

describe("ListingsMap", () => {
  it("uses 2D by default while exposing the production terrain driver", () => {
    const harness = createDriverHarness();
    createArcgisListingsMap.mockImplementationOnce(harness.createMap);

    render(
      <ListingsMap
        listings={[eastvaleListing]}
        onSelect={() => undefined}
        selectedListingId={null}
      />,
    );

    expect(createArcgisListingsMap).toHaveBeenCalledOnce();
    expect(harness.driver.updateListings).toHaveBeenCalledWith(
      [eastvaleListing],
      null,
    );
    expect(
      screen.getByRole("group", { name: "Map view" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2D" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(createArcgisTerrainListingsScene).not.toHaveBeenCalled();
  });

  it("switches between injected drivers while preserving React-owned state", async () => {
    const user = userEvent.setup();
    const lifecycle: string[] = [];
    const twoDimensionalHarness = createDriverHarness({
      lifecycle,
      name: "2d",
    });
    const terrainHarness = createDriverHarness({
      lifecycle,
      name: "terrain",
    });
    const onSelect = vi.fn();

    render(
      <ListingsMap
        createMap={twoDimensionalHarness.createMap}
        createTerrainMap={terrainHarness.createMap}
        listings={[eastvaleListing, coronaListing]}
        onSelect={onSelect}
        selectedListingId={coronaListing.id}
      />,
    );

    const modeControl = screen.getByRole("group", { name: "Map view" });
    const twoDimensionalButton = screen.getByRole("button", { name: "2D" });
    const terrainButton = screen.getByRole("button", { name: "3D Terrain" });
    expect(modeControl).toBeInTheDocument();
    expect(twoDimensionalButton).toHaveAttribute("aria-pressed", "true");
    expect(terrainButton).toHaveAttribute("aria-pressed", "false");

    act(() => twoDimensionalHarness.options?.onReady());
    await user.click(
      screen.getByRole("switch", { name: "Wildfire hazard zones" }),
    );
    expect(
      twoDimensionalHarness.driver.setWildfireHazardVisible,
    ).toHaveBeenCalledWith(true);

    await user.click(terrainButton);

    expect(twoDimensionalHarness.driver.destroy).toHaveBeenCalledOnce();
    expect(terrainHarness.createMap).toHaveBeenCalledOnce();
    expect(lifecycle).toEqual(["create:2d", "destroy:2d", "create:terrain"]);
    expect(terrainButton).toHaveAttribute("aria-pressed", "true");
    expect(terrainHarness.driver.updateListings).toHaveBeenCalledWith(
      [eastvaleListing, coronaListing],
      coronaListing.id,
    );
    expect(terrainHarness.driver.updateDraftMarker).toHaveBeenCalledWith(null);

    act(() => {
      twoDimensionalHarness.options?.onSelect(eastvaleListing.id);
      twoDimensionalHarness.options?.onError(new Error("stale 2D error"));
      twoDimensionalHarness.options?.onReady();
    });
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByText("Loading 3D terrain")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    act(() => terrainHarness.options?.onReady());
    expect(terrainHarness.driver.fitToListings).toHaveBeenCalledWith([
      eastvaleListing,
      coronaListing,
    ]);
    expect(terrainHarness.driver.focusListing).toHaveBeenCalledWith(
      coronaListing,
    );
    expect(
      terrainHarness.driver.setWildfireHazardVisible,
    ).toHaveBeenCalledWith(true);
    expect(
      screen.getByRole("switch", { name: "Wildfire hazard zones" }),
    ).toBeChecked();
    act(() =>
      terrainHarness.options?.onWildfireHazardStateChange({
        metadata: createWildfireHazardMetadata(),
        status: "ready",
        visible: true,
      }),
    );
    expect(
      screen.getByText(
        "Terrain is visual context only. CAL FIRE classifications are unchanged.",
      ),
    ).toBeInTheDocument();

    twoDimensionalButton.focus();
    await user.keyboard("[Enter]");
    expect(
      screen.queryByText(/Terrain is visual context only/),
    ).not.toBeInTheDocument();
    expect(terrainHarness.driver.destroy).toHaveBeenCalledOnce();
    expect(twoDimensionalHarness.createMap).toHaveBeenCalledTimes(2);
    expect(lifecycle).toEqual([
      "create:2d",
      "destroy:2d",
      "create:terrain",
      "destroy:terrain",
      "create:2d",
    ]);

    act(() => {
      terrainHarness.options?.onWildfireHazardStateChange({
        status: "error",
        visible: false,
      });
      terrainHarness.options?.onError(new Error("stale terrain error"));
    });
    expect(screen.getByText("Loading map")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    act(() => twoDimensionalHarness.options?.onReady());
    expect(
      screen.getByRole("switch", { name: "Wildfire hazard zones" }),
    ).toBeChecked();
    expect(
      twoDimensionalHarness.driver.setWildfireHazardVisible,
    ).toHaveBeenLastCalledWith(true);
  });

  it("returns to 2D and disables terrain while a listing draft is open", async () => {
    const user = userEvent.setup();
    const twoDimensionalHarness = createDriverHarness();
    const terrainHarness = createDriverHarness();
    const view = render(
      <ListingsMap
        createMap={twoDimensionalHarness.createMap}
        createTerrainMap={terrainHarness.createMap}
        listings={[eastvaleListing]}
        onSelect={() => undefined}
        selectedListingId={null}
      />,
    );

    await user.click(screen.getByRole("button", { name: "3D Terrain" }));
    act(() => terrainHarness.options?.onReady());

    view.rerender(
      <ListingsMap
        createMap={twoDimensionalHarness.createMap}
        createTerrainMap={terrainHarness.createMap}
        draftMarker={{
          confirmed: false,
          coordinates: { latitude: 33.8753, longitude: -117.5664 },
          onConfirm: () => undefined,
          onCoordinatesChange: () => undefined,
        }}
        listings={[eastvaleListing]}
        onSelect={() => undefined}
        selectedListingId={null}
      />,
    );

    const twoDimensionalButton = screen.getByRole("button", { name: "2D" });
    const terrainButton = screen.getByRole("button", { name: "3D Terrain" });
    expect(terrainHarness.driver.destroy).toHaveBeenCalledOnce();
    expect(twoDimensionalHarness.createMap).toHaveBeenCalledTimes(2);
    expect(twoDimensionalButton).toHaveAttribute("aria-pressed", "true");
    expect(terrainButton).toBeDisabled();
    expect(
      twoDimensionalHarness.driver.updateDraftMarker,
    ).toHaveBeenLastCalledWith({
      confirmed: false,
      coordinates: { latitude: 33.8753, longitude: -117.5664 },
    });

    await user.click(terrainButton);
    expect(terrainHarness.createMap).toHaveBeenCalledOnce();

    view.rerender(
      <ListingsMap
        createMap={twoDimensionalHarness.createMap}
        createTerrainMap={terrainHarness.createMap}
        listings={[eastvaleListing]}
        onSelect={() => undefined}
        selectedListingId={null}
      />,
    );
    expect(terrainButton).toBeEnabled();
    expect(twoDimensionalButton).toHaveAttribute("aria-pressed", "true");
  });

  it("retries the currently selected injected driver", async () => {
    const user = userEvent.setup();
    const twoDimensionalHarness = createDriverHarness();
    const firstTerrainHarness = createDriverHarness();
    const secondTerrainHarness = createDriverHarness();
    const createTerrainMap = vi
      .fn<CreateListingsMap>()
      .mockImplementationOnce(firstTerrainHarness.createMap)
      .mockImplementationOnce(secondTerrainHarness.createMap);

    render(
      <ListingsMap
        createMap={twoDimensionalHarness.createMap}
        createTerrainMap={createTerrainMap}
        listings={[eastvaleListing]}
        onSelect={() => undefined}
        selectedListingId={null}
      />,
    );

    await user.click(screen.getByRole("button", { name: "3D Terrain" }));
    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading 3D terrain",
    );
    act(() => firstTerrainHarness.options?.onError(new Error("scene error")));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "3D terrain unavailable",
    );
    await user.click(screen.getByRole("button", { name: "Retry 3D" }));

    expect(twoDimensionalHarness.createMap).toHaveBeenCalledOnce();
    expect(createTerrainMap).toHaveBeenCalledTimes(2);
    expect(firstTerrainHarness.driver.destroy).toHaveBeenCalledOnce();
    expect(secondTerrainHarness.driver.updateListings).toHaveBeenCalledWith(
      [eastvaleListing],
      null,
    );
  });

  it("returns from a terrain error to 2D and restores mode-control focus", async () => {
    const user = userEvent.setup();
    const twoDimensionalHarness = createDriverHarness();
    const terrainHarness = createDriverHarness();

    render(
      <ListingsMap
        createMap={twoDimensionalHarness.createMap}
        createTerrainMap={terrainHarness.createMap}
        listings={[eastvaleListing]}
        onSelect={() => undefined}
        selectedListingId={null}
      />,
    );

    act(() => twoDimensionalHarness.options?.onReady());
    await user.click(
      screen.getByRole("switch", { name: "Wildfire hazard zones" }),
    );
    await user.click(screen.getByRole("button", { name: "3D Terrain" }));
    act(() => terrainHarness.options?.onError(new Error("scene error")));
    await user.click(screen.getByRole("button", { name: "Return to 2D" }));

    const twoDimensionalButton = screen.getByRole("button", { name: "2D" });
    expect(terrainHarness.driver.destroy).toHaveBeenCalledOnce();
    expect(twoDimensionalHarness.createMap).toHaveBeenCalledTimes(2);
    expect(twoDimensionalButton).toHaveAttribute("aria-pressed", "true");
    expect(twoDimensionalButton).toHaveFocus();

    act(() => twoDimensionalHarness.options?.onReady());
    expect(
      twoDimensionalHarness.driver.setWildfireHazardVisible,
    ).toHaveBeenCalledTimes(2);
    expect(
      twoDimensionalHarness.driver.setWildfireHazardVisible,
    ).toHaveBeenLastCalledWith(true);
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

function createDriverHarness(configuration?: {
  lifecycle: string[];
  name: string;
}): {
  createMap: CreateListingsMap;
  driver: ListingsMapDriver;
  options: Parameters<CreateListingsMap>[0] | undefined;
} {
  const driver: ListingsMapDriver = {
    destroy: vi.fn(() => {
      if (configuration !== undefined) {
        configuration.lifecycle.push(`destroy:${configuration.name}`);
      }
    }),
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
  harness.createMap.mockImplementation((createOptions) => {
    harness.options = createOptions;
    return driver;
  });

  if (configuration !== undefined) {
    harness.createMap.mockImplementation((createOptions) => {
      harness.options = createOptions;
      configuration.lifecycle.push(`create:${configuration.name}`);
      return driver;
    });
  }

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
