// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import { eastvaleListing } from "./listingFixtures.js";
import {
  createLazyArcgisTerrainListingsSceneWithLoader,
  type TerrainListingsSceneModule,
} from "./lazyArcgisTerrainListingsScene.js";
import type {
  CreateListingsMap,
  CreateListingsMapOptions,
  ListingsMapDriver,
} from "./listingsMapDriver.js";

describe("lazy ArcGIS terrain listings scene", () => {
  it("loads on demand and replays the latest driver state", async () => {
    const loaded = deferred<TerrainListingsSceneModule>();
    const real = createDriverHarness();
    const options = createOptions();
    const driver = createLazyArcgisTerrainListingsSceneWithLoader(
      options,
      () => loaded.promise,
    );

    driver.updateListings([eastvaleListing], eastvaleListing.id);
    driver.updateDraftMarker(null);
    const visibility = driver.setWildfireHazardVisible(true);
    driver.resize();

    expect(real.createMap).not.toHaveBeenCalled();
    loaded.resolve({ createArcgisTerrainListingsScene: real.createMap });
    await visibility;

    expect(real.createMap).toHaveBeenCalledOnce();
    expect(real.driver.updateListings).toHaveBeenCalledWith(
      [eastvaleListing],
      eastvaleListing.id,
    );
    expect(real.driver.updateDraftMarker).toHaveBeenCalledWith(null);
    expect(real.driver.setWildfireHazardVisible).toHaveBeenCalledWith(true);
    expect(real.driver.resize).toHaveBeenCalledOnce();
  });

  it("forwards navigation commands after the real driver loads", async () => {
    const real = createDriverHarness();
    const driver = createLazyArcgisTerrainListingsSceneWithLoader(
      createOptions(),
      async () => ({ createArcgisTerrainListingsScene: real.createMap }),
    );

    await driver.setWildfireHazardVisible(false);
    driver.fitToListings([eastvaleListing]);
    driver.focusListing(eastvaleListing);

    expect(real.driver.fitToListings).toHaveBeenCalledWith([eastvaleListing]);
    expect(real.driver.focusListing).toHaveBeenCalledWith(eastvaleListing);
  });

  it("does not create a scene when destroyed before loading completes", async () => {
    const loaded = deferred<TerrainListingsSceneModule>();
    const real = createDriverHarness();
    const options = createOptions();
    const driver = createLazyArcgisTerrainListingsSceneWithLoader(
      options,
      () => loaded.promise,
    );

    driver.destroy();
    driver.destroy();
    loaded.resolve({ createArcgisTerrainListingsScene: real.createMap });
    await loaded.promise;
    await Promise.resolve();

    expect(real.createMap).not.toHaveBeenCalled();
    expect(options.onReady).not.toHaveBeenCalled();
    expect(options.onError).not.toHaveBeenCalled();
  });

  it("destroys an already loaded scene exactly once", async () => {
    const real = createDriverHarness();
    const driver = createLazyArcgisTerrainListingsSceneWithLoader(
      createOptions(),
      async () => ({ createArcgisTerrainListingsScene: real.createMap }),
    );
    await driver.setWildfireHazardVisible(false);

    driver.destroy();
    driver.destroy();

    expect(real.driver.destroy).toHaveBeenCalledOnce();
  });

  it("reports a bounded error when the dynamic module fails", async () => {
    const options = createOptions();
    const driver = createLazyArcgisTerrainListingsSceneWithLoader(
      options,
      async () => {
        throw new Error("private provider detail");
      },
    );
    await driver.setWildfireHazardVisible(false);

    expect(options.onError).toHaveBeenCalledOnce();
    expect(options.onError).not.toHaveBeenCalledWith(
      expect.objectContaining({ message: "private provider detail" }),
    );
  });
});

function createOptions(): CreateListingsMapOptions & {
  onError: ReturnType<typeof vi.fn>;
  onReady: ReturnType<typeof vi.fn>;
} {
  return {
    container: document.createElement("div"),
    onDraftCoordinatesChange: vi.fn(),
    onError: vi.fn(),
    onReady: vi.fn(),
    onSelect: vi.fn(),
    onWildfireHazardStateChange: vi.fn(),
  };
}

function createDriverHarness(): {
  createMap: ReturnType<typeof vi.fn<CreateListingsMap>>;
  driver: ListingsMapDriver;
} {
  const driver: ListingsMapDriver = {
    destroy: vi.fn(),
    fitToListings: vi.fn(),
    focusListing: vi.fn(),
    resize: vi.fn(),
    setWildfireHazardVisible: vi.fn().mockResolvedValue(undefined),
    updateDraftMarker: vi.fn(),
    updateListings: vi.fn(),
  };
  return {
    createMap: vi.fn<CreateListingsMap>().mockReturnValue(driver),
    driver,
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
