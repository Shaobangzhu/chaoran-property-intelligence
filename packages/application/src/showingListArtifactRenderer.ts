import type {
  GeneratedShowingList,
  ShowingListGenerationPreferences,
} from "./showingListSchemas.js";
import type { ShowingListPropertyContext } from "./showingListGenerator.js";

export const SHOWING_LIST_ARTIFACT_LIMITS = Object.freeze({
  maximumBytes: 5 * 1_024 * 1_024,
});

export interface ShowingListArtifactRenderInput {
  generationId: string;
  generatedAt: string;
  listings: readonly ShowingListPropertyContext[];
  preferences: ShowingListGenerationPreferences;
  draft: GeneratedShowingList;
}

export interface RenderedShowingListArtifact {
  bytes: Uint8Array;
  mediaType: "application/pdf";
  fileName: "showing-list-draft.pdf";
}

export interface ShowingListArtifactRendererPort {
  render(
    input: ShowingListArtifactRenderInput,
  ): Promise<RenderedShowingListArtifact>;
}

export class InvalidShowingListArtifactInputError extends Error {
  constructor() {
    super("Showing List artifact input was invalid");
    this.name = "InvalidShowingListArtifactInputError";
  }
}

export class ShowingListArtifactRenderingError extends Error {
  constructor() {
    super("Showing List artifact could not be rendered");
    this.name = "ShowingListArtifactRenderingError";
  }
}
