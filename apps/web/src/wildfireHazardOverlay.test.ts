import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { WildfireHazardMetadata } from "./wildfireHazardMetadata.js";
import {
  WILDFIRE_HAZARD_ARTIFACT_URL,
  WILDFIRE_HAZARD_SEVERITY_STYLES,
  createWildfireHazardOverlayLifecycle,
  loadWildfireHazardArtifact,
  parseWildfireHazardArtifact,
  type WildfireHazardFeatureCollection,
  type WildfireHazardOverlayRenderer,
  type WildfireHazardOverlayState,
} from "./wildfireHazardOverlay.js";

afterEach(() => vi.unstubAllGlobals());

describe("wildfire hazard artifact validation", () => {
  it("accepts the published seven-target Block 27.6 artifact", () => {
    const publishedArtifact = JSON.parse(
      readFileSync(
        new URL(
          "../public/data/wildfire-hazard/fhsz-supported-markets-2025.1-r3.geojson",
          import.meta.url,
        ),
        "utf8",
      ),
    );

    expect(parseWildfireHazardArtifact(publishedArtifact).features).toHaveLength(
      110,
    );
  });

  it("points the runtime loader at the reviewed successor filename", () => {
    expect(WILDFIRE_HAZARD_ARTIFACT_URL).toBe(
      "/data/wildfire-hazard/fhsz-supported-markets-2025.1-r3.geojson",
    );
  });

  it("accepts the three reviewed severities and polygon geometry", () => {
    expect(parseWildfireHazardArtifact(createArtifact()).features).toHaveLength(
      3,
    );
  });

  it("rejects unsupported severities and malformed geometry", () => {
    const unsupported = createArtifact();
    unsupported.features[0]!.properties.severity = "extreme";
    expect(() => parseWildfireHazardArtifact(unsupported)).toThrow(
      "Unsupported wildfire hazard severity",
    );

    const malformed = createArtifact();
    malformed.features[0]!.geometry.coordinates[0] = [
      [-117.6, 33.9],
      [-117.5, 33.9],
      [-117.5, 34],
    ];
    expect(() => parseWildfireHazardArtifact(malformed)).toThrow(
      "Polygon rings must contain at least four positions",
    );
  });

  it("loads the versioned artifact from the same origin with cancellation", async () => {
    const artifact = createArtifact();
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => artifact,
      ok: true,
    });
    vi.stubGlobal("fetch", fetchMock);
    const signal = new AbortController().signal;

    await expect(loadWildfireHazardArtifact(signal)).resolves.toEqual(artifact);
    expect(fetchMock).toHaveBeenCalledWith(WILDFIRE_HAZARD_ARTIFACT_URL, {
      signal,
    });
  });
});

describe("wildfire hazard overlay lifecycle", () => {
  it("loads once, installs once, and toggles renderer visibility", async () => {
    const harness = createHarness();
    const controller = harness.createController();

    expect(harness.loadArtifact).not.toHaveBeenCalled();
    expect(harness.loadMetadata).not.toHaveBeenCalled();
    expect(harness.renderer.install).not.toHaveBeenCalled();

    await controller.setVisible(true);

    expect(harness.loadArtifact).toHaveBeenCalledOnce();
    expect(harness.loadMetadata).toHaveBeenCalledOnce();
    expect(harness.renderer.install).toHaveBeenCalledWith(
      harness.artifact,
      expect.any(AbortSignal),
    );
    expect(harness.renderer.setVisible).toHaveBeenLastCalledWith(true);
    expect(harness.states.at(-1)).toEqual({
      metadata: harness.metadata,
      status: "ready",
      visible: true,
    });

    await controller.setVisible(false);
    await controller.setVisible(true);

    expect(harness.loadArtifact).toHaveBeenCalledOnce();
    expect(harness.loadMetadata).toHaveBeenCalledOnce();
    expect(harness.renderer.install).toHaveBeenCalledOnce();
    expect(harness.renderer.setVisible).toHaveBeenNthCalledWith(2, false);
    expect(harness.renderer.setVisible).toHaveBeenNthCalledWith(3, true);
  });

  it("keeps the reviewed severity palette engine-neutral", () => {
    expect(WILDFIRE_HAZARD_SEVERITY_STYLES).toEqual({
      moderate: {
        fillColor: "#f8b4ad",
        fillOpacity: 0.16,
        outlineColor: "#d9776d",
        outlineOpacity: 0.55,
        outlineWidth: 0.7,
      },
      high: {
        fillColor: "#e85d55",
        fillOpacity: 0.22,
        outlineColor: "#c43c32",
        outlineOpacity: 0.65,
        outlineWidth: 0.9,
      },
      "very-high": {
        fillColor: "#a61b1b",
        fillOpacity: 0.28,
        outlineColor: "#7f1d1d",
        outlineOpacity: 0.75,
        outlineWidth: 1.1,
      },
    });
  });

  it("honors a disable request while loading", async () => {
    const harness = createHarness();
    const artifactLoad = createDeferred<WildfireHazardFeatureCollection>();
    harness.loadArtifact.mockReturnValueOnce(artifactLoad.promise);
    const controller = harness.createController();

    const pendingLoad = controller.setVisible(true);
    await Promise.resolve();
    await controller.setVisible(false);
    artifactLoad.resolve(harness.artifact);
    await pendingLoad;

    expect(harness.renderer.setVisible).toHaveBeenLastCalledWith(false);
    expect(harness.states.at(-1)).toEqual({
      metadata: harness.metadata,
      status: "ready",
      visible: false,
    });
  });

  it("rolls back a partial renderer installation with a bounded error", async () => {
    const harness = createHarness();
    harness.renderer.install.mockRejectedValueOnce(
      new Error("private renderer detail"),
    );
    const controller = harness.createController();

    await expect(controller.setVisible(true)).resolves.toBeUndefined();

    expect(harness.renderer.rollback).toHaveBeenCalled();
    expect(harness.states.at(-1)).toEqual({
      status: "error",
      visible: false,
    });
  });

  it("does not install geometry without reviewed metadata", async () => {
    const harness = createHarness();
    harness.loadMetadata.mockRejectedValueOnce(new Error("missing provenance"));
    const controller = harness.createController();

    await controller.setVisible(true);

    expect(harness.renderer.install).not.toHaveBeenCalled();
    expect(harness.states.at(-1)).toEqual({
      status: "error",
      visible: false,
    });
  });

  it("retries from a clean state after a failed load", async () => {
    const harness = createHarness();
    harness.loadArtifact.mockRejectedValueOnce(
      new Error("private provider detail"),
    );
    const controller = harness.createController();

    await controller.setVisible(true);
    expect(harness.states.at(-1)).toEqual({
      status: "error",
      visible: false,
    });

    await controller.setVisible(true);
    expect(harness.loadArtifact).toHaveBeenCalledTimes(2);
    expect(harness.renderer.install).toHaveBeenCalledOnce();
    expect(harness.states.at(-1)).toMatchObject({
      status: "ready",
      visible: true,
    });
  });

  it("aborts pending work and destroys renderer resources idempotently", async () => {
    const harness = createHarness();
    let signal: AbortSignal | undefined;
    harness.loadArtifact.mockImplementationOnce((currentSignal) => {
      signal = currentSignal;
      return new Promise((_resolve, reject) => {
        currentSignal.addEventListener("abort", () =>
          reject(currentSignal.reason),
        );
      });
    });
    const controller = harness.createController();
    const pendingLoad = controller.setVisible(true);
    await Promise.resolve();

    controller.destroy();
    controller.destroy();
    await expect(pendingLoad).resolves.toBeUndefined();

    expect(signal?.aborted).toBe(true);
    expect(harness.renderer.destroy).toHaveBeenCalledOnce();
  });
});

function createHarness(): WildfireLifecycleHarness {
  const artifact = parseWildfireHazardArtifact(createArtifact());
  const metadata = createMetadata();
  const states: WildfireHazardOverlayState[] = [];
  const renderer: {
    destroy: ReturnType<typeof vi.fn>;
    install: ReturnType<typeof vi.fn>;
    rollback: ReturnType<typeof vi.fn>;
    setVisible: ReturnType<typeof vi.fn>;
  } = {
    destroy: vi.fn(),
    install: vi.fn(async () => undefined),
    rollback: vi.fn(),
    setVisible: vi.fn(),
  };
  const loadArtifact = vi.fn(async (_signal: AbortSignal) => artifact);
  const loadMetadata = vi.fn(async (_signal: AbortSignal) => metadata);

  return {
    artifact,
    createController: () =>
      createWildfireHazardOverlayLifecycle({
        loadArtifact,
        loadMetadata,
        onStateChange: (state) => states.push(state),
        renderer: renderer as WildfireHazardOverlayRenderer,
      }),
    loadArtifact,
    loadMetadata,
    metadata,
    renderer,
    states,
  };
}

interface WildfireLifecycleHarness {
  artifact: WildfireHazardFeatureCollection;
  createController: () => ReturnType<
    typeof createWildfireHazardOverlayLifecycle
  >;
  loadArtifact: ReturnType<typeof vi.fn>;
  loadMetadata: ReturnType<typeof vi.fn>;
  metadata: WildfireHazardMetadata;
  renderer: {
    destroy: ReturnType<typeof vi.fn>;
    install: ReturnType<typeof vi.fn>;
    rollback: ReturnType<typeof vi.fn>;
    setVisible: ReturnType<typeof vi.fn>;
  };
  states: WildfireHazardOverlayState[];
}

function createArtifact(): {
  features: Array<{
    geometry: { coordinates: number[][][]; type: "Polygon" };
    properties: {
      designationStatus: string;
      responsibilityArea: string;
      severity: string;
      sourceVersion: string;
    };
    type: "Feature";
  }>;
  type: "FeatureCollection";
} {
  return {
    type: "FeatureCollection",
    features: ["moderate", "high", "very-high"].map((severity, index) => ({
      type: "Feature",
      properties: {
        designationStatus: index === 0 ? "recommended" : "locally-adopted",
        responsibilityArea: "lra",
        severity,
        sourceVersion: "FHSZLRA25_1",
      },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-117.6 + index * 0.01, 33.9],
            [-117.5 + index * 0.01, 33.9],
            [-117.5 + index * 0.01, 34],
            [-117.6 + index * 0.01, 33.9],
          ],
        ],
      },
    })),
  };
}

function createMetadata(): WildfireHazardMetadata {
  return {
    artifactVersion: "2025.1",
    snapshotAt: "2026-08-22T00:29:56Z",
    sourceName: "CAL FIRE / Office of the State Fire Marshal",
    sourceUrl:
      "https://osfm.fire.ca.gov/what-we-do/community-wildfire-preparedness-and-mitigation/fire-hazard-severity-zones",
    sourceVersions: { lra: "FHSZLRA25_1", sra: "FHSZSRA_23_3" },
    jurisdictions: [
      { name: "Chino", status: "locally-adopted" },
      { name: "Chino Hills", status: "locally-adopted" },
      { name: "Corona", status: "locally-adopted" },
      { name: "Eastvale", status: "recommended" },
      { name: "Jurupa Valley", status: "locally-adopted" },
    ],
    coverageTargets: [],
  };
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: (value) => resolvePromise?.(value),
  };
}
