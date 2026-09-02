import { createHash } from "node:crypto";

import type { EstimatePropertyPriceInput } from "@chaoran-property-intelligence/application";

export interface PriceEstimationRequestControlConfig {
  readonly perUserLimit: number;
  readonly perIpLimit: number;
  readonly rateLimitWindowMs: number;
  readonly totalRequestTimeoutMs: number;
}

export const defaultPriceEstimationRequestControlConfig = Object.freeze({
  perUserLimit: 6,
  perIpLimit: 20,
  rateLimitWindowMs: 15 * 60 * 1_000,
  totalRequestTimeoutMs: 75_000,
});

export interface PriceEstimationRequestIdentity {
  readonly userId: string;
  readonly ip: string;
  readonly fingerprint: string;
}

export class PriceEstimationRateLimitedError extends Error {
  constructor() {
    super("Price Estimation request rate was limited");
    this.name = "PriceEstimationRateLimitedError";
  }
}

export class PriceEstimationInProgressError extends Error {
  constructor() {
    super("A different Price Estimation is already in progress");
    this.name = "PriceEstimationInProgressError";
  }
}

export class PriceEstimationTimedOutError extends Error {
  constructor() {
    super("Price Estimation request timed out");
    this.name = "PriceEstimationTimedOutError";
  }
}

interface RateState {
  count: number;
  resetAt: number;
}

interface ActiveEstimation<T> {
  readonly fingerprint: string;
  readonly promise: Promise<T>;
}

export class PriceEstimationRequestControl {
  private readonly activeByUser = new Map<string, ActiveEstimation<unknown>>();
  private readonly userRates = new Map<string, RateState>();
  private readonly ipRates = new Map<string, RateState>();

  constructor(
    private readonly config: PriceEstimationRequestControlConfig =
      defaultPriceEstimationRequestControlConfig,
    private readonly now: () => number = Date.now,
  ) {
    assertValidConfig(config);
  }

  run<T>(
    identity: PriceEstimationRequestIdentity,
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    this.consumeRate(identity);
    const active = this.activeByUser.get(identity.userId) as
      | ActiveEstimation<T>
      | undefined;
    if (active !== undefined) {
      if (active.fingerprint === identity.fingerprint) return active.promise;
      throw new PriceEstimationInProgressError();
    }

    const promise = this.runWithDeadline(operation);
    this.activeByUser.set(identity.userId, {
      fingerprint: identity.fingerprint,
      promise,
    });
    void promise.finally(() => {
      const current = this.activeByUser.get(identity.userId);
      if (current?.promise === promise) this.activeByUser.delete(identity.userId);
    }).catch(() => {
      // The caller observes the original promise; this handles finally's copy.
    });
    return promise;
  }

  private consumeRate(identity: PriceEstimationRequestIdentity): void {
    const now = this.readTime();
    const user = readRateState(
      this.userRates,
      identity.userId,
      now,
      this.config.rateLimitWindowMs,
    );
    const ip = readRateState(
      this.ipRates,
      identity.ip,
      now,
      this.config.rateLimitWindowMs,
    );
    if (
      user.count >= this.config.perUserLimit ||
      ip.count >= this.config.perIpLimit
    ) {
      throw new PriceEstimationRateLimitedError();
    }
    user.count += 1;
    ip.count += 1;
  }

  private runWithDeadline<T>(
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new PriceEstimationTimedOutError());
      }, this.config.totalRequestTimeoutMs);
    });
    let execution: Promise<T>;
    try {
      execution = operation(controller.signal);
    } catch (error) {
      if (timeout !== undefined) clearTimeout(timeout);
      return Promise.reject(error);
    }
    return Promise.race([execution, deadline]).finally(() => {
      if (timeout !== undefined) clearTimeout(timeout);
    });
  }

  private readTime(): number {
    const value = this.now();
    if (!Number.isFinite(value)) {
      throw new Error("Price Estimation rate-limit clock was invalid");
    }
    return value;
  }
}

export function createPriceEstimationFingerprint(
  input: EstimatePropertyPriceInput,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        input.address.streetAddress,
        input.address.city,
        input.address.zipCode,
        input.mode,
      ]),
    )
    .digest("hex");
}

function readRateState(
  store: Map<string, RateState>,
  key: string,
  now: number,
  windowMs: number,
): RateState {
  const current = store.get(key);
  if (current !== undefined && now < current.resetAt) return current;
  const next = { count: 0, resetAt: now + windowMs };
  store.set(key, next);
  return next;
}

function assertValidConfig(config: PriceEstimationRequestControlConfig): void {
  if (
    !Number.isSafeInteger(config.perUserLimit) ||
    config.perUserLimit <= 0 ||
    !Number.isSafeInteger(config.perIpLimit) ||
    config.perIpLimit <= 0 ||
    !Number.isSafeInteger(config.rateLimitWindowMs) ||
    config.rateLimitWindowMs <= 0 ||
    !Number.isSafeInteger(config.totalRequestTimeoutMs) ||
    config.totalRequestTimeoutMs <= 0
  ) {
    throw new Error("Price Estimation request control was invalid");
  }
}
