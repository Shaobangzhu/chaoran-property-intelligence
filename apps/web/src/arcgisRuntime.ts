import esriConfig from "@arcgis/core/config.js";

import { configureArcgisBasemapApiKey } from "./arcgisConfig.js";

export function initializeArcgisRuntime(
  apiKey: unknown = import.meta.env.VITE_ARCGIS_API_KEY,
): void {
  configureArcgisBasemapApiKey(esriConfig, apiKey);
}
