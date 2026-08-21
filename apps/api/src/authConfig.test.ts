import { describe, expect, it } from "vitest";

import { loadAuthConfig } from "./authConfig.js";

describe("loadAuthConfig", () => {
  it("loads the server-only JWT configuration", () => {
    expect(
      loadAuthConfig({
        JWT_SIGNING_SECRET: "base64url-secret-placeholder",
        JWT_ISSUER: "urn:chaoran-property-intelligence:auth",
        JWT_AUDIENCE: "urn:chaoran-property-intelligence:api",
      }),
    ).toEqual({
      signingSecret: "base64url-secret-placeholder",
      issuer: "urn:chaoran-property-intelligence:auth",
      audience: "urn:chaoran-property-intelligence:api",
    });
  });

  it.each(["JWT_SIGNING_SECRET", "JWT_ISSUER", "JWT_AUDIENCE"])(
    "rejects missing or blank %s without exposing another value",
    (missingKey) => {
      const environment: Record<string, string | undefined> = {
        JWT_SIGNING_SECRET: "sensitive-signing-value",
        JWT_ISSUER: "urn:chaoran-property-intelligence:auth",
        JWT_AUDIENCE: "urn:chaoran-property-intelligence:api",
        [missingKey]: " ",
      };

      expect(() => loadAuthConfig(environment)).toThrow(
        `Missing required environment variable: ${missingKey}`,
      );

      try {
        loadAuthConfig(environment);
      } catch (error) {
        expect(String(error)).not.toContain("sensitive-signing-value");
      }
    },
  );
});
