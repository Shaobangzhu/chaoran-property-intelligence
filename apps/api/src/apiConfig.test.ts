import { describe, expect, it } from "vitest";

import { loadApiConfig } from "./apiConfig.js";

describe("loadApiConfig", () => {
  it("loads a local database URL with loopback defaults", () => {
    expect(
      loadApiConfig({
        DATABASE_URL: "postgresql://cpi:secret@localhost:5432/cpi",
      }),
    ).toEqual({
      databaseConnection: {
        kind: "connection-string",
        connectionString: "postgresql://cpi:secret@localhost:5432/cpi",
      },
      deploymentMode: "local",
      host: "127.0.0.1",
      port: 3000,
      publicOrigin: "http://127.0.0.1:5173",
      originVerificationSecret: null,
      showingListArtifactStorage: null,
    });
  });

  it("accepts a valid custom API port", () => {
    expect(
      loadApiConfig({
        DATABASE_URL: "postgresql://localhost/cpi",
        API_PORT: "4100",
      }).port,
    ).toBe(4100);
  });

  it("requires DATABASE_URL", () => {
    expect(() => loadApiConfig({})).toThrow(
      "Missing required environment variable: DATABASE_URL",
    );
    expect(() => loadApiConfig({ DATABASE_URL: "   " })).toThrow(
      "Missing required environment variable: DATABASE_URL",
    );
  });

  it.each(["0", "65536", "3000.5", "not-a-port"])(
    "rejects invalid API_PORT %s",
    (port) => {
      expect(() =>
        loadApiConfig({
          DATABASE_URL: "postgresql://localhost/cpi",
          API_PORT: port,
        }),
      ).toThrow("Invalid API port: API_PORT");
    },
  );

  it("loads an explicit production listener and origin boundary", () => {
    expect(
      loadApiConfig({
        DATABASE_URL: "postgresql://private-host/cpi",
        API_DEPLOYMENT_MODE: "production",
        PORT: "8080",
        API_PUBLIC_ORIGIN: "https://app.example.com",
        API_ORIGIN_VERIFICATION_SECRET: "o".repeat(32),
      }),
    ).toEqual({
      databaseConnection: {
        kind: "connection-string",
        connectionString: "postgresql://private-host/cpi",
      },
      deploymentMode: "production",
      host: "0.0.0.0",
      port: 8080,
      publicOrigin: "https://app.example.com",
      originVerificationSecret: "o".repeat(32),
      showingListArtifactStorage: null,
    });
  });

  it("loads paired private Showing List artifact storage configuration", () => {
    expect(
      loadApiConfig({
        AWS_ACCOUNT_ID: "191227990660",
        DATABASE_URL: "postgresql://localhost/cpi",
        SHOWING_LIST_ARTIFACT_BUCKET: "cpi-private-artifacts",
      }).showingListArtifactStorage,
    ).toEqual({
      bucketName: "cpi-private-artifacts",
      expectedBucketOwner: "191227990660",
    });
  });

  it.each([
    { SHOWING_LIST_ARTIFACT_BUCKET: "cpi-private-artifacts" },
    { AWS_ACCOUNT_ID: "191227990660" },
    {
      AWS_ACCOUNT_ID: "1912-2799-0660",
      SHOWING_LIST_ARTIFACT_BUCKET: "cpi-private-artifacts",
    },
    {
      AWS_ACCOUNT_ID: "191227990660",
      SHOWING_LIST_ARTIFACT_BUCKET: "INVALID_BUCKET",
    },
  ])("rejects incomplete or invalid artifact config: %o", (artifactConfig) => {
    expect(() =>
      loadApiConfig({
        DATABASE_URL: "postgresql://localhost/cpi",
        ...artifactConfig,
      }),
    ).toThrow("Invalid Showing List artifact storage configuration");
  });

  it.each(["development", "prod", "LOCAL"])(
    "rejects an unknown deployment mode %s",
    (deploymentMode) => {
      expect(() =>
        loadApiConfig({
          DATABASE_URL: "postgresql://localhost/cpi",
          API_DEPLOYMENT_MODE: deploymentMode,
        }),
      ).toThrow("Invalid API deployment mode: API_DEPLOYMENT_MODE");
    },
  );

  it.each([
    "http://app.example.com",
    "https://app.example.com/path",
    "https://app.example.com/",
    "not-an-origin",
  ])("rejects invalid production public origin %s", (publicOrigin) => {
    expect(() =>
      loadApiConfig({
        DATABASE_URL: "postgresql://private-host/cpi",
        API_DEPLOYMENT_MODE: "production",
        PORT: "8080",
        API_PUBLIC_ORIGIN: publicOrigin,
        API_ORIGIN_VERIFICATION_SECRET: "o".repeat(32),
      }),
    ).toThrow("Invalid API public origin: API_PUBLIC_ORIGIN");
  });

  it.each(["", "too-short", "s".repeat(257)])(
    "rejects an invalid production origin secret",
    (secret) => {
      expect(() =>
        loadApiConfig({
          DATABASE_URL: "postgresql://private-host/cpi",
          API_DEPLOYMENT_MODE: "production",
          PORT: "8080",
          API_PUBLIC_ORIGIN: "https://app.example.com",
          API_ORIGIN_VERIFICATION_SECRET: secret,
        }),
      ).toThrow(
        "Invalid API origin verification secret: API_ORIGIN_VERIFICATION_SECRET",
      );
    },
  );

  it("requires App Runner PORT in production", () => {
    expect(() =>
      loadApiConfig({
        DATABASE_URL: "postgresql://private-host/cpi",
        API_DEPLOYMENT_MODE: "production",
        API_PUBLIC_ORIGIN: "https://app.example.com",
        API_ORIGIN_VERIFICATION_SECRET: "o".repeat(32),
      }),
    ).toThrow("Missing required environment variable: PORT");
  });
});
