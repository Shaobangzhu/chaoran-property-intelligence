import { describe, expect, it } from "vitest";

import {
  ArcgisConfigurationError,
  MAX_ARCGIS_API_KEY_LENGTH,
  configureArcgisBasemapApiKey,
} from "./arcgisConfig.js";

describe("ArcGIS basemap API key configuration", () => {
  it("sets only the scoped basemap styles key", () => {
    const scopes = [{ token: "existing-token", urls: ["https://example.com"] }];
    const target = {
      apiKey: undefined as string | undefined,
      apiKeys: {
        basemapStyles: "previous-key",
        scopes,
      },
    };

    configureArcgisBasemapApiKey(target, "test.arcgis-key_123");

    expect(target.apiKey).toBeUndefined();
    expect(target.apiKeys).toEqual({
      basemapStyles: "test.arcgis-key_123",
      scopes,
    });
  });

  it.each([
    ["missing", undefined],
    ["null", null],
    ["non-string", 123],
    ["empty", ""],
    ["blank", "   "],
    ["leading whitespace", " test-key"],
    ["trailing whitespace", "test-key "],
    ["embedded whitespace", "test key"],
    ["too long", "x".repeat(MAX_ARCGIS_API_KEY_LENGTH + 1)],
  ])("rejects a %s value with one bounded error", (_label, value) => {
    const target = { apiKeys: {} };

    expect(() => configureArcgisBasemapApiKey(target, value)).toThrow(
      ArcgisConfigurationError,
    );

    try {
      configureArcgisBasemapApiKey(target, value);
    } catch (error) {
      expect(error).toMatchObject({
        code: "ARCGIS_CONFIGURATION_UNAVAILABLE",
        message: "ArcGIS map configuration is unavailable.",
      });
      if (String(value).length > 0) {
        expect(String(error)).not.toContain(String(value));
      }
    }

    expect(target.apiKeys).toEqual({});
  });

  it("accepts the maximum bounded length", () => {
    const target = { apiKeys: {} as { basemapStyles?: string } };
    const apiKey = "x".repeat(MAX_ARCGIS_API_KEY_LENGTH);

    configureArcgisBasemapApiKey(target, apiKey);

    expect(target.apiKeys.basemapStyles).toHaveLength(
      MAX_ARCGIS_API_KEY_LENGTH,
    );
  });
});
