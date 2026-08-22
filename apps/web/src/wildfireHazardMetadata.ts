export const WILDFIRE_HAZARD_MANIFEST_URL =
  "/data/wildfire-hazard/manifest.json";

const targetJurisdictionNames = [
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

export type WildfireHazardJurisdictionStatus =
  | "locally-adopted"
  | "recommended";

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
  if (!isRecord(value) || value.schemaVersion !== 1) {
    throw new Error("Unsupported wildfire hazard manifest schema.");
  }

  const artifact = requireRecord(value.artifact, "artifact metadata");
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

  const targetJurisdictions = value.targetJurisdictions;
  if (!Array.isArray(targetJurisdictions)) {
    throw new Error("Wildfire hazard target jurisdictions are required.");
  }
  if (targetJurisdictions.length !== targetJurisdictionNames.length) {
    throw new Error("Expected exactly five target jurisdictions.");
  }

  const jurisdictions = targetJurisdictionNames.map((name) => {
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
    const status = record.lraDesignationStatus;
    if (
      !acceptedJurisdictionStatuses.has(
        status as WildfireHazardJurisdictionStatus,
      )
    ) {
      throw new Error("Unsupported jurisdiction designation status.");
    }
    return {
      name,
      status: status as WildfireHazardJurisdictionStatus,
    };
  });

  return {
    artifactVersion,
    snapshotAt,
    sourceName: lraSource.attribution,
    sourceUrl: lraSource.canonicalUrl,
    sourceVersions: {
      lra: lraSource.version,
      sra: sraSource.version,
    },
    jurisdictions,
  };
}

function requireSource(
  sources: unknown[],
  id: "lra" | "sra",
): {
  attribution: string;
  canonicalUrl: string;
  version: string;
} {
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
  const canonicalUrl = requireHttpsUrl(source.canonicalUrl);
  return {
    attribution: requireNonEmptyString(
      source.attribution,
      `${id.toUpperCase()} attribution`,
    ),
    canonicalUrl,
    version: requireNonEmptyString(
      source.version,
      `${id.toUpperCase()} source version`,
    ),
  };
}

function requireHttpsUrl(value: unknown): string {
  const url = requireNonEmptyString(value, "canonical source URL");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Wildfire hazard requires an HTTPS canonical source.");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("Wildfire hazard requires an HTTPS canonical source.");
  }
  return parsed.toString().replace(/\/$/, "");
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
