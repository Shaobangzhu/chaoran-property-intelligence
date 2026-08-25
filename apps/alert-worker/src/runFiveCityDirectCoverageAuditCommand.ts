import {
  fiveCityDirectCoverageAuditMarkets,
  formatFiveCityDirectCoverageAuditSummary,
  runFiveCityDirectCoverageAudit,
} from "./runFiveCityDirectCoverageAudit.js";
import type { TextWriter } from "./runAlertWorker.js";

const executionConfirmation = "--execute-five-requests";
const marketListConfirmation = `--markets=${fiveCityDirectCoverageAuditMarkets
  .map(toMarketSlug)
  .join(",")}`;
const usage =
  "Usage: pnpm rentcast:five-city-direct-coverage-audit:execute-five-requests\n";

export interface FiveCityDirectCoverageAuditCommandRuntime {
  args: string[];
  environment: Readonly<Record<string, string | undefined>>;
  fetch: typeof fetch;
  now: () => number;
  stderr: TextWriter;
  stdout: TextWriter;
  timeoutMs?: number;
}

export async function runFiveCityDirectCoverageAuditCommand(
  runtime: FiveCityDirectCoverageAuditCommandRuntime,
): Promise<number> {
  if (
    runtime.args.length !== 2 ||
    runtime.args[0] !== executionConfirmation ||
    runtime.args[1] !== marketListConfirmation
  ) {
    runtime.stderr.write(usage);
    runtime.stderr.write(
      "No RentCast request was made. The explicit five-request confirmation and exact reviewed market list are required.\n",
    );
    return 1;
  }

  try {
    const summary = await runFiveCityDirectCoverageAudit(runtime);
    runtime.stdout.write(
      formatFiveCityDirectCoverageAuditSummary(summary),
    );
    return summary.combined.coverageGatePassed ? 0 : 1;
  } catch (error) {
    runtime.stderr.write(
      `RentCast five-city direct coverage audit failed: ${redactApiKey(
        getErrorMessage(error),
        runtime.environment.RENTCAST_API_KEY,
      )}\n`,
    );
    return 1;
  }
}

function toMarketSlug(market: string): string {
  return market.toLowerCase().replaceAll(" ", "-");
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
