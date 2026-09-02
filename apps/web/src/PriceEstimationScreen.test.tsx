// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SessionAuthenticationRequiredError } from "./listingsApi.js";
import {
  PriceEstimationScreen,
  type PriceEstimator,
} from "./PriceEstimationScreen.js";
import {
  PriceEstimationRequestError,
  type PriceEstimationResult,
} from "./priceEstimationApi.js";

afterEach(cleanup);

describe("PriceEstimationScreen", () => {
  it("starts with an accessible California-only form and no provider request", () => {
    const estimatePrice = vi.fn<PriceEstimator>();
    render(<PriceEstimationScreen estimatePrice={estimatePrice} />);

    expect(
      screen.getByRole("heading", { name: "Price Estimation" }),
    ).toBeInTheDocument();
    expect(screen.getByText("California properties only")).toBeInTheDocument();
    expect(screen.getByLabelText("Street number and name")).toHaveAttribute(
      "autocomplete",
      "address-line1",
    );
    expect(screen.getByLabelText("City")).toHaveAttribute(
      "autocomplete",
      "address-level2",
    );
    expect(screen.getByLabelText("ZIP code")).toHaveAttribute(
      "inputmode",
      "numeric",
    );
    expect(
      screen.getByRole("button", { name: "Set Offer Price" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Set Listing Price" }),
    ).toBeEnabled();
    expect(estimatePrice).not.toHaveBeenCalled();
  });

  it("shows field-level validation without starting an estimate", async () => {
    const user = userEvent.setup();
    const estimatePrice = vi.fn<PriceEstimator>();
    render(<PriceEstimationScreen estimatePrice={estimatePrice} />);

    await user.type(screen.getByLabelText("Street number and name"), "100 Main St");
    await user.type(screen.getByLabelText("City"), "Irvine");
    await user.type(screen.getByLabelText("ZIP code"), "9261");
    await user.click(screen.getByRole("button", { name: "Set Offer Price" }));

    expect(screen.getByText("Enter a five-digit ZIP code.")).toBeInTheDocument();
    expect(screen.getByLabelText("ZIP code")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(estimatePrice).not.toHaveBeenCalled();
  });

  it("submits one offer action, disables both actions, and renders the complete result", async () => {
    const user = userEvent.setup();
    let resolve: ((result: PriceEstimationResult) => void) | undefined;
    const estimatePrice = vi.fn<PriceEstimator>(
      () =>
        new Promise((next) => {
          resolve = next;
        }),
    );
    render(<PriceEstimationScreen estimatePrice={estimatePrice} />);
    await fillAddress(user);

    await user.click(screen.getByRole("button", { name: "Set Offer Price" }));

    expect(estimatePrice).toHaveBeenCalledTimes(1);
    expect(estimatePrice.mock.calls[0]?.[0]).toEqual({
      streetAddress: "100 Test Ave",
      city: "Irvine",
      zipCode: "92618",
      mode: "offer",
    });
    expect(screen.getByRole("button", { name: "Estimating offer" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Set Listing Price" })).toBeDisabled();
    expect(
      screen.getByRole("status", {
        name: "",
      }),
    ).toHaveTextContent("Analyzing recorded sales and market evidence");

    resolve?.(createResult());

    expect(
      await screen.findByRole("heading", {
        name: "100 Test Ave, Irvine, CA 92618",
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("$1,000,000").length).toBeGreaterThan(0);
    expect(screen.getByText("Confidence: Medium")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Why this price" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Recommended strategy" })).toBeInTheDocument();
    const table = screen.getByRole("table", {
      name: "Selected recorded sales used in this recommendation",
    });
    expect(within(table).getAllByRole("row")).toHaveLength(4);
    expect(within(table).getByRole("columnheader", { name: "Recorded sale" })).toBeInTheDocument();
    expect(screen.getByText(/This is a decision aid, not an appraisal/)).toBeInTheDocument();
    expect(document.activeElement).toBe(
      screen
        .getByRole("heading", { name: "100 Test Ave, Irvine, CA 92618" })
        .closest("section"),
    );
  });

  it("submits listing mode and exposes deterministic narrative fallback as success", async () => {
    const user = userEvent.setup();
    const fallback = createResult({
      mode: "listing",
      fallback: true,
      nullableContext: true,
    });
    const estimatePrice = vi.fn<PriceEstimator>(async () => fallback);
    render(<PriceEstimationScreen estimatePrice={estimatePrice} />);
    await fillAddress(user);

    await user.click(screen.getByRole("button", { name: "Set Listing Price" }));

    expect(estimatePrice.mock.calls[0]?.[0].mode).toBe("listing");
    expect(await screen.findByText("Recommended listing price")).toBeInTheDocument();
    expect(screen.getByText("Quick sale")).toBeInTheDocument();
    expect(screen.getByText("Balanced")).toBeInTheDocument();
    expect(screen.getByText("Stretch")).toBeInTheDocument();
    expect(
      screen.getByText("Valuation completed with deterministic guidance"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("No verified subject-listing signal was available."),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Not available for this analysis.")).toHaveLength(2);
    expect(
      screen.queryByRole("heading", { name: /could not|unavailable/i }),
    ).not.toBeInTheDocument();
  });

  it("focuses a bounded failure and retries the preserved request", async () => {
    const user = userEvent.setup();
    const estimatePrice = vi
      .fn<PriceEstimator>()
      .mockRejectedValueOnce(
        new PriceEstimationRequestError("insufficient-evidence"),
      )
      .mockResolvedValueOnce(createResult());
    render(<PriceEstimationScreen estimatePrice={estimatePrice} />);
    await fillAddress(user);
    await user.click(screen.getByRole("button", { name: "Set Offer Price" }));

    const failureTitle = await screen.findByRole("heading", {
      name: "Not enough valuation evidence",
    });
    expect(document.activeElement).toBe(failureTitle.closest("section"));
    expect(screen.getByLabelText("Street number and name")).toHaveValue(
      "100 Test Ave",
    );

    await user.click(
      screen.getByRole("button", { name: "Retry Offer Estimate" }),
    );

    expect(estimatePrice).toHaveBeenCalledTimes(2);
    expect(estimatePrice.mock.calls[1]?.[0]).toEqual(
      estimatePrice.mock.calls[0]?.[0],
    );
    expect(
      await screen.findByRole("heading", {
        name: "100 Test Ave, Irvine, CA 92618",
      }),
    ).toBeInTheDocument();
  });

  it("shows a specific message when the server rejects the address request", async () => {
    const user = userEvent.setup();
    render(
      <PriceEstimationScreen
        estimatePrice={async () => {
          throw new PriceEstimationRequestError("invalid-request");
        }}
      />,
    );
    await fillAddress(user);

    await user.click(screen.getByRole("button", { name: "Set Offer Price" }));

    expect(
      await screen.findByRole("heading", {
        name: "Address request was not accepted",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Review the property address and try again."),
    ).toBeInTheDocument();
  });

  it("keeps a completed result but labels it when the address changes", async () => {
    const user = userEvent.setup();
    render(
      <PriceEstimationScreen estimatePrice={async () => createResult()} />,
    );
    await fillAddress(user);
    await user.click(screen.getByRole("button", { name: "Set Offer Price" }));
    await screen.findByText("Recommended offer");

    await user.clear(screen.getByLabelText("City"));
    await user.type(screen.getByLabelText("City"), "Corona");

    expect(
      screen.getByText(/Inputs changed\. This result remains based on 100 Test Ave, Irvine/),
    ).toBeInTheDocument();
    expect(screen.getByText("Recommended offer")).toBeInTheDocument();
  });

  it("aborts in-flight work and ignores late completion after unmount", async () => {
    let signal: AbortSignal | undefined;
    let resolve: ((result: PriceEstimationResult) => void) | undefined;
    const estimatePrice = vi.fn<PriceEstimator>(
      (_input, nextSignal) =>
        new Promise((next) => {
          signal = nextSignal;
          resolve = next;
        }),
    );
    const user = userEvent.setup();
    const view = render(<PriceEstimationScreen estimatePrice={estimatePrice} />);
    await fillAddress(user);
    await user.click(screen.getByRole("button", { name: "Set Offer Price" }));

    view.unmount();
    expect(signal?.aborted).toBe(true);
    expect(() => resolve?.(createResult())).not.toThrow();
  });

  it("does not turn session expiry into a visible provider error", async () => {
    const user = userEvent.setup();
    render(
      <PriceEstimationScreen
        estimatePrice={async () => {
          throw new SessionAuthenticationRequiredError();
        }}
      />,
    );
    await fillAddress(user);
    await user.click(screen.getByRole("button", { name: "Set Offer Price" }));

    expect(
      screen.queryByRole("heading", { name: /could not|unavailable/i }),
    ).not.toBeInTheDocument();
  });
});

async function fillAddress(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Street number and name"), "100 Test Ave");
  await user.type(screen.getByLabelText("City"), "Irvine");
  await user.type(screen.getByLabelText("ZIP code"), "92618");
}

function createResult(
  options: {
    readonly mode?: "offer" | "listing";
    readonly fallback?: boolean;
    readonly nullableContext?: boolean;
  } = {},
): PriceEstimationResult {
  const mode = options.mode ?? "offer";
  const scenarioData =
    mode === "offer"
      ? ([
          ["conservative", "Conservative", 980_000],
          ["recommended", "Recommended", 1_000_000],
          ["competitive", "Competitive", 1_020_000],
        ] as const)
      : ([
          ["quick-sale", "Quick sale", 980_000],
          ["balanced", "Balanced", 1_000_000],
          ["stretch", "Stretch", 1_020_000],
        ] as const);
  const comparables = [1, 2, 3].map((number) => ({
    evidenceId: `sale-comp-${number}`,
    propertyId: `cpi-property-${String(number).repeat(24)}`,
    formattedAddress: `${200 + number} Fixture Rd, Irvine, CA 92618`,
    salePrice: 990_000 + number * 5_000,
    saleDate: `2026-0${number + 4}-15`,
    distanceMiles: number * 0.2,
    propertyType: "Single Family" as const,
    bedrooms: 4,
    bathrooms: 3,
    squareFootage: 2_000,
    lotSize: 5_000,
    yearBuilt: 2000,
    pricePerSquareFoot: 500,
    similarityScore: 0.9,
    latitude: 33.65,
    longitude: -117.74,
  }));
  return {
    analysisId: "request-id",
    methodologyVersion: "cpi-price-decision-v1",
    mode,
    subject: {
      propertyId: `cpi-property-${"a".repeat(24)}`,
      formattedAddress: "100 Test Ave, Irvine, CA 92618",
      propertyType: "Single Family",
      bedrooms: 4,
      bathrooms: 3,
      squareFootage: 2_000,
      lotSize: 5_000,
      yearBuilt: 2000,
      latitude: 33.65,
      longitude: -117.74,
    },
    recommendation: {
      recommendedPrice: 1_000_000,
      rangeLow: 950_000,
      rangeHigh: 1_050_000,
      marketValueAnchor: 1_000_000,
      currency: "USD",
      confidence: "medium",
      dataAsOf: "2026-09-01T18:00:00.000Z",
    },
    scenarios: scenarioData.map(([kind, label, price]) => ({
      kind,
      label,
      price,
      tradeoff: `${label} evidence position.`,
    })),
    reasons: [
      {
        title: "Recorded sales",
        detail: "Recent recorded sales support the recommendation.",
        evidenceIds: comparables.map(({ evidenceId }) => evidenceId),
      },
    ],
    comparables,
    context: options.nullableContext
      ? { avm: null, market: null, listingSignals: null }
      : {
          avm: {
            estimate: 1_010_000,
            rangeLow: 960_000,
            rangeHigh: 1_060_000,
            label: "RentCast value estimate",
            retrievedAt: "2026-09-01T17:59:00.000Z",
          },
          market: {
            zipCode: "92618",
            medianListPrice: 1_020_000,
            medianPricePerSquareFoot: 505,
            medianDaysOnMarket: 30,
            totalListings: 100,
            newListings: 20,
            lastUpdatedDate: "2026-09-01",
          },
          listingSignals: {
            currentListPrice: 1_030_000,
            daysOnMarket: 45,
            priceReductionCount: 1,
            totalReductionPercent: 2.8,
            flexibilitySignal: "medium",
            isInference: true,
          },
        },
    strategy: {
      summary: "Use the evidence-backed central position.",
      steps: scenarioData.map(([scenarioKind]) => ({
        scenarioKind,
        guidance: "Confirm condition before using this position.",
      })),
      source: options.fallback ? "deterministic-fallback" : "openai",
      enhancementUnavailable: options.fallback ?? false,
    },
    limitations: [
      {
        code: "condition-unknown",
        message: "Interior condition and unreported renovations are not modeled.",
      },
    ],
  };
}
