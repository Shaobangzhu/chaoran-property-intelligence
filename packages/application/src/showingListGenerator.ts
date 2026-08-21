import type {
  GeneratedShowingList,
  ShowingListGenerationPreferences,
} from "./showingListSchemas.js";

export interface ShowingListPropertyContext {
  id: string;
  formattedAddress: string;
  latitude: number;
  longitude: number;
  propertyType: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  price: number | null;
  status: string;
  listedDate: string | null;
  mlsName: string | null;
  mlsNumber: string | null;
}

export interface ShowingListContext {
  listings: readonly ShowingListPropertyContext[];
  preferences: ShowingListGenerationPreferences;
}

export interface ShowingListGenerationMetadata {
  model: string;
  responseId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  durationMs: number;
}

export interface ShowingListGenerationResult {
  draft: GeneratedShowingList;
  metadata: ShowingListGenerationMetadata;
}

export interface ShowingListGenerator {
  generate(
    context: ShowingListContext,
  ): Promise<ShowingListGenerationResult>;
}
