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
      "This worker supports only --dry-run, --prepare-price-alerts, --run, --run-showing-list, --verify-baseline, --verify-price-alerts, or --telegram-smoke-test.",
    );
  });

  it("runs only the weekly Showing List production action", async () => {
    const stdout = new MemoryWriter();
    const stderr = new MemoryWriter();
    const runProduction = vi.fn(async () => {});
    const runShowingListProduction = vi.fn(async () => {});

    const exitCode = await runAlertWorker(
      {
        args: ["--run-showing-list"],
        stdout,
        stderr,
      },
      {
        prepareProductionPriceAlerts: async () => {},
        runProduction,
        runShowingListProduction,
        runTelegramSmokeTest: async () => {},
        verifyProductionBaseline: async () => createBaselineState(),
        verifyProductionPriceAlerts: async () => createPriceAlertState(),
      },
    );

    expect(exitCode).toBe(0);
    expect(runShowingListProduction).toHaveBeenCalledOnce();
    expect(runProduction).not.toHaveBeenCalled();
    expect(stdout.output).toBe("Weekly Showing List run completed.\n");
    expect(stderr.output).toBe("");
  });

  it("runs only the Telegram production smoke-test action", async () => {
    const stdout = new MemoryWriter();
    const stderr = new MemoryWriter();
    const runProduction = vi.fn(async () => {});
    const runShowingListProduction = vi.fn(async () => {});
    const verifyProductionBaseline = vi.fn(async () => createBaselineState());
    const runTelegramSmokeTest = vi.fn(async () => {});

    const exitCode = await runAlertWorker(
      {
        args: ["--telegram-smoke-test"],
        stdout,
        stderr,
      },
      {
        prepareProductionPriceAlerts: async () => {},
        runProduction,
        runShowingListProduction,
        runTelegramSmokeTest,
        verifyProductionBaseline,
        verifyProductionPriceAlerts: async () => createPriceAlertState(),
      },
    );

    expect(exitCode).toBe(0);
    expect(runTelegramSmokeTest).toHaveBeenCalledOnce();
    expect(runProduction).not.toHaveBeenCalled();
    expect(runShowingListProduction).not.toHaveBeenCalled();
    expect(verifyProductionBaseline).not.toHaveBeenCalled();
    expect(stdout.output).toBe("Telegram production smoke test completed.\n");
    expect(stderr.output).toBe("");
  });

  it("runs the production action only with the run flag", async () => {
    const stdout = new MemoryWriter();
    const stderr = new MemoryWriter();
    const runProduction = vi.fn(async () => {});
    const runShowingListProduction = vi.fn(async () => {});

    const exitCode = await runAlertWorker(
      {
        args: ["--run"],
        stdout,
        stderr,
      },
      {
        prepareProductionPriceAlerts: async () => {},
        runProduction,
        runShowingListProduction,
        runTelegramSmokeTest: async () => {},
        verifyProductionBaseline: async () => createBaselineState(),
        verifyProductionPriceAlerts: async () => createPriceAlertState(),
      },
    );

    expect(exitCode).toBe(0);
    expect(runProduction).toHaveBeenCalledOnce();
    expect(runShowingListProduction).not.toHaveBeenCalled();
    expect(stdout.output).toBe("Production run completed.\n");
    expect(stderr.output).toBe("");
  });

  it("prints aggregate baseline state without running production", async () => {
    const stdout = new MemoryWriter();
    const stderr = new MemoryWriter();
    const runProduction = vi.fn(async () => {});
    const runShowingListProduction = vi.fn(async () => {});
    const verifyProductionBaseline = vi.fn(async () => createBaselineState());

    const exitCode = await runAlertWorker(
      {
        args: ["--verify-baseline"],
        stdout,
        stderr,
      },
      {
        prepareProductionPriceAlerts: async () => {},
        runProduction,
        runShowingListProduction,
        runTelegramSmokeTest: async () => {},
        verifyProductionBaseline,
        verifyProductionPriceAlerts: async () => createPriceAlertState(),
      },
    );

    expect(exitCode).toBe(0);
    expect(runProduction).not.toHaveBeenCalled();
    expect(runShowingListProduction).not.toHaveBeenCalled();
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

  it("runs only the database price-alert preparation action", async () => {
    const stdout = new MemoryWriter();
    const stderr = new MemoryWriter();
    const prepareProductionPriceAlerts = vi.fn(async () => {});
    const runProduction = vi.fn(async () => {});
    const verifyProductionPriceAlerts = vi.fn(async () =>
      createPriceAlertState(),
    );

    const exitCode = await runAlertWorker(
      {
        args: ["--prepare-price-alerts"],
        stdout,
        stderr,
      },
      {
        prepareProductionPriceAlerts,
        runProduction,
        runShowingListProduction: async () => {},
        runTelegramSmokeTest: async () => {},
        verifyProductionBaseline: async () => createBaselineState(),
        verifyProductionPriceAlerts,
      },
    );

    expect(exitCode).toBe(0);
    expect(prepareProductionPriceAlerts).toHaveBeenCalledOnce();
    expect(runProduction).not.toHaveBeenCalled();
    expect(verifyProductionPriceAlerts).not.toHaveBeenCalled();
    expect(stdout.output).toBe(
      "Production price-alert preparation completed.\n",
    );
    expect(stderr.output).toBe("");
  });

  it("prints aggregate price-alert state without mutating the database", async () => {
    const stdout = new MemoryWriter();
    const stderr = new MemoryWriter();
    const prepareProductionPriceAlerts = vi.fn(async () => {});
    const runProduction = vi.fn(async () => {});
    const verifyProductionPriceAlerts = vi.fn(async () =>
      createPriceAlertState(),
    );

    const exitCode = await runAlertWorker(
      {
        args: ["--verify-price-alerts"],
        stdout,
        stderr,
      },
      {
        prepareProductionPriceAlerts,
        runProduction,
        runShowingListProduction: async () => {},
        runTelegramSmokeTest: async () => {},
        verifyProductionBaseline: async () => createBaselineState(),
        verifyProductionPriceAlerts,
      },
    );

    expect(exitCode).toBe(0);
    expect(verifyProductionPriceAlerts).toHaveBeenCalledOnce();
    expect(prepareProductionPriceAlerts).not.toHaveBeenCalled();
    expect(runProduction).not.toHaveBeenCalled();
    expect(stdout.output).toBe(
      [
        "Production price-alert verification completed.",
        "Schema ready: yes",
        "Migration 006 applied: yes",
        "Price baseline initialized: yes",
        "Price observations: 28",
        "Pending alert events: 1",
        "Sent alert events: 4",
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
        prepareProductionPriceAlerts: async () => {},
        runProduction: async () => {
          throw new Error("Database unavailable");
        },
        runShowingListProduction: async () => {},
        runTelegramSmokeTest: async () => {},
        verifyProductionBaseline: async () => createBaselineState(),
        verifyProductionPriceAlerts: async () => createPriceAlertState(),
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
        prepareProductionPriceAlerts: async () => {},
        runProduction: async () => {},
        runShowingListProduction: async () => {},
        runTelegramSmokeTest: async () => {
          throw new Error("Telegram unavailable");
        },
        verifyProductionBaseline: async () => createBaselineState(),
        verifyProductionPriceAlerts: async () => createPriceAlertState(),
      },
    );

    expect(exitCode).toBe(1);
    expect(stdout.output).toBe("");
    expect(stderr.output).toBe(
      "Telegram smoke test failed: Telegram unavailable\n",
    );
  });

  it("returns a failing exit code when price-alert preparation fails", async () => {
    const stdout = new MemoryWriter();
    const stderr = new MemoryWriter();

    const exitCode = await runAlertWorker(
      {
        args: ["--prepare-price-alerts"],
        stdout,
        stderr,
      },
      {
        prepareProductionPriceAlerts: async () => {
          throw new Error("Migration unavailable");
        },
        runProduction: async () => {},
        runShowingListProduction: async () => {},
        runTelegramSmokeTest: async () => {},
        verifyProductionBaseline: async () => createBaselineState(),
        verifyProductionPriceAlerts: async () => createPriceAlertState(),
      },
    );

    expect(exitCode).toBe(1);
    expect(stdout.output).toBe("");
    expect(stderr.output).toBe(
      "Price-alert preparation failed: Migration unavailable\n",
    );
  });

  it("returns a failing exit code when price-alert verification fails", async () => {
    const stdout = new MemoryWriter();
    const stderr = new MemoryWriter();

    const exitCode = await runAlertWorker(
      {
        args: ["--verify-price-alerts"],
        stdout,
        stderr,
      },
      {
        prepareProductionPriceAlerts: async () => {},
        runProduction: async () => {},
        runShowingListProduction: async () => {},
        runTelegramSmokeTest: async () => {},
        verifyProductionBaseline: async () => createBaselineState(),
        verifyProductionPriceAlerts: async () => {
          throw new Error("Inspection unavailable");
        },
      },
    );

    expect(exitCode).toBe(1);
    expect(stdout.output).toBe("");
    expect(stderr.output).toBe(
      "Price-alert verification failed: Inspection unavailable\n",
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

function createPriceAlertState() {
  return {
    schemaReady: true,
    migrationApplied: true,
    baselineInitialized: true,
    priceObservations: 28,
    pendingEvents: 1,
    sentEvents: 4,
  };
}

class MemoryWriter {
  output = "";

  write(message: string): void {
    this.output += message;
  }
}
