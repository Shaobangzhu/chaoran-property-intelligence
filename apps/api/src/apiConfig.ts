import type { PostgresConnectionConfig } from "@chaoran-property-intelligence/postgres";

const defaultApiPort = 3000;

export interface ApiConfig {
  databaseConnection: PostgresConnectionConfig;
  host: "127.0.0.1";
  port: number;
}

export function loadApiConfig(
  environment: Readonly<Record<string, string | undefined>>,
): ApiConfig {
  return {
    databaseConnection: {
      kind: "connection-string",
      connectionString: readRequiredVariable(environment, "DATABASE_URL"),
    },
    host: "127.0.0.1",
    port: readApiPort(environment),
  };
}

function readApiPort(
  environment: Readonly<Record<string, string | undefined>>,
): number {
  const value = environment.API_PORT;
  if (value === undefined || value.trim().length === 0) {
    return defaultApiPort;
  }

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("Invalid API port: API_PORT");
  }

  return port;
}

function readRequiredVariable(
  environment: Readonly<Record<string, string | undefined>>,
  key: string,
): string {
  const value = environment[key];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  return value;
}
