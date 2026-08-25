const coverageTargetKinds = new Set([
  "incorporated-jurisdiction",
  "market-context",
]);
const lraDesignationStatuses = new Set([
  "locally-adopted",
  "recommended",
]);

export function validateBuildConfig(config) {
  if (
    config?.publication?.enabled !== true &&
    config?.publication?.enabled !== false
  ) {
    throw new Error("Wildfire publication.enabled must be a boolean.");
  }

  const sourceIds = new Set();
  const sourcesById = new Map();
  for (const source of config.sources ?? []) {
    const id = requireIdentifier(source?.id, "source id");
    if (sourceIds.has(id)) {
      throw new Error(`Duplicate source id: ${id}.`);
    }
    sourceIds.add(id);
    sourcesById.set(id, source);

    requireSafeFileName(source.fileName, `source ${id} file name`);
    requireHttpsUrl(source.canonicalUrl, `source ${id} canonical URL`);
    if (source.downloadUrl !== undefined) {
      requireHttpsUrl(source.downloadUrl, `source ${id} download URL`);
    } else if (source.trackedPath === undefined) {
      throw new Error(`Remote source ${id} requires an HTTPS download URL.`);
    }
    if (!/^[a-f0-9]{64}$/.test(source.sha256)) {
      throw new Error(`Source ${id} has an invalid SHA-256.`);
    }
    if (!Number.isSafeInteger(source.maximumBytes) || source.maximumBytes <= 0) {
      throw new Error(`Source ${id} has an invalid size limit.`);
    }
    requireSafeGdalDataSource(source.gdalDataSource, id);
    requireSafeLayerName(source.gdalLayer, `source ${id} GDAL layer`);
  }

  if (!sourceIds.has("lra") || !sourceIds.has("sra")) {
    throw new Error("Both LRA and SRA sources are required.");
  }

  const evidenceIds = new Set();
  for (const evidence of config.designationEvidence ?? []) {
    const id = requireIdentifier(evidence?.id, "designation evidence id");
    if (evidenceIds.has(id)) {
      throw new Error(`Duplicate designation evidence id: ${id}.`);
    }
    evidenceIds.add(id);
    requireHttpsUrl(evidence.url, `designation evidence ${id} URL`);
  }

  if (
    !Array.isArray(config.coverageTargets) ||
    config.coverageTargets.length === 0
  ) {
    throw new Error("At least one coverage target is required.");
  }

  const targetIds = new Set();
  const targetLabels = new Set();
  for (const target of config.coverageTargets) {
    const id = requireIdentifier(target?.id, "coverage target id");
    if (targetIds.has(id)) {
      throw new Error(`Duplicate coverage target id: ${id}.`);
    }
    targetIds.add(id);

    const label = requireNonEmptyString(
      target.label,
      `coverage target ${id} label`,
    );
    if (targetLabels.has(label)) {
      throw new Error(`Duplicate coverage target label: ${label}.`);
    }
    targetLabels.add(label);

    if (!coverageTargetKinds.has(target.kind)) {
      throw new Error(`Unsupported coverage target kind: ${String(target.kind)}.`);
    }
    if (!lraDesignationStatuses.has(target.lraDesignationStatus)) {
      throw new Error(`Unsupported LRA designation status for ${id}.`);
    }
    if (!evidenceIds.has(target.evidenceId)) {
      throw new Error(
        `Coverage target ${id} references unknown designation evidence ${String(target.evidenceId)}.`,
      );
    }

    const boundarySource = sourcesById.get(target.boundarySourceId);
    if (boundarySource === undefined) {
      throw new Error(
        `Coverage target ${id} references unknown boundary source ${String(target.boundarySourceId)}.`,
      );
    }
    if (boundarySource.trackedPath === undefined) {
      throw new Error(
        `Coverage target ${id} requires a tracked boundary source.`,
      );
    }
    if (boundarySource.responsibilityArea !== undefined) {
      throw new Error(
        `Coverage target ${id} cannot use a hazard source as its boundary.`,
      );
    }
    validateBoundarySelector(target.boundarySelector, id);
    requireNonEmptyString(
      target.coverageDisclosure,
      `coverage target ${id} disclosure`,
    );

    if (target.kind === "market-context") {
      if (
        target.productSelector?.kind !== "zip" ||
        !/^\d{5}$/.test(target.productSelector?.value)
      ) {
        throw new Error(
          `Market-context target ${id} requires a five-digit ZIP selector.`,
        );
      }
    } else if (target.productSelector !== undefined) {
      throw new Error(
        `Incorporated-jurisdiction target ${id} cannot define a product selector.`,
      );
    }
  }

  return { sourcesById };
}

export function resolveCoverageTargetBoundary(target, source, collection) {
  if (
    collection?.type !== "FeatureCollection" ||
    !Array.isArray(collection.features)
  ) {
    throw new Error(
      `Boundary source ${source.id} is not a GeoJSON FeatureCollection.`,
    );
  }

  const selector = validateBoundarySelector(target.boundarySelector, target.id);
  const matches = collection.features.filter(
    (feature) => {
      const value = feature.properties?.[selector.field];
      return value !== undefined && value !== null && String(value) === selector.equals;
    },
  );
  if (matches.length !== 1) {
    throw new Error(
      `Expected one boundary for ${target.label} from ${source.id} using ` +
        `${selector.field}=${selector.equals}; received ${matches.length}.`,
    );
  }
  const match = matches[0];
  if (
    match?.geometry?.type !== "Polygon" &&
    match?.geometry?.type !== "MultiPolygon"
  ) {
    throw new Error(
      `Boundary for ${target.label} must be a Polygon or MultiPolygon.`,
    );
  }
  return match;
}

export function createBoundaryClip(target, source) {
  const selector = validateBoundarySelector(target.boundarySelector, target.id);
  return {
    dataSource: source.gdalDataSource,
    layer: source.gdalLayer,
    where: `${quoteIdentifier(selector.field)} = ${quoteSqlString(selector.equals)}`,
  };
}

export function quoteIdentifier(value) {
  requireOgrIdentifier(value, "OGR identifier");
  return `"${value}"`;
}

export function quoteSqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function validateBoundarySelector(selector, targetId) {
  if (
    selector === null ||
    typeof selector !== "object" ||
    Array.isArray(selector) ||
    Object.keys(selector).some((key) => key !== "field" && key !== "equals")
  ) {
    throw new Error(
      `Coverage target ${targetId} has an invalid boundary selector.`,
    );
  }
  requireOgrIdentifier(
    selector.field,
    `coverage target ${targetId} selector field`,
  );
  const equals = requireNonEmptyString(
    selector.equals,
    `coverage target ${targetId} selector value`,
  );
  return { field: selector.field, equals };
}

function requireOgrIdentifier(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Unsafe ${label}: ${String(value)}.`);
  }
  return value;
}

function requireSafeLayerName(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value)) {
    throw new Error(`Unsafe ${label}: ${String(value)}.`);
  }
  return value;
}

function requireSafeGdalDataSource(value, sourceId) {
  const isMountedSource =
    typeof value === "string" &&
    (value.startsWith("/work/sources/") ||
      value.startsWith("/vsizip//work/sources/"));
  if (
    !isMountedSource ||
    value.includes("..") ||
    /[\r\n\0]/.test(value)
  ) {
    throw new Error(`Unsafe source ${sourceId} GDAL data source.`);
  }
  return value;
}

function requireIdentifier(value, label) {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(value)) {
    throw new Error(`Invalid ${label}: ${String(value)}.`);
  }
  return value;
}

function requireSafeFileName(value, label) {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)
  ) {
    throw new Error(`Unsafe ${label}: ${String(value)}.`);
  }
  return value;
}

function requireHttpsUrl(value, label) {
  if (typeof value !== "string") {
    throw new Error(`${label} must use HTTPS.`);
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must use HTTPS.`);
  }
  if (url.protocol !== "https:") {
    throw new Error(`${label} must use HTTPS.`);
  }
  return value;
}

function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}
