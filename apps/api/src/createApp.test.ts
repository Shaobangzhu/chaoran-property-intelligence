import { once } from "node:events";
import type { Server } from "node:http";

import {
  AuthenticationRequiredError,
  InvalidCredentialsError,
  type AuthenticatedUser,
  type ListingRecord,
  type LoginInput,
  type LoginResult,
} from "@chaoran-property-intelligence/application";
import { describe, expect, it } from "vitest";

import {
  createApp,
  type ApiLogger,
  type CreateAppOptions,
  type GetCurrentUserUseCase,
  type ListListingsUseCase,
  type LoginUseCase,
} from "./createApp.js";

const localOrigin = "http://127.0.0.1:5173";
const productionOrigin = "https://app.example.com";
const originVerificationSecret = "o".repeat(32);
const sessionToken = "valid-session-token";
const now = new Date("2026-08-20T20:00:00.000Z");
const expiresAtEpochSeconds = Math.floor(now.getTime() / 1000) + 3600;

describe("createApp", () => {
  it("serves a public database-independent health response", async () => {
    const listListings = new FakeListListings([]);
    const getCurrentUser = new FakeGetCurrentUser();
    const response = await request(
      createTestApp({ listListings, getCurrentUser }),
      "/api/health",
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-powered-by")).toBeNull();
    await expect(response.json()).resolves.toEqual({ status: "ok" });
    expect(listListings.calls).toBe(0);
    expect(getCurrentUser.tokens).toEqual([]);
  });

  it("logs in with a bounded DTO and sets the local HttpOnly cookie", async () => {
    const login = new FakeLogin();
    const response = await request(createTestApp({ login }), "/api/auth/login", {
      method: "POST",
      headers: jsonHeaders(localOrigin),
      body: JSON.stringify({
        email: "  Admin@Example.COM  ",
        password: "candidate password",
      }),
    });

    expect(response.status).toBe(200);
    expect(login.inputs).toEqual([
      {
        email: "  Admin@Example.COM  ",
        password: "candidate password",
      },
    ]);
    await expect(response.json()).resolves.toEqual({
      user: {
        id: authenticatedUser.id,
        email: "admin@example.com",
        role: "admin",
      },
    });
    const setCookie = readSetCookie(response);
    expect(setCookie).toContain("cpi_session=issued-access-token");
    expect(setCookie).toContain("Max-Age=3600");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Strict");
    expect(setCookie).not.toContain("Secure");
    expect(setCookie).not.toContain("Domain=");
  });

  it("sets the __Host production cookie only behind the origin guard", async () => {
    const response = await request(
      createTestApp({ httpSecurity: productionHttpSecurity }),
      "/api/auth/login",
      {
        method: "POST",
        headers: {
          ...jsonHeaders(productionOrigin),
          "x-cpi-origin-verification": originVerificationSecret,
        },
        body: JSON.stringify({
          email: "admin@example.com",
          password: "candidate password",
        }),
      },
    );

    expect(response.status).toBe(200);
    const setCookie = readSetCookie(response);
    expect(setCookie).toContain("__Host-cpi_session=issued-access-token");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).not.toContain("Domain=");
  });

  it("maps every credential failure to one public response", async () => {
    const login = new FakeLogin(new InvalidCredentialsError());
    const response = await request(createTestApp({ login }), "/api/auth/login", {
      method: "POST",
      headers: jsonHeaders(localOrigin),
      body: JSON.stringify({
        email: "unknown@example.com",
        password: "candidate password",
      }),
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVALID_CREDENTIALS",
        message: "Invalid email or password",
      },
    });
  });

  it.each([
    [
      "extra fields",
      JSON.stringify({
        email: "admin@example.com",
        password: "candidate password",
        role: "admin",
      }),
    ],
    [
      "wrong field type",
      JSON.stringify({ email: "admin@example.com", password: 123 }),
    ],
    [
      "an array",
      JSON.stringify(["admin@example.com", "candidate password"]),
    ],
    ["malformed JSON", "{"],
  ])("rejects %s before executing login", async (_label, body) => {
    const login = new FakeLogin();
    const response = await request(createTestApp({ login }), "/api/auth/login", {
      method: "POST",
      headers: jsonHeaders(localOrigin),
      body,
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVALID_REQUEST",
        message: "Request body is invalid",
      },
    });
    expect(login.inputs).toEqual([]);
  });

  it("rejects oversized login JSON with the same bounded request error", async () => {
    const login = new FakeLogin();
    const response = await request(createTestApp({ login }), "/api/auth/login", {
      method: "POST",
      headers: jsonHeaders(localOrigin),
      body: JSON.stringify({
        email: "admin@example.com",
        password: "p".repeat(5_000),
      }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INVALID_REQUEST" },
    });
    expect(login.inputs).toEqual([]);
  });

  it.each([undefined, "https://wrong.example.com", "null"])(
    "rejects an unsafe request with Origin %s before body parsing",
    async (origin) => {
      const login = new FakeLogin();
      const headers: Record<string, string> = {
        "content-type": "application/json",
      };
      if (origin !== undefined) {
        headers.origin = origin;
      }

      const response = await request(
        createTestApp({ login }),
        "/api/auth/login",
        {
          method: "POST",
          headers,
          body: "{",
        },
      );

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({
        error: {
          code: "REQUEST_ORIGIN_REJECTED",
          message: "Request origin is not allowed",
        },
      });
      expect(login.inputs).toEqual([]);
    },
  );

  it("clears the exact local session cookie and returns 204", async () => {
    const response = await request(createTestApp(), "/api/auth/logout", {
      method: "POST",
      headers: { origin: localOrigin },
    });

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    const setCookie = readSetCookie(response);
    expect(setCookie).toContain("cpi_session=");
    expect(setCookie).toContain("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Strict");
  });

  it("returns the current live user from the session cookie", async () => {
    const getCurrentUser = new FakeGetCurrentUser();
    const response = await request(
      createTestApp({ getCurrentUser }),
      "/api/auth/me",
      { headers: sessionHeaders() },
    );

    expect(response.status).toBe(200);
    expect(getCurrentUser.tokens).toEqual([sessionToken]);
    await expect(response.json()).resolves.toEqual({
      user: {
        id: authenticatedUser.id,
        email: "admin@example.com",
        role: "admin",
      },
    });
  });

  it("does not accept a bearer token when the session cookie is missing", async () => {
    const getCurrentUser = new FakeGetCurrentUser();
    const response = await request(createTestApp({ getCurrentUser }), "/api/auth/me", {
      headers: { authorization: `Bearer ${sessionToken}` },
    });

    expect(response.status).toBe(401);
    expect(getCurrentUser.tokens).toEqual([]);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "AUTHENTICATION_REQUIRED" },
    });
  });

  it("maps an invalid or disabled session to one authentication response", async () => {
    const getCurrentUser = new FakeGetCurrentUser(
      new AuthenticationRequiredError(),
    );
    const response = await request(
      createTestApp({ getCurrentUser }),
      "/api/auth/me",
      { headers: sessionHeaders() },
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "AUTHENTICATION_REQUIRED",
        message: "Authentication is required",
      },
    });
  });

  it("protects listings before querying and maps DTOs after authentication", async () => {
    const listing = createListingRecord() as ListingRecord & {
      deduplicationKey: string;
      notificationStatus: string;
    };
    listing.deduplicationKey = "rentcast:internal-deduplication-key";
    listing.notificationStatus = "sent";
    const listListings = new FakeListListings([listing]);
    const app = createTestApp({ listListings });

    const unauthenticatedResponse = await request(app, "/api/listings");
    expect(unauthenticatedResponse.status).toBe(401);
    expect(listListings.calls).toBe(0);

    const response = await request(app, "/api/listings", {
      headers: sessionHeaders(),
    });

    expect(response.status).toBe(200);
    expect(listListings.calls).toBe(1);
    await expect(response.json()).resolves.toEqual({
      listings: [
        {
          id: "0198c7d2-7668-7775-b0fc-b789690a60c1",
          source: "rentcast",
          sourceListingId: "rentcast-listing-id",
          mlsName: "CRMLS",
          mlsNumber: "IG26000001",
          formattedAddress: "123 Main St, Eastvale, CA 92880",
          addressLine1: "123 Main St",
          addressLine2: null,
          city: "Eastvale",
          state: "CA",
          zipCode: "92880",
          latitude: 33.9525,
          longitude: -117.5848,
          propertyType: "Single Family",
          bedrooms: 4,
          bathrooms: 2.5,
          price: 825000,
          status: "Active",
          listedDate: "2026-08-19",
          lastSeenDate: "2026-08-19",
          firstDiscoveredAt: "2026-08-19T17:00:00.000Z",
        },
      ],
    });
  });

  it("maps internal failures without logging the secret-bearing error", async () => {
    const logger = new RecordingLogger();
    const response = await request(
      createTestApp({ listListings: new FailingListListings(), logger }),
      "/api/listings",
      { headers: sessionHeaders() },
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "Request could not be completed",
      },
    });
    expect(logger.errors).toEqual(["api.request.failed"]);
  });

  it("rejects direct production access but keeps health available", async () => {
    const app = createTestApp({ httpSecurity: productionHttpSecurity });

    const directResponse = await request(app, "/api/auth/me", {
      headers: sessionHeaders("__Host-cpi_session"),
    });
    expect(directResponse.status).toBe(403);
    await expect(directResponse.json()).resolves.toMatchObject({
      error: { code: "ORIGIN_VERIFICATION_FAILED" },
    });

    const healthResponse = await request(app, "/api/health");
    expect(healthResponse.status).toBe(200);
  });

  it("returns JSON for unknown API routes", async () => {
    const response = await request(createTestApp(), "/api/missing");

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "NOT_FOUND",
        message: "Route not found",
      },
    });
  });
});

class FakeLogin implements LoginUseCase {
  readonly inputs: LoginInput[] = [];

  constructor(private readonly failure?: Error) {}

  async execute(input: LoginInput): Promise<LoginResult> {
    this.inputs.push(input);
    if (this.failure !== undefined) {
      throw this.failure;
    }
    return {
      user: authenticatedUser,
      accessToken: {
        token: "issued-access-token",
        expiresAtEpochSeconds,
      },
    };
  }
}

class FakeGetCurrentUser implements GetCurrentUserUseCase {
  readonly tokens: string[] = [];

  constructor(private readonly failure?: Error) {}

  async execute(input: { accessToken: string }): Promise<AuthenticatedUser> {
    this.tokens.push(input.accessToken);
    if (this.failure !== undefined) {
      throw this.failure;
    }
    return authenticatedUser;
  }
}

class FakeListListings implements ListListingsUseCase {
  calls = 0;

  constructor(private readonly records: ListingRecord[]) {}

  async execute(): Promise<ListingRecord[]> {
    this.calls += 1;
    return this.records;
  }
}

class FailingListListings implements ListListingsUseCase {
  async execute(): Promise<ListingRecord[]> {
    throw new Error("postgresql://user:password@private-host/database");
  }
}

class RecordingLogger implements ApiLogger {
  readonly errors: string[] = [];

  error(message: string): void {
    this.errors.push(message);
  }
}

const authenticatedUser: AuthenticatedUser = {
  id: "0198c7d2-7668-7775-b0fc-b789690a60c1",
  normalizedEmail:
    "admin@example.com" as AuthenticatedUser["normalizedEmail"],
  role: "admin",
};

const localHttpSecurity = {
  deploymentMode: "local" as const,
  publicOrigin: localOrigin,
  originVerificationSecret: null,
};

const productionHttpSecurity = {
  deploymentMode: "production" as const,
  publicOrigin: productionOrigin,
  originVerificationSecret,
};

function createTestApp(
  overrides: Partial<CreateAppOptions> = {},
): ReturnType<typeof createApp> {
  return createApp({
    listListings: new FakeListListings([]),
    login: new FakeLogin(),
    getCurrentUser: new FakeGetCurrentUser(),
    httpSecurity: localHttpSecurity,
    logger: new RecordingLogger(),
    now: () => now,
    ...overrides,
  });
}

function jsonHeaders(origin: string): Record<string, string> {
  return { "content-type": "application/json", origin };
}

function sessionHeaders(cookieName = "cpi_session"): Record<string, string> {
  return { cookie: `${cookieName}=${sessionToken}` };
}

function readSetCookie(response: Response): string {
  const value = response.headers.get("set-cookie");
  if (value === null) {
    throw new Error("Expected response to set a cookie");
  }
  return value;
}

function createListingRecord(): ListingRecord {
  return {
    id: "0198c7d2-7668-7775-b0fc-b789690a60c1",
    listing: {
      source: "rentcast",
      sourceListingId: "rentcast-listing-id",
      mlsName: "CRMLS",
      mlsNumber: "IG26000001",
      formattedAddress: "123 Main St, Eastvale, CA 92880",
      addressLine1: "123 Main St",
      addressLine2: null,
      city: "Eastvale",
      state: "CA",
      zipCode: "92880",
      latitude: 33.9525,
      longitude: -117.5848,
      propertyType: "Single Family",
      bedrooms: 4,
      bathrooms: 2.5,
      price: 825000,
      status: "Active",
      listedDate: "2026-08-19",
      lastSeenDate: "2026-08-19",
      firstDiscoveredAt: "2026-08-19T17:00:00.000Z",
    },
  };
}

interface ListeningApp {
  listen(port: number, host: string): Server;
}

interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

async function request(
  app: ListeningApp,
  path: string,
  options: RequestOptions = {},
): Promise<Response> {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("Test server did not expose a TCP address");
    }

    return await fetch(`http://127.0.0.1:${address.port}${path}`, options);
  } finally {
    await closeServer(server);
  }
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) {
        resolve();
      } else {
        reject(error);
      }
    });
  });
}
