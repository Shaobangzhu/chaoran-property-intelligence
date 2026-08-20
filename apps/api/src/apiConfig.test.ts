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
      host: "127.0.0.1",
      port: 3000,
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
});
