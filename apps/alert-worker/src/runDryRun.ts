import {
  CheckNewListings,
  type ListingNotificationPort,
  type ListingRepositoryPort,
  type ListingSourcePort,
  type NormalizedListing,
  type StoredListing,
} from "@chaoran-property-intelligence/application";
import { matchesMvpSearchCriteria } from "@chaoran-property-intelligence/domain";

export interface DryRunSummary {
  baselineInitialized: boolean;
  storedListings: number;
  notificationBatches: number;
}

export async function runDryRun(): Promise<DryRunSummary> {
  const repository = new InMemoryListingRepository();
  const notifications = new RecordingListingNotifications();
  const checkNewListings = new CheckNewListings({
    source: new StaticListingSource(createDryRunListings()),
    repository,
    notifications,
    criteria: {
      matchesSearchCriteria: matchesMvpSearchCriteria,
    },
  });

  await checkNewListings.execute();

  return {
    baselineInitialized: repository.baselineInitialized,
    storedListings: repository.records.size,
    notificationBatches: notifications.sentAddressBatches.length,
  };
}

class StaticListingSource implements ListingSourcePort {
  constructor(private readonly listings: NormalizedListing[]) {}

  async getActiveSaleListings(): Promise<NormalizedListing[]> {
    return this.listings;
  }
}

class InMemoryListingRepository implements ListingRepositoryPort {
  baselineInitialized = false;
  readonly records = new Map<string, StoredListing>();

  async isBaselineInitialized(): Promise<boolean> {
    return this.baselineInitialized;
  }

  async initializeBaseline(listings: StoredListing[]): Promise<void> {
    for (const listing of listings) {
      this.records.set(listing.deduplicationKey, listing);
    }
    this.baselineInitialized = true;
  }

  async findByDeduplicationKeys(
    deduplicationKeys: string[],
  ): Promise<StoredListing[]> {
    return deduplicationKeys.flatMap((key) => {
      const listing = this.records.get(key);
      return listing === undefined ? [] : [listing];
    });
  }

  async savePendingListings(listings: StoredListing[]): Promise<void> {
    for (const listing of listings) {
      this.records.set(listing.deduplicationKey, listing);
    }
  }

  async findPendingListings(): Promise<StoredListing[]> {
    return [...this.records.values()].filter(
      (record) => record.notificationStatus === "pending",
    );
  }

  async markNotificationSent(
    deduplicationKeys: string[],
  ): Promise<void> {
    for (const key of deduplicationKeys) {
      const record = this.records.get(key);
      if (record !== undefined) {
        this.records.set(key, {
          ...record,
          notificationStatus: "sent",
        });
      }
    }
  }
}

class RecordingListingNotifications implements ListingNotificationPort {
  readonly sentAddressBatches: string[][] = [];

  async sendListingAddresses(addresses: string[]): Promise<void> {
    this.sentAddressBatches.push(addresses);
  }
}

function createDryRunListings(): NormalizedListing[] {
  return [
    createListing({
      sourceListingId: "dry-run-target",
      formattedAddress: "123 Main St, Eastvale, CA 92880",
      addressLine1: "123 Main St",
      city: "Eastvale",
      zipCode: "92880",
      latitude: 33.9525,
      longitude: -117.5848,
      mlsName: "CRMLS",
      mlsNumber: "DRY000001",
    }),
    createListing({
      sourceListingId: "dry-run-outside-city",
      formattedAddress: "1065 Brea Mall, Brea, CA 92821",
      addressLine1: "1065 Brea Mall",
      city: "Brea",
      zipCode: "92821",
      latitude: 33.9141,
      longitude: -117.8879,
      mlsName: null,
      mlsNumber: null,
    }),
  ];
}

function createListing(
  overrides: Pick<
    NormalizedListing,
    | "sourceListingId"
    | "formattedAddress"
    | "addressLine1"
    | "city"
    | "zipCode"
    | "latitude"
    | "longitude"
    | "mlsName"
    | "mlsNumber"
  >,
): NormalizedListing {
  return {
    source: "rentcast",
    addressLine2: null,
    state: "CA",
    propertyType: "Single Family",
    bedrooms: 4,
    bathrooms: 2.5,
    price: 825000,
    status: "Active",
    listedDate: "2026-08-19",
    lastSeenDate: "2026-08-19",
    firstDiscoveredAt: "2026-08-19T17:00:00.000Z",
    ...overrides,
  };
}
