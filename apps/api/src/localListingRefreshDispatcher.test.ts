import { describe, expect, it, vi } from "vitest";

import { LocalListingRefreshDispatcher } from "./localListingRefreshDispatcher.js";

const runId = "0198c7d2-7668-7775-b0fc-b789690a6013";

describe("LocalListingRefreshDispatcher", () => {
  it("starts the real worker entry point asynchronously for the opaque run", async () => {
    const environment = {
      DATABASE_URL: "postgresql://localhost/cpi",
      RENTCAST_API_KEY: "local-rentcast-key",
      TELEGRAM_BOT_TOKEN: "local-telegram-token",
      TELEGRAM_CHAT_ID: "local-chat-id",
    };
    const startWorker = vi.fn(async () => undefined);
    const dispatcher = new LocalListingRefreshDispatcher({
      environment,
      startWorker,
      workerEntryPoint: "/workspace/apps/alert-worker/dist/index.js",
    });

    await dispatcher.dispatch(runId);

    expect(startWorker).toHaveBeenCalledWith({
      environment,
      runId,
      workerEntryPoint: "/workspace/apps/alert-worker/dist/index.js",
    });
  });

  it("rejects invalid identities without starting a provider worker", async () => {
    const startWorker = vi.fn(async () => undefined);
    const dispatcher = new LocalListingRefreshDispatcher({ startWorker });

    await expect(dispatcher.dispatch("market=Corona")).rejects.toThrow(
      "Invalid listing refresh run ID",
    );
    expect(startWorker).not.toHaveBeenCalled();
  });

  it("maps process launch errors without exposing local details", async () => {
    const dispatcher = new LocalListingRefreshDispatcher({
      startWorker: async () => {
        throw new Error("private local path");
      },
    });

    await expect(dispatcher.dispatch(runId)).rejects.toThrow(
      "Local listing refresh dispatch failed",
    );
  });
});
