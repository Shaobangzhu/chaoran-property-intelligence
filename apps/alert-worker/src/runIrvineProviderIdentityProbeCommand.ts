import {
  formatIrvineProviderIdentityProbeSummary,
  runIrvineProviderIdentityProbe,
} from "./runIrvineProviderIdentityProbe.js";
import type { TextWriter } from "./runAlertWorker.js";

const executionConfirmation = "--execute-one-request";
const marketConfirmation = "--market=irvine-ca";
const probeConfirmation = "--probe=active-market-identity";
const usage =
  "Usage: pnpm rentcast:irvine-provider-identity-probe:execute-one-request\n";

export interface IrvineProviderIdentityProbeCommandRuntime {
  args: string[];
  environment: Readonly<Record<string, string | undefined>>;
  fetch: typeof fetch;
  now: () => number;
  stderr: TextWriter;
  stdout: TextWriter;
  timeoutMs?: number;
}

export async function runIrvineProviderIdentityProbeCommand(
  runtime: IrvineProviderIdentityProbeCommandRuntime,
): Promise<number> {
  if (
    runtime.args.length !== 3 ||
    runtime.args[0] !== executionConfirmation ||
    runtime.args[1] !== marketConfirmation ||
    runtime.args[2] !== probeConfirmation
  ) {
    runtime.stderr.write(usage);
    runtime.stderr.write(
      "No RentCast request was made. The exact one-request, Irvine market, and active-market-identity confirmations are required.\n",
    );
    return 1;
  }

  try {
    const summary = await runIrvineProviderIdentityProbe(runtime);
    runtime.stdout.write(
      formatIrvineProviderIdentityProbeSummary(summary),
    );
    return summary.identityGatePassed ? 0 : 1;
  } catch (error) {
    runtime.stderr.write(
      `RentCast Irvine provider identity probe failed: ${sanitizeErrorMessage(
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
