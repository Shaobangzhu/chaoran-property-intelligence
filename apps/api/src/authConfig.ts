import type { JoseAccessTokenServiceConfig } from "@chaoran-property-intelligence/auth";

export function loadAuthConfig(
  environment: Readonly<Record<string, string | undefined>>,
): JoseAccessTokenServiceConfig {
  return {
    signingSecret: readRequiredVariable(environment, "JWT_SIGNING_SECRET"),
    issuer: readRequiredVariable(environment, "JWT_ISSUER"),
    audience: readRequiredVariable(environment, "JWT_AUDIENCE"),
  };
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
