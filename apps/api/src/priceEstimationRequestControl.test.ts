import { describe, expect, it, vi } from "vitest";

import {
  createPriceEstimationFingerprint,
  PriceEstimationInProgressError,
  PriceEstimationRateLimitedError,
  PriceEstimationRequestControl,
  PriceEstimationTimedOutError,
} from "./priceEstimationRequestControl.js";

const config = {
  perUserLimit: 2,
  perIpLimit: 3,
  rateLimitWindowMs: 1_000,
  totalRequestTimeoutMs: 50,
};

describe("PriceEstimationRequestControl", () => {
  it("shares one in-flight execution for identical repeated submissions", async () => {
    const control = new PriceEstimationRequestControl(config);
    let resolve: ((value: string) => void) | undefined;
    const operation = vi.fn(
      () =>
        new Promise<string>((next) => {
          resolve = next;
        }),
    );
    const identity = {
      userId: "user-1",
      ip: "127.0.0.1",
      fingerprint: "same-request",
    };

    const first = control.run(identity, operation);
    const duplicate = control.run(identity, operation);
    resolve?.("completed");

    await expect(first).resolves.toBe("completed");
    await expect(duplicate).resolves.toBe("completed");
    expect(operation).toHaveBeenCalledOnce();
  });

  it("rejects a different estimation while one user request is active", async () => {
    const control = new PriceEstimationRequestControl(config);
    let resolve: (() => void) | undefined;
    const active = control.run(
      { userId: "user-1", ip: "127.0.0.1", fingerprint: "first" },
      () =>
        new Promise<void>((next) => {
          resolve = next;
        }),
    );

    expect(() =>
      control.run(
        { userId: "user-1", ip: "127.0.0.1", fingerprint: "second" },
        async () => undefined,
      ),
    ).toThrow(PriceEstimationInProgressError);
    resolve?.();
    await active;
  });

  it("enforces user and IP fixed-window limits before provider work", async () => {
    let now = 1_000;
    const control = new PriceEstimationRequestControl(config, () => now);
    const operation = vi.fn(async () => "ok");
    const base = { userId: "user-1", ip: "127.0.0.1" };

    await control.run({ ...base, fingerprint: "one" }, operation);
    await control.run({ ...base, fingerprint: "two" }, operation);
    expect(() =>
      control.run({ ...base, fingerprint: "three" }, operation),
    ).toThrow(PriceEstimationRateLimitedError);
    expect(operation).toHaveBeenCalledTimes(2);

    now = 2_000;
    await expect(
      control.run({ ...base, fingerprint: "after-reset" }, operation),
    ).resolves.toBe("ok");
  });

  it("enforces the IP budget across distinct authenticated users", async () => {
    const control = new PriceEstimationRequestControl(config);
    const operation = vi.fn(async () => "ok");
    for (const userId of ["user-1", "user-2", "user-3"]) {
      await control.run(
        { userId, ip: "127.0.0.1", fingerprint: userId },
        operation,
      );
    }

    expect(() =>
      control.run(
        { userId: "user-4", ip: "127.0.0.1", fingerprint: "four" },
        operation,
      ),
    ).toThrow(PriceEstimationRateLimitedError);
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it("aborts and rejects an execution at the total deadline", async () => {
    vi.useFakeTimers();
    try {
      const control = new PriceEstimationRequestControl(config);
      let receivedSignal: AbortSignal | undefined;
      const result = control.run(
        { userId: "user-1", ip: "127.0.0.1", fingerprint: "request" },
        (signal) => {
          receivedSignal = signal;
          return new Promise(() => undefined);
        },
      );

      await vi.advanceTimersByTimeAsync(50);

      await expect(result).rejects.toThrow(PriceEstimationTimedOutError);
      expect(receivedSignal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("hashes normalized request identity without retaining an address", () => {
    const fingerprint = createPriceEstimationFingerprint({
      address: {
        streetAddress: "100 Test Ave",
        city: "Irvine",
        zipCode: "92618",
      },
      mode: "offer",
    });
    const listingFingerprint = createPriceEstimationFingerprint({
      address: {
        streetAddress: "100 Test Ave",
        city: "Irvine",
        zipCode: "92618",
      },
      mode: "listing",
    });

    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(fingerprint).not.toContain("Test");
    expect(fingerprint).not.toBe(listingFingerprint);
  });
});
