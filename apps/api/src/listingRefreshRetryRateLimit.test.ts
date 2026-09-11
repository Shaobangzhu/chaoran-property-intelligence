import { describe, expect, it } from "vitest";

import { ListingRefreshRetryRateLimit } from "./listingRefreshRetryRateLimit.js";

describe("ListingRefreshRetryRateLimit", () => {
  it("bounds each administrator independently and resets its fixed window", () => {
    let now = 1_000;
    const limit = new ListingRefreshRetryRateLimit(
      { limit: 2, windowMs: 1_000 },
      () => now,
    );

    expect(limit.acquire("admin-a")).toBe(true);
    expect(limit.acquire("admin-a")).toBe(true);
    expect(limit.acquire("admin-a")).toBe(false);
    expect(limit.acquire("admin-b")).toBe(true);

    now = 2_000;
    expect(limit.acquire("admin-a")).toBe(true);
  });
});
