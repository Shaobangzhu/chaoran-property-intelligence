import type { NormalizedListing } from "@chaoran-property-intelligence/domain";

export type NotificationStatus = "baseline" | "pending" | "sent";

export interface StoredListing {
  deduplicationKey: string;
  listing: NormalizedListing;
  notificationStatus: NotificationStatus;
}

export interface ListingSourcePort {
  getActiveSaleListings(): Promise<NormalizedListing[]>;
}

export interface ListingRepositoryPort {
  isBaselineInitialized(): Promise<boolean>;
  initializeBaseline(listings: StoredListing[]): Promise<void>;
  findByDeduplicationKeys(deduplicationKeys: string[]): Promise<StoredListing[]>;
  savePendingListings(listings: StoredListing[]): Promise<void>;
  findPendingListings(): Promise<StoredListing[]>;
  markNotificationSent(deduplicationKeys: string[]): Promise<void>;
}

export interface ListingNotificationPort {
  sendListingAddresses(addresses: string[]): Promise<void>;
}

export interface ListingCriteriaPort {
  matchesSearchCriteria(listing: NormalizedListing): boolean;
}

export interface CheckNewListingsOptions {
  source: ListingSourcePort;
  repository: ListingRepositoryPort;
  notifications: ListingNotificationPort;
  criteria: ListingCriteriaPort;
}

export class CheckNewListings {
  private readonly source: ListingSourcePort;
  private readonly repository: ListingRepositoryPort;
  private readonly notifications: ListingNotificationPort;
  private readonly criteria: ListingCriteriaPort;

  constructor(options: CheckNewListingsOptions) {
    this.source = options.source;
    this.repository = options.repository;
    this.notifications = options.notifications;
    this.criteria = options.criteria;
  }

  async execute(): Promise<void> {
    const sourceListings = await this.source.getActiveSaleListings();
    const matchingListings = sourceListings.filter((listing) =>
      this.criteria.matchesSearchCriteria(listing),
    );

    const baselineInitialized =
      await this.repository.isBaselineInitialized();

    if (!baselineInitialized) {
      await this.repository.initializeBaseline(
        matchingListings.map((listing) => ({
          deduplicationKey: createDeduplicationKey(listing),
          listing,
          notificationStatus: "baseline",
        })),
      );
      return;
    }

    const newPendingListings =
      await this.createPendingRecordsForNewListings(matchingListings);
    await this.repository.savePendingListings(newPendingListings);

    const pendingListings = await this.repository.findPendingListings();
    if (pendingListings.length === 0) {
      return;
    }

    await this.notifications.sendListingAddresses(
      pendingListings.map((record) => record.listing.formattedAddress),
    );
    await this.repository.markNotificationSent(
      pendingListings.map((record) => record.deduplicationKey),
    );
  }

  private async createPendingRecordsForNewListings(
    listings: NormalizedListing[],
  ): Promise<StoredListing[]> {
    const candidateRecords = listings.map((listing) => ({
      deduplicationKey: createDeduplicationKey(listing),
      listing,
      notificationStatus: "pending" as const,
    }));
    const existingRecords = await this.repository.findByDeduplicationKeys(
      candidateRecords.map((record) => record.deduplicationKey),
    );
    const existingKeys = new Set(
      existingRecords.map((record) => record.deduplicationKey),
    );

    return candidateRecords.filter(
      (record) => !existingKeys.has(record.deduplicationKey),
    );
  }
}

function createDeduplicationKey(listing: NormalizedListing): string {
  if (listing.mlsName !== null && listing.mlsNumber !== null) {
    return `mls:${listing.mlsName}:${listing.mlsNumber}:${listing.listedDate}`;
  }

  return `${listing.source}:${listing.sourceListingId}:${listing.listedDate}`;
}
