import type { PostgresConnectionConfig } from "@chaoran-property-intelligence/postgres";

const defaultApiPort = 3000;
const defaultLocalOrigin = "http://127.0.0.1:5173";
const minimumOriginSecretLength = 32;
const maximumOriginSecretLength = 256;
const originSecretPattern = /^[A-Za-z0-9_-]+$/u;

export type ApiDeploymentMode = "local" | "production";
export type ApplicationDeploymentStage = "dev" | "production";

export interface ReleaseIdentity {
  gitSha: string;
  stage: ApplicationDeploymentStage;
}

export interface ApiHttpSecurityConfig {
  deploymentMode: ApiDeploymentMode;
  publicOrigin: string | null;
  originVerificationSecret: string | null;
  trustedPublicOriginHeaderName: string | null;
}

export interface ApiConfig extends ApiHttpSecurityConfig {
  databaseConnection: PostgresConnectionConfig;
  host: "127.0.0.1" | "0.0.0.0";
  port: number;
  releaseIdentity: ReleaseIdentity | null;
  showingListArtifactStorage: {
    bucketName: string;
    expectedBucketOwner: string;
  } | null;
}

export function loadApiConfig(
  environment: Readonly<Record<string, string | undefined>>,
): ApiConfig {
  const deploymentMode = readDeploymentMode(environment);

  return {
    databaseConnection: readDatabaseConnection(environment, deploymentMode),
    deploymentMode,
    host: deploymentMode === "production" ? "0.0.0.0" : "127.0.0.1",
    port:
      deploymentMode === "production"
        ? readPort(readRequiredVariable(environment, "PORT"), "PORT")
        : readLocalApiPort(environment),
    ...readPublicOrigin(environment, deploymentMode),
    originVerificationSecret:
      deploymentMode === "production"
        ? readOriginVerificationSecret(environment)
        : null,
    releaseIdentity: readReleaseIdentity(environment, deploymentMode),
    showingListArtifactStorage: readShowingListArtifactStorage(environment),
  };
}

function readReleaseIdentity(
  environment: Readonly<Record<string, string | undefined>>,
  deploymentMode: ApiDeploymentMode,
): ReleaseIdentity | null {
  if (deploymentMode === "local") {
    return null;
  }
  const gitSha = readRequiredVariable(environment, "CPI_RELEASE_SHA");
  const stage = readRequiredVariable(environment, "CPI_DEPLOYMENT_STAGE");
  if (!/^[a-f0-9]{40}$/u.test(gitSha)) {
    throw new Error("Invalid release identity: CPI_RELEASE_SHA");
  }
  if (stage !== "dev" && stage !== "production") {
    throw new Error("Invalid release identity: CPI_DEPLOYMENT_STAGE");
  }
  return { gitSha, stage };
}

function readDatabaseConnection(
  environment: Readonly<Record<string, string | undefined>>,
  deploymentMode: ApiDeploymentMode,
): PostgresConnectionConfig {
  const connectionString = environment.DATABASE_URL;
  if (connectionString !== undefined && connectionString.trim().length > 0) {
    return { kind: "connection-string", connectionString };
  }
  if (deploymentMode === "local") {
    throw new Error("Missing required environment variable: DATABASE_URL");
  }

  const credentials = readDatabaseCredentialsSecret(environment);

  return {
    kind: "parameters",
    database: readRequiredVariable(environment, "PGDATABASE"),
    host: readRequiredVariable(environment, "PGHOST"),
    password: credentials.password,
    port: readPort(readRequiredVariable(environment, "PGPORT"), "PGPORT"),
    ssl: true,
    user: credentials.username,
  };
}

function readDatabaseCredentialsSecret(
  environment: Readonly<Record<string, string | undefined>>,
): { password: string; username: string } {
  const value = readRequiredVariable(
    environment,
    "DATABASE_CREDENTIALS_SECRET_JSON",
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(
      "Invalid database credentials: DATABASE_CREDENTIALS_SECRET_JSON",
    );
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("password" in parsed) ||
    typeof parsed.password !== "string" ||
    parsed.password.length === 0 ||
    !("username" in parsed) ||
    typeof parsed.username !== "string" ||
    parsed.username.length === 0
  ) {
    throw new Error(
      "Invalid database credentials: DATABASE_CREDENTIALS_SECRET_JSON",
    );
  }
  return { password: parsed.password, username: parsed.username };
}

function readShowingListArtifactStorage(
  environment: Readonly<Record<string, string | undefined>>,
): ApiConfig["showingListArtifactStorage"] {
  const bucketName = environment.SHOWING_LIST_ARTIFACT_BUCKET;
  const expectedBucketOwner = environment.AWS_ACCOUNT_ID;
  if (
    (bucketName === undefined || bucketName.length === 0) &&
    (expectedBucketOwner === undefined || expectedBucketOwner.length === 0)
  ) {
    return null;
  }
  if (
    bucketName === undefined ||
    !isBucketName(bucketName) ||
    expectedBucketOwner === undefined ||
    !/^\d{12}$/.test(expectedBucketOwner)
  ) {
    throw new Error(
      "Invalid Showing List artifact storage configuration: SHOWING_LIST_ARTIFACT_BUCKET/AWS_ACCOUNT_ID",
    );
  }
  return { bucketName, expectedBucketOwner };
}

function isBucketName(value: string): boolean {
  return (
    value.length >= 3 &&
    value.length <= 63 &&
    /^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(value) &&
    !value.includes("..") &&
    !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)
  );
}

function readDeploymentMode(
  environment: Readonly<Record<string, string | undefined>>,
): ApiDeploymentMode {
  const value = environment.API_DEPLOYMENT_MODE;
  if (value === undefined || value.length === 0 || value === "local") {
    return "local";
  }
  if (value === "production") {
    return value;
  }
  throw new Error("Invalid API deployment mode: API_DEPLOYMENT_MODE");
}

function readLocalApiPort(
  environment: Readonly<Record<string, string | undefined>>,
): number {
  const value = environment.API_PORT;
  if (value === undefined || value.trim().length === 0) {
    return defaultApiPort;
  }
  return readPort(value, "API_PORT");
}

function readPort(value: string, variableName: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid API port: ${variableName}`);
  }
  return port;
}

function readPublicOrigin(
  environment: Readonly<Record<string, string | undefined>>,
  deploymentMode: ApiDeploymentMode,
): Pick<
  ApiHttpSecurityConfig,
  "publicOrigin" | "trustedPublicOriginHeaderName"
> {
  const configuredOrigin = environment.API_PUBLIC_ORIGIN;
  const trustedHeader = environment.API_TRUSTED_PUBLIC_ORIGIN_HEADER;
  if (trustedHeader !== undefined && trustedHeader.length > 0) {
    if (
      deploymentMode !== "production" ||
      configuredOrigin !== undefined ||
      trustedHeader !== "x-cpi-viewer-origin"
    ) {
      throw new Error(
        "Invalid API trusted origin header: API_TRUSTED_PUBLIC_ORIGIN_HEADER",
      );
    }
    return {
      publicOrigin: null,
      trustedPublicOriginHeaderName: trustedHeader,
    };
  }
  const value =
    configuredOrigin === undefined || configuredOrigin.length === 0
      ? deploymentMode === "local"
        ? defaultLocalOrigin
        : null
      : configuredOrigin;

  if (value === null || !isExactOrigin(value, deploymentMode)) {
    throw new Error("Invalid API public origin: API_PUBLIC_ORIGIN");
  }
  return { publicOrigin: value, trustedPublicOriginHeaderName: null };
}

function isExactOrigin(
  value: string,
  deploymentMode: ApiDeploymentMode,
): boolean {
  try {
    const url = new URL(value);
    const acceptedProtocol =
      deploymentMode === "production"
        ? url.protocol === "https:"
        : url.protocol === "http:" || url.protocol === "https:";

    return acceptedProtocol && url.origin === value;
  } catch {
    return false;
  }
}

function readOriginVerificationSecret(
  environment: Readonly<Record<string, string | undefined>>,
): string {
  const value = environment.API_ORIGIN_VERIFICATION_SECRET;
  if (
    value === undefined ||
    value.length < minimumOriginSecretLength ||
    value.length > maximumOriginSecretLength ||
    !originSecretPattern.test(value)
  ) {
    throw new Error(
      "Invalid API origin verification secret: API_ORIGIN_VERIFICATION_SECRET",
    );
  }
  return value;
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
