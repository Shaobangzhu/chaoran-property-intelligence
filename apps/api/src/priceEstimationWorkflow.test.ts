import { describe, expect, it, vi } from "vitest";

import { parsePriceEstimationRequest } from "./priceEstimationDto.js";
import { PriceEstimationWorkflow } from "./priceEstimationWorkflow.js";

const evaluatedAt = new Date("2026-09-01T18:00:00.000Z");

describe("PriceEstimationWorkflow", () => {
  it("accepts a parsed API request and reaches the RentCast adapter", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(createProviderFetch(false));
    const workflow = createWorkflow(fetch, null);
    const input = parsePriceEstimationRequest({
      streetAddress: "100 Test Ave",
      city: "Irvine",
      zipCode: "92618",
      mode: "offer",
    });

    await expect(workflow.execute(input)).resolves.toMatchObject({
      providerRequestCounts: { rentcast: 4, openai: 0 },
    });
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(new URL(String(fetch.mock.calls[0]?.[0])).pathname).toBe(
      "/v1/avm/value",
    );
  });

  it("composes four bounded RentCast requests and degrades one failed OpenAI request", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(createProviderFetch(true));
    const providerRequests: string[] = [];
    const workflow = createWorkflow(fetch, "openai-secret");

    const execution = await workflow.execute(createInput(), {
      onProviderRequest: (provider) => providerRequests.push(provider),
    });

    expect(execution.prepared.result).toMatchObject({
      mode: "offer",
      marketValueAnchor: 1_000_000,
      recommendedPrice: 1_000_000,
    });
    expect(execution.explanation).toMatchObject({
      source: "deterministic-fallback",
      enhancementUnavailable: true,
    });
    expect(execution.providerRequestCounts).toEqual({
      rentcast: 4,
      openai: 1,
    });
    expect(providerRequests).toEqual([
      "rentcast",
      "rentcast",
      "rentcast",
      "rentcast",
      "openai",
    ]);
    expect(fetch).toHaveBeenCalledTimes(5);
    const requests = fetch.mock.calls.map(
      ([input, init]) => new Request(input, init),
    );
    expect(requests.slice(0, 4).every((request) =>
      request.headers.get("x-api-key") === "rentcast-secret"
    )).toBe(true);
    expect(requests[4]?.url).toBe("https://api.openai.com/v1/responses");
    expect(requests[4]?.headers.get("authorization")).toBe(
      "Bearer openai-secret",
    );
    expect(requests.every((request) => !request.url.includes("apiKey"))).toBe(
      true,
    );
  });

  it("uses deterministic fallback without an OpenAI credential or request", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(createProviderFetch(false));
    const workflow = createWorkflow(fetch, null);

    const execution = await workflow.execute(createInput());

    expect(execution.explanation.source).toBe("deterministic-fallback");
    expect(execution.providerRequestCounts).toEqual({
      rentcast: 4,
      openai: 0,
    });
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(
      fetch.mock.calls.some(([input]) => String(input).includes("openai.com")),
    ).toBe(false);
  });

  it("isolates a throwing provider-observability callback", async () => {
    const workflow = createWorkflow(
      vi.fn<typeof globalThis.fetch>(createProviderFetch(false)),
      null,
    );

    await expect(
      workflow.execute(createInput(), {
        onProviderRequest: () => {
          throw new Error("observability detail");
        },
      }),
    ).resolves.toMatchObject({
      providerRequestCounts: { rentcast: 4, openai: 0 },
    });
  });
});

function createWorkflow(
  fetch: typeof globalThis.fetch,
  openAIApiKey: string | null,
) {
  return new PriceEstimationWorkflow({
    config: {
      rentCastApiKey: "rentcast-secret",
      openAIApiKey,
      rentCastRequestTimeoutMs: 15_000,
      openAIRequestTimeoutMs: 30_000,
    },
    fetch,
    now: () => new Date(evaluatedAt),
    nowMilliseconds: () => evaluatedAt.getTime(),
  });
}

function createInput() {
  return {
    address: {
      streetAddress: "100 Test Ave",
      city: "Irvine",
      zipCode: "92618",
    },
    mode: "offer" as const,
  };
}

function createProviderFetch(
  includeOpenAIFailure: boolean,
): typeof globalThis.fetch {
  return async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.hostname === "api.openai.com") {
      if (!includeOpenAIFailure) {
        throw new Error("Unexpected OpenAI request");
      }
      return Response.json(
        {
          error: {
            message: "provider detail",
            type: "server_error",
            code: "server_error",
          },
        },
        { status: 500 },
      );
    }
    if (url.pathname === "/v1/avm/value") {
      return Response.json({
        price: 1_000_000,
        priceRangeLow: 950_000,
        priceRangeHigh: 1_050_000,
        subjectProperty: createProperty("subject-property", 33.65, -117.74),
      });
    }
    if (url.pathname === "/v1/properties") {
      return Response.json(
        Array.from({ length: 5 }, (_, index) => ({
          ...createProperty(
            `comp-property-${index + 1}`,
            33.651 + index * 0.001,
            -117.741 - index * 0.001,
          ),
          formattedAddress: `${201 + index} Fixture Rd, Irvine, CA 92618`,
          lastSaleDate: `2026-0${index + 3}-15T00:00:00.000Z`,
          lastSalePrice: 1_000_000,
        })),
      );
    }
    if (url.pathname.startsWith("/v1/listings/sale/")) {
      return new Response("not found", { status: 404 });
    }
    if (url.pathname === "/v1/markets") {
      return Response.json({
        zipCode: "92618",
        saleData: {
          lastUpdatedDate: "2026-09-01T00:00:00.000Z",
          medianPrice: 1_020_000,
          medianPricePerSquareFoot: 505,
          medianDaysOnMarket: 30,
          totalListings: 100,
          newListings: 20,
        },
      });
    }
    return new Response("unexpected", { status: 500 });
  };
}

function createProperty(id: string, latitude: number, longitude: number) {
  return {
    id,
    formattedAddress: "100 Test Ave, Irvine, CA 92618",
    city: "Irvine",
    state: "CA",
    zipCode: "92618",
    latitude,
    longitude,
    propertyType: "Single Family",
    bedrooms: 4,
    bathrooms: 3,
    squareFootage: 2_000,
    lotSize: 5_000,
    yearBuilt: 2000,
  };
}
