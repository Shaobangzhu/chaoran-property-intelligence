import {
  safeParseCurrentShowingListDraft,
  type CurrentShowingListDraftQueryPort,
} from "./currentShowingListDraftRepository.js";
import {
  SHOWING_LIST_ARTIFACT_LIMITS,
  type RenderedShowingListArtifact,
} from "./showingListArtifactRenderer.js";
import type { StoredShowingListArtifact } from "./showingListArtifactStore.js";
import { SHOWING_LIST_ARTIFACT } from "./showingListSchemas.js";

export interface ShowingListArtifactReaderPort {
  readCurrentArtifact(
    expected: StoredShowingListArtifact,
  ): Promise<RenderedShowingListArtifact>;
}

export interface GetCurrentShowingListArtifactOptions {
  reader: ShowingListArtifactReaderPort;
  repository: CurrentShowingListDraftQueryPort;
}

export class CurrentShowingListDraftNotFoundError extends Error {
  constructor() {
    super("Current Showing List draft was not found");
    this.name = "CurrentShowingListDraftNotFoundError";
  }
}

export class ShowingListArtifactChangedError extends Error {
  constructor() {
    super("Current Showing List artifact changed");
    this.name = "ShowingListArtifactChangedError";
  }
}

export class ShowingListArtifactReaderInvalidResponseError extends Error {
  constructor() {
    super("Showing List artifact reader returned an invalid response");
    this.name = "ShowingListArtifactReaderInvalidResponseError";
  }
}

export class ShowingListArtifactReaderUnavailableError extends Error {
  constructor() {
    super("Showing List artifact reader was unavailable");
    this.name = "ShowingListArtifactReaderUnavailableError";
  }
}

export class GetCurrentShowingListArtifact {
  constructor(private readonly options: GetCurrentShowingListArtifactOptions) {}

  async execute(): Promise<RenderedShowingListArtifact> {
    const current = await this.options.repository.findCurrentDraft();
    if (current === null) {
      throw new CurrentShowingListDraftNotFoundError();
    }
    const parsedCurrent = safeParseCurrentShowingListDraft(current);
    if (!parsedCurrent.success) {
      throw new ShowingListArtifactReaderInvalidResponseError();
    }

    const artifact = await this.options.reader.readCurrentArtifact(
      parsedCurrent.data.artifact,
    );
    if (!isValidArtifact(artifact)) {
      throw new ShowingListArtifactReaderInvalidResponseError();
    }
    return {
      bytes: new Uint8Array(artifact.bytes),
      fileName: artifact.fileName,
      mediaType: artifact.mediaType,
    };
  }
}

function isValidArtifact(
  value: unknown,
): value is RenderedShowingListArtifact {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return (
    keys.length === 3 &&
    keys[0] === "bytes" &&
    keys[1] === "fileName" &&
    keys[2] === "mediaType" &&
    record.bytes instanceof Uint8Array &&
    record.bytes.byteLength >= 1 &&
    record.bytes.byteLength <= SHOWING_LIST_ARTIFACT_LIMITS.maximumBytes &&
    record.fileName === SHOWING_LIST_ARTIFACT.fileName &&
    record.mediaType === SHOWING_LIST_ARTIFACT.mediaType
  );
}
