import { describe, expect, it } from "vitest";

import {
  renderFlakePolicySummary,
  validateFlakeRegistry,
} from "./flakePolicy.mjs";

const validQuarantine = {
  evidenceUrl: "https://github.com/example/repository/actions/runs/123",
  expiresOn: "2026-09-15",
  introducedOn: "2026-08-28",
  owner: "@quality-owner",
  reason: "Intermittent browser readiness signal needs investigation.",
  remediationUrl: "https://github.com/example/repository/issues/456",
  testId: "ui-smoke::tests/ui/example.ts::suite > renders",
};

function registry(quarantines = []) {
  return {
    maximumQuarantineDays: 30,
    quarantines,
    schemaVersion: 1,
  };
}

describe("validateFlakeRegistry", () => {
  it("accepts an empty registry", () => {
    expect(
      validateFlakeRegistry(registry(), { today: "2026-08-28" }),
    ).toEqual({ activeQuarantines: [], errors: [] });
  });

  it("accepts complete bounded quarantine metadata", () => {
    const result = validateFlakeRegistry(registry([validQuarantine]), {
      today: "2026-08-28",
    });

    expect(result.errors).toEqual([]);
    expect(result.activeQuarantines).toEqual([validQuarantine]);
  });

  it("rejects expired and overlong quarantines", () => {
    const result = validateFlakeRegistry(
      registry([
        { ...validQuarantine, expiresOn: "2026-08-28" },
        {
          ...validQuarantine,
          expiresOn: "2026-10-15",
          testId: "another-test",
        },
      ]),
      { today: "2026-08-28" },
    );

    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("expired on 2026-08-28"),
        expect.stringContaining("more than 30 days"),
      ]),
    );
  });

  it("rejects missing evidence and duplicate test IDs", () => {
    const result = validateFlakeRegistry(
      registry([
        { ...validQuarantine, evidenceUrl: "not-a-url" },
        validQuarantine,
      ]),
      { today: "2026-08-28" },
    );

    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("must be an HTTPS URL"),
        expect.stringContaining("duplicates"),
      ]),
    );
  });

  it("renders active ownership and policy errors", () => {
    const markdown = renderFlakePolicySummary({
      activeQuarantines: [validQuarantine],
      errors: ["example error"],
    });

    expect(markdown).toContain("Active quarantines: **1**");
    expect(markdown).toContain("@quality-owner");
    expect(markdown).toContain("example error");
  });
});
