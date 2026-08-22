import { describe, expect, it, vi } from "vitest";

import { runRentCastCoverageAuditCommand } from "./runRentCastCoverageAuditCommand.js";

describe("runRentCastCoverageAuditCommand", () => {
  it("refuses to call RentCast without the explicit one-request flag", async () => {
    const stdout = new MemoryWriter();
    const stderr = new MemoryWriter();
    const fetch = vi.fn<typeof globalThis.fetch>();

    const exitCode = await runRentCastCoverageAuditCommand({
      args: [],
      environment: { RENTCAST_API_KEY: "test-secret" },
      fetch,
      now: () => 1_000,
      stderr,
      stdout,
    });

    expect(exitCode).toBe(1);
    expect(fetch).not.toHaveBeenCalled();
    expect(stdout.output).toBe("");
    expect(stderr.output).toContain(
      "pnpm rentcast:coverage-audit:execute-one-request",
    );
    expect(stderr.output).toContain("No RentCast request was made.");
  });

  it("executes one aggregate-only audit with the explicit flag", async () => {
    const stdout = new MemoryWriter();
    const stderr = new MemoryWriter();
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json([createListing()], {
        headers: { "X-Total-Count": "1" },
      }),
    );

    const exitCode = await runRentCastCoverageAuditCommand({
      args: ["--execute-one-request"],
      environment: { RENTCAST_API_KEY: "test-secret" },
      fetch,
      now: () => 1_000,
      stderr,
      stdout,
    });

    expect(exitCode).toBe(0);
    expect(fetch).toHaveBeenCalledOnce();
    expect(stderr.output).toBe("");
    expect(stdout.output).toContain("Coverage gate: PASS");
    expect(stdout.output).toContain("Returned page complete: yes");
    expect(stdout.output).toContain("Total matching listings: 1");
    expect(stdout.output).not.toContain("123 Main St");
    expect(stdout.output).not.toContain("test-secret");
    expect(stdout.output).not.toContain("api.rentcast.io");
  });

  it("returns a failure when the one-page coverage gate is not met", async () => {
    const stdout = new MemoryWriter();
    const stderr = new MemoryWriter();
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json([createListing()], {
        headers: { "X-Total-Count": "501" },
      }),
    );

    const exitCode = await runRentCastCoverageAuditCommand({
      args: ["--execute-one-request"],
      environment: { RENTCAST_API_KEY: "test-secret" },
      fetch,
      now: () => 1_000,
      stderr,
      stdout,
    });

    expect(exitCode).toBe(1);
    expect(fetch).toHaveBeenCalledOnce();
    expect(stdout.output).toContain("Coverage gate: FAIL");
    expect(stdout.output).toContain("Returned page complete: no");
    expect(stdout.output).toContain("Result limit margin: 0");
    expect(stderr.output).toBe("");
  });

  it("redacts the API key from an unexpected request error", async () => {
    const stdout = new MemoryWriter();
    const stderr = new MemoryWriter();
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      throw new Error("Transport rejected test-secret");
    });

    const exitCode = await runRentCastCoverageAuditCommand({
      args: ["--execute-one-request"],
      environment: { RENTCAST_API_KEY: "test-secret" },
      fetch,
      now: () => 1_000,
      stderr,
      stdout,
    });

    expect(exitCode).toBe(1);
    expect(stdout.output).toBe("");
    expect(stderr.output).toContain("Transport rejected [REDACTED]");
    expect(stderr.output).not.toContain("test-secret");
  });
});

function createListing() {
  return {
    id: "123-Main-St,-Chino,-CA-91710",
    formattedAddress: "123 Main St, Chino, CA 91710",
    addressLine1: "123 Main St",
    addressLine2: null,
    city: "Chino",
    state: "CA",
    zipCode: "91710",
    latitude: 34.0122,
    longitude: -117.6889,
    propertyType: "Single Family",
    bedrooms: 4,
    bathrooms: 3,
    status: "Active",
    price: 775_000,
    listedDate: "2026-08-20T00:00:00.000Z",
    lastSeenDate: "2026-08-21T12:00:00.000Z",
    mlsName: "CRMLS",
    mlsNumber: "FIXTURE",
  };
}

class MemoryWriter {
  output = "";

  write(message: string): void {
    this.output += message;
  }
}
