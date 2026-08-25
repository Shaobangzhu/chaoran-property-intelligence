export const WILDFIRE_HAZARD_MANIFEST_URL =
  "/data/wildfire-hazard/manifest.json";

const legacyTargetJurisdictionNames = [
  "Chino",
  "Chino Hills",
  "Corona",
  "Eastvale",
  "Jurupa Valley",
] as const;
const acceptedJurisdictionStatuses = new Set<WildfireHazardJurisdictionStatus>([
  "locally-adopted",
  "recommended",
]);
const acceptedCoverageTargetKinds = new Set<WildfireHazardCoverageTargetKind>([
  "incorporated-jurisdiction",
  "market-context",
]);
const identifierPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const sha256Pattern = /^[a-f0-9]{64}$/;

export type WildfireHazardJurisdictionStatus =
  | "locally-adopted"
  | "recommended";

export type WildfireHazardCoverageTargetKind =
  | "incorporated-jurisdiction"
  | "market-context";

export interface WildfireHazardCoverageTarget {
  id: string;
  label: string;
  kind: WildfireHazardCoverageTargetKind;
  boundarySourceId: string;
  lraDesignationStatus: WildfireHazardJurisdictionStatus;
  evidenceId: string;
  coverageDisclosure: string;
  productSelector?: {
    kind: "zip";
    value: string;
  };
}

export interface WildfireHazardMetadata {
  artifactVersion: string;
  snapshotAt: string;
  sourceName: string;
  sourceUrl: string;
  sourceVersions: {
    lra: string;
    sra: string;
  };
  jurisdictions: Array<{
    name: string;
    status: WildfireHazardJurisdictionStatus;
  }>;
  coverageTargets: WildfireHazardCoverageTarget[];
}

interface ParsedSource {
  id: string;
  attribution: string;
  canonicalUrl: string;
  version: string;
}

export async function loadWildfireHazardMetadata(
  signal: AbortSignal,
): Promise<WildfireHazardMetadata> {
  const response = await fetch(WILDFIRE_HAZARD_MANIFEST_URL, { signal });
  if (!response.ok) {
    throw new Error("Wildfire hazard provenance is unavailable.");
  }
  return parseWildfireHazardManifest(await response.json());
}

export function parseWildfireHazardManifest(
  value: unknown,
): WildfireHazardMetadata {
  if (!isRecord(value)) {
    throw new Error("Unsupported wildfire hazard manifest schema.");
  }
  if (value.schemaVersion === 1) {
    return parseLegacyManifest(value);
  }
  if (value.schemaVersion === 2) {
    return parseCoverageManifest(value);
  }
  throw new Error("Unsupported wildfire hazard manifest schema.");
}

function parseLegacyManifest(value: Record<string, unknown>) {
  const common = parseCommonMetadata(value, false);
  const targetJurisdictions = value.targetJurisdictions;
  if (!Array.isArray(targetJurisdictions)) {
    throw new Error("Wildfire hazard target jurisdictions are required.");
  }
  if (targetJurisdictions.length !== legacyTargetJurisdictionNames.length) {
    throw new Error("Expected exactly five target jurisdictions.");
  }

  const jurisdictions = legacyTargetJurisdictionNames.map((name) => {
    const matches = targetJurisdictions.filter(
      (candidate): candidate is Record<string, unknown> =>
        isRecord(candidate) && candidate.name === name,
    );
    if (matches.length !== 1) {
      throw new Error(`Expected one target jurisdiction record for ${name}.`);
    }
    const record = matches[0];
    if (record === undefined) {
      throw new Error(`Missing target jurisdiction record for ${name}.`);
    }
    return {
      name,
      status: requireJurisdictionStatus(record.lraDesignationStatus),
    };
  });

  return { ...common, jurisdictions, coverageTargets: [] };
}

function parseCoverageManifest(value: Record<string, unknown>) {
  const common = parseCommonMetadata(value, true);
  const sourceIds = parseStrictSources(value.sources);
  const evidenceIds = parseDesignationEvidence(value.designationEvidence);
  const coverageTargets = parseCoverageTargets(
    value.coverageTargets,
    sourceIds,
    evidenceIds,
  );

  return {
    ...common,
    jurisdictions: coverageTargets
      .filter((target) => target.kind === "incorporated-jurisdiction")
      .map((target) => ({
        name: target.label,
        status: target.lraDesignationStatus,
      })),
    coverageTargets,
  };
}

function parseCommonMetadata(
  value: Record<string, unknown>,
  strictArtifact: boolean,
) {
  const artifact = requireRecord(value.artifact, "artifact metadata");
  if (strictArtifact) {
    validateArtifactMetadata(artifact);
  }
  const artifactVersion = requireNonEmptyString(
    artifact.version,
    "artifact version",
  );
  const snapshotAt = requireNonEmptyString(
    value.generatedFromSnapshotAt,
    "snapshot timestamp",
  );
  if (Number.isNaN(Date.parse(snapshotAt))) {
    throw new Error("Wildfire hazard snapshot timestamp is invalid.");
  }

  const sources = value.sources;
  if (!Array.isArray(sources)) {
    throw new Error("Wildfire hazard provenance sources are required.");
  }
  const lraSource = requireSource(sources, "lra");
  const sraSource = requireSource(sources, "sra");
  if (lraSource.canonicalUrl !== sraSource.canonicalUrl) {
    throw new Error("LRA and SRA must share one canonical source.");
  }

  return {
    artifactVersion,
    snapshotAt,
    sourceName: lraSource.attribution,
    sourceUrl: lraSource.canonicalUrl,
    sourceVersions: {
      lra: lraSource.version,
      sra: sraSource.version,
    },
  };
}

function validateArtifactMetadata(artifact: Record<string, unknown>) {
  const fileName = requireNonEmptyString(artifact.fileName, "artifact filename");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.geojson$/.test(fileName)) {
    throw new Error("Wildfire hazard requires a safe GeoJSON artifact filename.");
  }
  if (artifact.mediaType !== "application/geo+json") {
    throw new Error("Wildfire hazard artifact media type is unsupported.");
  }
  if (
    typeof artifact.sha256 !== "string" ||
    !sha256Pattern.test(artifact.sha256)
  ) {
    throw new Error("Wildfire hazard artifact SHA-256 is invalid.");
  }
  requireNonNegativeInteger(artifact.bytes, "artifact byte count");
  requireNonNegativeInteger(artifact.gzipBytes, "artifact gzip byte count");
  const featureCount = requireNonNegativeInteger(
    artifact.featureCount,
    "artifact feature count",
  );
  requireNonNegativeInteger(
    artifact.coordinateCount,
    "artifact coordinate count",
  );
  validateCountRecord(
    artifact.severityCounts,
    ["moderate", "high", "very-high"],
    featureCount,
    "severity",
  );
  validateCountRecord(
    artifact.responsibilityAreaCounts,
    ["lra", "sra"],
    featureCount,
    "responsibility area",
  );
  validateCountRecord(
    artifact.designationStatusCounts,
    ["effective", "recommended", "locally-adopted"],
    featureCount,
    "designation status",
  );
}

function parseStrictSources(value: unknown): Set<string> {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Wildfire hazard provenance sources are required.");
  }

  const sourceIds = new Set<string>();
  for (const candidate of value) {
    const source = requireRecord(candidate, "provenance source");
    const id = requireIdentifier(source.id, "provenance source id");
    if (sourceIds.has(id)) {
      throw new Error(`Duplicate provenance source id: ${id}.`);
    }
    sourceIds.add(id);
    requireNonEmptyString(source.title, `source ${id} title`);
    requireHttpsUrl(source.canonicalUrl, "canonical source URL");
    if (source.downloadUrl !== undefined) {
      requireHttpsUrl(source.downloadUrl, "source download URL");
    }
    if (typeof source.sha256 !== "string" || !sha256Pattern.test(source.sha256)) {
      throw new Error(`Source ${id} has an invalid SHA-256.`);
    }
    requireNonEmptyString(source.version, `source ${id} version`);
    requireNonEmptyString(source.license, `source ${id} license`);
    requireNonEmptyString(source.attribution, `source ${id} attribution`);
  }
  if (!sourceIds.has("lra") || !sourceIds.has("sra")) {
    throw new Error("Both LRA and SRA provenance sources are required.");
  }
  return sourceIds;
}

function parseDesignationEvidence(value: unknown): Set<string> {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Wildfire hazard designation evidence is required.");
  }

  const evidenceIds = new Set<string>();
  for (const candidate of value) {
    const evidence = requireRecord(candidate, "designation evidence");
    const id = requireIdentifier(evidence.id, "designation evidence id");
    if (evidenceIds.has(id)) {
      throw new Error(`Duplicate designation evidence id: ${id}.`);
    }
    evidenceIds.add(id);
    requireNonEmptyString(evidence.title, `designation evidence ${id} title`);
    requireHttpsUrl(evidence.url, "designation evidence URL");
    requireNonEmptyString(
      evidence.finding,
      `designation evidence ${id} finding`,
    );
  }
  return evidenceIds;
}

function parseCoverageTargets(
  value: unknown,
  sourceIds: Set<string>,
  evidenceIds: Set<string>,
): WildfireHazardCoverageTarget[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Wildfire hazard coverage targets are required.");
  }

  const targetIds = new Set<string>();
  const targetLabels = new Set<string>();
  return value.map((candidate) => {
    const target = requireRecord(candidate, "coverage target");
    const id = requireIdentifier(target.id, "coverage target id");
    if (targetIds.has(id)) {
      throw new Error(`Duplicate coverage target id: ${id}.`);
    }
    targetIds.add(id);

    const label = requireNonEmptyString(target.label, `coverage target ${id} label`);
    if (targetLabels.has(label)) {
      throw new Error(`Duplicate coverage target label: ${label}.`);
    }
    targetLabels.add(label);

    const kind = target.kind as WildfireHazardCoverageTargetKind;
    if (!acceptedCoverageTargetKinds.has(kind)) {
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
    const lraDesignationStatus = requireCoverageTargetStatus(
      target.lraDesignationStatus,
    );
    const evidenceId = requireIdentifier(
      target.evidenceId,
      `coverage target ${id} evidence id`,
    );
    if (!evidenceIds.has(evidenceId)) {
      throw new Error(
        `Coverage target ${id} references unknown designation evidence ${evidenceId}.`,
      );
    }
    const coverageDisclosure = requireNonEmptyString(
      target.coverageDisclosure,
      `coverage target ${id} disclosure`,
    );
    const productSelector = parseProductSelector(target.productSelector, kind);

    return {
      id,
      label,
      kind,
      boundarySourceId,
      lraDesignationStatus,
      evidenceId,
      coverageDisclosure,
      ...(productSelector === undefined ? {} : { productSelector }),
    };
  });
}

function parseProductSelector(
  value: unknown,
  kind: WildfireHazardCoverageTargetKind,
) {
  if (kind === "incorporated-jurisdiction") {
    if (value !== undefined) {
      throw new Error(
        "Incorporated-jurisdiction targets cannot define a product selector.",
      );
    }
    return undefined;
  }

  const selector = requireRecord(value, "market-context product selector");
  if (
    selector.kind !== "zip" ||
    typeof selector.value !== "string" ||
    !/^\d{5}$/.test(selector.value)
  ) {
    throw new Error("Market-context targets require a five-digit ZIP selector.");
  }
  return { kind: "zip" as const, value: selector.value };
}

function requireSource(sources: unknown[], id: "lra" | "sra"): ParsedSource {
  const matches = sources.filter(
    (candidate): candidate is Record<string, unknown> =>
      isRecord(candidate) && candidate.id === id,
  );
  if (matches.length !== 1) {
    throw new Error(`Expected one ${id.toUpperCase()} provenance source.`);
  }
  const source = matches[0];
  if (source === undefined) {
    throw new Error(`Missing ${id.toUpperCase()} provenance source.`);
  }
  return {
    id,
    attribution: requireNonEmptyString(
      source.attribution,
      `${id.toUpperCase()} attribution`,
    ),
    canonicalUrl: requireHttpsUrl(source.canonicalUrl, "canonical source URL"),
    version: requireNonEmptyString(
      source.version,
      `${id.toUpperCase()} source version`,
    ),
  };
}

function requireJurisdictionStatus(
  value: unknown,
): WildfireHazardJurisdictionStatus {
  if (
    !acceptedJurisdictionStatuses.has(
      value as WildfireHazardJurisdictionStatus,
    )
  ) {
    throw new Error("Unsupported jurisdiction designation status.");
  }
  return value as WildfireHazardJurisdictionStatus;
}

function requireCoverageTargetStatus(
  value: unknown,
): WildfireHazardJurisdictionStatus {
  if (
    !acceptedJurisdictionStatuses.has(
      value as WildfireHazardJurisdictionStatus,
    )
  ) {
    throw new Error("Unsupported coverage target designation status.");
  }
  return value as WildfireHazardJurisdictionStatus;
}

function validateCountRecord(
  value: unknown,
  allowedKeys: string[],
  featureCount: number,
  label: string,
) {
  const counts = requireRecord(value, `${label} counts`);
  if (Object.keys(counts).some((key) => !allowedKeys.includes(key))) {
    throw new Error(`Wildfire hazard ${label} counts contain an unknown key.`);
  }
  const total = allowedKeys.reduce(
    (sum, key) =>
      sum + requireNonNegativeInteger(counts[key], `${label} count for ${key}`),
    0,
  );
  if (total !== featureCount) {
    throw new Error(`Wildfire hazard ${label} counts do not match feature count.`);
  }
}

function requireHttpsUrl(value: unknown, label: string): string {
  const url = requireNonEmptyString(value, label);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Wildfire hazard requires an HTTPS ${label}.`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`Wildfire hazard requires an HTTPS ${label}.`);
  }
  return parsed.toString().replace(/\/$/, "");
}

function requireIdentifier(value: unknown, label: string): string {
  const identifier = requireNonEmptyString(value, label);
  if (!identifierPattern.test(identifier)) {
    throw new Error(`Wildfire hazard ${label} is invalid.`);
  }
  return identifier;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`Wildfire hazard ${label} is required.`);
  }
  return value;
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Wildfire hazard ${label} is required.`);
  }
  return value;
}

function requireNonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new Error(
      `Wildfire hazard ${label} must be a non-negative integer.`,
    );
  }
  return value as number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
