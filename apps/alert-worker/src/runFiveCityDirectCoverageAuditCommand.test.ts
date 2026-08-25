import { describe, expect, it, vi } from "vitest";

import { runFiveCityDirectCoverageAuditCommand } from "./runFiveCityDirectCoverageAuditCommand.js";

const executionConfirmation = "--execute-five-requests";
const marketListConfirmation =
  "--markets=chino,chino-hills,eastvale,corona,jurupa-valley";
const exactConfirmation = [executionConfirmation, marketListConfirmation];

describe("runFiveCityDirectCoverageAuditCommand", () => {
  it.each([
    { args: [] },
    { args: [executionConfirmation] },
    { args: [marketListConfirmation] },
    {
      args: [executionConfirmation, "--markets=chino,corona"],
    },
    { args: [marketListConfirmation, executionConfirmation] },
  ])("refuses unconfirmed arguments without reading or fetching: $args", async ({ args }) => {
    const stdout = new MemoryWriter();
    const stderr = new MemoryWriter();
    const fetch = vi.fn<typeof globalThis.fetch>();

    const exitCode = await runFiveCityDirectCoverageAuditCommand({
      args,
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
      "rentcast:five-city-direct-coverage-audit:execute-five-requests",
    );
    expect(stderr.output).toContain("No RentCast request was made.");
  });

  it("executes five aggregate-only audits with both exact confirmations", async () => {
    const stdout = new MemoryWriter();
    const stderr = new MemoryWriter();
    const fetch = createSuccessfulFetch();

    const exitCode = await runFiveCityDirectCoverageAuditCommand({
      args: exactConfirmation,
      environment: { RENTCAST_API_KEY: "test-secret" },
      fetch,
      now: () => 1_000,
      stderr,
      stdout,
    });

    expect(exitCode).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(5);
    expect(stderr.output).toBe("");
    expect(stdout.output).toContain("Coverage gate: PASS");
    expect(stdout.output).toContain("Requests completed: 5");
    expect(stdout.output).toContain("Expected cities verified: yes");
    expect(stdout.output).not.toContain("123 Main St");
    expect(stdout.output).not.toContain("test-secret");
    expect(stdout.output).not.toContain("api.rentcast.io");
  });

  it("does not retry or print a partial summary after a request error", async () => {
    const stdout = new MemoryWriter();
    const stderr = new MemoryWriter();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(createResponse("Chino"))
      .mockResolvedValueOnce(createResponse("Chino Hills"))
      .mockResolvedValueOnce(new Response("Unavailable", { status: 503 }));

    const exitCode = await runFiveCityDirectCoverageAuditCommand({
      args: exactConfirmation,
      environment: { RENTCAST_API_KEY: "test-secret" },
      fetch,
      now: () => 1_000,
      stderr,
      stdout,
    });

    expect(exitCode).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(stdout.output).toBe("");
    expect(stderr.output).toContain(
      "Eastvale failed with status 503",
    );
  });

  it("redacts the API key from an unexpected transport error", async () => {
    const stdout = new MemoryWriter();
    const stderr = new MemoryWriter();
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      throw new Error("Transport rejected test-secret");
    });

    const exitCode = await runFiveCityDirectCoverageAuditCommand({
      args: exactConfirmation,
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

function createSuccessfulFetch() {
  return vi.fn<typeof globalThis.fetch>(async (input) => {
    const city = (input as URL).searchParams.get("city") ?? "missing";
    return Response.json([createListing(city)], {
      headers: { "X-Total-Count": "1" },
    });
  });
}

function createResponse(city: string): Response {
  return Response.json([createListing(city)], {
    headers: { "X-Total-Count": "1" },
  });
}

function createListing(city: string) {
  return {
    bathrooms: 2.5,
    bedrooms: 4,
    city,
    formattedAddress: `123 Main St, ${city}, CA`,
    price: 825_000,
    propertyType: "Single Family",
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
