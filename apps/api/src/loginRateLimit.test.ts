import type { Options } from "express-rate-limit";
import { describe, expect, it } from "vitest";

import { FixedWindowLoginRateLimitStore } from "./loginRateLimit.js";

describe("FixedWindowLoginRateLimitStore", () => {
  it("rolls the bounded global counter using an injected clock", () => {
    let currentTime = Date.parse("2026-08-20T20:00:00.000Z");
    const store = new FixedWindowLoginRateLimitStore(() => currentTime);
    store.init({ windowMs: 60_000 } as Options);

    expect(store.increment("ignored-viewer-key").totalHits).toBe(1);
    expect(store.increment("another-ignored-viewer-key").totalHits).toBe(2);

    currentTime += 60_000;

    expect(store.increment("ignored-viewer-key").totalHits).toBe(1);
  });

  it("decrements successful work without allowing a negative count", () => {
    const store = new FixedWindowLoginRateLimitStore(() => 1_000);
    store.init({ windowMs: 60_000 } as Options);

    store.increment("global");
    store.decrement("global");
    store.decrement("global");

    expect(store.increment("global").totalHits).toBe(1);
  });
});
