import { describe, expect, it, vi } from "vitest";

import { runIrvineProviderIdentityProbeCommand } from "./runIrvineProviderIdentityProbeCommand.js";

const executionConfirmation = "--execute-one-request";
const marketConfirmation = "--market=irvine-ca";
const probeConfirmation = "--probe=active-market-identity";
const validArgs = [
  executionConfirmation,
  marketConfirmation,
  probeConfirmation,
];

describe("runIrvineProviderIdentityProbeCommand", () => {
  it("refuses to call RentCast without all explicit confirmations", async () => {
    const stdout = new MemoryWriter();
    const stderr = new MemoryWriter();
    const fetch = vi.fn<typeof globalThis.fetch>();

    const exitCode = await runIrvineProviderIdentityProbeCommand({
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
      "rentcast:irvine-provider-identity-probe:execute-one-request",
    );
    expect(stderr.output).toContain("active-market-identity confirmations");
    expect(stderr.output).toContain("No RentCast request was made.");
  });

  it.each([
    [executionConfirmation, "--market=orange-county", probeConfirmation],
    [marketConfirmation, executionConfirmation, probeConfirmation],
    [executionConfirmation, marketConfirmation, "--probe=product-coverage"],
    [...validArgs, "--extra"],
  ])("refuses invalid confirmation arguments before fetch: %o", async (...args) => {
    const stdout = new MemoryWriter();
    const stderr = new MemoryWriter();
    const fetch = vi.fn<typeof globalThis.fetch>();

    const exitCode = await runIrvineProviderIdentityProbeCommand({
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
  });

  it("executes one aggregate-only probe with all exact confirmations", async () => {
    const stdout = new MemoryWriter();
    const stderr = new MemoryWriter();
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json([createListing()], {
        headers: { "X-Total-Count": "1" },
      }),
    );

    const exitCode = await runIrvineProviderIdentityProbeCommand({
      args: validArgs,
      environment: { RENTCAST_API_KEY: "test-secret" },
      fetch,
      now: () => 1_000,
      stderr,
      stdout,
    });

    expect(exitCode).toBe(0);
    expect(fetch).toHaveBeenCalledOnce();
    expect(stderr.output).toBe("");
    expect(stdout.output).toContain("Identity gate: PASS");
    expect(stdout.output).toContain("Requests completed: 1");
    expect(stdout.output).toContain("Expected city verified: yes");
    expect(stdout.output).toContain("Geography evidence only");
    expect(stdout.output).not.toContain("123 Main St");
    expect(stdout.output).not.toContain("test-secret");
    expect(stdout.output).not.toContain("api.rentcast.io");
  });

  it("does not retry when the identity gate fails", async () => {
    const stdout = new MemoryWriter();
    const stderr = new MemoryWriter();
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json([createListing({ city: "Tustin" })], {
        headers: { "X-Total-Count": "1" },
      }),
    );

    const exitCode = await runIrvineProviderIdentityProbeCommand({
      args: validArgs,
      environment: { RENTCAST_API_KEY: "test-secret" },
      fetch,
      now: () => 1_000,
      stderr,
      stdout,
    });

    expect(exitCode).toBe(1);
    expect(fetch).toHaveBeenCalledOnce();
    expect(stdout.output).toContain("Identity gate: FAIL");
    expect(stderr.output).toBe("");
  });

  it("stops before fetch when the API key is missing", async () => {
    const stdout = new MemoryWriter();
    const stderr = new MemoryWriter();
    const fetch = vi.fn<typeof globalThis.fetch>();

    const exitCode = await runIrvineProviderIdentityProbeCommand({
      args: validArgs,
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

    const exitCode = await runIrvineProviderIdentityProbeCommand({
      args: validArgs,
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

    const exitCode = await runIrvineProviderIdentityProbeCommand({
      args: validArgs,
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
    city: "Irvine",
    formattedAddress: "123 Main St, Irvine, CA 92602",
    state: "CA",
    status: "Active",
  };
}

class MemoryWriter {
  output = "";

  write(message: string): void {
    this.output += message;
  }
}
