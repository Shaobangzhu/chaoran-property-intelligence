import type {
  ListingRepositoryPort,
  StoredListing,
} from "@chaoran-property-intelligence/application";

export class InMemoryListingRepository implements ListingRepositoryPort {
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
