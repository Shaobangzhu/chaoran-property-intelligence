// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WildfireHazardControl } from "./WildfireHazardControl.js";
import type { WildfireHazardMetadata } from "./wildfireHazardMetadata.js";
import type { WildfireHazardOverlayState } from "./wildfireHazardOverlay.js";

afterEach(cleanup);

describe("WildfireHazardControl", () => {
  it("renders a keyboard-operable switch that is off by default", async () => {
    const user = userEvent.setup();
    const onEnabledChange = vi.fn();
    renderControl({ onEnabledChange });

    const toggle = screen.getByRole("switch", {
      name: "Wildfire hazard zones",
    });
    expect(toggle).not.toBeChecked();

    toggle.focus();
    await user.keyboard(" ");
    expect(onEnabledChange).toHaveBeenCalledWith(true);
  });

  it("announces non-blocking loading without displaying a legend", () => {
    renderControl({
      enabled: true,
      state: { status: "loading", visible: false },
    });

    expect(screen.getByRole("switch")).toBeChecked();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading hazard zones",
    );
    expect(
      screen.queryByLabelText("Fire Hazard Severity Zone legend"),
    ).not.toBeInTheDocument();
  });

  it("shows the severity legend and reviewed provenance only while visible", () => {
    const metadata = createMetadata();
    const { rerender } = renderControl({
      enabled: true,
      state: { status: "ready", visible: true, metadata },
    });

    const legend = screen.getByLabelText("Fire Hazard Severity Zone legend");
    expect(legend).toHaveTextContent("Moderate");
    expect(legend).toHaveTextContent("High");
    expect(legend).toHaveTextContent("Very High");
    expect(legend).toHaveTextContent("Version 2025.1");
    expect(legend).toHaveTextContent("Snapshot Aug 22, 2026 UTC");
    expect(legend).toHaveTextContent(
      "Chino, Chino Hills, Corona, and Jurupa Valley locally adopted",
    );
    expect(legend).toHaveTextContent("Eastvale recommended");
    expect(legend).toHaveTextContent(
      "Blank areas may be outside mapped hazard zones",
    );
    expect(screen.getByRole("link", { name: "CAL FIRE / OSFM" })).toHaveAttribute(
      "href",
      metadata.sourceUrl,
    );
    expect(screen.getByRole("link", { name: "CAL FIRE / OSFM" })).toHaveAttribute(
      "rel",
      "noreferrer",
    );
    expect(screen.getByRole("link", { name: "CAL FIRE / OSFM" })).toHaveAttribute(
      "target",
      "_blank",
    );

    rerender(
      <WildfireHazardControl
        enabled={false}
        onEnabledChange={() => undefined}
        onRetry={() => undefined}
        state={{ status: "ready", visible: false, metadata }}
      />,
    );
    expect(
      screen.queryByLabelText("Fire Hazard Severity Zone legend"),
    ).not.toBeInTheDocument();
  });

  it("shows the classification-preserving disclosure only in visible terrain mode", () => {
    const metadata = createMetadata();
    const { rerender } = renderControl({
      enabled: true,
      state: { status: "ready", visible: true, metadata },
      terrainContext: true,
    });

    expect(
      screen.getByText(
        "Terrain is visual context only. CAL FIRE classifications are unchanged.",
      ),
    ).toBeInTheDocument();

    rerender(
      <WildfireHazardControl
        enabled={true}
        onEnabledChange={() => undefined}
        onRetry={() => undefined}
        state={{ status: "ready", visible: true, metadata }}
        terrainContext={false}
      />,
    );
    expect(
      screen.queryByText(/Terrain is visual context only/),
    ).not.toBeInTheDocument();
  });

  it("shows a bounded error and retries without exposing private details", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    renderControl({
      enabled: false,
      onRetry,
      state: { status: "error", visible: false },
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Hazard layer unavailable",
    );
    expect(screen.queryByText(/provider|private/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry hazard layer" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});

function renderControl({
  enabled = false,
  onEnabledChange = () => undefined,
  onRetry = () => undefined,
  state = { status: "idle", visible: false },
  terrainContext = false,
}: {
  enabled?: boolean;
  onEnabledChange?: (enabled: boolean) => void;
  onRetry?: () => void;
  state?: WildfireHazardOverlayState;
  terrainContext?: boolean;
} = {}): ReturnType<typeof render> {
  return render(
    <WildfireHazardControl
      enabled={enabled}
      onEnabledChange={onEnabledChange}
      onRetry={onRetry}
      state={state}
      terrainContext={terrainContext}
    />,
  );
}

function createMetadata(): WildfireHazardMetadata {
  return {
    artifactVersion: "2025.1",
    snapshotAt: "2026-08-22T00:29:56Z",
    sourceName: "CAL FIRE / Office of the State Fire Marshal",
    sourceUrl:
      "https://osfm.fire.ca.gov/what-we-do/community-wildfire-preparedness-and-mitigation/fire-hazard-severity-zones",
    sourceVersions: {
      lra: "FHSZLRA25_1",
      sra: "FHSZSRA_23_3",
    },
    jurisdictions: [
      { name: "Chino", status: "locally-adopted" },
      { name: "Chino Hills", status: "locally-adopted" },
      { name: "Corona", status: "locally-adopted" },
      { name: "Eastvale", status: "recommended" },
      { name: "Jurupa Valley", status: "locally-adopted" },
    ],
  };
}
