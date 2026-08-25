import {
  formatStevensonRanchCoverageAuditSummary,
  runStevensonRanchCoverageAudit,
} from "./runStevensonRanchCoverageAudit.js";
import type { TextWriter } from "./runAlertWorker.js";

const executionConfirmation = "--execute-one-request";
const marketConfirmation = "--market=stevenson-ranch-91381";
const usage =
  "Usage: pnpm rentcast:stevenson-ranch-coverage-audit:execute-one-request\n";

export interface StevensonRanchCoverageAuditCommandRuntime {
  args: string[];
  environment: Readonly<Record<string, string | undefined>>;
  fetch: typeof fetch;
  now: () => number;
  stderr: TextWriter;
  stdout: TextWriter;
  timeoutMs?: number;
}

export async function runStevensonRanchCoverageAuditCommand(
  runtime: StevensonRanchCoverageAuditCommandRuntime,
): Promise<number> {
  if (
    runtime.args.length !== 2 ||
    runtime.args[0] !== executionConfirmation ||
    runtime.args[1] !== marketConfirmation
  ) {
    runtime.stderr.write(usage);
    runtime.stderr.write(
      "No RentCast request was made. The explicit one-request confirmation and exact reviewed market are required.\n",
    );
    return 1;
  }

  try {
    const summary = await runStevensonRanchCoverageAudit(runtime);
    runtime.stdout.write(
      formatStevensonRanchCoverageAuditSummary(summary),
    );
    return summary.coverageGatePassed ? 0 : 1;
  } catch (error) {
    runtime.stderr.write(
      `RentCast Stevenson Ranch coverage audit failed: ${redactApiKey(
        getErrorMessage(error),
        runtime.environment.RENTCAST_API_KEY,
      )}\n`,
    );
    return 1;
  }
}

function redactApiKey(message: string, apiKey: string | undefined): string {
  if (apiKey === undefined || apiKey.length === 0) {
    return message;
  }

  return message.replaceAll(apiKey, "[REDACTED]");
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}
