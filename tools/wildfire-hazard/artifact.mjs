import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

const severityBySourceValue = new Map([
  ["Moderate", "moderate"],
  ["High", "high"],
  ["Very High", "very-high"],
]);

const severityOrder = new Map([
  ["moderate", 0],
  ["high", 1],
  ["very-high", 2],
]);

const responsibilityAreas = new Set(["sra", "lra"]);
const designationStatuses = new Set([
  "effective",
  "recommended",
  "locally-adopted",
]);

export function buildWildfireHazardArtifact(sources) {
  if (!Array.isArray(sources) || sources.length === 0) {
    throw new Error("At least one wildfire hazard source is required.");
  }

  const statistics = createEmptyStatistics();
  const features = [];

  for (const source of sources) {
    validateSource(source);

    for (const feature of source.featureCollection.features) {
      const sourceSeverity = feature?.properties?.FHSZ;

      if (sourceSeverity === "NonWildland") {
        statistics.excludedNonWildlandCount += 1;
        continue;
      }

      const severity = severityBySourceValue.get(sourceSeverity);
      if (severity === undefined) {
        throw new Error(
          `Unknown FHSZ severity: ${String(sourceSeverity)}.`,
        );
      }

      const geometry = normalizeGeometry(feature.geometry);
      const normalizedFeature = {
        type: "Feature",
        properties: {
          severity,
          responsibilityArea: source.responsibilityArea,
          designationStatus: source.designationStatus,
          sourceVersion: source.sourceVersion,
        },
        geometry,
      };

      statistics.featureCount += 1;
      statistics.severityCounts[severity] += 1;
      statistics.responsibilityAreaCounts[source.responsibilityArea] += 1;
      statistics.designationStatusCounts[source.designationStatus] += 1;
      collectGeometryStatistics(geometry, statistics);
      features.push(normalizedFeature);
    }
  }

  features.sort(compareFeatures);

  const collection = {
    type: "FeatureCollection",
    features,
  };
  const json = `${JSON.stringify(collection)}\n`;
  const sha256 = sha256Text(json);

  return {
    collection,
    json,
    sha256,
    statistics: {
      ...statistics,
      bounds: statistics.featureCount === 0 ? null : statistics.bounds,
      rawBytes: Buffer.byteLength(json),
      gzipBytes: gzipSync(json, { level: 9, mtime: 0 }).byteLength,
    },
  };
}

export function createWildfireHazardManifest({
  artifact,
  artifactFileName,
  artifactVersion,
  snapshotAt,
  gdalImage,
  nodeVersion = process.versions.node,
  sources,
  designationEvidence = [],
  targetJurisdictions = [],
  quality,
}) {
  if (!artifactFileName || !artifactVersion || !snapshotAt || !gdalImage) {
    throw new Error("Complete artifact and tooling metadata is required.");
  }

  if (!Array.isArray(sources) || sources.length === 0) {
    throw new Error("At least one provenance source is required.");
  }

  return {
    schemaVersion: 1,
    artifact: {
      fileName: artifactFileName,
      mediaType: "application/geo+json",
      version: artifactVersion,
      sha256: artifact.sha256,
      bytes: Buffer.byteLength(artifact.json),
      gzipBytes: artifact.statistics.gzipBytes,
      featureCount: artifact.statistics.featureCount,
      coordinateCount: artifact.statistics.coordinateCount,
      bounds: artifact.statistics.bounds,
      severityCounts: artifact.statistics.severityCounts,
      responsibilityAreaCounts:
        artifact.statistics.responsibilityAreaCounts,
      designationStatusCounts:
        artifact.statistics.designationStatusCounts,
    },
    generatedFromSnapshotAt: snapshotAt,
    tooling: {
      node: nodeVersion,
      gdalImage,
    },
    sources: sources.map((source) => ({ ...source })),
    designationEvidence: designationEvidence.map((evidence) => ({
      ...evidence,
    })),
    targetJurisdictions: targetJurisdictions.map((jurisdiction) => ({
      ...jurisdiction,
    })),
    quality,
    exclusions: {
      nonWildlandFeatureCount:
        artifact.statistics.excludedNonWildlandCount,
      unsupportedSeverities: "fail-build",
    },
    disclosures: [
      "Fire Hazard Severity Zones describe hazard, not current wildfire risk.",
      "Blank areas are not evidence of no hazard.",
      "This display artifact is not a parcel-level hazard determination.",
    ],
  };
}

export function serializeManifest(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function validateSource(source) {
  if (!responsibilityAreas.has(source?.responsibilityArea)) {
    throw new Error("Unknown responsibility area.");
  }

  if (!designationStatuses.has(source?.designationStatus)) {
    throw new Error("Unknown designation status.");
  }

  if (
    typeof source.sourceVersion !== "string" ||
    source.sourceVersion.trim() === ""
  ) {
    throw new Error("A non-empty source version is required.");
  }

  const collection = source.featureCollection;
  if (
    collection?.type !== "FeatureCollection" ||
    !Array.isArray(collection.features)
  ) {
    throw new Error("Expected a GeoJSON FeatureCollection.");
  }
}

function normalizeGeometry(geometry) {
  if (geometry?.type === "Polygon") {
    return {
      type: "Polygon",
      coordinates: normalizePolygonCoordinates(geometry.coordinates),
    };
  }

  if (geometry?.type === "MultiPolygon") {
    if (!Array.isArray(geometry.coordinates) || geometry.coordinates.length === 0) {
      throw new Error("MultiPolygon geometry must contain polygons.");
    }

    return {
      type: "MultiPolygon",
      coordinates: geometry.coordinates.map(normalizePolygonCoordinates),
    };
  }

  throw new Error("Wildfire hazard geometry must be Polygon or MultiPolygon.");
}

function normalizePolygonCoordinates(coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length === 0) {
    throw new Error("Polygon geometry must contain rings.");
  }

  return coordinates.map((ring) => {
    if (!Array.isArray(ring) || ring.length < 4) {
      throw new Error("Polygon rings must contain at least four positions.");
    }

    const normalizedRing = ring.map(normalizePosition);
    const first = normalizedRing[0];
    const last = normalizedRing[normalizedRing.length - 1];

    if (first[0] !== last[0] || first[1] !== last[1]) {
      throw new Error("Polygon rings must be closed.");
    }

    return normalizedRing;
  });
}

function normalizePosition(position) {
  if (
    !Array.isArray(position) ||
    position.length < 2 ||
    !Number.isFinite(position[0]) ||
    !Number.isFinite(position[1])
  ) {
    throw new Error("Every position requires finite longitude and latitude.");
  }

  const longitude = roundCoordinate(position[0]);
  const latitude = roundCoordinate(position[1]);
  if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
    throw new Error("Longitude or latitude is outside WGS84 bounds.");
  }

  return [longitude, latitude];
}

function roundCoordinate(value) {
  return Math.round(value * 10_000_000) / 10_000_000;
}

function compareFeatures(left, right) {
  const propertyComparison = compareStrings(
    featurePropertyKey(left),
    featurePropertyKey(right),
  );

  if (propertyComparison !== 0) {
    return propertyComparison;
  }

  return compareStrings(JSON.stringify(left.geometry), JSON.stringify(right.geometry));
}

function featurePropertyKey(feature) {
  const properties = feature.properties;
  return [
    properties.responsibilityArea,
    properties.designationStatus,
    String(severityOrder.get(properties.severity)).padStart(2, "0"),
    properties.sourceVersion,
  ].join(":");
}

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function createEmptyStatistics() {
  return {
    featureCount: 0,
    excludedNonWildlandCount: 0,
    coordinateCount: 0,
    ringCount: 0,
    bounds: [Infinity, Infinity, -Infinity, -Infinity],
    severityCounts: {
      moderate: 0,
      high: 0,
      "very-high": 0,
    },
    responsibilityAreaCounts: {
      sra: 0,
      lra: 0,
    },
    designationStatusCounts: {
      effective: 0,
      recommended: 0,
      "locally-adopted": 0,
    },
  };
}

function collectGeometryStatistics(geometry, statistics) {
  const polygons =
    geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;

  for (const polygon of polygons) {
    statistics.ringCount += polygon.length;
    for (const ring of polygon) {
      for (const [longitude, latitude] of ring) {
        statistics.coordinateCount += 1;
        statistics.bounds[0] = Math.min(statistics.bounds[0], longitude);
        statistics.bounds[1] = Math.min(statistics.bounds[1], latitude);
        statistics.bounds[2] = Math.max(statistics.bounds[2], longitude);
        statistics.bounds[3] = Math.max(statistics.bounds[3], latitude);
      }
    }
  }
}

function sha256Text(value) {
  return createHash("sha256").update(value).digest("hex");
}
