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
const targetDesignationStatuses = new Set([
  "recommended",
  "locally-adopted",
]);
const coverageTargetKinds = new Set([
  "incorporated-jurisdiction",
  "market-context",
]);
const sha256Pattern = /^[a-f0-9]{64}$/;
const identifierPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

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
  coverageTargets = [],
  quality,
}) {
  validateManifestArtifact(
    artifact,
    artifactFileName,
    artifactVersion,
    snapshotAt,
  );
  requireNonEmptyString(gdalImage, "GDAL image");
  requireNonEmptyString(nodeVersion, "Node version");

  const sourceIds = validateManifestSources(sources);
  const evidenceIds = validateDesignationEvidence(designationEvidence);
  validateCoverageTargets(coverageTargets, sourceIds, evidenceIds);

  return {
    schemaVersion: 2,
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
    coverageTargets: coverageTargets.map(toManifestCoverageTarget),
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

function toManifestCoverageTarget(target) {
  return {
    id: target.id,
    label: target.label,
    kind: target.kind,
    boundarySourceId: target.boundarySourceId,
    lraDesignationStatus: target.lraDesignationStatus,
    evidenceId: target.evidenceId,
    coverageDisclosure: target.coverageDisclosure,
    ...(target.productSelector === undefined
      ? {}
      : { productSelector: { ...target.productSelector } }),
  };
}

function validateManifestArtifact(
  artifact,
  artifactFileName,
  artifactVersion,
  snapshotAt,
) {
  if (
    typeof artifactFileName !== "string" ||
    artifactFileName.trim() !== artifactFileName ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.geojson$/.test(artifactFileName)
  ) {
    throw new Error("A safe GeoJSON artifact filename is required.");
  }
  requireNonEmptyString(artifactVersion, "artifact version");
  const snapshot = requireNonEmptyString(snapshotAt, "snapshot timestamp");
  if (Number.isNaN(Date.parse(snapshot))) {
    throw new Error("The wildfire hazard snapshot timestamp is invalid.");
  }
  if (
    typeof artifact?.json !== "string" ||
    !sha256Pattern.test(artifact?.sha256)
  ) {
    throw new Error("A valid wildfire hazard artifact is required.");
  }
  if (sha256Text(artifact.json) !== artifact.sha256) {
    throw new Error("Wildfire hazard artifact SHA-256 does not match its bytes.");
  }

  const statistics = artifact.statistics;
  if (Buffer.byteLength(artifact.json) !== statistics?.rawBytes) {
    throw new Error("Wildfire hazard artifact raw byte count is inconsistent.");
  }
  if (
    gzipSync(artifact.json, { level: 9, mtime: 0 }).byteLength !==
    statistics?.gzipBytes
  ) {
    throw new Error("Wildfire hazard artifact gzip byte count is inconsistent.");
  }
  requireNonNegativeInteger(statistics?.featureCount, "feature count");
  requireNonNegativeInteger(statistics?.coordinateCount, "coordinate count");
  requireNonNegativeInteger(statistics?.gzipBytes, "gzip byte count");
  validateCountRecord(
    statistics?.severityCounts,
    severityOrder.keys(),
    statistics.featureCount,
    "severity",
  );
  validateCountRecord(
    statistics?.responsibilityAreaCounts,
    responsibilityAreas,
    statistics.featureCount,
    "responsibility area",
  );
  validateCountRecord(
    statistics?.designationStatusCounts,
    designationStatuses,
    statistics.featureCount,
    "designation status",
  );
}

function validateManifestSources(sources) {
  if (!Array.isArray(sources) || sources.length === 0) {
    throw new Error("At least one provenance source is required.");
  }

  const sourceIds = new Set();
  const canonicalUrls = new Map();
  for (const source of sources) {
    const id = requireIdentifier(source?.id, "provenance source id");
    if (sourceIds.has(id)) {
      throw new Error(`Duplicate provenance source id: ${id}.`);
    }
    sourceIds.add(id);
    requireNonEmptyString(source.title, `source ${id} title`);
    canonicalUrls.set(
      id,
      requireHttpsUrl(source.canonicalUrl, `source ${id} canonical URL`),
    );
    if (source.downloadUrl !== undefined) {
      requireHttpsUrl(source.downloadUrl, `source ${id} download URL`);
    }
    if (!sha256Pattern.test(source.sha256)) {
      throw new Error(`Source ${id} has an invalid SHA-256.`);
    }
    requireNonEmptyString(source.version, `source ${id} version`);
    requireNonEmptyString(source.license, `source ${id} license`);
    requireNonEmptyString(source.attribution, `source ${id} attribution`);
  }

  if (!sourceIds.has("lra") || !sourceIds.has("sra")) {
    throw new Error("Both LRA and SRA provenance sources are required.");
  }
  if (canonicalUrls.get("lra") !== canonicalUrls.get("sra")) {
    throw new Error("LRA and SRA must share one canonical source.");
  }
  return sourceIds;
}

function validateDesignationEvidence(designationEvidence) {
  if (!Array.isArray(designationEvidence) || designationEvidence.length === 0) {
    throw new Error("At least one designation evidence record is required.");
  }

  const evidenceIds = new Set();
  for (const evidence of designationEvidence) {
    const id = requireIdentifier(evidence?.id, "designation evidence id");
    if (evidenceIds.has(id)) {
      throw new Error(`Duplicate designation evidence id: ${id}.`);
    }
    evidenceIds.add(id);
    requireNonEmptyString(evidence.title, `designation evidence ${id} title`);
    requireHttpsUrl(
      evidence.url,
      `HTTPS designation evidence URL for ${id}`,
    );
    requireNonEmptyString(
      evidence.finding,
      `designation evidence ${id} finding`,
    );
  }
  return evidenceIds;
}

function validateCoverageTargets(coverageTargets, sourceIds, evidenceIds) {
  if (!Array.isArray(coverageTargets) || coverageTargets.length === 0) {
    throw new Error("At least one wildfire hazard coverage target is required.");
  }

  const targetIds = new Set();
  const targetLabels = new Set();
  for (const target of coverageTargets) {
    const id = requireIdentifier(target?.id, "coverage target id");
    if (targetIds.has(id)) {
      throw new Error(`Duplicate coverage target id: ${id}.`);
    }
    targetIds.add(id);

    const label = requireNonEmptyString(target.label, `coverage target ${id} label`);
    if (targetLabels.has(label)) {
      throw new Error(`Duplicate coverage target label: ${label}.`);
    }
    targetLabels.add(label);

    if (!coverageTargetKinds.has(target.kind)) {
      throw new Error(`Unsupported coverage target kind: ${String(target.kind)}.`);
    }
    const boundarySourceId = requireIdentifier(
      target.boundarySourceId,
      `coverage target ${id} boundary source id`,
    );
    if (!sourceIds.has(boundarySourceId)) {
      throw new Error(
        `Coverage target ${id} references unknown boundary source ${boundarySourceId}.`,
      );
    }
    if (!targetDesignationStatuses.has(target.lraDesignationStatus)) {
      throw new Error(
        "Unsupported coverage target designation status.",
      );
    }
    const evidenceId = requireIdentifier(
      target.evidenceId,
      `coverage target ${id} evidence id`,
    );
    if (!evidenceIds.has(evidenceId)) {
      throw new Error(
        `Coverage target ${id} references unknown designation evidence ${evidenceId}.`,
      );
    }
    requireNonEmptyString(
      target.coverageDisclosure,
      `coverage target ${id} disclosure`,
    );
    validateProductSelector(target);
  }
}

function validateProductSelector(target) {
  if (target.kind === "incorporated-jurisdiction") {
    if (target.productSelector !== undefined) {
      throw new Error(
        "Incorporated-jurisdiction targets cannot define a product selector.",
      );
    }
    return;
  }

  if (
    target.productSelector?.kind !== "zip" ||
    !/^\d{5}$/.test(target.productSelector?.value)
  ) {
    throw new Error("Market-context targets require a five-digit ZIP selector.");
  }
}

function validateCountRecord(value, allowedKeys, featureCount, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Wildfire hazard ${label} counts are required.`);
  }
  const allowed = new Set(allowedKeys);
  const keys = Object.keys(value);
  if (keys.some((key) => !allowed.has(key))) {
    throw new Error(`Wildfire hazard ${label} counts contain an unknown key.`);
  }
  const total = [...allowed].reduce((sum, key) => {
    requireNonNegativeInteger(value[key], `${label} count for ${key}`);
    return sum + value[key];
  }, 0);
  if (total !== featureCount) {
    throw new Error(`Wildfire hazard ${label} counts do not match feature count.`);
  }
}

function requireIdentifier(value, label) {
  const identifier = requireNonEmptyString(value, label);
  if (!identifierPattern.test(identifier)) {
    throw new Error(`Wildfire hazard ${label} is invalid.`);
  }
  return identifier;
}

function requireHttpsUrl(value, label) {
  const url = requireNonEmptyString(value, label);
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`A ${label} is required.`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`A ${label} is required.`);
  }
  return parsed.toString().replace(/\/$/, "");
}

function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Wildfire hazard ${label} is required.`);
  }
  return value;
}

function requireNonNegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Wildfire hazard ${label} must be a non-negative integer.`);
  }
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
