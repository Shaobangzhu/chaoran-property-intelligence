import { SessionAuthenticationRequiredError } from "./listingsApi.js";

export interface ShowingListStop {
  listingId: string;
  proposedOrder: number;
  orderReason: string;
  highlights: string[];
  considerations: string[];
}

export interface ShowingListDraft {
  title: string;
  summary: string;
  stops: ShowingListStop[];
  clientMessage: string;
  reviewWarnings: string[];
}

export interface CurrentShowingList {
  generationId: string;
  preferences: {
    clientDisplayName: string | null;
    showingDate: string | null;
  };
  draft: ShowingListDraft;
  status: "draft" | "reviewed";
  deliveryStatus: "pending" | "sent" | "failed";
  generatedAt: string;
  updatedAt: string;
  artifact: {
    fileName: "showing-list-draft.pdf";
    kind: "generated-snapshot";
  };
}

export interface SaveShowingListInput {
  generationId: string;
  expectedUpdatedAt: string;
  draft: ShowingListDraft;
}

export interface ReviewShowingListInput {
  generationId: string;
  expectedUpdatedAt: string;
}

export interface ShowingListArtifactDownload {
  blob: Blob;
  fileName: "showing-list-draft.pdf";
}

type FetchImplementation = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface ShowingListRequestOptions {
  fetchImplementation?: FetchImplementation;
  signal?: AbortSignal;
}

export class ShowingListChangedError extends Error {
  constructor() {
    super("Showing List changed");
    this.name = "ShowingListChangedError";
  }
}

export class ShowingListNotFoundError extends Error {
  constructor() {
    super("Showing List was not found");
    this.name = "ShowingListNotFoundError";
  }
}

export async function fetchCurrentShowingList(
  options: ShowingListRequestOptions = {},
): Promise<CurrentShowingList | null> {
  const response = await request("/api/showing-list/current", "GET", options);
  throwForStatus(response, "load");
  return parseCurrentResponse(await readJson(response));
}

export async function saveCurrentShowingList(
  input: SaveShowingListInput,
  options: ShowingListRequestOptions = {},
): Promise<CurrentShowingList> {
  const response = await request(
    "/api/showing-list/current",
    "PATCH",
    options,
    input,
  );
  throwForStatus(response, "save");
  const current = parseCurrentResponse(await readJson(response));
  if (current === null) throw invalidResponse();
  return current;
}

export async function markCurrentShowingListReviewed(
  input: ReviewShowingListInput,
  options: ShowingListRequestOptions = {},
): Promise<CurrentShowingList> {
  const response = await request(
    "/api/showing-list/current/review",
    "POST",
    options,
    input,
  );
  throwForStatus(response, "review");
  const current = parseCurrentResponse(await readJson(response));
  if (current === null) throw invalidResponse();
  return current;
}

export async function downloadCurrentShowingList(
  options: ShowingListRequestOptions = {},
): Promise<ShowingListArtifactDownload> {
  const response = await request(
    "/api/showing-list/current/download",
    "GET",
    options,
  );
  throwForStatus(response, "download");
  if (response.headers.get("content-type") !== "application/pdf") {
    throw invalidResponse();
  }
  return {
    blob: await response.blob(),
    fileName: "showing-list-draft.pdf",
  };
}

async function request(
  path: string,
  method: "GET" | "PATCH" | "POST",
  options: ShowingListRequestOptions,
  body?: unknown,
): Promise<Response> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const init: RequestInit = {
    credentials: "same-origin",
    headers,
    method,
  };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  if (options.signal !== undefined) init.signal = options.signal;
  return (options.fetchImplementation ?? fetch)(path, init);
}

function throwForStatus(response: Response, operation: string): void {
  if (response.status === 401) throw new SessionAuthenticationRequiredError();
  if (response.status === 404) throw new ShowingListNotFoundError();
  if (response.status === 409) throw new ShowingListChangedError();
  if (!response.ok) {
    throw new Error(`Unable to ${operation} Showing List (${response.status})`);
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw invalidResponse();
  }
}

function parseCurrentResponse(value: unknown): CurrentShowingList | null {
  const response = strictRecord(value, ["current"]);
  if (response.current === null) return null;
  const current = strictRecord(response.current, [
    "artifact",
    "deliveryStatus",
    "draft",
    "generatedAt",
    "generationId",
    "preferences",
    "status",
    "updatedAt",
  ]);
  const preferences = strictRecord(current.preferences, [
    "clientDisplayName",
    "showingDate",
  ]);
  const artifact = strictRecord(current.artifact, ["fileName", "kind"]);
  const status = readEnum(current.status, ["draft", "reviewed"] as const);
  const deliveryStatus = readEnum(
    current.deliveryStatus,
    ["pending", "sent", "failed"] as const,
  );
  if (
    artifact.fileName !== "showing-list-draft.pdf" ||
    artifact.kind !== "generated-snapshot"
  ) {
    throw invalidResponse();
  }
  return {
    artifact: {
      fileName: "showing-list-draft.pdf",
      kind: "generated-snapshot",
    },
    deliveryStatus,
    draft: parseDraft(current.draft),
    generatedAt: readString(current.generatedAt),
    generationId: readString(current.generationId),
    preferences: {
      clientDisplayName: readNullableString(preferences.clientDisplayName),
      showingDate: readNullableString(preferences.showingDate),
    },
    status,
    updatedAt: readString(current.updatedAt),
  };
}

function parseDraft(value: unknown): ShowingListDraft {
  const draft = strictRecord(value, [
    "clientMessage",
    "reviewWarnings",
    "stops",
    "summary",
    "title",
  ]);
  if (!Array.isArray(draft.stops)) throw invalidResponse();
  const stops = draft.stops.map((value) => {
    const stop = strictRecord(value, [
      "considerations",
      "highlights",
      "listingId",
      "orderReason",
      "proposedOrder",
    ]);
    if (!Number.isInteger(stop.proposedOrder)) throw invalidResponse();
    return {
      considerations: readStringArray(stop.considerations),
      highlights: readStringArray(stop.highlights),
      listingId: readString(stop.listingId),
      orderReason: readString(stop.orderReason),
      proposedOrder: stop.proposedOrder as number,
    };
  });
  if (
    stops.length < 1 ||
    stops.length > 10 ||
    new Set(stops.map((stop) => stop.listingId)).size !== stops.length ||
    stops
      .map((stop) => stop.proposedOrder)
      .sort((left, right) => left - right)
      .some((order, index) => order !== index + 1)
  ) {
    throw invalidResponse();
  }
  return {
    clientMessage: readString(draft.clientMessage),
    reviewWarnings: readStringArray(draft.reviewWarnings),
    stops,
    summary: readString(draft.summary),
    title: readString(draft.title),
  };
}

function strictRecord(
  value: unknown,
  expectedKeys: readonly string[],
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalidResponse();
  }
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const expected = [...expectedKeys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw invalidResponse();
  }
  return record;
}

function readString(value: unknown): string {
  if (typeof value !== "string") throw invalidResponse();
  return value;
}

function readNullableString(value: unknown): string | null {
  return value === null ? null : readString(value);
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw invalidResponse();
  }
  return [...value] as string[];
}

function readEnum<const T extends readonly string[]>(
  value: unknown,
  accepted: T,
): T[number] {
  if (typeof value !== "string" || !accepted.includes(value)) {
    throw invalidResponse();
  }
  return value;
}

function invalidResponse(): Error {
  return new Error("Showing List API returned an invalid response");
}
