import type { ListingRefreshDispatchPort } from "@chaoran-property-intelligence/application";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const runIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const defaultWorkerEntryPoint = fileURLToPath(
  new URL("../../alert-worker/dist/index.js", import.meta.url),
);

export interface LocalListingRefreshWorkerInput {
  environment: NodeJS.ProcessEnv;
  runId: string;
  workerEntryPoint: string;
}

export type LocalListingRefreshWorkerStarter = (
  input: LocalListingRefreshWorkerInput,
) => Promise<void>;

export interface LocalListingRefreshDispatcherOptions {
  environment?: NodeJS.ProcessEnv;
  startWorker?: LocalListingRefreshWorkerStarter;
  workerEntryPoint?: string;
}

export class LocalListingRefreshDispatcher
  implements ListingRefreshDispatchPort
{
  private readonly environment: NodeJS.ProcessEnv;
  private readonly startWorker: LocalListingRefreshWorkerStarter;
  private readonly workerEntryPoint: string;

  constructor(options: LocalListingRefreshDispatcherOptions = {}) {
    this.environment = options.environment ?? process.env;
    this.startWorker = options.startWorker ?? startLocalListingRefreshWorker;
    this.workerEntryPoint =
      options.workerEntryPoint ?? defaultWorkerEntryPoint;
  }

  async dispatch(runId: string): Promise<void> {
    if (!runIdPattern.test(runId)) {
      throw new Error("Invalid listing refresh run ID");
    }

    try {
      await this.startWorker({
        environment: this.environment,
        runId,
        workerEntryPoint: this.workerEntryPoint,
      });
    } catch (error) {
      throw new Error("Local listing refresh dispatch failed", {
        cause: error,
      });
    }
  }
}

async function startLocalListingRefreshWorker(
  input: LocalListingRefreshWorkerInput,
): Promise<void> {
  const child = spawn(
    process.execPath,
    [input.workerEntryPoint, "--run"],
    {
      detached: true,
      env: {
        ...input.environment,
        LISTING_REFRESH_RUN_ID: input.runId,
      },
      stdio: ["ignore", "inherit", "inherit"],
    },
  );

  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("spawn", resolve);
  });
  child.unref();
}
