export interface ListingRefreshRetryRateLimitConfig {
  readonly limit: number;
  readonly windowMs: number;
}

export const defaultListingRefreshRetryRateLimitConfig = Object.freeze({
  limit: 3,
  windowMs: 60 * 60 * 1_000,
});

export class ListingRefreshRetryRateLimit {
  private readonly attempts = new Map<
    string,
    { count: number; resetAt: number }
  >();

  constructor(
    private readonly config: ListingRefreshRetryRateLimitConfig,
    private readonly now: () => number,
  ) {
    if (
      !Number.isSafeInteger(config.limit) ||
      config.limit < 1 ||
      !Number.isSafeInteger(config.windowMs) ||
      config.windowMs < 1
    ) {
      throw new Error("Listing refresh retry rate-limit config was invalid");
    }
  }

  acquire(userId: string): boolean {
    const currentTime = this.readTime();
    const existing = this.attempts.get(userId);
    if (existing === undefined || currentTime >= existing.resetAt) {
      this.attempts.set(userId, {
        count: 1,
        resetAt: currentTime + this.config.windowMs,
      });
      return true;
    }
    if (existing.count >= this.config.limit) return false;
    existing.count += 1;
    return true;
  }

  private readTime(): number {
    const value = this.now();
    if (!Number.isFinite(value)) {
      throw new Error("Listing refresh retry rate-limit clock was invalid");
    }
    return value;
  }
}
