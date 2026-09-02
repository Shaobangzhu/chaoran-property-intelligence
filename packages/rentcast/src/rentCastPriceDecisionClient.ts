const rentCastApiBaseUrl = "https://api.rentcast.io/v1";
const defaultTimeoutMs = 30_000;

export const RENTCAST_PRICE_DECISION_CALL_BUDGET = Object.freeze({
  maximumRequestsPerEstimation: 4,
  retryCount: 0,
  recordedSalesRadiusMiles: 5,
  recordedSalesAgeDays: 365,
  recordedSalesLimit: 25,
  avmComparableCount: 20,
});

export type RentCastPriceDecisionEndpoint =
  | "avm"
  | "recorded-sales"
  | "listing-history"
  | "market";

export type RentCastPriceDecisionRequestOutcome =
  | "success"
  | "not-found"
  | "http-error"
  | "timeout"
  | "aborted"
  | "network-error"
  | "invalid-response";

export interface RentCastPriceDecisionRequestEvent {
  readonly endpoint: RentCastPriceDecisionEndpoint;
  readonly outcome: RentCastPriceDecisionRequestOutcome;
  readonly durationMs: number;
  readonly status?: number;
}

export interface RentCastPriceDecisionClientOptions {
  readonly apiKey: string;
  readonly fetch: typeof fetch;
  readonly timeoutMs?: number;
  readonly onRequest?: (event: RentCastPriceDecisionRequestEvent) => void;
  readonly nowMilliseconds?: () => number;
}

export interface RentCastSanitizedProperty {
  readonly id: string;
  readonly formattedAddress: string;
  readonly city: string;
  readonly state: string;
  readonly zipCode: string;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly propertyType: string | null;
  readonly bedrooms: number | null;
  readonly bathrooms: number | null;
  readonly squareFootage: number | null;
  readonly lotSize: number | null;
  readonly yearBuilt: number | null;
}

export interface RentCastValueEstimate {
  readonly price: number;
  readonly priceRangeLow: number;
  readonly priceRangeHigh: number;
  readonly subjectProperty: RentCastSanitizedProperty;
}

export interface RentCastRecordedSaleProperty
  extends RentCastSanitizedProperty {
  readonly lastSaleDate: string | null;
  readonly lastSalePrice: number | null;
}

export interface RentCastListingEpisode {
  readonly listedDate: string;
  readonly removedDate: string | null;
  readonly price: number;
}

export interface RentCastSubjectSaleListing {
  readonly id: string;
  readonly status: string;
  readonly price: number | null;
  readonly listedDate: string | null;
  readonly lastSeenDate: string | null;
  readonly daysOnMarket: number | null;
  readonly history: readonly RentCastListingEpisode[];
}

export interface RentCastSaleMarketData {
  readonly lastUpdatedDate: string;
  readonly medianPrice: number | null;
  readonly medianPricePerSquareFoot: number | null;
  readonly medianDaysOnMarket: number | null;
  readonly totalListings: number | null;
  readonly newListings: number | null;
}

export type RentCastPriceDecisionRequestFailure =
  | Exclude<RentCastPriceDecisionRequestOutcome, "success">;

export class InvalidRentCastPriceDecisionConfigurationError extends Error {
  constructor() {
    super("RentCast Price Decision configuration was invalid");
    this.name = "InvalidRentCastPriceDecisionConfigurationError";
  }
}

export class RentCastPriceDecisionRequestError extends Error {
  constructor(
    readonly endpoint: RentCastPriceDecisionEndpoint,
    readonly reason: RentCastPriceDecisionRequestFailure,
    options?: ErrorOptions,
  ) {
    super(`RentCast Price Decision ${endpoint} request failed`, options);
    this.name = "RentCastPriceDecisionRequestError";
  }
}

export interface RentCastPriceDecisionPort {
  getValueEstimate(
    address: string,
    signal?: AbortSignal,
  ): Promise<RentCastValueEstimate>;
  getRecordedSales(
    address: string,
    propertyType: string,
    signal?: AbortSignal,
  ): Promise<readonly RentCastRecordedSaleProperty[]>;
  getSaleListing(
    propertyId: string,
    signal?: AbortSignal,
  ): Promise<RentCastSubjectSaleListing | null>;
  getSaleMarket(
    zipCode: string,
    signal?: AbortSignal,
  ): Promise<RentCastSaleMarketData | null>;
}

export class RentCastPriceDecisionClient
  implements RentCastPriceDecisionPort
{
  private readonly apiKey: string;
  private readonly fetch: typeof fetch;
  private readonly timeoutMs: number;
  private readonly onRequest:
    | ((event: RentCastPriceDecisionRequestEvent) => void)
    | undefined;
  private readonly nowMilliseconds: () => number;

  constructor(options: RentCastPriceDecisionClientOptions) {
    const apiKey = options.apiKey.trim();
    const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
    if (
      apiKey.length === 0 ||
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs <= 0 ||
      timeoutMs > 60_000
    ) {
      throw new InvalidRentCastPriceDecisionConfigurationError();
    }
    this.apiKey = apiKey;
    this.fetch = options.fetch;
    this.timeoutMs = timeoutMs;
    this.onRequest = options.onRequest;
    this.nowMilliseconds = options.nowMilliseconds ?? Date.now;
  }

  async getValueEstimate(
    address: string,
    signal?: AbortSignal,
  ): Promise<RentCastValueEstimate> {
    const url = new URL(`${rentCastApiBaseUrl}/avm/value`);
    url.searchParams.set("address", normalizeQueryValue(address));
    url.searchParams.set(
      "maxRadius",
      String(RENTCAST_PRICE_DECISION_CALL_BUDGET.recordedSalesRadiusMiles),
    );
    url.searchParams.set(
      "daysOld",
      String(RENTCAST_PRICE_DECISION_CALL_BUDGET.recordedSalesAgeDays),
    );
    url.searchParams.set(
      "compCount",
      String(RENTCAST_PRICE_DECISION_CALL_BUDGET.avmComparableCount),
    );
    url.searchParams.set("lookupSubjectAttributes", "true");

    const body = await this.request("avm", url, signal, false);
    return parseValueEstimate(body);
  }

  async getRecordedSales(
    address: string,
    propertyType: string,
    signal?: AbortSignal,
  ): Promise<readonly RentCastRecordedSaleProperty[]> {
    const url = new URL(`${rentCastApiBaseUrl}/properties`);
    url.searchParams.set("address", normalizeQueryValue(address));
    url.searchParams.set(
      "radius",
      String(RENTCAST_PRICE_DECISION_CALL_BUDGET.recordedSalesRadiusMiles),
    );
    url.searchParams.set("propertyType", normalizeQueryValue(propertyType));
    url.searchParams.set(
      "saleDateRange",
      String(RENTCAST_PRICE_DECISION_CALL_BUDGET.recordedSalesAgeDays),
    );
    url.searchParams.set(
      "limit",
      String(RENTCAST_PRICE_DECISION_CALL_BUDGET.recordedSalesLimit),
    );

    const body = await this.request("recorded-sales", url, signal, false);
    if (!Array.isArray(body)) {
      throw this.invalidResponse("recorded-sales");
    }
    return Object.freeze(body.map(parseRecordedSaleProperty));
  }

  async getSaleListing(
    propertyId: string,
    signal?: AbortSignal,
  ): Promise<RentCastSubjectSaleListing | null> {
    const url = new URL(
      `${rentCastApiBaseUrl}/listings/sale/${encodeURIComponent(
        normalizeQueryValue(propertyId),
      )}`,
    );
    const body = await this.request("listing-history", url, signal, true);
    return body === null ? null : parseSubjectSaleListing(body);
  }

  async getSaleMarket(
    zipCode: string,
    signal?: AbortSignal,
  ): Promise<RentCastSaleMarketData | null> {
    if (!/^\d{5}$/.test(zipCode)) {
      throw new InvalidRentCastPriceDecisionConfigurationError();
    }
    const url = new URL(`${rentCastApiBaseUrl}/markets`);
    url.searchParams.set("zipCode", zipCode);
    url.searchParams.set("dataType", "Sale");
    url.searchParams.set("historyRange", "1");

    const body = await this.request("market", url, signal, true);
    if (body === null) {
      return null;
    }
    if (!isRecord(body)) {
      throw this.invalidResponse("market");
    }
    const saleData = body.saleData;
    if (saleData === undefined || saleData === null) {
      return null;
    }
    return parseSaleMarketData(saleData);
  }

  private async request(
    endpoint: RentCastPriceDecisionEndpoint,
    url: URL,
    signal: AbortSignal | undefined,
    notFoundAsNull: boolean,
  ): Promise<unknown | null> {
    const startedAt = this.nowMilliseconds();
    const controller = new AbortController();
    let timedOut = false;
    let callerAborted = signal?.aborted ?? false;
    const abortFromCaller = () => {
      callerAborted = true;
      controller.abort();
    };
    signal?.addEventListener("abort", abortFromCaller, { once: true });
    if (callerAborted) {
      controller.abort();
    }
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "X-Api-Key": this.apiKey,
        },
        signal: controller.signal,
      });
    } catch (error) {
      const reason: RentCastPriceDecisionRequestFailure = timedOut
        ? "timeout"
        : callerAborted
          ? "aborted"
          : "network-error";
      this.emit({ endpoint, outcome: reason, startedAt });
      throw new RentCastPriceDecisionRequestError(endpoint, reason, {
        cause: error,
      });
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abortFromCaller);
    }

    if (response.status === 404) {
      this.emit({ endpoint, outcome: "not-found", startedAt, status: 404 });
      if (notFoundAsNull) {
        return null;
      }
      throw new RentCastPriceDecisionRequestError(endpoint, "not-found");
    }
    if (!response.ok) {
      this.emit({
        endpoint,
        outcome: "http-error",
        startedAt,
        status: response.status,
      });
      throw new RentCastPriceDecisionRequestError(endpoint, "http-error");
    }

    let body: unknown;
    try {
      body = JSON.parse(await response.text()) as unknown;
    } catch (error) {
      this.emit({
        endpoint,
        outcome: "invalid-response",
        startedAt,
        status: response.status,
      });
      throw new RentCastPriceDecisionRequestError(
        endpoint,
        "invalid-response",
        { cause: error },
      );
    }
    this.emit({
      endpoint,
      outcome: "success",
      startedAt,
      status: response.status,
    });
    return body;
  }

  private invalidResponse(
    endpoint: RentCastPriceDecisionEndpoint,
  ): RentCastPriceDecisionRequestError {
    return new RentCastPriceDecisionRequestError(endpoint, "invalid-response");
  }

  private emit(input: {
    endpoint: RentCastPriceDecisionEndpoint;
    outcome: RentCastPriceDecisionRequestOutcome;
    startedAt: number;
    status?: number;
  }): void {
    if (this.onRequest === undefined) {
      return;
    }
    const event: RentCastPriceDecisionRequestEvent = {
      endpoint: input.endpoint,
      outcome: input.outcome,
      durationMs: Math.max(0, this.nowMilliseconds() - input.startedAt),
      ...(input.status === undefined ? {} : { status: input.status }),
    };
    try {
      this.onRequest(Object.freeze(event));
    } catch {
      // Observability must not change provider behavior.
    }
  }
}

function parseValueEstimate(value: unknown): RentCastValueEstimate {
  if (!isRecord(value)) {
    throw invalidSchema("avm");
  }
  return Object.freeze({
    price: readNumber(value, "price", "avm"),
    priceRangeLow: readNumber(value, "priceRangeLow", "avm"),
    priceRangeHigh: readNumber(value, "priceRangeHigh", "avm"),
    subjectProperty: parseProperty(
      readRecord(value, "subjectProperty", "avm"),
      "avm",
    ),
  });
}

function parseRecordedSaleProperty(value: unknown): RentCastRecordedSaleProperty {
  if (!isRecord(value)) {
    throw invalidSchema("recorded-sales");
  }
  return Object.freeze({
    ...parseProperty(value, "recorded-sales"),
    lastSaleDate: readOptionalNullableString(
      value,
      "lastSaleDate",
      "recorded-sales",
    ),
    lastSalePrice: readOptionalNullableNumber(
      value,
      "lastSalePrice",
      "recorded-sales",
    ),
  });
}

function parseProperty(
  value: Record<string, unknown>,
  endpoint: "avm" | "recorded-sales",
): RentCastSanitizedProperty {
  return Object.freeze({
    id: readString(value, "id", endpoint),
    formattedAddress: readString(value, "formattedAddress", endpoint),
    city: readString(value, "city", endpoint),
    state: readString(value, "state", endpoint),
    zipCode: readString(value, "zipCode", endpoint),
    latitude: readOptionalNullableNumber(value, "latitude", endpoint),
    longitude: readOptionalNullableNumber(value, "longitude", endpoint),
    propertyType: readOptionalNullableString(value, "propertyType", endpoint),
    bedrooms: readOptionalNullableNumber(value, "bedrooms", endpoint),
    bathrooms: readOptionalNullableNumber(value, "bathrooms", endpoint),
    squareFootage: readOptionalNullableNumber(
      value,
      "squareFootage",
      endpoint,
    ),
    lotSize: readOptionalNullableNumber(value, "lotSize", endpoint),
    yearBuilt: readOptionalNullableNumber(value, "yearBuilt", endpoint),
  });
}

function parseSubjectSaleListing(value: unknown): RentCastSubjectSaleListing {
  if (!isRecord(value)) {
    throw invalidSchema("listing-history");
  }
  const historyValue = value.history;
  let history: readonly RentCastListingEpisode[] = Object.freeze([]);
  if (historyValue !== undefined && historyValue !== null) {
    if (!isRecord(historyValue)) {
      throw invalidSchema("listing-history");
    }
    history = Object.freeze(
      Object.values(historyValue).map((entry) => parseListingEpisode(entry)),
    );
  }
  return Object.freeze({
    id: readString(value, "id", "listing-history"),
    status: readString(value, "status", "listing-history"),
    price: readOptionalNullableNumber(value, "price", "listing-history"),
    listedDate: readOptionalNullableString(
      value,
      "listedDate",
      "listing-history",
    ),
    lastSeenDate: readOptionalNullableString(
      value,
      "lastSeenDate",
      "listing-history",
    ),
    daysOnMarket: readOptionalNullableNumber(
      value,
      "daysOnMarket",
      "listing-history",
    ),
    history,
  });
}

function parseListingEpisode(value: unknown): RentCastListingEpisode {
  if (!isRecord(value) || value.event !== "Sale Listing") {
    throw invalidSchema("listing-history");
  }
  return Object.freeze({
    listedDate: readString(value, "listedDate", "listing-history"),
    removedDate: readOptionalNullableString(
      value,
      "removedDate",
      "listing-history",
    ),
    price: readNumber(value, "price", "listing-history"),
  });
}

function parseSaleMarketData(value: unknown): RentCastSaleMarketData {
  if (!isRecord(value)) {
    throw invalidSchema("market");
  }
  return Object.freeze({
    lastUpdatedDate: readString(value, "lastUpdatedDate", "market"),
    medianPrice: readOptionalNullableNumber(value, "medianPrice", "market"),
    medianPricePerSquareFoot: readOptionalNullableNumber(
      value,
      "medianPricePerSquareFoot",
      "market",
    ),
    medianDaysOnMarket: readOptionalNullableNumber(
      value,
      "medianDaysOnMarket",
      "market",
    ),
    totalListings: readOptionalNullableNumber(
      value,
      "totalListings",
      "market",
    ),
    newListings: readOptionalNullableNumber(value, "newListings", "market"),
  });
}

function normalizeQueryValue(value: string): string {
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > 300 ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    throw new InvalidRentCastPriceDecisionConfigurationError();
  }
  return normalized;
}

function readRecord(
  record: Record<string, unknown>,
  key: string,
  endpoint: RentCastPriceDecisionEndpoint,
): Record<string, unknown> {
  const value = record[key];
  if (!isRecord(value)) {
    throw invalidSchema(endpoint);
  }
  return value;
}

function readString(
  record: Record<string, unknown>,
  key: string,
  endpoint: RentCastPriceDecisionEndpoint,
): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw invalidSchema(endpoint);
  }
  return value;
}

function readNumber(
  record: Record<string, unknown>,
  key: string,
  endpoint: RentCastPriceDecisionEndpoint,
): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw invalidSchema(endpoint);
  }
  return value;
}

function readOptionalNullableString(
  record: Record<string, unknown>,
  key: string,
  endpoint: RentCastPriceDecisionEndpoint,
): string | null {
  const value = record[key];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw invalidSchema(endpoint);
  }
  return value;
}

function readOptionalNullableNumber(
  record: Record<string, unknown>,
  key: string,
  endpoint: RentCastPriceDecisionEndpoint,
): number | null {
  const value = record[key];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw invalidSchema(endpoint);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidSchema(
  endpoint: RentCastPriceDecisionEndpoint,
): RentCastPriceDecisionRequestError {
  return new RentCastPriceDecisionRequestError(endpoint, "invalid-response");
}
