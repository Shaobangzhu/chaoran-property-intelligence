import { SHOWING_LIST_CURRENT_ARTIFACT_KEY } from "./currentShowingListDraftRepository.js";
import type { RenderedShowingListArtifact } from "./showingListArtifactRenderer.js";

export interface StoredShowingListArtifact {
  key: typeof SHOWING_LIST_CURRENT_ARTIFACT_KEY;
  etag: string;
}

export interface ShowingListArtifactStorePort {
  replaceCurrentArtifact(
    artifact: RenderedShowingListArtifact,
  ): Promise<StoredShowingListArtifact>;
}

export class InvalidShowingListArtifactStoreInputError extends Error {
  constructor() {
    super("Showing List artifact storage input was invalid");
    this.name = "InvalidShowingListArtifactStoreInputError";
  }
}

export class ShowingListArtifactStoreInvalidResponseError extends Error {
  constructor() {
    super("Showing List artifact storage returned an invalid response");
    this.name = "ShowingListArtifactStoreInvalidResponseError";
  }
}

export class ShowingListArtifactStoreUnavailableError extends Error {
  constructor() {
    super("Showing List artifact storage was unavailable");
    this.name = "ShowingListArtifactStoreUnavailableError";
  }
}
