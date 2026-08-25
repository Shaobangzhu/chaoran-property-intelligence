import { describe, expect, it, vi } from "vitest";

import { runStevensonRanchCoverageAuditCommand } from "./runStevensonRanchCoverageAuditCommand.js";

describe("runStevensonRanchCoverageAuditCommand", () => {
  it("refuses to call RentCast without the explicit one-request flag", async () => {
    const stdout = new MemoryWriter();
    const stderr = new MemoryWriter();
    const fetch = vi.fn<typeof globalThis.fetch>();

    const exitCode = await runStevensonRanchCoverageAuditCommand({
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
      "rentcast:stevenson-ranch-coverage-audit:execute-one-request",
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

    const exitCode = await runStevensonRanchCoverageAuditCommand({
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
    expect(stdout.output).toContain("Expected city verified: yes");
    expect(stdout.output).not.toContain("123 Main St");
    expect(stdout.output).not.toContain("test-secret");
    expect(stdout.output).not.toContain("api.rentcast.io");
  });

  it("does not retry when the coverage gate fails", async () => {
    const stdout = new MemoryWriter();
    const stderr = new MemoryWriter();
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json([createListing({ city: "Valencia" })], {
        headers: { "X-Total-Count": "1" },
      }),
    );

    const exitCode = await runStevensonRanchCoverageAuditCommand({
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
    expect(stdout.output).toContain("Expected city verified: no");
    expect(stderr.output).toBe("");
  });

  it("redacts the API key from an unexpected request error", async () => {
    const stdout = new MemoryWriter();
    const stderr = new MemoryWriter();
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      throw new Error("Transport rejected test-secret");
    });

    const exitCode = await runStevensonRanchCoverageAuditCommand({
      args: ["--execute-one-request"],
      environment: { RENTCAST_API_KEY: "test-secret" },
      fetch,
      now: () => 1_000,
      stderr,
      stdout,
    });

    expect(exitCode).toBe(1);
    expect(fetch).toHaveBeenCalledOnce();
    expect(stdout.output).toBe("");
    expect(stderr.output).toContain("Transport rejected [REDACTED]");
    expect(stderr.output).not.toContain("test-secret");
  });
});

function createListing(
  overrides: Partial<ReturnType<typeof createBaseListing>> = {},
) {
  return { ...createBaseListing(), ...overrides };
}

function createBaseListing() {
  return {
    bathrooms: 2.5,
    bedrooms: 4,
    city: "Stevenson Ranch",
    formattedAddress: "123 Main St, Stevenson Ranch, CA 91381",
    price: 825_000,
    propertyType: "Single Family",
    state: "CA",
    status: "Active",
    zipCode: "91381",
  };
}

class MemoryWriter {
  output = "";

  write(message: string): void {
    this.output += message;
  }
}
