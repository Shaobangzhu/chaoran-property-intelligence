import { describe, expect, it, vi } from "vitest";

import {
  PriceDecisionEvidenceUnavailableError,
  PriceDecisionSubjectNotFoundError,
} from "@chaoran-property-intelligence/application";

import {
  RentCastPriceDecisionRequestError,
  type RentCastPriceDecisionPort,
} from "./rentCastPriceDecisionClient.js";
import { RentCastPriceDecisionEvidenceProvider } from "./rentCastPriceDecisionEvidenceProvider.js";

const address = Object.freeze({
  streetAddress: "100 Test Ave",
  city: "Irvine",
  state: "CA",
  zipCode: "92618",
} as const);

describe("RentCastPriceDecisionEvidenceProvider", () => {
  it("acquires four sources in order and maps recorded sales conservatively", async () => {
    const calls: string[] = [];
    const client = createClient({ calls });
    const provider = new RentCastPriceDecisionEvidenceProvider({
      client,
      now: () => new Date("2026-09-01T12:00:00.000Z"),
    });

    const evidence = await provider.load({ address });

    expect(calls).toEqual([
      "avm:100 Test Ave, Irvine, CA 92618",
      "sales:100 Test Ave, Irvine, CA 92618:Single Family",
      "listing:100-Test-Ave,-Irvine,-CA-92618",
      "market:92618",
    ]);
    expect(evidence.subject).toMatchObject({
      propertyId: "100-Test-Ave,-Irvine,-CA-92618",
      state: "CA",
      zipCode: "92618",
      propertyType: "Single Family",
    });
    expect(evidence.recordedSales).toHaveLength(1);
    expect(evidence.recordedSales[0]).toMatchObject({
      source: "recorded-sale",
      salePrice: 1_010_000,
      saleDate: "2026-05-10",
      distanceMiles: 0.09,
    });
    expect(evidence.targetListing).toMatchObject({
      status: "inactive",
      currentListPrice: 1_075_000,
      daysOnMarket: 61,
    });
    expect(evidence.targetListing?.events.map((event) => event.kind)).toEqual([
      "listed",
      "removed",
      "relisted",
    ]);
    expect(evidence.targetListing?.events).not.toContainEqual(
      expect.objectContaining({ kind: "price-change" }),
    );
    expect(evidence.marketContext).toMatchObject({
      zipCode: "92618",
      medianListPrice: 1_025_000,
      medianDaysOnMarket: 27,
    });
    expect(evidence.externalValueEstimate).toMatchObject({
      providerName: "RentCast",
      estimate: 1_050_000,
      rangeLow: 990_000,
      rangeHigh: 1_110_000,
    });
    expect(Object.isFrozen(evidence)).toBe(true);
  });

  it("does not convert an AVM listing comparable into a recorded sale", async () => {
    const provider = new RentCastPriceDecisionEvidenceProvider({
      client: createClient({ recordedSales: [] }),
      now: () => new Date("2026-09-01T12:00:00.000Z"),
    });

    const evidence = await provider.load({ address });
    expect(evidence.recordedSales).toEqual([]);
    expect(evidence.externalValueEstimate?.estimate).toBe(1_050_000);
  });

  it("maps AVM not-found and all other provider failures to bounded errors", async () => {
    const notFoundClient = createClient();
    notFoundClient.getValueEstimate = vi.fn(async () => {
      throw new RentCastPriceDecisionRequestError("avm", "not-found");
    });
    const unavailableClient = createClient();
    unavailableClient.getRecordedSales = vi.fn(async () => {
      throw new RentCastPriceDecisionRequestError(
        "recorded-sales",
        "timeout",
      );
    });

    await expect(createProvider(notFoundClient).load({ address })).rejects.toThrow(
      PriceDecisionSubjectNotFoundError,
    );
    await expect(
      createProvider(unavailableClient).load({ address }),
    ).rejects.toThrow(PriceDecisionEvidenceUnavailableError);
    expect(unavailableClient.getSaleListing).not.toHaveBeenCalled();
    expect(unavailableClient.getSaleMarket).not.toHaveBeenCalled();
  });

  it("fails closed when the provider resolves a different ZIP", async () => {
    const client = createClient();
    client.getValueEstimate = vi.fn(async () => ({
      ...(await createClient().getValueEstimate("ignored")),
      subjectProperty: {
        ...(await createClient().getValueEstimate("ignored")).subjectProperty,
        zipCode: "92620",
      },
    }));

    await expect(createProvider(client).load({ address })).rejects.toThrow(
      PriceDecisionEvidenceUnavailableError,
    );
    expect(client.getRecordedSales).not.toHaveBeenCalled();
  });
});

function createProvider(client: RentCastPriceDecisionPort) {
  return new RentCastPriceDecisionEvidenceProvider({
    client,
    now: () => new Date("2026-09-01T12:00:00.000Z"),
  });
}

function createClient(options: {
  calls?: string[];
  recordedSales?: readonly Awaited<
    ReturnType<RentCastPriceDecisionPort["getRecordedSales"]>
  >[number][];
} = {}): RentCastPriceDecisionPort & {
  getValueEstimate: ReturnType<typeof vi.fn>;
  getRecordedSales: ReturnType<typeof vi.fn>;
  getSaleListing: ReturnType<typeof vi.fn>;
  getSaleMarket: ReturnType<typeof vi.fn>;
} {
  const subject = {
    id: "100-Test-Ave,-Irvine,-CA-92618",
    formattedAddress: "100 Test Ave, Irvine, CA 92618",
    city: "Irvine",
    state: "CA",
    zipCode: "92618",
    latitude: 33.65,
    longitude: -117.74,
    propertyType: "Single Family",
    bedrooms: 4,
    bathrooms: 3,
    squareFootage: 2200,
    lotSize: 5000,
    yearBuilt: 2012,
  } as const;
  const defaultRecordedSales = [
    {
      ...subject,
      id: "200-Fixture-Rd,-Irvine,-CA-92618",
      formattedAddress: "200 Fixture Rd, Irvine, CA 92618",
      latitude: 33.651,
      longitude: -117.741,
      lastSaleDate: "2026-05-10T00:00:00.000Z",
      lastSalePrice: 1_010_000,
    },
    {
      ...subject,
      lastSaleDate: "2025-01-01T00:00:00.000Z",
      lastSalePrice: 900_000,
    },
  ];
  return {
    getValueEstimate: vi.fn(async (providerAddress: string) => {
      options.calls?.push(`avm:${providerAddress}`);
      return {
        price: 1_050_000,
        priceRangeLow: 990_000,
        priceRangeHigh: 1_110_000,
        subjectProperty: subject,
      };
    }),
    getRecordedSales: vi.fn(
      async (providerAddress: string, propertyType: string) => {
        options.calls?.push(`sales:${providerAddress}:${propertyType}`);
        return options.recordedSales ?? defaultRecordedSales;
      },
    ),
    getSaleListing: vi.fn(async (propertyId: string) => {
      options.calls?.push(`listing:${propertyId}`);
      return {
        id: subject.id,
        status: "Inactive",
        price: 1_075_000,
        listedDate: "2026-06-15T00:00:00.000Z",
        lastSeenDate: "2026-08-15T12:00:00.000Z",
        daysOnMarket: 61,
        history: [
          {
            listedDate: "2026-01-01T00:00:00.000Z",
            removedDate: "2026-02-01T00:00:00.000Z",
            price: 1_100_000,
          },
          {
            listedDate: "2026-06-15T00:00:00.000Z",
            removedDate: null,
            price: 1_075_000,
          },
        ],
      };
    }),
    getSaleMarket: vi.fn(async (zipCode: string) => {
      options.calls?.push(`market:${zipCode}`);
      return {
        lastUpdatedDate: "2026-08-31T00:00:00.000Z",
        medianPrice: 1_025_000,
        medianPricePerSquareFoot: 535.25,
        medianDaysOnMarket: 27,
        totalListings: 45,
        newListings: 8,
      };
    }),
  };
}
