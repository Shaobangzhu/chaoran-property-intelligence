import {
  formatIrvineCoverageAuditSummary,
  runIrvineCoverageAudit,
} from "./runIrvineCoverageAudit.js";
import type { TextWriter } from "./runAlertWorker.js";

const executionConfirmation = "--execute-one-request";
const marketConfirmation = "--market=irvine-ca";
const usage =
  "Usage: pnpm rentcast:irvine-coverage-audit:execute-one-request\n";

export interface IrvineCoverageAuditCommandRuntime {
  args: string[];
  environment: Readonly<Record<string, string | undefined>>;
  fetch: typeof fetch;
  now: () => number;
  stderr: TextWriter;
  stdout: TextWriter;
  timeoutMs?: number;
}

export async function runIrvineCoverageAuditCommand(
  runtime: IrvineCoverageAuditCommandRuntime,
): Promise<number> {
  if (
    runtime.args.length !== 2 ||
    runtime.args[0] !== executionConfirmation ||
    runtime.args[1] !== marketConfirmation
  ) {
    runtime.stderr.write(usage);
    runtime.stderr.write(
      "No RentCast request was made. The explicit one-request confirmation and exact reviewed Irvine market are required.\n",
    );
    return 1;
  }

  try {
    const summary = await runIrvineCoverageAudit(runtime);
    runtime.stdout.write(formatIrvineCoverageAuditSummary(summary));
    return summary.coverageGatePassed ? 0 : 1;
  } catch (error) {
    runtime.stderr.write(
      `RentCast Irvine coverage audit failed: ${sanitizeErrorMessage(
        getErrorMessage(error),
        runtime.environment.RENTCAST_API_KEY,
      )}\n`,
    );
    return 1;
  }
}

function sanitizeErrorMessage(
  message: string,
  apiKey: string | undefined,
): string {
  return redactApiKey(message, apiKey).replace(
    /https:\/\/api\.rentcast\.io\/\S+/gu,
    "[REDACTED_URL]",
  );
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
