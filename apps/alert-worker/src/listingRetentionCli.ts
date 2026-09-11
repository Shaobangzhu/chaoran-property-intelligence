import { runListingRetentionCommand } from "./runListingRetentionCommand.js";

interface ProcessLike {
  argv: string[];
  env: Record<string, string | undefined>;
  exitCode?: number;
  stderr: { write(message: string): void };
  stdout: { write(message: string): void };
}

declare const process: ProcessLike;

process.exitCode = await runListingRetentionCommand({
  args: process.argv.slice(2),
  environment: process.env,
  now: () => new Date(),
  stderr: process.stderr,
  stdout: process.stdout,
});
