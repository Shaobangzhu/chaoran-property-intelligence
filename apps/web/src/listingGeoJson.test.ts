import { describe, expect, it } from "vitest";

import { listingsToFeatureCollection } from "./listingGeoJson.js";
import { coronaListing, eastvaleListing } from "./listingFixtures.js";

describe("listingsToFeatureCollection", () => {
  it("converts listing coordinates to GeoJSON longitude-latitude points", () => {
    const collection = listingsToFeatureCollection(
      [eastvaleListing, coronaListing],
      coronaListing.id,
    );

    expect(collection).toEqual({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [-117.5848, 33.9525],
          },
          properties: {
            id: eastvaleListing.id,
            selected: false,
          },
        },
        {
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [-117.5664, 33.8753],
          },
          properties: {
            id: coronaListing.id,
            selected: true,
          },
        },
      ],
    });
  });

  it("keeps one stable map feature when only the asking price changes", () => {
    const currentListing = { ...eastvaleListing, price: 770000 };

    const collection = listingsToFeatureCollection(
      [currentListing],
      currentListing.id,
    );

    expect(collection.features).toEqual([
      expect.objectContaining({
        properties: {
          id: currentListing.id,
          selected: true,
        },
      }),
    ]);
  });
});
