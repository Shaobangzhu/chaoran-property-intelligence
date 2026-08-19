import { runAlertWorker } from "./runAlertWorker.js";

interface ProcessLike {
  argv: string[];
  stdout: { write(message: string): void };
  stderr: { write(message: string): void };
  exitCode?: number;
}

declare const process: ProcessLike;

process.exitCode = await runAlertWorker({
  args: process.argv.slice(2),
  stdout: process.stdout,
  stderr: process.stderr,
});
