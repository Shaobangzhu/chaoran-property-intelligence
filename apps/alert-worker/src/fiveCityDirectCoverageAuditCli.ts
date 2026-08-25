import { runFiveCityDirectCoverageAuditCommand } from "./runFiveCityDirectCoverageAuditCommand.js";

interface ProcessLike {
  argv: string[];
  env: Record<string, string | undefined>;
  exitCode?: number;
  stderr: { write(message: string): void };
  stdout: { write(message: string): void };
}

declare const process: ProcessLike;

process.exitCode = await runFiveCityDirectCoverageAuditCommand({
  args: process.argv.slice(2),
  environment: process.env,
  fetch: globalThis.fetch,
  now: () => Date.now(),
  stderr: process.stderr,
  stdout: process.stdout,
});
