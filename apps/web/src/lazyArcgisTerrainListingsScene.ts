import type { ListingSummary } from "./listingsApi.js";
import type {
  CreateListingsMap,
  CreateListingsMapOptions,
  DraftMarkerPresentation,
  ListingsMapDriver,
} from "./listingsMapDriver.js";

export interface TerrainListingsSceneModule {
  createArcgisTerrainListingsScene: CreateListingsMap;
}

type TerrainListingsSceneLoader = () => Promise<TerrainListingsSceneModule>;

type PendingNavigation =
  | { listings: ListingSummary[]; type: "fit" }
  | { listing: ListingSummary; type: "focus" };

export class ArcgisTerrainListingsSceneLoadError extends Error {
  public constructor() {
    super("ArcGIS terrain listings scene could not be loaded.");
    this.name = "ArcgisTerrainListingsSceneLoadError";
  }
}

const loadTerrainListingsScene: TerrainListingsSceneLoader = async () => {
  const [, terrainModule] = await Promise.all([
    import("@arcgis/map-components/components/arcgis-scene"),
    import("./arcgisTerrainListingsScene.js"),
  ]);
  return terrainModule;
};

export const createLazyArcgisTerrainListingsScene: CreateListingsMap =
  (options) =>
    createLazyArcgisTerrainListingsSceneWithLoader(
      options,
      loadTerrainListingsScene,
    );

export function createLazyArcgisTerrainListingsSceneWithLoader(
  options: CreateListingsMapOptions,
  load: TerrainListingsSceneLoader,
): ListingsMapDriver {
  let realDriver: ListingsMapDriver | null = null;
  let destroyed = false;
  let currentListings: ListingSummary[] = [];
  let currentSelectedListingId: string | null = null;
  let currentDraftMarker: DraftMarkerPresentation | null = null;
  let desiredWildfireHazardVisibility: boolean | null = null;
  let pendingNavigation: PendingNavigation | null = null;
  let resizePending = false;

  const loading = Promise.resolve()
    .then(load)
    .then(async ({ createArcgisTerrainListingsScene }) => {
      if (destroyed) {
        return;
      }

      const driver = createArcgisTerrainListingsScene(options);
      if (destroyed) {
        driver.destroy();
        return;
      }

      realDriver = driver;
      driver.updateListings(currentListings, currentSelectedListingId);
      driver.updateDraftMarker(currentDraftMarker);

      if (pendingNavigation?.type === "fit") {
        driver.fitToListings(pendingNavigation.listings);
      } else if (pendingNavigation?.type === "focus") {
        driver.focusListing(pendingNavigation.listing);
      }
      pendingNavigation = null;

      if (resizePending) {
        driver.resize();
        resizePending = false;
      }

      if (desiredWildfireHazardVisibility !== null) {
        await driver.setWildfireHazardVisible(
          desiredWildfireHazardVisibility,
        );
      }
    })
    .catch(() => {
      if (!destroyed) {
        options.onError(new ArcgisTerrainListingsSceneLoadError());
      }
    });

  return {
    updateListings: (listings, selectedListingId) => {
      currentListings = [...listings];
      currentSelectedListingId = selectedListingId;
      realDriver?.updateListings(currentListings, currentSelectedListingId);
    },
    fitToListings: (listings) => {
      if (realDriver !== null) {
        realDriver.fitToListings(listings);
      } else if (!destroyed) {
        pendingNavigation = { listings: [...listings], type: "fit" };
      }
    },
    focusListing: (listing) => {
      if (realDriver !== null) {
        realDriver.focusListing(listing);
      } else if (!destroyed) {
        pendingNavigation = { listing, type: "focus" };
      }
    },
    updateDraftMarker: (draftMarker) => {
      currentDraftMarker = draftMarker;
      realDriver?.updateDraftMarker(currentDraftMarker);
    },
    setWildfireHazardVisible: async (visible) => {
      desiredWildfireHazardVisibility = visible;
      if (realDriver !== null) {
        await realDriver.setWildfireHazardVisible(visible);
        return;
      }
      await loading;
    },
    resize: () => {
      if (realDriver !== null) {
        realDriver.resize();
      } else if (!destroyed) {
        resizePending = true;
      }
    },
    destroy: () => {
      if (destroyed) {
        return;
      }
      destroyed = true;
      realDriver?.destroy();
      realDriver = null;
      pendingNavigation = null;
    },
  };
}
