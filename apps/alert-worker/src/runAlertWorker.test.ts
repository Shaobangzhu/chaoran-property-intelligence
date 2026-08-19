import { describe, expect, it } from "vitest";

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

  it("rejects execution without the dry-run flag", async () => {
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
      "This worker currently supports only --dry-run.",
    );
  });
});

class MemoryWriter {
  output = "";

  write(message: string): void {
    this.output += message;
  }
}
