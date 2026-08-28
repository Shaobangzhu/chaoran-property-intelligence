import { describe, expect, it, vi } from "vitest";

import { waitForHealthyHttp } from "./waitForHttp.mjs";

describe("waitForHealthyHttp", () => {
  it("polls only until the health contract becomes ready", async () => {
    const fetchImplementation = vi
      .fn()
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: "ok" }), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      );
    const delay = vi.fn().mockResolvedValue(undefined);

    await expect(
      waitForHealthyHttp({
        attempts: 3,
        delay,
        fetchImplementation,
        intervalMs: 1,
        url: "https://dev.example.com/api/health",
      }),
    ).resolves.toEqual({ attempt: 2, status: 200 });
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    expect(delay).toHaveBeenCalledOnce();
  });

  it("rejects HTTP targets before making a request", async () => {
    const fetchImplementation = vi.fn();

    await expect(
      waitForHealthyHttp({
        fetchImplementation,
        url: "http://dev.example.com/api/health",
      }),
    ).rejects.toThrow("must use HTTPS");
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("fails after the configured attempt budget", async () => {
    const fetchImplementation = vi
      .fn()
      .mockResolvedValue(new Response("unavailable", { status: 503 }));

    await expect(
      waitForHealthyHttp({
        attempts: 2,
        delay: vi.fn().mockResolvedValue(undefined),
        fetchImplementation,
        intervalMs: 1,
        url: "https://dev.example.com/api/health",
      }),
    ).rejects.toThrow("after 2 attempts: HTTP 503");
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
  });
});
