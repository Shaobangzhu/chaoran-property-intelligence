import { ExternalLink, Flame, LoaderCircle, RefreshCw } from "lucide-react";

import type { WildfireHazardMetadata } from "./wildfireHazardMetadata.js";
import type { WildfireHazardOverlayState } from "./wildfireHazardOverlay.js";

export interface WildfireHazardControlProps {
  enabled: boolean;
  state: WildfireHazardOverlayState;
  onEnabledChange: (enabled: boolean) => void;
  onRetry: () => void;
  terrainContext?: boolean;
}

export function WildfireHazardControl({
  enabled,
  state,
  onEnabledChange,
  onRetry,
  terrainContext = false,
}: WildfireHazardControlProps): React.JSX.Element {
  const isVisible = state.status === "ready" && state.visible;

  return (
    <section
      className={`wildfire-hazard-control${isVisible ? " is-expanded" : ""}`}
      aria-label="Wildfire hazard map controls"
    >
      <label className="wildfire-hazard-toggle">
        <span className="wildfire-hazard-toggle-label">
          <Flame aria-hidden="true" size={17} strokeWidth={1.9} />
          <span>Wildfire hazard zones</span>
        </span>
        <input
          type="checkbox"
          role="switch"
          checked={enabled}
          onChange={(event) => onEnabledChange(event.currentTarget.checked)}
        />
      </label>

      {state.status === "loading" ? (
        <div className="wildfire-hazard-message" role="status">
          <LoaderCircle
            className="wildfire-hazard-spinner"
            aria-hidden="true"
            size={15}
          />
          Loading hazard zones
        </div>
      ) : null}

      {state.status === "error" ? (
        <div className="wildfire-hazard-message is-error" role="alert">
          <span>Hazard layer unavailable</span>
          <button
            type="button"
            aria-label="Retry hazard layer"
            onClick={onRetry}
          >
            <RefreshCw aria-hidden="true" size={14} strokeWidth={2} />
            Retry
          </button>
        </div>
      ) : null}

      {isVisible ? (
        <WildfireHazardLegend
          metadata={state.metadata}
          terrainContext={terrainContext}
        />
      ) : null}
    </section>
  );
}

function WildfireHazardLegend({
  metadata,
  terrainContext,
}: {
  metadata: WildfireHazardMetadata;
  terrainContext: boolean;
}): React.JSX.Element {
  return (
    <div
      className="wildfire-hazard-legend"
      aria-label="Fire Hazard Severity Zone legend"
    >
      <div className="wildfire-hazard-legend-heading">
        Fire Hazard Severity Zones
      </div>
      <ul className="wildfire-hazard-legend-scale">
        <LegendItem label="Moderate" severity="moderate" />
        <LegendItem label="High" severity="high" />
        <LegendItem label="Very High" severity="very-high" />
      </ul>
      <div className="wildfire-hazard-provenance">
        <a
          href={metadata.sourceUrl}
          target="_blank"
          rel="noreferrer"
          title={metadata.sourceName}
        >
          CAL FIRE / OSFM
          <ExternalLink aria-hidden="true" size={12} strokeWidth={2} />
        </a>
        <span>
          Version {metadata.artifactVersion} | Snapshot{" "}
          {formatSnapshotDate(metadata.snapshotAt)} UTC
        </span>
        <span>
          LRA {metadata.sourceVersions.lra} | SRA {metadata.sourceVersions.sra}
        </span>
      </div>
      <p className="wildfire-hazard-jurisdictions">
        {formatCoverageStatus(metadata)}
      </p>
      {metadata.coverageTargets
        .filter(({ kind }) => kind === "market-context")
        .map((target) => (
          <p className="wildfire-hazard-disclosure" key={target.id}>
            {target.coverageDisclosure}
            {target.productSelector === undefined
              ? null
              : ` Product market selector: ZIP ${target.productSelector.value}.`}
          </p>
        ))}
      <p className="wildfire-hazard-disclosure">
        Blank areas may be outside mapped hazard zones.
      </p>
      {terrainContext ? (
        <p className="wildfire-hazard-disclosure">
          Terrain is visual context only. CAL FIRE classifications are
          unchanged.
        </p>
      ) : null}
    </div>
  );
}

function LegendItem({
  label,
  severity,
}: {
  label: string;
  severity: "moderate" | "high" | "very-high";
}): React.JSX.Element {
  return (
    <li>
      <span
        className={`wildfire-hazard-swatch is-${severity}`}
        aria-hidden="true"
      />
      <span>{label}</span>
    </li>
  );
}

function formatSnapshotDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(value));
}

function formatCoverageStatus(metadata: WildfireHazardMetadata): string {
  const adopted = metadata.jurisdictions
    .filter(({ status }) => status === "locally-adopted")
    .map(({ name }) => name);
  const recommended = metadata.jurisdictions
    .filter(({ status }) => status === "recommended")
    .map(({ name }) => name);
  const sentences = [];
  if (adopted.length > 0) {
    sentences.push(`${formatList(adopted)} locally adopted.`);
  }
  if (recommended.length > 0) {
    sentences.push(`${formatList(recommended)} recommended.`);
  }
  for (const target of metadata.coverageTargets) {
    if (target.kind !== "market-context") {
      continue;
    }
    const status =
      target.lraDesignationStatus === "locally-adopted"
        ? "locally adopted"
        : "recommended";
    sentences.push(`${target.label} market context ${status}.`);
  }
  return sentences.join(" ");
}

function formatList(values: string[]): string {
  if (values.length <= 1) {
    return values[0] ?? "";
  }
  if (values.length === 2) {
    return `${values[0]} and ${values[1]}`;
  }
  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}
