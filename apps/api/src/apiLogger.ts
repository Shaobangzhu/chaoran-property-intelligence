export interface ApiLogContext {
  requestId: string;
  mode?: "offer" | "listing";
  zipCode?: string;
  durationMs?: number;
  comparableCount?: number;
  confidence?: "high" | "medium" | "low";
  outcome?: string;
  rentCastRequestCount?: number;
  openAIRequestCount?: number;
}

export interface ApiLogger {
  info(event: string, context: ApiLogContext): void;
  error(event: string, context: ApiLogContext): void;
}
