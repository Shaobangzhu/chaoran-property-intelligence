import GeoJSONLayer from "@arcgis/core/layers/GeoJSONLayer.js";
import UniqueValueRenderer from "@arcgis/core/renderers/UniqueValueRenderer.js";
import SimpleFillSymbol from "@arcgis/core/symbols/SimpleFillSymbol.js";
import { describe, expect, it } from "vitest";

import {
  ARCGIS_WILDFIRE_HAZARD_LAYER_ID,
  createArcgisWildfireHazardLayer,
} from "./arcgisWildfireHazardOverlay.js";
import { createArcgisTerrainWildfireHazardLayer } from "./arcgisTerrainWildfireHazardOverlay.js";

describe("ArcGIS terrain wildfire hazard layer", () => {
  it("drapes the unchanged three-severity 2D renderer on the ground", () => {
    const flatLayer = createArcgisWildfireHazardLayer("blob:cpi-flat-hazard");
    const terrainLayer = createArcgisTerrainWildfireHazardLayer(
      "blob:cpi-terrain-hazard",
    );

    expect(terrainLayer).toBeInstanceOf(GeoJSONLayer);
    expect(terrainLayer.id).toBe(ARCGIS_WILDFIRE_HAZARD_LAYER_ID);
    expect(terrainLayer.elevationInfo?.mode).toBe("on-the-ground");
    expect(terrainLayer.popupEnabled).toBe(false);
    expect(terrainLayer.legendEnabled).toBe(false);
    expect(terrainLayer.outFields).toEqual(["severity"]);
    expect(terrainLayer.renderer).toBeInstanceOf(UniqueValueRenderer);
    expect(terrainLayer.renderer?.toJSON()).toEqual(
      flatLayer.renderer?.toJSON(),
    );

    const renderer = terrainLayer.renderer as UniqueValueRenderer;
    expect(renderer.field).toBe("severity");
    expect(renderer.defaultSymbol).toBeNull();
    expect(renderer.uniqueValueInfos?.map(({ value }) => value)).toEqual([
      "moderate",
      "high",
      "very-high",
    ]);
    for (const { symbol } of renderer.uniqueValueInfos ?? []) {
      expect(symbol).toBeInstanceOf(SimpleFillSymbol);
      expect(symbol?.type).toBe("simple-fill");
    }
  });
});
