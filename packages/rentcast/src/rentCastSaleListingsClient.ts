const rentCastSaleListingsUrl = "https://api.rentcast.io/v1/listings/sale";
const defaultTimeoutMs = 30000;
const saleListingsResultLimit = 500;

type SaleListingsRequestProfile =
  | "price-alert-production"
  | "price-drop-coverage-audit";

export interface RentCastSaleListingsClientOptions {
  apiKey: string;
  fetch: typeof fetch;
  timeoutMs?: number;
}

export interface RentCastSaleListing {
  id: string;
  formattedAddress: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string;
  zipCode: string;
  latitude: number;
  longitude: number;
  propertyType: string;
  bedrooms: number;
  bathrooms: number;
  status: string;
  price: number;
  listedDate: string;
  lastSeenDate: string;
  mlsName: string | null;
  mlsNumber: string | null;
}

export interface RentCastSaleListingsCoveragePage {
  listings: RentCastSaleListing[];
  responseBodyBytes: number;
  resultLimit: number;
  totalCount: number;
}

export interface RentCastListingsPort {
  searchSaleListings(): Promise<RentCastSaleListing[]>;
}

export class RentCastSaleListingsClient implements RentCastListingsPort {
  private readonly apiKey: string;
  private readonly fetch: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: RentCastSaleListingsClientOptions) {
    this.apiKey = options.apiKey;
    this.fetch = options.fetch;
    this.timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
  }

  async searchSaleListings(): Promise<RentCastSaleListing[]> {
    const result = await this.requestSaleListings(
      "price-alert-production",
    );
    return result.listings;
  }

  async searchSaleListingsForCoverageAudit(): Promise<RentCastSaleListingsCoveragePage> {
    const result = await this.requestSaleListings(
      "price-drop-coverage-audit",
    );
    const totalCount = readCoverageTotalCount(result.response);

    if (totalCount < result.listings.length) {
      throw new Error(
        "RentCast coverage audit total count was smaller than the response page",
      );
    }

    return {
      listings: result.listings,
      responseBodyBytes: result.responseBodyBytes,
      resultLimit: saleListingsResultLimit,
      totalCount,
    };
  }

  private async requestSaleListings(
    profile: SaleListingsRequestProfile,
  ): Promise<SaleListingsRequestResult> {
    const url = createSaleListingsUrl(profile);

    const abortController = new AbortController();
    const timeout = setTimeout(() => {
      abortController.abort();
    }, this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "X-Api-Key": this.apiKey,
        },
        signal: abortController.signal,
      });
    } catch (error) {
      if (isAbortError(error)) {
        throw new Error("RentCast sale listings request timed out");
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new Error(
        `RentCast sale listings request failed with status ${response.status}`,
      );
    }

    let responseText: string;
    try {
      responseText = await response.text();
    } catch {
      throw new Error("RentCast sale listings response was not valid JSON");
    }

    let body: unknown;
    try {
      body = JSON.parse(responseText) as unknown;
    } catch {
      throw new Error("RentCast sale listings response was not valid JSON");
    }

    if (!Array.isArray(body)) {
      throw new Error(
        "RentCast sale listings response did not match the expected schema",
      );
    }

    return {
      listings: body.map(parseRentCastSaleListing),
      response,
      responseBodyBytes: new TextEncoder().encode(responseText).byteLength,
    };
  }
}

interface SaleListingsRequestResult {
  listings: RentCastSaleListing[];
  response: Response;
  responseBodyBytes: number;
}

function createSaleListingsUrl(
  profile: SaleListingsRequestProfile,
): URL {
  const url = new URL(rentCastSaleListingsUrl);
  url.searchParams.set("address", "1065 Brea Mall, Brea, CA 92821");
  url.searchParams.set("radius", "20");
  url.searchParams.set("state", "CA");
  url.searchParams.set("status", "Active");
  url.searchParams.set("propertyType", "Single Family");
  url.searchParams.set("price", "*:850000");
  url.searchParams.set("bedrooms", "4:");
  url.searchParams.set("bathrooms", "2.5:");
  url.searchParams.set("limit", String(saleListingsResultLimit));

  if (profile === "price-drop-coverage-audit") {
    url.searchParams.set("includeTotalCount", "true");
  }

  return url;
}

function readCoverageTotalCount(response: Response): number {
  const value = response.headers.get("X-Total-Count");
  if (value === null || !/^\d+$/.test(value)) {
    throw new Error(
      "RentCast coverage audit response did not include a valid X-Total-Count header",
    );
  }

  const totalCount = Number(value);
  if (!Number.isSafeInteger(totalCount)) {
    throw new Error(
      "RentCast coverage audit response did not include a valid X-Total-Count header",
    );
  }

  return totalCount;
}

function parseRentCastSaleListing(value: unknown): RentCastSaleListing {
  if (!isRecord(value)) {
    throwInvalidSchemaError();
  }

  return {
    id: readString(value, "id"),
    formattedAddress: readString(value, "formattedAddress"),
    addressLine1: readString(value, "addressLine1"),
    addressLine2: readNullableString(value, "addressLine2"),
    city: readString(value, "city"),
    state: readString(value, "state"),
    zipCode: readString(value, "zipCode"),
    latitude: readNumber(value, "latitude"),
    longitude: readNumber(value, "longitude"),
    propertyType: readString(value, "propertyType"),
    bedrooms: readNumber(value, "bedrooms"),
    bathrooms: readNumber(value, "bathrooms"),
    status: readString(value, "status"),
    price: readNumber(value, "price"),
    listedDate: readString(value, "listedDate"),
    lastSeenDate: readString(value, "lastSeenDate"),
    mlsName: readOptionalNullableString(value, "mlsName"),
    mlsNumber: readOptionalNullableString(value, "mlsNumber"),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(
  record: Record<string, unknown>,
  key: string,
): string {
  const value = record[key];
  if (typeof value !== "string") {
    throwInvalidSchemaError();
  }

  return value;
}

function readNullableString(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const value = record[key];
  if (value === null || typeof value === "string") {
    return value;
  }

  throwInvalidSchemaError();
}

function readOptionalNullableString(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const value = record[key];
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === "string") {
    return value;
  }

  throwInvalidSchemaError();
}

function readNumber(
  record: Record<string, unknown>,
  key: string,
): number {
  const value = record[key];
  if (typeof value !== "number") {
    throwInvalidSchemaError();
  }

  return value;
}

function throwInvalidSchemaError(): never {
  throw new Error(
    "RentCast sale listings response did not match the expected schema",
  );
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
