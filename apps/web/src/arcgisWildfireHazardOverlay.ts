import type Layer from "@arcgis/core/layers/Layer.js";
import GeoJSONLayer from "@arcgis/core/layers/GeoJSONLayer.js";
import type { UniqueValueRendererProperties } from "@arcgis/core/renderers/UniqueValueRenderer.js";
import type { SimpleFillSymbolProperties } from "@arcgis/core/symbols/SimpleFillSymbol.js";

import {
  loadWildfireHazardMetadata,
  type WildfireHazardMetadata,
} from "./wildfireHazardMetadata.js";
import {
  createWildfireHazardOverlayLifecycle,
  loadWildfireHazardArtifact,
  WILDFIRE_HAZARD_SEVERITY_STYLES,
  type LoadWildfireHazardArtifact,
  type WildfireHazardFeatureCollection,
  type WildfireHazardOverlayController,
  type WildfireHazardOverlayRenderer,
  type WildfireHazardOverlayState,
  type WildfireHazardSeverity,
} from "./wildfireHazardOverlay.js";

export const ARCGIS_WILDFIRE_HAZARD_LAYER_ID = "cpi-wildfire-hazard";

const severities = ["moderate", "high", "very-high"] as const;

export interface ArcgisWildfireHazardMap {
  add: (layer: Layer, index?: number) => unknown;
  findLayerById: (id: string) => Layer | null | undefined;
  remove: (layer: Layer) => unknown;
}

export interface CreateArcgisWildfireHazardOverlayOptions {
  map: ArcgisWildfireHazardMap;
  onStateChange?: (state: WildfireHazardOverlayState) => void;
}

export interface ArcgisWildfireHazardOverlayDependencies {
  createLayer: (objectUrl: string) => GeoJSONLayer;
  createObjectUrl: (artifact: WildfireHazardFeatureCollection) => string;
  loadArtifact: LoadWildfireHazardArtifact;
  loadMetadata: (signal: AbortSignal) => Promise<WildfireHazardMetadata>;
  revokeObjectUrl: (objectUrl: string) => void;
}

const defaultDependencies: ArcgisWildfireHazardOverlayDependencies = {
  createLayer: createArcgisWildfireHazardLayer,
  createObjectUrl: createWildfireHazardObjectUrl,
  loadArtifact: loadWildfireHazardArtifact,
  loadMetadata: loadWildfireHazardMetadata,
  revokeObjectUrl: (objectUrl) => URL.revokeObjectURL(objectUrl),
};

export function createArcgisWildfireHazardOverlayController(
  options: CreateArcgisWildfireHazardOverlayOptions,
): WildfireHazardOverlayController {
  return createArcgisWildfireHazardOverlayControllerWithDependencies(
    options,
    defaultDependencies,
  );
}

export function createArcgisWildfireHazardOverlayControllerWithDependencies(
  {
    map,
    onStateChange = () => undefined,
  }: CreateArcgisWildfireHazardOverlayOptions,
  dependencies: ArcgisWildfireHazardOverlayDependencies,
): WildfireHazardOverlayController {
  return createWildfireHazardOverlayLifecycle({
    loadArtifact: dependencies.loadArtifact,
    loadMetadata: dependencies.loadMetadata,
    onStateChange,
    renderer: createArcgisWildfireHazardRenderer(map, dependencies),
  });
}

export function createArcgisWildfireHazardLayer(
  objectUrl: string,
): GeoJSONLayer {
  return new GeoJSONLayer({
    copyright: "CAL FIRE / OSFM",
    id: ARCGIS_WILDFIRE_HAZARD_LAYER_ID,
    legendEnabled: false,
    listMode: "hide",
    outFields: ["severity"],
    popupEnabled: false,
    renderer: createSeverityRenderer(),
    title: "Fire Hazard Severity Zones",
    url: objectUrl,
    visible: false,
  });
}

function createArcgisWildfireHazardRenderer(
  map: ArcgisWildfireHazardMap,
  dependencies: ArcgisWildfireHazardOverlayDependencies,
): WildfireHazardOverlayRenderer {
  let layer: GeoJSONLayer | null = null;
  let layerAdded = false;
  let objectUrl: string | null = null;

  return {
    destroy: rollback,
    install: async (artifact, signal) => {
      if (
        layer !== null ||
        objectUrl !== null ||
        map.findLayerById(ARCGIS_WILDFIRE_HAZARD_LAYER_ID) != null
      ) {
        throw new Error("Wildfire hazard layer already exists.");
      }

      objectUrl = dependencies.createObjectUrl(artifact);
      try {
        layer = dependencies.createLayer(objectUrl);
        await layer.load();
        if (signal.aborted) {
          return;
        }
        layerAdded = true;
        map.add(layer, 0);
      } catch (error) {
        rollback();
        throw error;
      }
    },
    rollback,
    setVisible: (visible) => {
      if (layer === null || !layerAdded) {
        throw new Error("Wildfire hazard layer is unavailable.");
      }
      layer.visible = visible;
    },
  };

  function rollback(): void {
    const currentLayer = layer;
    const currentObjectUrl = objectUrl;
    const removeLayer = layerAdded;
    layer = null;
    layerAdded = false;
    objectUrl = null;

    if (currentLayer !== null) {
      if (removeLayer) {
        try {
          map.remove(currentLayer);
        } catch {
          // The map may already be tearing down.
        }
      }
      try {
        currentLayer.destroy();
      } catch {
        // Layer destruction is best-effort during rollback.
      }
    }
    if (currentObjectUrl !== null) {
      try {
        dependencies.revokeObjectUrl(currentObjectUrl);
      } catch {
        // URL revocation is best-effort during rollback.
      }
    }
  }
}

function createSeverityRenderer(): UniqueValueRendererProperties & {
  type: "unique-value";
} {
  return {
    defaultSymbol: null,
    field: "severity",
    type: "unique-value",
    uniqueValueInfos: severities.map((severity) => ({
      label: severityLabel(severity),
      symbol: createSeveritySymbol(severity),
      value: severity,
    })),
  };
}

function createSeveritySymbol(
  severity: WildfireHazardSeverity,
): SimpleFillSymbolProperties & { type: "simple-fill" } {
  const style = WILDFIRE_HAZARD_SEVERITY_STYLES[severity];
  return {
    color: colorWithOpacity(style.fillColor, style.fillOpacity),
    outline: {
      color: colorWithOpacity(style.outlineColor, style.outlineOpacity),
      type: "simple-line",
      width: `${style.outlineWidth}px`,
    },
    style: "solid",
    type: "simple-fill",
  };
}

function colorWithOpacity(
  hex: string,
  opacity: number,
): readonly [number, number, number, number] {
  const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/iu.exec(hex);
  if (match === null) {
    throw new Error("Invalid wildfire hazard color.");
  }
  return [
    Number.parseInt(match[1] ?? "", 16),
    Number.parseInt(match[2] ?? "", 16),
    Number.parseInt(match[3] ?? "", 16),
    opacity,
  ];
}

function severityLabel(severity: WildfireHazardSeverity): string {
  if (severity === "very-high") {
    return "Very High";
  }
  return severity === "high" ? "High" : "Moderate";
}

function createWildfireHazardObjectUrl(
  artifact: WildfireHazardFeatureCollection,
): string {
  return URL.createObjectURL(
    new Blob([JSON.stringify(artifact)], { type: "application/geo+json" }),
  );
}
