import GeoJSONLayer from "@arcgis/core/layers/GeoJSONLayer.js";

import {
  createArcgisWildfireHazardLayer,
  createArcgisWildfireHazardOverlayControllerWithLayerFactory,
  type CreateArcgisWildfireHazardOverlayOptions,
} from "./arcgisWildfireHazardOverlay.js";
import type { WildfireHazardOverlayController } from "./wildfireHazardOverlay.js";

export function createArcgisTerrainWildfireHazardOverlayController(
  options: CreateArcgisWildfireHazardOverlayOptions,
): WildfireHazardOverlayController {
  return createArcgisWildfireHazardOverlayControllerWithLayerFactory(
    options,
    createArcgisTerrainWildfireHazardLayer,
  );
}

export function createArcgisTerrainWildfireHazardLayer(
  objectUrl: string,
): GeoJSONLayer {
  const layer = createArcgisWildfireHazardLayer(objectUrl);
  layer.elevationInfo = { mode: "on-the-ground" };
  return layer;
}
