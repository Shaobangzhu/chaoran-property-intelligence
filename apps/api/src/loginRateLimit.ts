import {
  rateLimit,
  type IncrementResponse,
  type Options,
  type RateLimitRequestHandler,
  type Store,
} from "express-rate-limit";
import type { Request, Response } from "express";

export interface LoginRateLimitConfig {
  limit: number;
  windowMs: number;
}

export interface CreateLoginRateLimiterOptions {
  config: LoginRateLimitConfig;
  now?: () => number;
  onRateLimited: (request: Request, response: Response) => void;
}

export const defaultLoginRateLimitConfig: LoginRateLimitConfig = {
  limit: 10,
  windowMs: 15 * 60 * 1_000,
};

const globalLoginLimitKey = "cpi-login-global";

export function createLoginRateLimiter({
  config,
  now,
  onRateLimited,
}: CreateLoginRateLimiterOptions): RateLimitRequestHandler {
  return rateLimit({
    identifier: "cpi-login-failures",
    keyGenerator: () => globalLoginLimitKey,
    legacyHeaders: false,
    limit: config.limit,
    passOnStoreError: false,
    skipSuccessfulRequests: true,
    standardHeaders: "draft-8",
    store: new FixedWindowLoginRateLimitStore(now),
    validate: {
      forwardedHeader: false,
      xForwardedForHeader: false,
    },
    windowMs: config.windowMs,
    handler: (request, response) => {
      onRateLimited(request, response);
      response.status(429).json({
        error: {
          code: "LOGIN_RATE_LIMITED",
          message: "Too many sign-in attempts",
        },
      });
    },
  });
}

export class FixedWindowLoginRateLimitStore implements Store {
  readonly localKeys = true;
  readonly prefix = "cpi-login:";

  private readonly now: () => number;
  private windowMs = defaultLoginRateLimitConfig.windowMs;
  private totalHits = 0;
  private resetTime: Date | null = null;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  init(options: Options): void {
    this.windowMs = options.windowMs;
  }

  increment(_key: string): IncrementResponse {
    this.rollWindowIfNeeded();
    this.totalHits += 1;
    return this.readState();
  }

  decrement(_key: string): void {
    this.rollWindowIfNeeded();
    this.totalHits = Math.max(0, this.totalHits - 1);
  }

  resetKey(_key: string): void {
    this.totalHits = 0;
    this.resetTime = null;
  }

  resetAll(): void {
    this.resetKey(globalLoginLimitKey);
  }

  private rollWindowIfNeeded(): void {
    const currentTime = this.readTime();
    if (
      this.resetTime === null ||
      currentTime >= this.resetTime.getTime()
    ) {
      this.totalHits = 0;
      this.resetTime = new Date(currentTime + this.windowMs);
    }
  }

  private readState(): IncrementResponse {
    if (this.resetTime === null) {
      throw new Error("Login rate-limit window was not initialized");
    }
    return { resetTime: this.resetTime, totalHits: this.totalHits };
  }

  private readTime(): number {
    const value = this.now();
    if (!Number.isFinite(value)) {
      throw new Error("Login rate-limit clock was invalid");
    }
    return value;
  }
}
