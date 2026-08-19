import { runAlertWorker } from "./runAlertWorker.js";
import { runProduction } from "./runProduction.js";

interface ProcessLike {
  argv: string[];
  stdout: { write(message: string): void };
  stderr: { write(message: string): void };
  env: Record<string, string | undefined>;
  exitCode?: number;
}

declare const process: ProcessLike;

process.exitCode = await runAlertWorker(
  {
    args: process.argv.slice(2),
    stdout: process.stdout,
    stderr: process.stderr,
  },
  {
    runProduction: () =>
      runProduction({
        environment: process.env,
        fetch: globalThis.fetch,
        now: () => new Date(),
      }),
  },
);
