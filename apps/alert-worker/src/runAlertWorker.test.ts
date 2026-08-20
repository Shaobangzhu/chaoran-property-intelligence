import { describe, expect, it, vi } from "vitest";

import { runAlertWorker } from "./runAlertWorker.js";

describe("runAlertWorker", () => {
  it("runs the fake listing pipeline in dry-run mode", async () => {
    const stdout = new MemoryWriter();
    const stderr = new MemoryWriter();

    const exitCode = await runAlertWorker({
      args: ["--dry-run"],
      stdout,
      stderr,
    });

    expect(exitCode).toBe(0);
    expect(stdout.output).toContain("Dry run completed.");
    expect(stdout.output).toContain("Baseline initialized: yes");
    expect(stdout.output).toContain("Stored listings: 1");
    expect(stdout.output).toContain("Notification batches: 0");
    expect(stdout.output).toContain(
      "No external services or production data were used.",
    );
    expect(stderr.output).toBe("");
  });

  it("rejects execution without an explicit mode flag", async () => {
    const stdout = new MemoryWriter();
    const stderr = new MemoryWriter();

    const exitCode = await runAlertWorker({
      args: [],
      stdout,
      stderr,
    });

    expect(exitCode).toBe(1);
    expect(stdout.output).toBe("");
    expect(stderr.output).toContain(
      "This worker supports only --dry-run, --run, --verify-baseline, or --telegram-smoke-test.",
    );
  });

  it("runs only the Telegram production smoke-test action", async () => {
    const stdout = new MemoryWriter();
    const stderr = new MemoryWriter();
    const runProduction = vi.fn(async () => {});
    const verifyProductionBaseline = vi.fn(async () => createBaselineState());
    const runTelegramSmokeTest = vi.fn(async () => {});

    const exitCode = await runAlertWorker(
      {
        args: ["--telegram-smoke-test"],
        stdout,
        stderr,
      },
      {
        runProduction,
        runTelegramSmokeTest,
        verifyProductionBaseline,
      },
    );

    expect(exitCode).toBe(0);
    expect(runTelegramSmokeTest).toHaveBeenCalledOnce();
    expect(runProduction).not.toHaveBeenCalled();
    expect(verifyProductionBaseline).not.toHaveBeenCalled();
    expect(stdout.output).toBe("Telegram production smoke test completed.\n");
    expect(stderr.output).toBe("");
  });

  it("runs the production action only with the run flag", async () => {
    const stdout = new MemoryWriter();
    const stderr = new MemoryWriter();
    const runProduction = vi.fn(async () => {});

    const exitCode = await runAlertWorker(
      {
        args: ["--run"],
        stdout,
        stderr,
      },
      {
        runProduction,
        runTelegramSmokeTest: async () => {},
        verifyProductionBaseline: async () => createBaselineState(),
      },
    );

    expect(exitCode).toBe(0);
    expect(runProduction).toHaveBeenCalledOnce();
    expect(stdout.output).toBe("Production run completed.\n");
    expect(stderr.output).toBe("");
  });

  it("prints aggregate baseline state without running production", async () => {
    const stdout = new MemoryWriter();
    const stderr = new MemoryWriter();
    const runProduction = vi.fn(async () => {});
    const verifyProductionBaseline = vi.fn(async () => createBaselineState());

    const exitCode = await runAlertWorker(
      {
        args: ["--verify-baseline"],
        stdout,
        stderr,
      },
      {
        runProduction,
        runTelegramSmokeTest: async () => {},
        verifyProductionBaseline,
      },
    );

    expect(exitCode).toBe(0);
    expect(runProduction).not.toHaveBeenCalled();
    expect(verifyProductionBaseline).toHaveBeenCalledOnce();
    expect(stdout.output).toBe(
      [
        "Production baseline verification completed.",
        "Schema ready: yes",
        "Migration applied: yes",
        "Baseline initialized: yes",
        "Baseline listings: 4",
        "Pending listings: 0",
        "Sent listings: 0",
        "",
      ].join("\n"),
    );
    expect(stderr.output).toBe("");
  });

  it("returns a failing exit code when the production action fails", async () => {
    const stdout = new MemoryWriter();
    const stderr = new MemoryWriter();

    const exitCode = await runAlertWorker(
      {
        args: ["--run"],
        stdout,
        stderr,
      },
      {
        runProduction: async () => {
          throw new Error("Database unavailable");
        },
        runTelegramSmokeTest: async () => {},
        verifyProductionBaseline: async () => createBaselineState(),
      },
    );

    expect(exitCode).toBe(1);
    expect(stdout.output).toBe("");
    expect(stderr.output).toBe("Worker failed: Database unavailable\n");
  });

  it("returns a failing exit code when the Telegram smoke test fails", async () => {
    const stdout = new MemoryWriter();
    const stderr = new MemoryWriter();

    const exitCode = await runAlertWorker(
      {
        args: ["--telegram-smoke-test"],
        stdout,
        stderr,
      },
      {
        runProduction: async () => {},
        runTelegramSmokeTest: async () => {
          throw new Error("Telegram unavailable");
        },
        verifyProductionBaseline: async () => createBaselineState(),
      },
    );

    expect(exitCode).toBe(1);
    expect(stdout.output).toBe("");
    expect(stderr.output).toBe(
      "Telegram smoke test failed: Telegram unavailable\n",
    );
  });
});

function createBaselineState() {
  return {
    schemaReady: true,
    migrationApplied: true,
    baselineInitialized: true,
    baselineListings: 4,
    pendingListings: 0,
    sentListings: 0,
  };
}

class MemoryWriter {
  output = "";

  write(message: string): void {
    this.output += message;
  }
}
