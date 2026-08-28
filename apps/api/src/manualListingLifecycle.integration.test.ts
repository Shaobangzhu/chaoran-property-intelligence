import { once } from "node:events";
import type { Server } from "node:http";

import {
  ArchiveManualListing,
  CreateManualListing,
  ListListings,
  UpdateManualListing,
  type ArchiveManualListingPersistenceInput,
  type AuthenticatedUser,
  type CreateManualListingPersistenceInput,
  type GetCurrentUserInput,
  type ListingQueryPort,
  type ListingRecord,
  type LoginInput,
  type LoginResult,
  type ManualListingMutationRepositoryPort,
  type ManualListingRecord,
  type ManualListingRepositoryPort,
  type UpdateManualListingPersistenceInput,
} from "@chaoran-property-intelligence/application";
import { describe, expect, it } from "vitest";

import { createApp, type ApiLogger } from "./createApp.js";

const publicOrigin = "http://127.0.0.1:5173";
const listingId = "0198c7d2-7668-7775-b0fc-b789690a60d2";
const actorUserId = "0198c7d2-7668-7775-b0fc-b789690a60c1";

describe("manual listing authenticated API lifecycle integration", () => {
  it("creates, edits, protects, archives, and filters a manual listing", async () => {
    const repository = new InMemoryListingRepository([rentCastRecord]);
    const timestamps = [
      new Date("2026-08-20T19:30:00.000Z"),
      new Date("2026-08-20T20:00:00.000Z"),
      new Date("2026-08-20T20:30:00.000Z"),
    ];
    const now = (): Date => {
      const value = timestamps.shift();
      if (value === undefined) throw new Error("Unexpected clock read");
      return value;
    };
    const logger = new RecordingLogger();
    const app = createApp({
      archiveManualListing: new ArchiveManualListing({ now, repository }),
      createManualListing: new CreateManualListing({
        createId: () => listingId,
        now,
        repository,
      }),
      getCurrentUser: new StaticCurrentUser(),
      getCurrentShowingListArtifact: unusedShowingListUseCase(),
      getCurrentShowingListDraft: unusedShowingListUseCase(),
      getListingSearchCriteria: unusedShowingListUseCase(),
      httpSecurity: {
        deploymentMode: "local",
        originVerificationSecret: null,
        publicOrigin,
        trustedPublicOriginHeaderName: null,
      },
      listListings: new ListListings({ query: repository }),
      logger,
      login: new UnusedLogin(),
      markCurrentShowingListDraftReviewed: unusedShowingListUseCase(),
      requestIdFactory: () => "0198c7d2-7668-7775-b0fc-b789690a60ff",
      saveCurrentShowingListDraft: unusedShowingListUseCase(),
      updateListingSearchCriteria: unusedShowingListUseCase(),
      updateManualListing: new UpdateManualListing({ now, repository }),
    });

    await withServer(app, async (baseUrl) => {
      const createdResponse = await request(baseUrl, "/api/listings/manual", {
        body: {
          addressLine1: "456 Client Way",
          city: "Corona",
          state: "CA",
          zipCode: "92879",
          latitude: 33.8753,
          longitude: -117.5664,
          price: 735000,
          status: "Active",
          notes: "Private client context",
        },
        method: "POST",
      });
      expect(createdResponse.status).toBe(201);
      await expect(createdResponse.json()).resolves.toMatchObject({
        listing: {
          id: listingId,
          source: "manual",
          sourceListingId: null,
        },
      });
      expect(repository.manualRecord).toMatchObject({
        createdByUserId: actorUserId,
        notes: "Private client context",
      });

      const updatedResponse = await request(
        baseUrl,
        `/api/listings/${listingId}`,
        { body: { city: "Norco", price: null }, method: "PATCH" },
      );
      expect(updatedResponse.status).toBe(200);
      await expect(updatedResponse.json()).resolves.toMatchObject({
        listing: {
          city: "Norco",
          formattedAddress: "456 Client Way, Norco, CA 92879",
          id: listingId,
          price: null,
        },
      });
      expect(repository.manualRecord?.notes).toBe("Private client context");

      const rentCastUpdateResponse = await request(
        baseUrl,
        `/api/listings/${rentCastRecord.id}`,
        { body: { city: "Norco" }, method: "PATCH" },
      );
      expect(rentCastUpdateResponse.status).toBe(404);
      await expect(rentCastUpdateResponse.json()).resolves.toEqual({
        error: {
          code: "MANUAL_LISTING_NOT_FOUND",
          message: "Manual listing was not found",
        },
      });

      const archiveResponse = await request(
        baseUrl,
        `/api/listings/${listingId}/archive`,
        { method: "POST" },
      );
      expect(archiveResponse.status).toBe(204);
      expect(await archiveResponse.text()).toBe("");

      const listingsResponse = await request(baseUrl, "/api/listings", {
        method: "GET",
      });
      expect(listingsResponse.status).toBe(200);
      await expect(listingsResponse.json()).resolves.toEqual({
        listings: [expect.objectContaining({ id: rentCastRecord.id, source: "rentcast" })],
      });
      expect(repository.manualRecord?.archivedAt).toBe(
        "2026-08-20T20:30:00.000Z",
      );
    });

    expect(logger.events).toEqual([
      "api.listings.manual.created",
      "api.listings.manual.updated",
      "api.listings.manual.archived",
    ]);
  });
});

function unusedShowingListUseCase(): { execute(): Promise<never> } {
  return {
    async execute() {
      throw new Error("Not used by this integration test");
    },
  };
}

class InMemoryListingRepository
  implements
    ListingQueryPort,
    ManualListingRepositoryPort,
    ManualListingMutationRepositoryPort
{
  manualRecord: ManualListingRecord | null = null;

  constructor(private readonly fixedRecords: ListingRecord[]) {}

  async createManualListing(
    input: CreateManualListingPersistenceInput,
  ): Promise<ManualListingRecord> {
    this.manualRecord = { ...input, archivedAt: null };
    return this.manualRecord;
  }

  async findActiveManualListing(id: string): Promise<ManualListingRecord | null> {
    return this.manualRecord?.id === id && this.manualRecord.archivedAt === null
      ? this.manualRecord
      : null;
  }

  async updateManualListing(
    input: UpdateManualListingPersistenceInput,
  ): Promise<ManualListingRecord | null> {
    if (this.manualRecord?.id !== input.id || this.manualRecord.archivedAt !== null) {
      return null;
    }
    this.manualRecord = {
      ...this.manualRecord,
      listing: input.listing,
      notes: input.notes,
      updatedAt: input.updatedAt,
    };
    return this.manualRecord;
  }

  async archiveManualListing(
    input: ArchiveManualListingPersistenceInput,
  ): Promise<boolean> {
    if (this.manualRecord?.id !== input.id || this.manualRecord.archivedAt !== null) {
      return false;
    }
    this.manualRecord = {
      ...this.manualRecord,
      archivedAt: input.archivedAt,
      updatedAt: input.updatedAt,
    };
    return true;
  }

  async listListings(): Promise<ListingRecord[]> {
    return [
      ...this.fixedRecords,
      ...(this.manualRecord === null || this.manualRecord.archivedAt !== null
        ? []
        : [{ id: this.manualRecord.id, listing: this.manualRecord.listing }]),
    ];
  }
}

class StaticCurrentUser {
  async execute(_input: GetCurrentUserInput): Promise<AuthenticatedUser> {
    return {
      id: actorUserId,
      normalizedEmail: "admin@example.com" as AuthenticatedUser["normalizedEmail"],
      role: "admin",
    };
  }
}

class UnusedLogin {
  async execute(_input: LoginInput): Promise<LoginResult> {
    throw new Error("Login is not used by this lifecycle test");
  }
}

class RecordingLogger implements ApiLogger {
  readonly events: string[] = [];

  error(_event: string): void {}

  info(event: string): void {
    this.events.push(event);
  }
}

const rentCastRecord: ListingRecord = {
  id: "0198c7d2-7668-7775-b0fc-b789690a60e1",
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

async function request(
  baseUrl: string,
  path: string,
  options: { body?: unknown; method: string },
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    headers: {
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      cookie: "cpi_session=integration-session",
      origin: publicOrigin,
    },
    method: options.method,
  });
}
