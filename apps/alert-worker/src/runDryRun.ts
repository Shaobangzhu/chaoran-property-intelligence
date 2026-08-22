import {
  CheckListingAlerts,
  FakeListingAlertNotifications,
  FakeListingAlertStateRepository,
  type ListingSourcePort,
} from "@chaoran-property-intelligence/application";
import {
  matchesMvpSearchCriteria,
  matchesPriceAlertAcquisitionCriteria,
  type RentCastNormalizedListing,
} from "@chaoran-property-intelligence/domain";

export interface DryRunSummary {
  baselineInitialized: boolean;
  storedListings: number;
  notificationBatches: number;
}

export async function runDryRun(): Promise<DryRunSummary> {
  const repository = new FakeListingAlertStateRepository();
  const notifications = new FakeListingAlertNotifications();
  const checkListingAlerts = new CheckListingAlerts({
    source: new StaticListingSource(createDryRunListings()),
    repository,
    notifications,
    criteria: {
      matchesAcquisitionCriteria: matchesPriceAlertAcquisitionCriteria,
      matchesNewListingCriteria: matchesMvpSearchCriteria,
    },
    now: () => new Date("2026-08-21T15:00:00.000Z"),
  });

  await checkListingAlerts.execute();

  return {
    baselineInitialized:
      await repository.isPriceObservationBaselineInitialized(),
    storedListings: repository.listingSnapshots.length,
    notificationBatches: notifications.calls.length,
  };
}

class StaticListingSource implements ListingSourcePort {
  constructor(private readonly listings: RentCastNormalizedListing[]) {}

  async getActiveSaleListings(): Promise<RentCastNormalizedListing[]> {
    return this.listings;
  }
}

function createDryRunListings(): RentCastNormalizedListing[] {
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
    RentCastNormalizedListing,
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
): RentCastNormalizedListing {
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
