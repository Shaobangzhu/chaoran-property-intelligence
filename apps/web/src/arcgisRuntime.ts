import esriConfig from "@arcgis/core/config.js";
import "@arcgis/map-components/components/arcgis-map";
import "@arcgis/map-components/components/arcgis-zoom";

import { configureArcgisBasemapApiKey } from "./arcgisConfig.js";

export function initializeArcgisRuntime(
  apiKey: unknown = import.meta.env.VITE_ARCGIS_API_KEY,
): void {
  configureArcgisBasemapApiKey(esriConfig, apiKey);
}
