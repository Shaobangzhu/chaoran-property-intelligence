import { beforeEach, describe, expect, it, vi } from "vitest";

const { esriConfig } = vi.hoisted(() => ({
  esriConfig: {
    apiKey: undefined as string | undefined,
    apiKeys: {} as { basemapStyles?: string },
  },
}));

vi.mock("@arcgis/core/config.js", () => ({ default: esriConfig }));

import { ArcgisConfigurationError } from "./arcgisConfig.js";
import { initializeArcgisRuntime } from "./arcgisRuntime.js";

describe("ArcGIS runtime foundation", () => {
  beforeEach(() => {
    esriConfig.apiKey = undefined;
    esriConfig.apiKeys = {};
  });

  it("configures only the basemap styles key", () => {
    initializeArcgisRuntime("test.runtime-key_123");

    expect(esriConfig.apiKey).toBeUndefined();
    expect(esriConfig.apiKeys).toEqual({
      basemapStyles: "test.runtime-key_123",
    });
  });

  it("fails closed when the key is unavailable", () => {
    expect(() => initializeArcgisRuntime(null)).toThrow(
      ArcgisConfigurationError,
    );
    expect(esriConfig.apiKeys).toEqual({});
  });
});
