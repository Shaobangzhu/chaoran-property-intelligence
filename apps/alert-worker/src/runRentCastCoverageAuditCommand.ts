import {
  formatRentCastCoverageAuditSummary,
  runRentCastCoverageAudit,
} from "./runRentCastCoverageAudit.js";
import type { TextWriter } from "./runAlertWorker.js";

const executionConfirmation = "--execute-one-request";
const usage =
  "Usage: pnpm rentcast:coverage-audit:execute-one-request\n";

export interface RentCastCoverageAuditCommandRuntime {
  args: string[];
  environment: Readonly<Record<string, string | undefined>>;
  fetch: typeof fetch;
  now: () => number;
  stderr: TextWriter;
  stdout: TextWriter;
}

export async function runRentCastCoverageAuditCommand(
  runtime: RentCastCoverageAuditCommandRuntime,
): Promise<number> {
  if (
    runtime.args.length !== 1 ||
    runtime.args[0] !== executionConfirmation
  ) {
    runtime.stderr.write(usage);
    runtime.stderr.write(
      "No RentCast request was made. The explicit one-request confirmation flag is required.\n",
    );
    return 1;
  }

  try {
    const summary = await runRentCastCoverageAudit(runtime);
    runtime.stdout.write(formatRentCastCoverageAuditSummary(summary));
    return summary.combined.coverageGatePassed ? 0 : 1;
  } catch (error) {
    runtime.stderr.write(
      `RentCast coverage audit failed: ${redactApiKey(
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
