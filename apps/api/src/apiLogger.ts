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
  plannedProviderRequestCount?: number;
  refreshDispatch?: "not-required" | "dispatched" | "failed";
  refreshStatus?: "none" | "queued" | "running" | "succeeded" | "failed" | "superseded";
}

export interface ApiLogger {
  info(event: string, context: ApiLogContext): void;
  error(event: string, context: ApiLogContext): void;
}
