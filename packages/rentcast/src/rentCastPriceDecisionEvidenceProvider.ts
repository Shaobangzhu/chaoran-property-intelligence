import {
  InvalidPriceDecisionEvidenceError,
  normalizePriceDecisionEvidence,
  PriceDecisionEvidenceUnavailableError,
  PriceDecisionSubjectNotFoundError,
  type PriceDecisionEvidence,
  type PriceDecisionEvidencePort,
  type PriceDecisionEvidenceRequest,
  type PriceDecisionMarketContext,
  type PriceDecisionSubject,
  type PriceDecisionTargetListing,
  type RecordedSaleComparable,
} from "@chaoran-property-intelligence/application";

import {
  RentCastPriceDecisionRequestError,
  type RentCastPriceDecisionPort,
  type RentCastRecordedSaleProperty,
  type RentCastSaleMarketData,
  type RentCastSanitizedProperty,
  type RentCastSubjectSaleListing,
  type RentCastValueEstimate,
} from "./rentCastPriceDecisionClient.js";

const supportedPropertyTypes = new Set([
  "Single Family",
  "Condo",
  "Townhouse",
  "Manufactured",
  "Multi-Family",
  "Apartment",
  "Land",
]);

export interface RentCastPriceDecisionEvidenceProviderOptions {
  readonly client: RentCastPriceDecisionPort;
  readonly now: () => Date;
}

export class RentCastPriceDecisionEvidenceProvider
  implements PriceDecisionEvidencePort
{
  private readonly client: RentCastPriceDecisionPort;
  private readonly now: () => Date;

  constructor(options: RentCastPriceDecisionEvidenceProviderOptions) {
    this.client = options.client;
    this.now = options.now;
  }

  async load(
    request: PriceDecisionEvidenceRequest,
  ): Promise<PriceDecisionEvidence> {
    const providerAddress = `${request.address.streetAddress}, ${request.address.city}, CA ${request.address.zipCode}`;

    try {
      const valueEstimate = await this.client.getValueEstimate(
        providerAddress,
        request.signal,
      );
      const subject = mapSubject(valueEstimate.subjectProperty, request);
      const retrievedAt = readClock(this.now);
      const recordedSaleProperties = await this.client.getRecordedSales(
        providerAddress,
        subject.propertyType,
        request.signal,
      );
      const listing = await this.client.getSaleListing(
        subject.propertyId,
        request.signal,
      );
      const market = await this.client.getSaleMarket(
        subject.zipCode,
        request.signal,
      );
      const acquiredAt = readClock(this.now);

      return normalizePriceDecisionEvidence({
        acquiredAt,
        subject,
        recordedSales: mapRecordedSales(recordedSaleProperties, subject),
        targetListing: mapTargetListing(listing),
        marketContext: mapMarket(market, subject.zipCode),
        externalValueEstimate: mapValueEstimate(valueEstimate, retrievedAt),
      });
    } catch (error) {
      if (
        error instanceof RentCastPriceDecisionRequestError &&
        error.endpoint === "avm" &&
        error.reason === "not-found"
      ) {
        throw new PriceDecisionSubjectNotFoundError();
      }
      if (error instanceof PriceDecisionSubjectNotFoundError) {
        throw error;
      }
      if (
        error instanceof RentCastPriceDecisionRequestError ||
        error instanceof InvalidPriceDecisionEvidenceError ||
        error instanceof InvalidRentCastPriceDecisionEvidenceError
      ) {
        throw new PriceDecisionEvidenceUnavailableError();
      }
      throw error;
    }
  }
}

class InvalidRentCastPriceDecisionEvidenceError extends Error {}

function mapSubject(
  property: RentCastSanitizedProperty,
  request: PriceDecisionEvidenceRequest,
): PriceDecisionSubject {
  if (
    property.state !== "CA" ||
    property.zipCode !== request.address.zipCode ||
    !isSupportedPropertyType(property.propertyType)
  ) {
    throw new InvalidRentCastPriceDecisionEvidenceError();
  }
  return {
    propertyId: property.id,
    formattedAddress: property.formattedAddress,
    city: property.city,
    state: "CA",
    zipCode: property.zipCode,
    propertyType: property.propertyType,
    bedrooms: property.bedrooms,
    bathrooms: property.bathrooms,
    squareFootage: property.squareFootage,
    lotSize: property.lotSize,
    yearBuilt: property.yearBuilt,
    latitude: property.latitude,
    longitude: property.longitude,
  };
}

function mapRecordedSales(
  properties: readonly RentCastRecordedSaleProperty[],
  subject: PriceDecisionSubject,
): readonly RecordedSaleComparable[] {
  if (subject.latitude === null || subject.longitude === null) {
    throw new InvalidRentCastPriceDecisionEvidenceError();
  }

  const comparables: RecordedSaleComparable[] = [];
  const propertyIds = new Set<string>();
  for (const property of properties) {
    if (
      property.id === subject.propertyId ||
      propertyIds.has(property.id) ||
      property.lastSaleDate === null ||
      property.lastSalePrice === null ||
      property.latitude === null ||
      property.longitude === null ||
      !isSupportedPropertyType(property.propertyType)
    ) {
      continue;
    }
    propertyIds.add(property.id);
    comparables.push({
      evidenceId: createEvidenceId("recorded-sale", property.id),
      source: "recorded-sale",
      propertyId: property.id,
      formattedAddress: property.formattedAddress,
      salePrice: property.lastSalePrice,
      saleDate: toCanonicalDate(property.lastSaleDate),
      distanceMiles: haversineMiles(
        subject.latitude,
        subject.longitude,
        property.latitude,
        property.longitude,
      ),
      propertyType: property.propertyType,
      bedrooms: property.bedrooms,
      bathrooms: property.bathrooms,
      squareFootage: property.squareFootage,
      lotSize: property.lotSize,
      yearBuilt: property.yearBuilt,
      latitude: property.latitude,
      longitude: property.longitude,
    });
  }
  return comparables;
}

function mapTargetListing(
  listing: RentCastSubjectSaleListing | null,
): PriceDecisionTargetListing | null {
  if (listing === null) {
    return null;
  }
  const episodes = [...listing.history].sort((left, right) =>
    left.listedDate.localeCompare(right.listedDate),
  );
  const events: Array<PriceDecisionTargetListing["events"][number]> = [];
  for (const [index, episode] of episodes.entries()) {
    const listedOn = toCanonicalDate(episode.listedDate);
    const kind = index === 0 ? "listed" : "relisted";
    events.push({
      evidenceId: createEvidenceId(
        `listing-${kind}`,
        `${listing.id}:${listedOn}:${index}`,
      ),
      kind,
      occurredOn: listedOn,
      price: episode.price,
    });
    if (episode.removedDate !== null) {
      const removedOn = toCanonicalDate(episode.removedDate);
      events.push({
        evidenceId: createEvidenceId(
          "listing-removed",
          `${listing.id}:${removedOn}:${index}`,
        ),
        kind: "removed",
        occurredOn: removedOn,
        price: episode.price,
      });
    }
  }

  return {
    evidenceId: createEvidenceId("target-listing", listing.id),
    status: mapListingStatus(listing.status),
    currentListPrice: listing.price,
    listedDate:
      listing.listedDate === null
        ? null
        : toCanonicalDate(listing.listedDate),
    lastSeenDate:
      listing.lastSeenDate === null
        ? null
        : toCanonicalDate(listing.lastSeenDate),
    daysOnMarket: listing.daysOnMarket,
    events,
  };
}

function mapMarket(
  market: RentCastSaleMarketData | null,
  zipCode: string,
): PriceDecisionMarketContext | null {
  if (market === null) {
    return null;
  }
  return {
    evidenceId: createEvidenceId("sale-market", zipCode),
    zipCode,
    lastUpdatedDate: toCanonicalDate(market.lastUpdatedDate),
    medianListPrice: market.medianPrice,
    medianPricePerSquareFoot: market.medianPricePerSquareFoot,
    medianDaysOnMarket: market.medianDaysOnMarket,
    totalListings: market.totalListings,
    newListings: market.newListings,
  };
}

function mapValueEstimate(
  estimate: RentCastValueEstimate,
  retrievedAt: string,
) {
  return {
    evidenceId: createEvidenceId("avm", estimate.subjectProperty.id),
    providerName: "RentCast",
    estimate: estimate.price,
    rangeLow: estimate.priceRangeLow,
    rangeHigh: estimate.priceRangeHigh,
    retrievedAt,
  };
}

function mapListingStatus(
  status: string,
): PriceDecisionTargetListing["status"] {
  if (status === "Active") {
    return "active";
  }
  if (status === "Inactive") {
    return "inactive";
  }
  return "unknown";
}

function isSupportedPropertyType(
  value: string | null,
): value is PriceDecisionSubject["propertyType"] {
  return value !== null && supportedPropertyTypes.has(value);
}

function toCanonicalDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new InvalidRentCastPriceDecisionEvidenceError();
  }
  return date.toISOString().slice(0, 10);
}

function readClock(now: () => Date): string {
  const value = now();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new InvalidRentCastPriceDecisionEvidenceError();
  }
  return value.toISOString();
}

function haversineMiles(
  originLatitude: number,
  originLongitude: number,
  latitude: number,
  longitude: number,
): number {
  const radians = Math.PI / 180;
  const latitudeDelta = (latitude - originLatitude) * radians;
  const longitudeDelta = (longitude - originLongitude) * radians;
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(originLatitude * radians) *
      Math.cos(latitude * radians) *
      Math.sin(longitudeDelta / 2) ** 2;
  const miles = 2 * 3_958.8 * Math.asin(Math.sqrt(a));
  return Math.round(miles * 1_000) / 1_000;
}

function createEvidenceId(kind: string, identity: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < identity.length; index += 1) {
    hash ^= identity.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `rentcast:${kind}:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
