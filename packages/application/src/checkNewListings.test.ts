import { describe, expect, it } from "vitest";

import type { RentCastNormalizedListing } from "@chaoran-property-intelligence/domain";

import {
  CheckNewListings,
  type ListingCriteriaPort,
  type ListingNotificationPort,
  type ListingRepositoryPort,
  type ListingSourcePort,
  type StoredListing,
} from "./checkNewListings.js";

describe("CheckNewListings", () => {
  it("silently initializes baseline with current matching listings on first run", async () => {
    const source = new FakeListingSource([
      createListing({
        sourceListingId: "rentcast-1",
        formattedAddress: "123 Main St, Eastvale, CA 92880",
        city: "Eastvale",
        mlsName: "CRMLS",
        mlsNumber: "IG26123456",
      }),
      createListing({
        sourceListingId: "rentcast-2",
        formattedAddress: "999 Outside Ave, Brea, CA 92821",
        city: "Brea",
      }),
    ]);
    const repository = new FakeListingRepository();
    const notifications = new FakeListingNotifications();
    const checkNewListings = new CheckNewListings({
      source,
      repository,
      notifications,
      criteria: new FakeListingCriteria(),
    });

    await checkNewListings.execute();

    expect(notifications.sentAddressBatches).toEqual([]);
    expect(repository.baselineInitialized).toBe(true);
    expect(repository.records).toEqual([
      {
        deduplicationKey: "mls:CRMLS:IG26123456:2026-08-17",
        listing: createListing({
          sourceListingId: "rentcast-1",
          formattedAddress: "123 Main St, Eastvale, CA 92880",
          city: "Eastvale",
          mlsName: "CRMLS",
          mlsNumber: "IG26123456",
        }),
        notificationStatus: "baseline",
      },
    ]);
  });

  it("initializes the baseline marker even when there are no matching listings", async () => {
    const source = new FakeListingSource([]);
    const repository = new FakeListingRepository();
    const notifications = new FakeListingNotifications();
    const checkNewListings = new CheckNewListings({
      source,
      repository,
      notifications,
      criteria: new FakeListingCriteria(),
    });

    await checkNewListings.execute();

    expect(repository.baselineInitialized).toBe(true);
    expect(repository.records).toEqual([]);
    expect(notifications.sentAddressBatches).toEqual([]);
  });

  it("stores a new listing as pending, sends its address, then marks it sent", async () => {
    const listing = createListing({
      sourceListingId: "rentcast-new",
      formattedAddress: "456 Oak Ave, Chino, CA 91710",
      city: "Chino",
      mlsName: null,
      mlsNumber: null,
    });
    const source = new FakeListingSource([listing]);
    const repository = new FakeListingRepository({
      baselineInitialized: true,
    });
    const notifications = new FakeListingNotifications();
    const checkNewListings = new CheckNewListings({
      source,
      repository,
      notifications,
      criteria: new FakeListingCriteria(),
    });

    await checkNewListings.execute();

    expect(repository.statusTransitions).toEqual([
      "pending:rentcast:rentcast-new:2026-08-17",
      "sent:rentcast:rentcast-new:2026-08-17",
    ]);
    expect(notifications.sentAddressBatches).toEqual([
      ["456 Oak Ave, Chino, CA 91710"],
    ]);
    expect(repository.records).toEqual([
      {
        deduplicationKey: "rentcast:rentcast-new:2026-08-17",
        listing,
        notificationStatus: "sent",
      },
    ]);
  });

  it("keeps a new listing pending when notification fails", async () => {
    const listing = createListing({
      sourceListingId: "rentcast-new",
      formattedAddress: "456 Oak Ave, Chino, CA 91710",
      city: "Chino",
    });
    const source = new FakeListingSource([listing]);
    const repository = new FakeListingRepository({
      baselineInitialized: true,
    });
    const notifications = new FakeListingNotifications({
      failOnSend: true,
    });
    const checkNewListings = new CheckNewListings({
      source,
      repository,
      notifications,
      criteria: new FakeListingCriteria(),
    });

    await expect(checkNewListings.execute()).rejects.toThrow(
      "Telegram unavailable",
    );

    expect(repository.records).toEqual([
      {
        deduplicationKey: "rentcast:rentcast-new:2026-08-17",
        listing,
        notificationStatus: "pending",
      },
    ]);
  });

  it("retries pending notifications on the next run", async () => {
    const pendingListing = createListing({
      sourceListingId: "rentcast-pending",
      formattedAddress: "789 Pine Dr, Corona, CA 92879",
      city: "Corona",
    });
    const source = new FakeListingSource([]);
    const repository = new FakeListingRepository({
      baselineInitialized: true,
      records: [
        {
          deduplicationKey: "rentcast:rentcast-pending:2026-08-17",
          listing: pendingListing,
          notificationStatus: "pending",
        },
      ],
    });
    const notifications = new FakeListingNotifications();
    const checkNewListings = new CheckNewListings({
      source,
      repository,
      notifications,
      criteria: new FakeListingCriteria(),
    });

    await checkNewListings.execute();

    expect(notifications.sentAddressBatches).toEqual([
      ["789 Pine Dr, Corona, CA 92879"],
    ]);
    expect(repository.records[0]?.notificationStatus).toBe("sent");
  });

  it("does not resend listings that were already sent", async () => {
    const sentListing = createListing({
      sourceListingId: "rentcast-sent",
      formattedAddress: "321 Birch Ln, Jurupa Valley, CA 92509",
      city: "Jurupa Valley",
    });
    const source = new FakeListingSource([sentListing]);
    const repository = new FakeListingRepository({
      baselineInitialized: true,
      records: [
        {
          deduplicationKey: "rentcast:rentcast-sent:2026-08-17",
          listing: sentListing,
          notificationStatus: "sent",
        },
      ],
    });
    const notifications = new FakeListingNotifications();
    const checkNewListings = new CheckNewListings({
      source,
      repository,
      notifications,
      criteria: new FakeListingCriteria(),
    });

    await checkNewListings.execute();

    expect(notifications.sentAddressBatches).toEqual([]);
    expect(repository.records[0]?.notificationStatus).toBe("sent");
  });

  it("treats the same MLS listing with a new listed date as a relisting", async () => {
    const oldListing = createListing({
      sourceListingId: "rentcast-old",
      formattedAddress: "654 Maple St, Chino Hills, CA 91709",
      city: "Chino Hills",
      mlsName: "CRMLS",
      mlsNumber: "CV26000001",
      listedDate: "2026-08-01",
    });
    const relistedListing = createListing({
      sourceListingId: "rentcast-new",
      formattedAddress: "654 Maple St, Chino Hills, CA 91709",
      city: "Chino Hills",
      mlsName: "CRMLS",
      mlsNumber: "CV26000001",
      listedDate: "2026-08-17",
    });
    const source = new FakeListingSource([relistedListing]);
    const repository = new FakeListingRepository({
      baselineInitialized: true,
      records: [
        {
          deduplicationKey: "mls:CRMLS:CV26000001:2026-08-01",
          listing: oldListing,
          notificationStatus: "sent",
        },
      ],
    });
    const notifications = new FakeListingNotifications();
    const checkNewListings = new CheckNewListings({
      source,
      repository,
      notifications,
      criteria: new FakeListingCriteria(),
    });

    await checkNewListings.execute();

    expect(notifications.sentAddressBatches).toEqual([
      ["654 Maple St, Chino Hills, CA 91709"],
    ]);
    expect(repository.records.map((record) => record.deduplicationKey)).toEqual(
      [
        "mls:CRMLS:CV26000001:2026-08-01",
        "mls:CRMLS:CV26000001:2026-08-17",
      ],
    );
    expect(repository.records[1]?.notificationStatus).toBe("sent");
  });
});

function createListing(
  overrides: Partial<RentCastNormalizedListing> = {},
): RentCastNormalizedListing {
  return {
    source: "rentcast",
    sourceListingId: "rentcast-listing-id",
    mlsName: null,
    mlsNumber: null,
    formattedAddress: "123 Main St, Eastvale, CA 92880",
    addressLine1: "123 Main St",
    addressLine2: null,
    city: "Eastvale",
    state: "CA",
    zipCode: "92880",
    latitude: 33.9521,
    longitude: -117.5848,
    propertyType: "Single Family",
    bedrooms: 4,
    bathrooms: 3,
    price: 825000,
    status: "Active",
    listedDate: "2026-08-17",
    lastSeenDate: "2026-08-18",
    firstDiscoveredAt: "2026-08-18T13:00:00.000Z",
    ...overrides,
  };
}

class FakeListingSource implements ListingSourcePort {
  constructor(private readonly listings: RentCastNormalizedListing[]) {}

  async getActiveSaleListings(): Promise<RentCastNormalizedListing[]> {
    return this.listings;
  }
}

class FakeListingCriteria implements ListingCriteriaPort {
  matchesSearchCriteria(listing: RentCastNormalizedListing): boolean {
    return listing.city !== "Brea";
  }
}

interface FakeListingRepositoryOptions {
  baselineInitialized?: boolean;
  records?: StoredListing[];
}

class FakeListingRepository implements ListingRepositoryPort {
  baselineInitialized: boolean;
  records: StoredListing[];
  statusTransitions: string[] = [];

  constructor(options: FakeListingRepositoryOptions = {}) {
    this.baselineInitialized = options.baselineInitialized ?? false;
    this.records = options.records ?? [];
  }

  async isBaselineInitialized(): Promise<boolean> {
    return this.baselineInitialized;
  }

  async initializeBaseline(listings: StoredListing[]): Promise<void> {
    this.records = listings;
    this.baselineInitialized = true;
  }

  async findByDeduplicationKeys(keys: string[]): Promise<StoredListing[]> {
    return this.records.filter((record) =>
      keys.includes(record.deduplicationKey),
    );
  }

  async savePendingListings(listings: StoredListing[]): Promise<void> {
    for (const listing of listings) {
      const existingIndex = this.records.findIndex(
        (record) => record.deduplicationKey === listing.deduplicationKey,
      );

      this.statusTransitions.push(`pending:${listing.deduplicationKey}`);

      if (existingIndex === -1) {
        this.records.push(listing);
      } else {
        this.records[existingIndex] = listing;
      }
    }
  }

  async findPendingListings(): Promise<StoredListing[]> {
    return this.records.filter(
      (record) => record.notificationStatus === "pending",
    );
  }

  async markNotificationSent(deduplicationKeys: string[]): Promise<void> {
    for (const deduplicationKey of deduplicationKeys) {
      const record = this.records.find(
        (candidate) => candidate.deduplicationKey === deduplicationKey,
      );
      if (record === undefined) {
        continue;
      }

      record.notificationStatus = "sent";
      this.statusTransitions.push(`sent:${deduplicationKey}`);
    }
  }
}

interface FakeListingNotificationsOptions {
  failOnSend?: boolean;
}

class FakeListingNotifications implements ListingNotificationPort {
  sentAddressBatches: string[][] = [];

  constructor(private readonly options: FakeListingNotificationsOptions = {}) {}

  async sendListingAddresses(addresses: string[]): Promise<void> {
    if (this.options.failOnSend === true) {
      throw new Error("Telegram unavailable");
    }

    this.sentAddressBatches.push(addresses);
  }
}
