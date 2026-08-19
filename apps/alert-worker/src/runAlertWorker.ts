import { runDryRun } from "./runDryRun.js";

export interface TextWriter {
  write(message: string): void;
}

export interface AlertWorkerRuntime {
  args: string[];
  stdout: TextWriter;
  stderr: TextWriter;
}

export interface AlertWorkerActions {
  runProduction(): Promise<void>;
}

export async function runAlertWorker(
  runtime: AlertWorkerRuntime,
  actions?: AlertWorkerActions,
): Promise<number> {
  if (runtime.args.length !== 1) {
    runtime.stderr.write(
      "This worker supports only --dry-run or --run.\n",
    );
    return 1;
  }

  if (runtime.args[0] === "--dry-run") {
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

  if (runtime.args[0] === "--run" && actions !== undefined) {
    try {
      await actions.runProduction();
      runtime.stdout.write("Production run completed.\n");
      return 0;
    } catch (error) {
      runtime.stderr.write(`Worker failed: ${getErrorMessage(error)}\n`);
      return 1;
    }
  }

  runtime.stderr.write("This worker supports only --dry-run or --run.\n");
  return 1;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}
