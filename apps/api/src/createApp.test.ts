import { once } from "node:events";
import type { Server } from "node:http";

import type { ListingRecord } from "@chaoran-property-intelligence/application";
import { describe, expect, it } from "vitest";

import {
  createApp,
  type ApiLogger,
  type ListListingsUseCase,
} from "./createApp.js";

describe("createApp", () => {
  it("returns explicitly mapped listing DTOs without worker state", async () => {
    const listing = createListingRecord() as ListingRecord & {
      deduplicationKey: string;
      notificationStatus: string;
    };
    listing.deduplicationKey = "rentcast:internal-deduplication-key";
    listing.notificationStatus = "sent";
    const app = createApp({
      listListings: new FakeListListings([listing]),
      logger: new RecordingLogger(),
    });

    const response = await request(app, "/api/listings");

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-powered-by")).toBeNull();
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

  it("returns an empty listings collection", async () => {
    const app = createApp({
      listListings: new FakeListListings([]),
      logger: new RecordingLogger(),
    });

    const response = await request(app, "/api/listings");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ listings: [] });
  });

  it("maps query failures to a safe error response", async () => {
    const logger = new RecordingLogger();
    const app = createApp({
      listListings: new FailingListListings(),
      logger,
    });

    const response = await request(app, "/api/listings");

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "Unable to list listings",
      },
    });
    expect(logger.errors).toEqual(["GET /api/listings failed"]);
  });

  it("returns JSON for unknown API routes", async () => {
    const app = createApp({
      listListings: new FakeListListings([]),
      logger: new RecordingLogger(),
    });

    const response = await request(app, "/api/missing");

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "NOT_FOUND",
        message: "Route not found",
      },
    });
  });
});

class FakeListListings implements ListListingsUseCase {
  constructor(private readonly records: ListingRecord[]) {}

  async execute(): Promise<ListingRecord[]> {
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

async function request(app: ListeningApp, path: string): Promise<Response> {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("Test server did not expose a TCP address");
    }

    return await fetch(`http://127.0.0.1:${address.port}${path}`);
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
