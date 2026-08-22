import { once } from "node:events";
import type { Server } from "node:http";

import {
  AuthenticationRequiredError,
  CurrentShowingListDraftChangedError,
  CurrentShowingListDraftNotFoundError,
  type ArchiveManualListingInput,
  type CreateManualListingInput,
  type CurrentShowingListDraft,
  InvalidCredentialsError,
  InvalidManualListingError,
  ManualListingNotFoundError,
  type AuthenticatedUser,
  type ListingRecord,
  type LoginInput,
  type LoginResult,
  type MarkCurrentShowingListDraftReviewedInput,
  type ManualListingRecord,
  type RenderedShowingListArtifact,
  type SaveCurrentShowingListDraftInput,
  type UpdateManualListingInput,
} from "@chaoran-property-intelligence/application";
import { describe, expect, it } from "vitest";

import {
  createApp,
  type ApiLogger,
  type ArchiveManualListingUseCase,
  type CreateManualListingUseCase,
  type CreateAppOptions,
  type GetCurrentUserUseCase,
  type GetCurrentShowingListArtifactUseCase,
  type GetCurrentShowingListDraftUseCase,
  type ListListingsUseCase,
  type LoginUseCase,
  type MarkCurrentShowingListDraftReviewedUseCase,
  type SaveCurrentShowingListDraftUseCase,
  type UpdateManualListingUseCase,
} from "./createApp.js";

const localOrigin = "http://127.0.0.1:5173";
const productionOrigin = "https://app.example.com";
const originVerificationSecret = "o".repeat(32);
const sessionToken = "valid-session-token";
const requestId = "0198c7d2-7668-7775-b0fc-b789690a60d9";
const now = new Date("2026-08-20T20:00:00.000Z");
const expiresAtEpochSeconds = Math.floor(now.getTime() / 1000) + 3600;

describe("createApp", () => {
  it("serves a public database-independent health response", async () => {
    const listListings = new FakeListListings([]);
    const getCurrentUser = new FakeGetCurrentUser();
    const response = await request(
      createTestApp({ listListings, getCurrentUser }),
      "/api/health",
      { headers: { "x-request-id": "viewer-supplied-request-id" } },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-powered-by")).toBeNull();
    expect(response.headers.get("x-request-id")).toBe(requestId);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("permissions-policy")).toBe(
      "camera=(), microphone=(), geolocation=()",
    );
    expect(response.headers.get("strict-transport-security")).toBeNull();
    await expect(response.json()).resolves.toEqual({ status: "ok" });
    expect(listListings.calls).toBe(0);
    expect(getCurrentUser.tokens).toEqual([]);
  });

  it("adds production transport security without changing the health boundary", async () => {
    const response = await request(
      createTestApp({ httpSecurity: productionHttpSecurity }),
      "/api/health",
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("strict-transport-security")).toBe(
      "max-age=31536000; includeSubDomains",
    );
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
    const logger = new RecordingLogger();
    const response = await request(
      createTestApp({ login, logger }),
      "/api/auth/login",
      {
        method: "POST",
        headers: jsonHeaders(localOrigin),
        body: JSON.stringify({
          email: "unknown@example.com",
          password: "candidate password",
        }),
      },
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVALID_CREDENTIALS",
        message: "Invalid email or password",
      },
    });
    expect(logger.infos).toEqual([
      {
        context: { requestId },
        event: "api.auth.login.rejected",
      },
    ]);
  });

  it("limits failed login work before body parsing without trusting viewer IP headers", async () => {
    const login = new FakeLogin(new InvalidCredentialsError());
    const logger = new RecordingLogger();
    const app = createTestApp({
      login,
      logger,
      loginRateLimit: { limit: 2, windowMs: 60_000 },
    });
    const input = {
      method: "POST",
      headers: {
        ...jsonHeaders(localOrigin),
        "x-forwarded-for": "203.0.113.10",
      },
      body: JSON.stringify({
        email: "unknown@example.com",
        password: "candidate password",
      }),
    };

    expect((await request(app, "/api/auth/login", input)).status).toBe(401);
    expect((await request(app, "/api/auth/login", input)).status).toBe(401);
    const limited = await request(app, "/api/auth/login", {
      ...input,
      headers: {
        ...input.headers,
        "x-forwarded-for": "198.51.100.20",
      },
    });

    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toMatch(/^\d+$/u);
    expect(limited.headers.get("ratelimit")).not.toBeNull();
    await expect(limited.json()).resolves.toEqual({
      error: {
        code: "LOGIN_RATE_LIMITED",
        message: "Too many sign-in attempts",
      },
    });
    expect(login.inputs).toHaveLength(2);
    expect(logger.infos.at(-1)).toEqual({
      context: { requestId },
      event: "api.auth.login.rate_limited",
    });
  });

  it("does not let rejected origins consume the login limit", async () => {
    const login = new FakeLogin(new InvalidCredentialsError());
    const app = createTestApp({
      login,
      loginRateLimit: { limit: 1, windowMs: 60_000 },
    });
    const body = JSON.stringify({
      email: "unknown@example.com",
      password: "candidate password",
    });

    expect(
      (
        await request(app, "/api/auth/login", {
          method: "POST",
          headers: jsonHeaders("https://wrong.example.com"),
          body,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app, "/api/auth/login", {
          method: "POST",
          headers: jsonHeaders(localOrigin),
          body,
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await request(app, "/api/auth/login", {
          method: "POST",
          headers: jsonHeaders(localOrigin),
          body,
        })
      ).status,
    ).toBe(429);
    expect(login.inputs).toHaveLength(1);
  });

  it("does not charge successful logins against the failed-attempt budget", async () => {
    const login = new FakeLogin();
    const app = createTestApp({
      login,
      loginRateLimit: { limit: 1, windowMs: 60_000 },
    });
    const input = {
      method: "POST",
      headers: jsonHeaders(localOrigin),
      body: JSON.stringify({
        email: "admin@example.com",
        password: "candidate password",
      }),
    };

    expect((await request(app, "/api/auth/login", input)).status).toBe(200);
    expect((await request(app, "/api/auth/login", input)).status).toBe(200);
    expect(login.inputs).toHaveLength(2);
  });

  it("counts malformed login attempts before parsing credential bodies", async () => {
    const login = new FakeLogin();
    const app = createTestApp({
      login,
      loginRateLimit: { limit: 1, windowMs: 60_000 },
    });

    expect(
      (
        await request(app, "/api/auth/login", {
          method: "POST",
          headers: jsonHeaders(localOrigin),
          body: "{",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app, "/api/auth/login", {
          method: "POST",
          headers: jsonHeaders(localOrigin),
          body: JSON.stringify({
            email: "admin@example.com",
            password: "candidate password",
          }),
        })
      ).status,
    ).toBe(429);
    expect(login.inputs).toEqual([]);
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
      const logger = new RecordingLogger();
      const headers: Record<string, string> = {
        "content-type": "application/json",
      };
      if (origin !== undefined) {
        headers.origin = origin;
      }

      const response = await request(
        createTestApp({ login, logger }),
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
      expect(logger.infos).toEqual([
        {
          context: { requestId },
          event: "api.request_origin.rejected",
        },
      ]);
    },
  );

  it.each(["POST", "PUT", "PATCH", "DELETE"])(
    "requires an exact Origin for every unsafe %s request",
    async (method) => {
      const app = createTestApp();

      const rejected = await request(app, "/api/missing", { method });
      expect(rejected.status).toBe(403);
      await expect(rejected.json()).resolves.toMatchObject({
        error: { code: "REQUEST_ORIGIN_REJECTED" },
      });

      const accepted = await request(app, "/api/missing", {
        method,
        headers: { origin: localOrigin },
      });
      expect(accepted.status).toBe(404);
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

  it("returns the latest price without changing the public listing id", async () => {
    const listing = createListingRecord();
    listing.listing.price = 770000;
    listing.listing.lastSeenDate = "2026-08-22";
    const listListings = new FakeListListings([listing]);

    const response = await request(
      createTestApp({ listListings }),
      "/api/listings",
      { headers: sessionHeaders() },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      listings: [
        {
          id: listing.id,
          price: 770000,
          lastSeenDate: "2026-08-22",
        },
      ],
    });
    expect(listListings.calls).toBe(1);
  });

  it("protects and returns only the bounded current Showing List review DTO", async () => {
    const getCurrentShowingListDraft = new FakeGetCurrentShowingListDraft();
    const app = createTestApp({ getCurrentShowingListDraft });

    expect((await request(app, "/api/showing-list/current")).status).toBe(401);
    expect(getCurrentShowingListDraft.calls).toBe(0);

    const response = await request(app, "/api/showing-list/current", {
      headers: sessionHeaders(),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      current: {
        artifact: {
          fileName: "showing-list-draft.pdf",
          kind: "generated-snapshot",
        },
        deliveryStatus: "pending",
        draft: createCurrentShowingListDraft().draft,
        generatedAt: "2026-08-20T20:00:00.000Z",
        generationId: "0198c7d2-7668-7775-b0fc-b789690a60f1",
        preferences: {
          clientDisplayName: "Alex",
          showingDate: "2026-08-23",
        },
        status: "draft",
        updatedAt: "2026-08-20T20:00:00.000Z",
      },
    });
    expect(JSON.stringify(body)).not.toContain("artifact-etag");
    expect(JSON.stringify(body)).not.toContain("gpt-5.6-terra");
    expect(JSON.stringify(body)).not.toContain("agentInstructions");
  });

  it("rejects a non-admin Showing List read before querying the draft", async () => {
    const getCurrentShowingListDraft = new FakeGetCurrentShowingListDraft();
    const nonAdminUser = {
      ...authenticatedUser,
      role: "viewer",
    } as unknown as AuthenticatedUser;
    const app = createTestApp({
      getCurrentShowingListDraft,
      getCurrentUser: new FakeGetCurrentUser(undefined, nonAdminUser),
    });

    const response = await request(app, "/api/showing-list/current", {
      headers: sessionHeaders(),
    });

    expect(response.status).toBe(403);
    expect(getCurrentShowingListDraft.calls).toBe(0);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "ADMIN_AUTHORIZATION_REQUIRED",
        message: "Administrator authorization is required",
      },
    });
  });

  it("saves and reviews a current Showing List with concurrency identity", async () => {
    const save = new FakeSaveCurrentShowingListDraft();
    const mark = new FakeMarkCurrentShowingListDraftReviewed();
    const logger = new RecordingLogger();
    const current = createCurrentShowingListDraft();
    const app = createTestApp({
      logger,
      markCurrentShowingListDraftReviewed: mark,
      saveCurrentShowingListDraft: save,
    });

    const savedResponse = await request(app, "/api/showing-list/current", {
      body: JSON.stringify({
        draft: current.draft,
        expectedUpdatedAt: current.updatedAt,
        generationId: current.generationId,
      }),
      headers: manualListingHeaders(),
      method: "PATCH",
    });
    expect(savedResponse.status).toBe(200);
    expect(save.inputs).toEqual([
      {
        draft: current.draft,
        expectedUpdatedAt: current.updatedAt,
        generationId: current.generationId,
      },
    ]);

    const reviewedResponse = await request(
      app,
      "/api/showing-list/current/review",
      {
        body: JSON.stringify({
          expectedUpdatedAt: current.updatedAt,
          generationId: current.generationId,
        }),
        headers: manualListingHeaders(),
        method: "POST",
      },
    );
    expect(reviewedResponse.status).toBe(200);
    expect(mark.inputs).toHaveLength(1);
    expect(logger.infos).toContainEqual({
      context: { requestId },
      event: "api.showing_list.current.saved",
    });
    expect(logger.infos).toContainEqual({
      context: { requestId },
      event: "api.showing_list.current.reviewed",
    });
  });

  it("rejects malformed and stale Showing List review writes safely", async () => {
    const save = new FakeSaveCurrentShowingListDraft();
    const malformed = await request(
      createTestApp({ saveCurrentShowingListDraft: save }),
      "/api/showing-list/current",
      {
        body: JSON.stringify({ generationId: "extra-only" }),
        headers: manualListingHeaders(),
        method: "PATCH",
      },
    );
    expect(malformed.status).toBe(400);
    expect(save.inputs).toEqual([]);

    const stale = await request(
      createTestApp({
        saveCurrentShowingListDraft: new FakeSaveCurrentShowingListDraft(
          new CurrentShowingListDraftChangedError(),
        ),
      }),
      "/api/showing-list/current",
      {
        body: JSON.stringify({
          draft: createCurrentShowingListDraft().draft,
          expectedUpdatedAt: "2026-08-20T20:00:00.000Z",
          generationId: "0198c7d2-7668-7775-b0fc-b789690a60f1",
        }),
        headers: manualListingHeaders(),
        method: "PATCH",
      },
    );
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({
      error: { code: "SHOWING_LIST_CHANGED" },
    });
  });

  it("downloads the authenticated generated PDF snapshot", async () => {
    const artifact = new FakeGetCurrentShowingListArtifact();
    const response = await request(
      createTestApp({ getCurrentShowingListArtifact: artifact }),
      "/api/showing-list/current/download",
      { headers: sessionHeaders() },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="showing-list-draft.pdf"',
    );
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([
      37, 80, 68, 70,
    ]);
    expect(artifact.calls).toBe(1);
  });

  it("maps a missing current artifact to a bounded 404", async () => {
    const response = await request(
      createTestApp({
        getCurrentShowingListArtifact: new FakeGetCurrentShowingListArtifact(
          new CurrentShowingListDraftNotFoundError(),
        ),
      }),
      "/api/showing-list/current/download",
      { headers: sessionHeaders() },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "SHOWING_LIST_NOT_FOUND" },
    });
  });

  it("returns 403 before querying when an authenticated identity is not admin", async () => {
    const listListings = new FakeListListings([]);
    const logger = new RecordingLogger();
    const nonAdminUser = {
      ...authenticatedUser,
      role: "viewer",
    } as unknown as AuthenticatedUser;
    const response = await request(
      createTestApp({
        getCurrentUser: new FakeGetCurrentUser(undefined, nonAdminUser),
        listListings,
        logger,
      }),
      "/api/listings",
      { headers: sessionHeaders() },
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "ADMIN_AUTHORIZATION_REQUIRED",
        message: "Administrator authorization is required",
      },
    });
    expect(listListings.calls).toBe(0);
    expect(logger.infos).toEqual([
      {
        context: { requestId },
        event: "api.authorization.admin.rejected",
      },
    ]);
  });

  it("authenticates manual writes before parsing their JSON body", async () => {
    const createManualListing = new FakeCreateManualListing();
    const response = await request(
      createTestApp({ createManualListing }),
      "/api/listings/manual",
      {
        method: "POST",
        headers: jsonHeaders(localOrigin),
        body: "{",
      },
    );

    expect(response.status).toBe(401);
    expect(createManualListing.inputs).toEqual([]);
  });

  it("requires admin authorization before parsing a manual listing body", async () => {
    const createManualListing = new FakeCreateManualListing();
    const nonAdminUser = {
      ...authenticatedUser,
      role: "viewer",
    } as unknown as AuthenticatedUser;
    const response = await request(
      createTestApp({
        createManualListing,
        getCurrentUser: new FakeGetCurrentUser(undefined, nonAdminUser),
      }),
      "/api/listings/manual",
      {
        method: "POST",
        headers: manualListingHeaders(),
        body: "{",
      },
    );

    expect(response.status).toBe(403);
    expect(createManualListing.inputs).toEqual([]);
  });

  it("creates a manual listing with the authenticated actor and a bounded response", async () => {
    const createManualListing = new FakeCreateManualListing();
    const logger = new RecordingLogger();
    const response = await request(
      createTestApp({ createManualListing, logger }),
      "/api/listings/manual",
      {
        method: "POST",
        headers: manualListingHeaders(),
        body: JSON.stringify(createManualListingBody()),
      },
    );

    expect(response.status).toBe(201);
    expect(createManualListing.inputs).toEqual([
      {
        actorUserId: authenticatedUser.id,
        draft: createManualListingBody(),
      },
    ]);
    await expect(response.json()).resolves.toEqual({
      listing: {
        id: "0198c7d2-7668-7775-b0fc-b789690a60c3",
        source: "manual",
        sourceListingId: null,
        mlsName: null,
        mlsNumber: null,
        formattedAddress: "123 Main St, Eastvale, CA 92880",
        addressLine1: "123 Main St",
        addressLine2: null,
        city: "Eastvale",
        state: "CA",
        zipCode: "92880",
        latitude: 33.9525,
        longitude: -117.5848,
        propertyType: null,
        bedrooms: null,
        bathrooms: null,
        price: null,
        status: "Active",
        listedDate: null,
        lastSeenDate: "2026-08-20",
        firstDiscoveredAt: "2026-08-20T20:00:00.000Z",
      },
    });
    expect(logger.infos).toEqual([
      {
        context: { requestId },
        event: "api.listings.manual.created",
      },
    ]);
  });

  it("accepts the maximum valid notes length within the manual body limit", async () => {
    const createManualListing = new FakeCreateManualListing();
    const notes = "n".repeat(4_000);
    const response = await request(
      createTestApp({ createManualListing }),
      "/api/listings/manual",
      {
        method: "POST",
        headers: manualListingHeaders(),
        body: JSON.stringify({ ...createManualListingBody(), notes }),
      },
    );

    expect(response.status).toBe(201);
    expect(createManualListing.inputs[0]?.draft.notes).toBe(notes);
  });

  it.each([
    ["an extra protected field", { ...createManualListingBody(), source: "manual" }],
    ["a wrong field type", { ...createManualListingBody(), price: "825000" }],
    ["an array", []],
  ])("rejects %s before executing manual creation", async (_label, body) => {
    const createManualListing = new FakeCreateManualListing();
    const response = await request(
      createTestApp({ createManualListing }),
      "/api/listings/manual",
      {
        method: "POST",
        headers: manualListingHeaders(),
        body: JSON.stringify(body),
      },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVALID_REQUEST",
        message: "Request body is invalid",
      },
    });
    expect(createManualListing.inputs).toEqual([]);
  });

  it("rejects an oversized manual-listing body before executing the use case", async () => {
    const createManualListing = new FakeCreateManualListing();
    const response = await request(
      createTestApp({ createManualListing }),
      "/api/listings/manual",
      {
        method: "POST",
        headers: manualListingHeaders(),
        body: JSON.stringify({
          ...createManualListingBody(),
          notes: "n".repeat(9_000),
        }),
      },
    );

    expect(response.status).toBe(400);
    expect(createManualListing.inputs).toEqual([]);
  });

  it("rejects malformed manual-listing JSON after authentication", async () => {
    const createManualListing = new FakeCreateManualListing();
    const response = await request(
      createTestApp({ createManualListing }),
      "/api/listings/manual",
      {
        method: "POST",
        headers: manualListingHeaders(),
        body: "{",
      },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INVALID_REQUEST" },
    });
    expect(createManualListing.inputs).toEqual([]);
  });

  it("maps safe manual-listing validation fields without exposing values", async () => {
    const createManualListing = new FakeCreateManualListing(
      new InvalidManualListingError("latitude"),
    );
    const response = await request(
      createTestApp({ createManualListing }),
      "/api/listings/manual",
      {
        method: "POST",
        headers: manualListingHeaders(),
        body: JSON.stringify(createManualListingBody()),
      },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVALID_MANUAL_LISTING",
        field: "latitude",
        message: "Manual listing is invalid",
      },
    });
  });

  it("treats an invalid authenticated actor as an internal failure", async () => {
    const logger = new RecordingLogger();
    const createManualListing = new FakeCreateManualListing(
      new InvalidManualListingError("actorUserId"),
    );
    const response = await request(
      createTestApp({ createManualListing, logger }),
      "/api/listings/manual",
      {
        method: "POST",
        headers: manualListingHeaders(),
        body: JSON.stringify(createManualListingBody()),
      },
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INTERNAL_SERVER_ERROR" },
    });
    expect(logger.errors).toEqual([
      {
        context: { requestId },
        event: "api.request.failed",
      },
    ]);
  });

  it("rejects the wrong Origin before authenticating a manual write", async () => {
    const createManualListing = new FakeCreateManualListing();
    const getCurrentUser = new FakeGetCurrentUser();
    const response = await request(
      createTestApp({ createManualListing, getCurrentUser }),
      "/api/listings/manual",
      {
        method: "POST",
        headers: {
          ...manualListingHeaders(),
          origin: "https://wrong.example.com",
        },
        body: JSON.stringify(createManualListingBody()),
      },
    );

    expect(response.status).toBe(403);
    expect(getCurrentUser.tokens).toEqual([]);
    expect(createManualListing.inputs).toEqual([]);
  });

  it("updates an active manual listing with a strict partial patch", async () => {
    const updateManualListing = new FakeUpdateManualListing();
    const logger = new RecordingLogger();
    const response = await request(
      createTestApp({ logger, updateManualListing }),
      "/api/listings/0198c7d2-7668-7775-b0fc-b789690a60c3",
      {
        method: "PATCH",
        headers: manualListingHeaders(),
        body: JSON.stringify({ city: "Corona", notes: null }),
      },
    );

    expect(response.status).toBe(200);
    expect(updateManualListing.inputs).toEqual([
      {
        listingId: "0198c7d2-7668-7775-b0fc-b789690a60c3",
        patch: { city: "Corona", notes: null },
      },
    ]);
    await expect(response.json()).resolves.toMatchObject({
      listing: { id: "0198c7d2-7668-7775-b0fc-b789690a60c3", source: "manual" },
    });
    expect(logger.infos).toContainEqual({
      context: { requestId },
      event: "api.listings.manual.updated",
    });
  });

  it("authenticates and authorizes before parsing manual updates", async () => {
    const updateManualListing = new FakeUpdateManualListing();
    const unauthenticated = await request(
      createTestApp({ updateManualListing }),
      "/api/listings/0198c7d2-7668-7775-b0fc-b789690a60c3",
      {
        method: "PATCH",
        headers: jsonHeaders(localOrigin),
        body: "{",
      },
    );
    expect(unauthenticated.status).toBe(401);
    expect(updateManualListing.inputs).toEqual([]);

    const nonAdminUser = {
      ...authenticatedUser,
      role: "viewer",
    } as unknown as AuthenticatedUser;
    const forbidden = await request(
      createTestApp({
        getCurrentUser: new FakeGetCurrentUser(undefined, nonAdminUser),
        updateManualListing,
      }),
      "/api/listings/0198c7d2-7668-7775-b0fc-b789690a60c3",
      {
        method: "PATCH",
        headers: manualListingHeaders(),
        body: "{",
      },
    );
    expect(forbidden.status).toBe(403);
    expect(updateManualListing.inputs).toEqual([]);
  });

  it("rejects empty and protected manual updates before the use case", async () => {
    const updateManualListing = new FakeUpdateManualListing();
    for (const body of [{}, { source: "manual" }]) {
      const response = await request(
        createTestApp({ updateManualListing }),
        "/api/listings/0198c7d2-7668-7775-b0fc-b789690a60c3",
        {
          method: "PATCH",
          headers: manualListingHeaders(),
          body: JSON.stringify(body),
        },
      );
      expect(response.status).toBe(400);
    }
    expect(updateManualListing.inputs).toEqual([]);
  });

  it("returns one bounded 404 for a non-editable listing ID", async () => {
    const response = await request(
      createTestApp({
        updateManualListing: new FakeUpdateManualListing(
          new ManualListingNotFoundError(),
        ),
      }),
      "/api/listings/0198c7d2-7668-7775-b0fc-b789690a60c1",
      {
        method: "PATCH",
        headers: manualListingHeaders(),
        body: JSON.stringify({ city: "Corona" }),
      },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "MANUAL_LISTING_NOT_FOUND",
        message: "Manual listing was not found",
      },
    });
  });

  it("archives an active manual listing without a response body", async () => {
    const archiveManualListing = new FakeArchiveManualListing();
    const logger = new RecordingLogger();
    const response = await request(
      createTestApp({ archiveManualListing, logger }),
      "/api/listings/0198c7d2-7668-7775-b0fc-b789690a60c3/archive",
      { method: "POST", headers: { origin: localOrigin, ...sessionHeaders() } },
    );

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(archiveManualListing.inputs).toEqual([
      { listingId: "0198c7d2-7668-7775-b0fc-b789690a60c3" },
    ]);
    expect(logger.infos).toContainEqual({
      context: { requestId },
      event: "api.listings.manual.archived",
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
    expect(logger.errors).toEqual([
      {
        context: { requestId },
        event: "api.request.failed",
      },
    ]);
  });

  it("rejects direct production access but keeps health available", async () => {
    const logger = new RecordingLogger();
    const app = createTestApp({
      httpSecurity: productionHttpSecurity,
      logger,
    });

    const directResponse = await request(app, "/api/auth/me", {
      headers: sessionHeaders("__Host-cpi_session"),
    });
    expect(directResponse.status).toBe(403);
    await expect(directResponse.json()).resolves.toMatchObject({
      error: { code: "ORIGIN_VERIFICATION_FAILED" },
    });

    const healthResponse = await request(app, "/api/health");
    expect(healthResponse.status).toBe(200);
    expect(logger.infos).toEqual([
      {
        context: { requestId },
        event: "api.origin_verification.rejected",
      },
    ]);
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

  constructor(
    private readonly failure?: Error,
    private readonly user: AuthenticatedUser = authenticatedUser,
  ) {}

  async execute(input: { accessToken: string }): Promise<AuthenticatedUser> {
    this.tokens.push(input.accessToken);
    if (this.failure !== undefined) {
      throw this.failure;
    }
    return this.user;
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

class FakeCreateManualListing implements CreateManualListingUseCase {
  readonly inputs: CreateManualListingInput[] = [];

  constructor(private readonly failure?: Error) {}

  async execute(
    input: CreateManualListingInput,
  ): Promise<ManualListingRecord> {
    this.inputs.push(input);
    if (this.failure !== undefined) {
      throw this.failure;
    }
    return createManualListingRecord();
  }
}

class FakeUpdateManualListing implements UpdateManualListingUseCase {
  readonly inputs: UpdateManualListingInput[] = [];

  constructor(private readonly failure?: Error) {}

  async execute(input: UpdateManualListingInput): Promise<ManualListingRecord> {
    this.inputs.push(input);
    if (this.failure !== undefined) {
      throw this.failure;
    }
    return createManualListingRecord();
  }
}

class FakeArchiveManualListing implements ArchiveManualListingUseCase {
  readonly inputs: ArchiveManualListingInput[] = [];

  constructor(private readonly failure?: Error) {}

  async execute(input: ArchiveManualListingInput): Promise<void> {
    this.inputs.push(input);
    if (this.failure !== undefined) {
      throw this.failure;
    }
  }
}

class FakeGetCurrentShowingListDraft
  implements GetCurrentShowingListDraftUseCase
{
  calls = 0;

  constructor(
    private readonly current: CurrentShowingListDraft | null =
      createCurrentShowingListDraft(),
  ) {}

  async execute(): Promise<CurrentShowingListDraft | null> {
    this.calls += 1;
    return this.current;
  }
}

class FakeSaveCurrentShowingListDraft
  implements SaveCurrentShowingListDraftUseCase
{
  readonly inputs: SaveCurrentShowingListDraftInput[] = [];

  constructor(private readonly failure?: Error) {}

  async execute(
    input: SaveCurrentShowingListDraftInput,
  ): Promise<CurrentShowingListDraft> {
    this.inputs.push(input);
    if (this.failure !== undefined) {
      throw this.failure;
    }
    return createCurrentShowingListDraft();
  }
}

class FakeMarkCurrentShowingListDraftReviewed
  implements MarkCurrentShowingListDraftReviewedUseCase
{
  readonly inputs: MarkCurrentShowingListDraftReviewedInput[] = [];

  async execute(
    input: MarkCurrentShowingListDraftReviewedInput,
  ): Promise<CurrentShowingListDraft> {
    this.inputs.push(input);
    return createCurrentShowingListDraft({ status: "reviewed" });
  }
}

class FakeGetCurrentShowingListArtifact
  implements GetCurrentShowingListArtifactUseCase
{
  calls = 0;

  constructor(private readonly failure?: Error) {}

  async execute(): Promise<RenderedShowingListArtifact> {
    this.calls += 1;
    if (this.failure !== undefined) {
      throw this.failure;
    }
    return {
      bytes: new Uint8Array([37, 80, 68, 70]),
      fileName: "showing-list-draft.pdf",
      mediaType: "application/pdf",
    };
  }
}

class FailingListListings implements ListListingsUseCase {
  async execute(): Promise<ListingRecord[]> {
    throw new Error("postgresql://user:password@private-host/database");
  }
}

class RecordingLogger implements ApiLogger {
  readonly errors: RecordedLog[] = [];
  readonly infos: RecordedLog[] = [];

  error(event: string, context?: { requestId: string }): void {
    this.errors.push({ context, event });
  }

  info(event: string, context?: { requestId: string }): void {
    this.infos.push({ context, event });
  }
}

interface RecordedLog {
  event: string;
  context: { requestId: string } | undefined;
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
    archiveManualListing: new FakeArchiveManualListing(),
    createManualListing: new FakeCreateManualListing(),
    listListings: new FakeListListings([]),
    login: new FakeLogin(),
    getCurrentUser: new FakeGetCurrentUser(),
    getCurrentShowingListArtifact: new FakeGetCurrentShowingListArtifact(),
    getCurrentShowingListDraft: new FakeGetCurrentShowingListDraft(),
    httpSecurity: localHttpSecurity,
    logger: new RecordingLogger(),
    now: () => now,
    requestIdFactory: () => requestId,
    markCurrentShowingListDraftReviewed:
      new FakeMarkCurrentShowingListDraftReviewed(),
    saveCurrentShowingListDraft: new FakeSaveCurrentShowingListDraft(),
    updateManualListing: new FakeUpdateManualListing(),
    ...overrides,
  });
}

function jsonHeaders(origin: string): Record<string, string> {
  return { "content-type": "application/json", origin };
}

function manualListingHeaders(): Record<string, string> {
  return {
    ...jsonHeaders(localOrigin),
    ...sessionHeaders(),
  };
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

function createManualListingBody(): Record<string, unknown> {
  return {
    addressLine1: "123 Main St",
    city: "Eastvale",
    state: "CA",
    zipCode: "92880",
    latitude: 33.9525,
    longitude: -117.5848,
    status: "Active",
  };
}

function createManualListingRecord(): ManualListingRecord {
  return {
    id: "0198c7d2-7668-7775-b0fc-b789690a60c3",
    listing: {
      source: "manual",
      sourceListingId: null,
      mlsName: null,
      mlsNumber: null,
      formattedAddress: "123 Main St, Eastvale, CA 92880",
      addressLine1: "123 Main St",
      addressLine2: null,
      city: "Eastvale",
      state: "CA",
      zipCode: "92880",
      latitude: 33.9525,
      longitude: -117.5848,
      propertyType: null,
      bedrooms: null,
      bathrooms: null,
      price: null,
      status: "Active",
      listedDate: null,
      lastSeenDate: "2026-08-20",
      firstDiscoveredAt: "2026-08-20T20:00:00.000Z",
    },
    createdByUserId: authenticatedUser.id,
    notes: "secret internal note",
    archivedAt: null,
    createdAt: "2026-08-20T20:00:00.000Z",
    updatedAt: "2026-08-20T20:00:00.000Z",
  };
}

function createCurrentShowingListDraft(
  overrides: Partial<CurrentShowingListDraft> = {},
): CurrentShowingListDraft {
  const listingId = "0198c7d2-7668-7775-b0fc-b789690a60c1";
  return {
    artifact: {
      etag: '"artifact-etag"',
      key: "showing-lists/current.pdf",
    },
    createdByUserId: authenticatedUser.id,
    deliveredAt: null,
    deliveryStatus: "pending",
    draft: {
      clientMessage: "Please review these properties before the showing.",
      reviewWarnings: ["Licensed-agent review is required."],
      stops: [{
        considerations: ["Confirm showing availability"],
        highlights: ["Four bedrooms"],
        listingId,
        orderReason: "Suggested order for agent review.",
        proposedOrder: 1,
      }],
      summary: "An unreviewed draft for the selected properties.",
      title: "Saturday Showing List",
    },
    generatedAt: "2026-08-20T20:00:00.000Z",
    generationId: "0198c7d2-7668-7775-b0fc-b789690a60f1",
    generationInput: {
      listingIds: [listingId],
      preferences: {
        agentInstructions: "Private notes",
        clientDisplayName: "Alex",
        showingDate: "2026-08-23",
      },
    },
    generationMetadata: {
      durationMs: 1_250,
      inputTokens: 100,
      model: "gpt-5.6-terra",
      outputTokens: 80,
      responseId: "resp_123",
      totalTokens: 180,
    },
    promptVersion: "v1",
    status: "draft",
    updatedAt: "2026-08-20T20:00:00.000Z",
    ...overrides,
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
