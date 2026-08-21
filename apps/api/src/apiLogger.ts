export interface ApiLogContext {
  requestId: string;
}

export interface ApiLogger {
  info(event: string, context: ApiLogContext): void;
  error(event: string, context: ApiLogContext): void;
}
