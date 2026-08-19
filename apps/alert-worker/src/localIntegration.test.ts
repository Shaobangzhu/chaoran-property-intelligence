import { describe, expect, it, vi } from "vitest";

import { CheckNewListings } from "@chaoran-property-intelligence/application";
import { matchesMvpSearchCriteria } from "@chaoran-property-intelligence/domain";
import {
  RentCastSaleListingsClient,
  type RentCastSaleListing,
} from "@chaoran-property-intelligence/rentcast";
import { TelegramBotClient } from "@chaoran-property-intelligence/telegram";

import { InMemoryListingRepository } from "./inMemoryListingRepository.js";
import { RentCastListingSource } from "./rentCastListingSource.js";

describe("local alert worker integration", () => {
  it("baselines silently, notifies one new listing, and stays idempotent", async () => {
    const baselineListing = createRentCastListing({
      id: "rentcast-baseline",
      formattedAddress: "123 Main St, Eastvale, CA 92880",
      addressLine1: "123 Main St",
      city: "Eastvale",
      zipCode: "92880",
      latitude: 33.9525,
      longitude: -117.5848,
      mlsName: "CRMLS",
      mlsNumber: "IG26000001",
    });
    const newListing = createRentCastListing({
      id: "rentcast-new",
      formattedAddress: "456 Oak Ave, Chino, CA 91710",
      addressLine1: "456 Oak Ave",
      city: "Chino",
      zipCode: "91710",
      latitude: 34.0122,
      longitude: -117.6889,
      mlsName: null,
      mlsNumber: null,
    });
    const outsideCityListing = createRentCastListing({
      id: "rentcast-brea",
      formattedAddress: "1065 Brea Mall, Brea, CA 92821",
      addressLine1: "1065 Brea Mall",
      city: "Brea",
      zipCode: "92821",
      latitude: 33.9141,
      longitude: -117.8879,
      mlsName: null,
      mlsNumber: null,
    });
    const rentCastResponses = [
      [baselineListing, outsideCityListing],
      [baselineListing, newListing, outsideCityListing],
      [baselineListing, newListing, outsideCityListing],
    ];
    const rentCastFetch = vi.fn<typeof fetch>(async () => {
      const responseBody = rentCastResponses.shift();
      if (responseBody === undefined) {
        throw new Error("Unexpected RentCast request");
      }

      return Response.json(responseBody);
    });
    const telegramFetch = vi.fn<typeof fetch>(async () =>
      Response.json({ ok: true }),
    );
    const repository = new InMemoryListingRepository();
    const source = new RentCastListingSource({
      client: new RentCastSaleListingsClient({
        apiKey: "fake-api-key",
        fetch: rentCastFetch,
      }),
      now: () => new Date("2026-08-19T17:00:00.000Z"),
    });
    const checkNewListings = new CheckNewListings({
      source,
      repository,
      notifications: new TelegramBotClient({
        botToken: "fake-bot-token",
        chatId: "fake-chat-id",
        fetch: telegramFetch,
      }),
      criteria: {
        matchesSearchCriteria: matchesMvpSearchCriteria,
      },
    });

    await checkNewListings.execute();
    expect(repository.baselineInitialized).toBe(true);
    expect(telegramFetch).not.toHaveBeenCalled();

    await checkNewListings.execute();
    await checkNewListings.execute();

    expect(rentCastFetch).toHaveBeenCalledTimes(3);
    expect(telegramFetch).toHaveBeenCalledTimes(1);
    const telegramRequest = telegramFetch.mock.calls[0];
    if (telegramRequest === undefined) {
      throw new Error("Expected one Telegram request");
    }
    const [telegramUrl, telegramInit] = telegramRequest;
    expect(String(telegramUrl)).toBe(
      "https://api.telegram.org/botfake-bot-token/sendMessage",
    );
    expect(telegramInit?.method).toBe("POST");
    expect(JSON.parse(String(telegramInit?.body))).toEqual({
      chat_id: "fake-chat-id",
      text: "456 Oak Ave, Chino, CA 91710",
    });

    const storedRecords = [...repository.records.values()];
    expect(
      storedRecords.map((record) => ({
        deduplicationKey: record.deduplicationKey,
        notificationStatus: record.notificationStatus,
      })),
    ).toEqual([
      {
        deduplicationKey: "mls:CRMLS:IG26000001:2026-08-19",
        notificationStatus: "baseline",
      },
      {
        deduplicationKey: "rentcast:rentcast-new:2026-08-19",
        notificationStatus: "sent",
      },
    ]);
    expect(storedRecords[0]?.listing).toMatchObject({
      source: "rentcast",
      sourceListingId: "rentcast-baseline",
      latitude: 33.9525,
      longitude: -117.5848,
      firstDiscoveredAt: "2026-08-19T17:00:00.000Z",
    });
    expect(storedRecords[1]?.listing).toMatchObject({
      sourceListingId: "rentcast-new",
      formattedAddress: "456 Oak Ave, Chino, CA 91710",
    });
    expect(storedRecords.some((record) => record.listing.city === "Brea")).toBe(
      false,
    );
  });
});

function createRentCastListing(
  overrides: Partial<RentCastSaleListing> = {},
): RentCastSaleListing {
  return {
    id: "rentcast-listing-id",
    formattedAddress: "123 Main St, Eastvale, CA 92880",
    addressLine1: "123 Main St",
    addressLine2: null,
    city: "Eastvale",
    state: "CA",
    zipCode: "92880",
    latitude: 33.9525,
    longitude: -117.5848,
    propertyType: "Single Family",
    bedrooms: 4,
    bathrooms: 2.5,
    status: "Active",
    price: 825000,
    listedDate: "2026-08-19",
    lastSeenDate: "2026-08-19",
    mlsName: null,
    mlsNumber: null,
    ...overrides,
  };
}
