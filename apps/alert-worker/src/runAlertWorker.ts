import type { BaselineState } from "@chaoran-property-intelligence/postgres";

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
  runShowingListProduction(): Promise<void>;
  runTelegramSmokeTest(): Promise<void>;
  verifyProductionBaseline(): Promise<BaselineState>;
}

const supportedModesMessage =
  "This worker supports only --dry-run, --run, --run-showing-list, --verify-baseline, or --telegram-smoke-test.\n";

export async function runAlertWorker(
  runtime: AlertWorkerRuntime,
  actions?: AlertWorkerActions,
): Promise<number> {
  if (runtime.args.length !== 1) {
    runtime.stderr.write(supportedModesMessage);
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

  if (runtime.args[0] === "--run-showing-list" && actions !== undefined) {
    try {
      await actions.runShowingListProduction();
      runtime.stdout.write("Weekly Showing List run completed.\n");
      return 0;
    } catch (error) {
      runtime.stderr.write(
        `Weekly Showing List worker failed: ${getErrorMessage(error)}\n`,
      );
      return 1;
    }
  }

  if (runtime.args[0] === "--verify-baseline" && actions !== undefined) {
    try {
      const state = await actions.verifyProductionBaseline();
      writeBaselineState(runtime.stdout, state);
      return 0;
    } catch (error) {
      runtime.stderr.write(
        `Baseline verification failed: ${getErrorMessage(error)}\n`,
      );
      return 1;
    }
  }

  if (runtime.args[0] === "--telegram-smoke-test" && actions !== undefined) {
    try {
      await actions.runTelegramSmokeTest();
      runtime.stdout.write("Telegram production smoke test completed.\n");
      return 0;
    } catch (error) {
      runtime.stderr.write(
        `Telegram smoke test failed: ${getErrorMessage(error)}\n`,
      );
      return 1;
    }
  }

  runtime.stderr.write(supportedModesMessage);
  return 1;
}

function writeBaselineState(writer: TextWriter, state: BaselineState): void {
  writer.write("Production baseline verification completed.\n");
  writer.write(`Schema ready: ${state.schemaReady ? "yes" : "no"}\n`);
  writer.write(
    `Migration applied: ${state.migrationApplied ? "yes" : "no"}\n`,
  );
  writer.write(
    `Baseline initialized: ${state.baselineInitialized ? "yes" : "no"}\n`,
  );
  writer.write(`Baseline listings: ${state.baselineListings}\n`);
  writer.write(`Pending listings: ${state.pendingListings}\n`);
  writer.write(`Sent listings: ${state.sentListings}\n`);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}
