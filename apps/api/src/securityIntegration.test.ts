import { once } from "node:events";
import type { Server } from "node:http";

import {
  GetCurrentUser,
  ListListings,
  Login,
  type CreateUserInput,
  type ListingQueryPort,
  type UserAuthenticationRecord,
  type UserRepositoryPort,
} from "@chaoran-property-intelligence/application";
import {
  Argon2idPasswordHasher,
  DUMMY_PASSWORD_HASH,
  JoseAccessTokenService,
} from "@chaoran-property-intelligence/auth";
import {
  normalizePassword,
  normalizeUserEmail,
  type UserAccount,
} from "@chaoran-property-intelligence/domain";
import { describe, expect, it } from "vitest";

import { createApp, type ApiLogger } from "./createApp.js";

const publicOrigin = "http://127.0.0.1:5173";
const password = "correct horse battery staple";
const now = new Date("2026-08-20T20:00:00.000Z");
const userId = "0198c7d2-7668-7775-b0fc-b789690a60c1";
const tokenId = "0198c7d2-7668-7775-b0fc-b789690a60c2";
const requestId = "0198c7d2-7668-7775-b0fc-b789690a60c3";

describe("authentication security integration", () => {
  it("runs login, cookie authentication, admin access, and logout through real auth adapters", async () => {
    const passwordHasher = new Argon2idPasswordHasher();
    const passwordHash = await passwordHasher.hash(normalizePassword(password));
    const repository = new InMemoryUserRepository({
      createdAt: now.toISOString(),
      id: userId,
      normalizedEmail: normalizeUserEmail("admin@example.com"),
      passwordHash,
      role: "admin",
      status: "active",
      updatedAt: now.toISOString(),
    });
    const tokenService = new JoseAccessTokenService({
      audience: "urn:chaoran-property-intelligence:api:test",
      createTokenId: () => tokenId,
      issuer: "urn:chaoran-property-intelligence:auth:test",
      now: () => now,
      signingSecret: Buffer.alloc(32, 7).toString("base64url"),
    });
    const logger = new SafeRecordingLogger();
    const app = createApp({
      archiveManualListing: {
        async execute() {
          throw new Error("Not used by this integration test");
        },
      },
      createManualListing: {
        async execute() {
          throw new Error("Not used by this integration test");
        },
      },
      getCurrentUser: new GetCurrentUser({ repository, tokenService }),
      httpSecurity: {
        deploymentMode: "local",
        originVerificationSecret: null,
        publicOrigin,
      },
      listListings: new ListListings({ query: new EmptyListingQuery() }),
      logger,
      login: new Login({
        dummyPasswordHash: DUMMY_PASSWORD_HASH,
        passwordHasher,
        repository,
        tokenService,
      }),
      now: () => now,
      requestIdFactory: () => requestId,
      updateManualListing: {
        async execute() {
          throw new Error("Not used by this integration test");
        },
      },
    });

    await withServer(app, async (baseUrl) => {
      const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
        body: JSON.stringify({ email: "ADMIN@example.com", password }),
        headers: {
          "content-type": "application/json",
          origin: publicOrigin,
        },
        method: "POST",
      });
      expect(loginResponse.status).toBe(200);
      const sessionCookie = readCookiePair(loginResponse);
      expect(sessionCookie).toMatch(/^cpi_session=ey/u);
      expect(loginResponse.headers.get("x-request-id")).toBe(requestId);

      const meResponse = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { cookie: sessionCookie },
      });
      expect(meResponse.status).toBe(200);
      await expect(meResponse.json()).resolves.toEqual({
        user: { email: "admin@example.com", id: userId, role: "admin" },
      });

      const listingsResponse = await fetch(`${baseUrl}/api/listings`, {
        headers: { cookie: sessionCookie },
      });
      expect(listingsResponse.status).toBe(200);
      await expect(listingsResponse.json()).resolves.toEqual({ listings: [] });

      const logoutResponse = await fetch(`${baseUrl}/api/auth/logout`, {
        headers: { cookie: sessionCookie, origin: publicOrigin },
        method: "POST",
      });
      expect(logoutResponse.status).toBe(204);
      const clearedCookie = readCookiePair(logoutResponse);
      expect(clearedCookie).toBe("cpi_session=");

      const signedOutResponse = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { cookie: clearedCookie },
      });
      expect(signedOutResponse.status).toBe(401);
    });

    const serializedLogs = JSON.stringify(logger.entries);
    expect(serializedLogs).not.toContain("admin@example.com");
    expect(serializedLogs).not.toContain(password);
    expect(serializedLogs).not.toContain("cpi_session");
    expect(serializedLogs).not.toContain("eyJ");
    expect(logger.entries.map((entry) => entry.event)).toEqual([
      "api.auth.login.succeeded",
      "api.auth.session.rejected",
    ]);
  });
});

class InMemoryUserRepository implements UserRepositoryPort {
  constructor(private readonly user: UserAuthenticationRecord) {}

  async createUser(_input: CreateUserInput): Promise<UserAccount> {
    throw new Error("Not used by this integration test");
  }

  async findById(id: string): Promise<UserAccount | null> {
    if (id !== this.user.id) {
      return null;
    }
    const { passwordHash: _passwordHash, ...account } = this.user;
    return account;
  }

  async findByNormalizedEmail(
    normalizedEmail: UserAuthenticationRecord["normalizedEmail"],
  ): Promise<UserAuthenticationRecord | null> {
    return normalizedEmail === this.user.normalizedEmail ? this.user : null;
  }
}

class EmptyListingQuery implements ListingQueryPort {
  async listListings(): Promise<[]> {
    return [];
  }
}

class SafeRecordingLogger implements ApiLogger {
  readonly entries: Array<{
    context: { requestId: string };
    event: string;
    level: "error" | "info";
  }> = [];

  error(event: string, context: { requestId: string }): void {
    this.entries.push({ context, event, level: "error" });
  }

  info(event: string, context: { requestId: string }): void {
    this.entries.push({ context, event, level: "info" });
  }
}

interface ListeningApp {
  listen(port: number, host: string): Server;
}

async function withServer(
  app: ListeningApp,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("Test server did not expose a TCP address");
    }
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) =>
        error === undefined ? resolve() : reject(error),
      );
    });
  }
}

function readCookiePair(response: Response): string {
  const setCookie = response.headers.get("set-cookie");
  const cookiePair = setCookie?.split(";", 1)[0];
  if (cookiePair === undefined) {
    throw new Error("Expected response to set a cookie");
  }
  return cookiePair;
}
