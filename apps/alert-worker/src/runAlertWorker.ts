import { runDryRun } from "./runDryRun.js";

export interface TextWriter {
  write(message: string): void;
}

export interface AlertWorkerRuntime {
  args: string[];
  stdout: TextWriter;
  stderr: TextWriter;
}

export async function runAlertWorker(
  runtime: AlertWorkerRuntime,
): Promise<number> {
  if (runtime.args.length !== 1 || runtime.args[0] !== "--dry-run") {
    runtime.stderr.write(
      "This worker currently supports only --dry-run.\n",
    );
    return 1;
  }

  const summary = await runDryRun();

  runtime.stdout.write("Dry run completed.\n");
  runtime.stdout.write("Mode: dry-run\n");
  runtime.stdout.write(
    `Baseline initialized: ${summary.baselineInitialized ? "yes" : "no"}\n`,
  );
  runtime.stdout.write(`Stored listings: ${summary.storedListings}\n`);
  runtime.stdout.write(
    `Notification batches: ${summary.notificationBatches}\n`,
  );
  runtime.stdout.write(
    "No external services or production data were used.\n",
  );

  return 0;
}
