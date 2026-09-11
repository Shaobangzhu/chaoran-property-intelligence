import { describe, expect, it, vi } from "vitest";

import type { ListingRetentionReport } from "@chaoran-property-intelligence/application";

import { runListingRetentionCommand } from "./runListingRetentionCommand.js";

describe("runListingRetentionCommand", () => {
  it("prints aggregate preview output without candidate identities", async () => {
    const stdout = new MemoryWriter();
    const stderr = new MemoryWriter();
    const run = vi.fn(async () => previewReport);

    const exitCode = await runListingRetentionCommand(
      createRuntime(["--preview"], stdout, stderr),
      { run },
    );

    expect(exitCode).toBe(0);
    expect(run).toHaveBeenCalledWith(
      { mode: "preview" },
      expect.objectContaining({ environment: {} }),
    );
    expect(stdout.output).toContain("Candidates provider listings: 2");
    expect(stdout.output).toContain("Deleted total: 0");
    expect(stdout.output).not.toContain("listing-id");
    expect(stderr.output).toBe("");
  });

  it("requires an exact cutoff and all four approved aggregate counts", async () => {
    const stdout = new MemoryWriter();
    const stderr = new MemoryWriter();
    const run = vi.fn(async () => executeReport);

    const exitCode = await runListingRetentionCommand(
      createRuntime(
        [
          "--execute",
          `--as-of=${asOf}`,
          "--expected-search-runs=1",
          "--expected-search-memberships=0",
          "--expected-provider-listings=2",
          "--expected-alert-events=0",
        ],
        stdout,
        stderr,
      ),
      { run },
    );

    expect(exitCode).toBe(0);
    expect(run).toHaveBeenCalledWith(
      {
        mode: "execute",
        asOf,
        expectedCandidates: {
          searchRuns: 1,
          searchMemberships: 0,
          providerListings: 2,
          alertEvents: 0,
          total: 3,
        },
      },
      expect.anything(),
    );
  });

  it("rejects incomplete execution confirmation without running cleanup", async () => {
    const stdout = new MemoryWriter();
    const stderr = new MemoryWriter();
    const run = vi.fn(async () => executeReport);

    const exitCode = await runListingRetentionCommand(
      createRuntime(["--execute", `--as-of=${asOf}`], stdout, stderr),
      { run },
    );

    expect(exitCode).toBe(1);
    expect(run).not.toHaveBeenCalled();
    expect(stderr.output).toContain("Usage:");
  });

  it("does not print database errors or credentials", async () => {
    const stdout = new MemoryWriter();
    const stderr = new MemoryWriter();
    const run = vi.fn(async () => {
      throw new Error("postgresql://admin:secret@example.test/private-row");
    });

    const exitCode = await runListingRetentionCommand(
      createRuntime(["--preview"], stdout, stderr),
      { run },
    );

    expect(exitCode).toBe(1);
    expect(stdout.output).toBe("");
    expect(stderr.output).toBe(
      "Listing retention failed. No candidate identities were emitted.\n",
    );
  });
});

const asOf = "2026-09-10T15:00:00.000Z";
const previewReport: ListingRetentionReport = {
  mode: "preview",
  asOf,
  startedAt: asOf,
  completedAt: asOf,
  candidates: {
    searchRuns: 1,
    searchMemberships: 0,
    providerListings: 2,
    alertEvents: 0,
    total: 3,
  },
  deleted: {
    searchRuns: 0,
    searchMemberships: 0,
    providerListings: 0,
    alertEvents: 0,
    total: 0,
  },
  hasMore: false,
};
const executeReport: ListingRetentionReport = {
  ...previewReport,
  mode: "execute",
  deleted: previewReport.candidates,
};

function createRuntime(
  args: string[],
  stdout: MemoryWriter,
  stderr: MemoryWriter,
) {
  return {
    args,
    environment: {},
    now: () => new Date(asOf),
    stdout,
    stderr,
  };
}

class MemoryWriter {
  output = "";

  write(message: string): void {
    this.output += message;
  }
}
