import { describe, expect, it, vi } from "vitest";

import { runIrvineCoverageAuditCommand } from "./runIrvineCoverageAuditCommand.js";

describe("runIrvineCoverageAuditCommand", () => {
  it("refuses to call RentCast without the explicit one-request flag", async () => {
    const stdout = new MemoryWriter();
    const stderr = new MemoryWriter();
    const fetch = vi.fn<typeof globalThis.fetch>();

    const exitCode = await runIrvineCoverageAuditCommand({
      args: [],
      environment: {},
      fetch,
      now: () => 1_000,
      stderr,
      stdout,
    });

    expect(exitCode).toBe(1);
    expect(fetch).not.toHaveBeenCalled();
    expect(stdout.output).toBe("");
    expect(stderr.output).toContain(
      "rentcast:irvine-coverage-audit:execute-one-request",
    );
    expect(stderr.output).toContain("exact reviewed Irvine market");
    expect(stderr.output).toContain("No RentCast request was made.");
  });

  it.each([
    ["--execute-one-request", "--market=orange-county"],
    ["--market=irvine-ca", "--execute-one-request"],
    ["--execute-one-request", "--market=irvine-ca", "--extra"],
  ])("refuses invalid confirmation arguments before fetch: %o", async (...args) => {
    const stdout = new MemoryWriter();
    const stderr = new MemoryWriter();
    const fetch = vi.fn<typeof globalThis.fetch>();

    const exitCode = await runIrvineCoverageAuditCommand({
      args,
      environment: { RENTCAST_API_KEY: "test-secret" },
      fetch,
      now: () => 1_000,
      stderr,
      stdout,
    });

    expect(exitCode).toBe(1);
    expect(fetch).not.toHaveBeenCalled();
    expect(stdout.output).toBe("");
    expect(stderr.output).toContain("exact reviewed Irvine market");
  });

  it("executes one aggregate-only audit with both exact confirmations", async () => {
    const stdout = new MemoryWriter();
    const stderr = new MemoryWriter();
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json([createListing()], {
        headers: { "X-Total-Count": "1" },
      }),
    );

    const exitCode = await runIrvineCoverageAuditCommand({
      args: ["--execute-one-request", "--market=irvine-ca"],
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
    expect(stdout.output).toContain("Requests completed: 1");
    expect(stdout.output).toContain("Expected city verified: yes");
    expect(stdout.output).toContain(
      "Planned Block 27 request cost reference: 7 requests",
    );
    expect(stdout.output).not.toContain("123 Main St");
    expect(stdout.output).not.toContain("test-secret");
    expect(stdout.output).not.toContain("api.rentcast.io");
  });

  it("does not retry when the coverage gate fails", async () => {
    const stdout = new MemoryWriter();
    const stderr = new MemoryWriter();
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json([createListing({ city: "Tustin" })], {
        headers: { "X-Total-Count": "1" },
      }),
    );

    const exitCode = await runIrvineCoverageAuditCommand({
      args: ["--execute-one-request", "--market=irvine-ca"],
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

  it("stops before fetch when the API key is missing", async () => {
    const stdout = new MemoryWriter();
    const stderr = new MemoryWriter();
    const fetch = vi.fn<typeof globalThis.fetch>();

    const exitCode = await runIrvineCoverageAuditCommand({
      args: ["--execute-one-request", "--market=irvine-ca"],
      environment: {},
      fetch,
      now: () => 1_000,
      stderr,
      stdout,
    });

    expect(exitCode).toBe(1);
    expect(fetch).not.toHaveBeenCalled();
    expect(stdout.output).toBe("");
    expect(stderr.output).toContain("Missing required environment variable");
  });

  it("redacts the API key from an unexpected request error", async () => {
    const stdout = new MemoryWriter();
    const stderr = new MemoryWriter();
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      throw new Error("Transport rejected test-secret");
    });

    const exitCode = await runIrvineCoverageAuditCommand({
      args: ["--execute-one-request", "--market=irvine-ca"],
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

  it("redacts a full RentCast URL from an unexpected request error", async () => {
    const stdout = new MemoryWriter();
    const stderr = new MemoryWriter();
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      throw new Error(
        "Transport rejected https://api.rentcast.io/v1/listings/sale?city=Irvine&state=CA",
      );
    });

    const exitCode = await runIrvineCoverageAuditCommand({
      args: ["--execute-one-request", "--market=irvine-ca"],
      environment: { RENTCAST_API_KEY: "test-secret" },
      fetch,
      now: () => 1_000,
      stderr,
      stdout,
    });

    expect(exitCode).toBe(1);
    expect(fetch).toHaveBeenCalledOnce();
    expect(stdout.output).toBe("");
    expect(stderr.output).toContain("Transport rejected [REDACTED_URL]");
    expect(stderr.output).not.toContain("api.rentcast.io");
    expect(stderr.output).not.toContain("city=Irvine");
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
    city: "Irvine",
    formattedAddress: "123 Main St, Irvine, CA 92602",
    price: 825_000,
    propertyType: "Single Family",
    state: "CA",
    status: "Active",
    zipCode: "92602",
  };
}

class MemoryWriter {
  output = "";

  write(message: string): void {
    this.output += message;
  }
}
