import {
  SHOWING_LIST_ARTIFACT,
  type CurrentShowingListDraft,
  type GeneratedShowingList,
  type MarkCurrentShowingListDraftReviewedInput,
  type SaveCurrentShowingListDraftInput,
} from "@chaoran-property-intelligence/application";

export interface CurrentShowingListDraftDto {
  generationId: string;
  preferences: {
    clientDisplayName: string | null;
    showingDate: string | null;
  };
  draft: GeneratedShowingList;
  status: CurrentShowingListDraft["status"];
  deliveryStatus: CurrentShowingListDraft["deliveryStatus"];
  generatedAt: string;
  updatedAt: string;
  artifact: {
    fileName: typeof SHOWING_LIST_ARTIFACT.fileName;
    kind: "generated-snapshot";
  };
}

export interface GetCurrentShowingListDraftResponse {
  current: CurrentShowingListDraftDto | null;
}

export class InvalidShowingListRequestError extends Error {
  constructor() {
    super("Showing List request was invalid");
    this.name = "InvalidShowingListRequestError";
  }
}

export function toCurrentShowingListDraftDto(
  current: CurrentShowingListDraft,
): CurrentShowingListDraftDto {
  return {
    artifact: {
      fileName: SHOWING_LIST_ARTIFACT.fileName,
      kind: "generated-snapshot",
    },
    deliveryStatus: current.deliveryStatus,
    draft: current.draft,
    generatedAt: current.generatedAt,
    generationId: current.generationId,
    preferences: {
      clientDisplayName: current.generationInput.preferences.clientDisplayName,
      showingDate: current.generationInput.preferences.showingDate,
    },
    status: current.status,
    updatedAt: current.updatedAt,
  };
}

export function parseSaveCurrentShowingListDraftRequest(
  value: unknown,
): SaveCurrentShowingListDraftInput {
  const record = readStrictRecord(value, [
    "draft",
    "expectedUpdatedAt",
    "generationId",
  ]);
  return {
    draft: record.draft as GeneratedShowingList,
    expectedUpdatedAt: readString(record.expectedUpdatedAt),
    generationId: readString(record.generationId),
  };
}

export function parseMarkCurrentShowingListDraftReviewedRequest(
  value: unknown,
): MarkCurrentShowingListDraftReviewedInput {
  const record = readStrictRecord(value, [
    "expectedUpdatedAt",
    "generationId",
  ]);
  return {
    expectedUpdatedAt: readString(record.expectedUpdatedAt),
    generationId: readString(record.generationId),
  };
}

function readStrictRecord(
  value: unknown,
  expectedKeys: readonly string[],
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InvalidShowingListRequestError();
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== [...expectedKeys].sort()[index])
  ) {
    throw new InvalidShowingListRequestError();
  }
  return record;
}

function readString(value: unknown): string {
  if (typeof value !== "string") {
    throw new InvalidShowingListRequestError();
  }
  return value;
}
