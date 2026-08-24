export const MAX_ARCGIS_API_KEY_LENGTH = 4096;

export class ArcgisConfigurationError extends Error {
  public readonly code = "ARCGIS_CONFIGURATION_UNAVAILABLE";

  public constructor() {
    super("ArcGIS map configuration is unavailable.");
    this.name = "ArcgisConfigurationError";
  }
}

interface ArcgisBasemapApiKeyTarget {
  readonly apiKeys: {
    basemapStyles?: string;
  };
}

export function configureArcgisBasemapApiKey(
  target: ArcgisBasemapApiKeyTarget,
  value: unknown,
): void {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_ARCGIS_API_KEY_LENGTH ||
    /\s/u.test(value)
  ) {
    throw new ArcgisConfigurationError();
  }

  target.apiKeys.basemapStyles = value;
}
