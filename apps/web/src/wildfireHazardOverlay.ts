import type { AddLayerObject, Map as MapLibreMap } from "maplibre-gl";

import {
  loadWildfireHazardMetadata,
  type WildfireHazardMetadata,
} from "./wildfireHazardMetadata.js";

export const WILDFIRE_HAZARD_ARTIFACT_URL =
  "/data/wildfire-hazard/fhsz-five-cities-2025.1.geojson";
export const WILDFIRE_HAZARD_SOURCE_ID = "cpi-wildfire-hazard-source";
export const WILDFIRE_HAZARD_FILL_LAYER_ID = "cpi-wildfire-hazard-fill";
export const WILDFIRE_HAZARD_OUTLINE_LAYER_IDS = {
  moderate: "cpi-wildfire-hazard-outline-moderate",
  high: "cpi-wildfire-hazard-outline-high",
  "very-high": "cpi-wildfire-hazard-outline-very-high",
} as const;
export const WILDFIRE_HAZARD_LAYER_IDS = [
  WILDFIRE_HAZARD_FILL_LAYER_ID,
  WILDFIRE_HAZARD_OUTLINE_LAYER_IDS.moderate,
  WILDFIRE_HAZARD_OUTLINE_LAYER_IDS.high,
  WILDFIRE_HAZARD_OUTLINE_LAYER_IDS["very-high"],
] as const;

const acceptedSeverities = new Set<WildfireHazardSeverity>([
  "moderate",
  "high",
  "very-high",
]);
const acceptedResponsibilityAreas = new Set<WildfireHazardResponsibilityArea>([
  "lra",
  "sra",
]);
const acceptedDesignationStatuses = new Set<WildfireHazardDesignationStatus>([
  "effective",
  "recommended",
  "locally-adopted",
]);

export type WildfireHazardSeverity = "moderate" | "high" | "very-high";
export type WildfireHazardResponsibilityArea = "lra" | "sra";
export type WildfireHazardDesignationStatus =
  | "effective"
  | "recommended"
  | "locally-adopted";

export const WILDFIRE_HAZARD_SEVERITY_STYLES = {
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
} as const satisfies Record<
  WildfireHazardSeverity,
  {
    fillColor: string;
    fillOpacity: number;
    outlineColor: string;
    outlineOpacity: number;
    outlineWidth: number;
  }
>;

export interface WildfireHazardFeatureCollection {
  type: "FeatureCollection";
  features: WildfireHazardFeature[];
}

export interface WildfireHazardFeature {
  type: "Feature";
  properties: {
    designationStatus: WildfireHazardDesignationStatus;
    responsibilityArea: WildfireHazardResponsibilityArea;
    severity: WildfireHazardSeverity;
    sourceVersion: string;
  };
  geometry: WildfireHazardGeometry;
}

export type WildfireHazardGeometry =
  | {
      type: "Polygon";
      coordinates: WildfireHazardPosition[][];
    }
  | {
      type: "MultiPolygon";
      coordinates: WildfireHazardPosition[][][];
    };

export type WildfireHazardPosition = [number, number];

export type WildfireHazardOverlayState =
  | { status: "idle"; visible: false }
  | { status: "loading"; visible: false }
  | {
      status: "ready";
      visible: boolean;
      metadata: WildfireHazardMetadata;
    }
  | { status: "error"; visible: false };

export interface WildfireHazardOverlayController {
  setVisible: (visible: boolean) => Promise<void>;
  destroy: () => void;
}

export interface WildfireHazardMap {
  addLayer: (layer: WildfireHazardLayer, beforeId?: string) => unknown;
  addSource: (id: string, source: unknown) => unknown;
  getLayer: (id: string) => WildfireHazardLayer | undefined;
  getSource: (id: string) => unknown;
  removeLayer: (id: string) => unknown;
  removeSource: (id: string) => unknown;
  setLayoutProperty: (
    id: string,
    property: "visibility",
    value: "none" | "visible",
  ) => unknown;
}

export interface WildfireHazardLayer {
  id: string;
  type: "fill" | "line";
  source: string;
  filter?: unknown;
  layout: { visibility: "none" | "visible" };
  paint: Record<string, unknown>;
}

export type LoadWildfireHazardArtifact = (
  signal: AbortSignal,
) => Promise<WildfireHazardFeatureCollection>;

export interface WildfireHazardOverlayRenderer {
  destroy: () => void;
  install: (
    artifact: WildfireHazardFeatureCollection,
    signal: AbortSignal,
  ) => Promise<void> | void;
  rollback: () => void;
  setVisible: (visible: boolean) => void;
}

export interface CreateWildfireHazardOverlayLifecycleOptions {
  loadArtifact?: LoadWildfireHazardArtifact;
  loadMetadata?: typeof loadWildfireHazardMetadata;
  onStateChange?: (state: WildfireHazardOverlayState) => void;
  renderer: WildfireHazardOverlayRenderer;
}

interface CreateWildfireHazardOverlayControllerOptions {
  map: WildfireHazardMap;
  beforeLayerId: string;
  loadArtifact?: LoadWildfireHazardArtifact;
  loadMetadata?: typeof loadWildfireHazardMetadata;
  onStateChange?: (state: WildfireHazardOverlayState) => void;
}

export function createWildfireHazardOverlayController({
  beforeLayerId,
  loadArtifact = loadWildfireHazardArtifact,
  loadMetadata = loadWildfireHazardMetadata,
  map,
  onStateChange = () => undefined,
}: CreateWildfireHazardOverlayControllerOptions): WildfireHazardOverlayController {
  return createWildfireHazardOverlayLifecycle({
    loadArtifact,
    loadMetadata,
    onStateChange,
    renderer: createMapLibreWildfireHazardRenderer(map, beforeLayerId),
  });
}

export function createWildfireHazardOverlayLifecycle({
  loadArtifact = loadWildfireHazardArtifact,
  loadMetadata = loadWildfireHazardMetadata,
  onStateChange = () => undefined,
  renderer,
}: CreateWildfireHazardOverlayLifecycleOptions): WildfireHazardOverlayController {
  let abortController: AbortController | null = null;
  let desiredVisibility = false;
  let destroyed = false;
  let installed = false;
  let loadPromise: Promise<void> | null = null;
  let metadata: WildfireHazardMetadata | null = null;
  let state: WildfireHazardOverlayState = {
    status: "idle",
    visible: false,
  };

  onStateChange(state);

  return {
    setVisible: async (visible) => {
      if (destroyed) {
        return;
      }

      desiredVisibility = visible;
      if (installed) {
        try {
          if (metadata === null) {
            throw new Error("Wildfire hazard metadata is unavailable.");
          }
          renderer.setVisible(visible);
          updateState({ status: "ready", visible, metadata });
        } catch {
          rollbackInstallation();
          desiredVisibility = false;
          updateState({ status: "error", visible: false });
        }
        return;
      }

      if (!visible) {
        updateState(
          loadPromise === null
            ? { status: "idle", visible: false }
            : { status: "loading", visible: false },
        );
        return;
      }

      if (loadPromise === null) {
        abortController = new AbortController();
        const currentAbortController = abortController;
        updateState({ status: "loading", visible: false });

        const currentLoad = Promise.resolve()
          .then(() => {
            if (destroyed || currentAbortController.signal.aborted) {
              return null;
            }
            return Promise.all([
              loadArtifact(currentAbortController.signal),
              loadMetadata(currentAbortController.signal),
            ]);
          })
          .then((bundle) => {
            if (
              bundle === null ||
              destroyed ||
              currentAbortController.signal.aborted
            ) {
              return;
            }
            const [artifact, loadedMetadata] = bundle;
            return Promise.resolve(
              renderer.install(artifact, currentAbortController.signal),
            ).then(() => loadedMetadata);
          })
          .then((loadedMetadata) => {
            if (
              loadedMetadata === undefined ||
              destroyed ||
              currentAbortController.signal.aborted
            ) {
              rollbackInstallation();
              return;
            }
            installed = true;
            metadata = loadedMetadata;
            renderer.setVisible(desiredVisibility);
            updateState({
              status: "ready",
              visible: desiredVisibility,
              metadata,
            });
          })
          .catch(() => {
            rollbackInstallation();
            if (destroyed || currentAbortController.signal.aborted) {
              return;
            }
            desiredVisibility = false;
            updateState({ status: "error", visible: false });
          })
          .finally(() => {
            if (loadPromise === currentLoad) {
              loadPromise = null;
              abortController = null;
            }
          });
        loadPromise = currentLoad;
      }

      await loadPromise;
    },
    destroy: () => {
      if (destroyed) {
        return;
      }
      destroyed = true;
      abortController?.abort();
      installed = false;
      metadata = null;
      renderer.destroy();
    },
  };

  function rollbackInstallation(): void {
    installed = false;
    metadata = null;
    renderer.rollback();
  }

  function updateState(nextState: WildfireHazardOverlayState): void {
    if (
      state.status === nextState.status &&
      state.visible === nextState.visible
    ) {
      return;
    }
    state = nextState;
    onStateChange(state);
  }
}

export async function loadWildfireHazardArtifact(
  signal: AbortSignal,
): Promise<WildfireHazardFeatureCollection> {
  const response = await fetch(WILDFIRE_HAZARD_ARTIFACT_URL, { signal });
  if (!response.ok) {
    throw new Error("Wildfire hazard artifact is unavailable.");
  }
  return parseWildfireHazardArtifact(await response.json());
}

export function parseWildfireHazardArtifact(
  value: unknown,
): WildfireHazardFeatureCollection {
  if (
    !isRecord(value) ||
    value.type !== "FeatureCollection" ||
    !Array.isArray(value.features) ||
    value.features.length === 0
  ) {
    throw new Error("Expected a non-empty wildfire hazard FeatureCollection.");
  }

  for (const feature of value.features) {
    validateFeature(feature);
  }
  return value as unknown as WildfireHazardFeatureCollection;
}

export function createMapLibreWildfireHazardMapAdapter(
  map: MapLibreMap,
): WildfireHazardMap {
  return {
    addLayer: (layer, beforeId) =>
      map.addLayer(layer as AddLayerObject, beforeId),
    addSource: (id, source) =>
      map.addSource(
        id,
        source as Parameters<MapLibreMap["addSource"]>[1],
      ),
    getLayer: (id) =>
      map.getLayer(id) as unknown as WildfireHazardLayer | undefined,
    getSource: (id) => map.getSource(id),
    removeLayer: (id) => map.removeLayer(id),
    removeSource: (id) => map.removeSource(id),
    setLayoutProperty: (id, property, value) =>
      map.setLayoutProperty(id, property, value),
  };
}

function createMapLibreWildfireHazardRenderer(
  map: WildfireHazardMap,
  beforeLayerId: string,
): WildfireHazardOverlayRenderer {
  let sourceAdded = false;
  const addedLayerIds: string[] = [];

  return {
    destroy: () => rollback(),
    install: (artifact) => {
      if (map.getSource(WILDFIRE_HAZARD_SOURCE_ID) !== undefined) {
        throw new Error("Wildfire hazard source already exists.");
      }
      if (
        WILDFIRE_HAZARD_LAYER_IDS.some(
          (layerId) => map.getLayer(layerId) !== undefined,
        )
      ) {
        throw new Error("Wildfire hazard layer already exists.");
      }

      map.addSource(WILDFIRE_HAZARD_SOURCE_ID, {
        type: "geojson",
        data: artifact,
      });
      sourceAdded = true;

      for (const layer of createLayerSpecifications()) {
        addedLayerIds.push(layer.id);
        map.addLayer(layer, beforeLayerId);
      }
    },
    rollback,
    setVisible: (visible) => setLayerVisibility(map, visible),
  };

  function rollback(): void {
    for (const layerId of [...addedLayerIds].reverse()) {
      if (map.getLayer(layerId) !== undefined) {
        try {
          map.removeLayer(layerId);
        } catch {
          // The map may already be tearing down.
        }
      }
    }
    addedLayerIds.length = 0;

    if (sourceAdded && map.getSource(WILDFIRE_HAZARD_SOURCE_ID) !== undefined) {
      try {
        map.removeSource(WILDFIRE_HAZARD_SOURCE_ID);
      } catch {
        // The map may already be tearing down.
      }
    }
    sourceAdded = false;
  }
}

function createLayerSpecifications(): WildfireHazardLayer[] {
  const moderate = WILDFIRE_HAZARD_SEVERITY_STYLES.moderate;
  const high = WILDFIRE_HAZARD_SEVERITY_STYLES.high;
  const veryHigh = WILDFIRE_HAZARD_SEVERITY_STYLES["very-high"];
  return [
    {
      id: WILDFIRE_HAZARD_FILL_LAYER_ID,
      type: "fill",
      source: WILDFIRE_HAZARD_SOURCE_ID,
      layout: { visibility: "none" },
      paint: {
        "fill-color": [
          "match",
          ["get", "severity"],
          "moderate",
          moderate.fillColor,
          "high",
          high.fillColor,
          "very-high",
          veryHigh.fillColor,
          "rgba(0, 0, 0, 0)",
        ],
        "fill-opacity": [
          "match",
          ["get", "severity"],
          "moderate",
          moderate.fillOpacity,
          "high",
          high.fillOpacity,
          "very-high",
          veryHigh.fillOpacity,
          0,
        ],
      },
    },
    createOutlineLayer(
      "moderate",
      WILDFIRE_HAZARD_OUTLINE_LAYER_IDS.moderate,
      moderate.outlineColor,
      moderate.outlineWidth,
      moderate.outlineOpacity,
    ),
    createOutlineLayer(
      "high",
      WILDFIRE_HAZARD_OUTLINE_LAYER_IDS.high,
      high.outlineColor,
      high.outlineWidth,
      high.outlineOpacity,
    ),
    createOutlineLayer(
      "very-high",
      WILDFIRE_HAZARD_OUTLINE_LAYER_IDS["very-high"],
      veryHigh.outlineColor,
      veryHigh.outlineWidth,
      veryHigh.outlineOpacity,
    ),
  ];
}

function createOutlineLayer(
  severity: WildfireHazardSeverity,
  id: string,
  color: string,
  width: number,
  opacity: number,
): WildfireHazardLayer {
  return {
    id,
    type: "line",
    source: WILDFIRE_HAZARD_SOURCE_ID,
    filter: ["==", ["get", "severity"], severity],
    layout: { visibility: "none" },
    paint: {
      "line-color": color,
      "line-opacity": opacity,
      "line-width": width,
    },
  };
}

function setLayerVisibility(map: WildfireHazardMap, visible: boolean): void {
  const visibility = visible ? "visible" : "none";
  for (const layerId of WILDFIRE_HAZARD_LAYER_IDS) {
    if (map.getLayer(layerId) === undefined) {
      throw new Error(`Missing wildfire hazard layer: ${layerId}.`);
    }
    map.setLayoutProperty(layerId, "visibility", visibility);
  }
}

function validateFeature(value: unknown): asserts value is WildfireHazardFeature {
  if (!isRecord(value) || value.type !== "Feature") {
    throw new Error("Expected a wildfire hazard Feature.");
  }
  validateProperties(value.properties);
  validateGeometry(value.geometry);
}

function validateProperties(value: unknown): void {
  if (!isRecord(value)) {
    throw new Error("Wildfire hazard properties are required.");
  }
  if (!acceptedSeverities.has(value.severity as WildfireHazardSeverity)) {
    throw new Error("Unsupported wildfire hazard severity.");
  }
  if (
    !acceptedResponsibilityAreas.has(
      value.responsibilityArea as WildfireHazardResponsibilityArea,
    )
  ) {
    throw new Error("Unsupported wildfire hazard responsibility area.");
  }
  if (
    !acceptedDesignationStatuses.has(
      value.designationStatus as WildfireHazardDesignationStatus,
    )
  ) {
    throw new Error("Unsupported wildfire hazard designation status.");
  }
  if (
    typeof value.sourceVersion !== "string" ||
    value.sourceVersion.trim() === ""
  ) {
    throw new Error("Wildfire hazard source version is required.");
  }
}

function validateGeometry(value: unknown): void {
  if (!isRecord(value)) {
    throw new Error("Wildfire hazard geometry is required.");
  }
  if (value.type === "Polygon") {
    validatePolygonCoordinates(value.coordinates);
    return;
  }
  if (value.type === "MultiPolygon") {
    if (!Array.isArray(value.coordinates) || value.coordinates.length === 0) {
      throw new Error("MultiPolygon geometry must contain polygons.");
    }
    for (const polygon of value.coordinates) {
      validatePolygonCoordinates(polygon);
    }
    return;
  }
  throw new Error("Wildfire hazard geometry must be Polygon or MultiPolygon.");
}

function validatePolygonCoordinates(value: unknown): void {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Polygon geometry must contain rings.");
  }
  for (const ring of value) {
    if (!Array.isArray(ring) || ring.length < 4) {
      throw new Error("Polygon rings must contain at least four positions.");
    }
    for (const position of ring) {
      validatePosition(position);
    }
    const first = ring[0];
    const last = ring.at(-1);
    if (
      !Array.isArray(first) ||
      !Array.isArray(last) ||
      first[0] !== last[0] ||
      first[1] !== last[1]
    ) {
      throw new Error("Polygon rings must be closed.");
    }
  }
}

function validatePosition(value: unknown): void {
  if (
    !Array.isArray(value) ||
    value.length < 2 ||
    !Number.isFinite(value[0]) ||
    !Number.isFinite(value[1])
  ) {
    throw new Error("Wildfire hazard positions require finite coordinates.");
  }
  const [longitude, latitude] = value as [number, number];
  if (
    longitude < -180 ||
    longitude > 180 ||
    latitude < -90 ||
    latitude > 90
  ) {
    throw new Error("Wildfire hazard coordinates are outside WGS84 bounds.");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
