import { describe, expect, it } from "vitest";

import {
  analyzePlaywrightResults,
  createPlaywrightTestId,
  renderFlakeAnalysis,
} from "./analyzePlaywrightResults.mjs";

const testId = createPlaywrightTestId({
  file: "tests/ui/smoke.playwright.ts",
  projectName: "ui-smoke",
  specTitle: "shows the sign-in screen",
  suiteTitles: ["smoke.playwright.ts", "@smoke UI smoke"],
});
const validQuarantine = {
  evidenceUrl: "https://github.com/example/repository/actions/runs/123",
  expiresOn: "2026-09-15",
  introducedOn: "2026-08-28",
  owner: "@quality-owner",
  reason: "Intermittent browser readiness signal needs investigation.",
  remediationUrl: "https://github.com/example/repository/issues/456",
  testId,
};

function registry(quarantines = []) {
  return {
    maximumQuarantineDays: 30,
    quarantines,
    schemaVersion: 1,
  };
}

function report(status = "flaky") {
  return {
    suites: [
      {
        file: "tests/ui/smoke.playwright.ts",
        specs: [],
        suites: [
          {
            specs: [
              {
                file: "tests/ui/smoke.playwright.ts",
                tests: [
                  {
                    projectName: "ui-smoke",
                    results:
                      status === "flaky"
                        ? [
                            { duration: 20, retry: 0, status: "failed" },
                            { duration: 10, retry: 1, status: "passed" },
                          ]
                        : [{ duration: 20, retry: 0, status: "passed" }],
                    status,
                  },
                ],
                title: "shows the sign-in screen",
              },
            ],
            suites: [],
            title: "@smoke UI smoke",
          },
        ],
        title: "smoke.playwright.ts",
      },
    ],
  };
}

describe("analyzePlaywrightResults", () => {
  it("creates a stable human-readable test ID", () => {
    expect(testId).toBe(
      "ui-smoke::tests/ui/smoke.playwright.ts::smoke.playwright.ts > @smoke UI smoke > shows the sign-in screen",
    );
  });

  it("flags an unregistered retry", () => {
    const analysis = analyzePlaywrightResults(report(), registry(), {
      today: "2026-08-28",
    });

    expect(analysis.retryObservations).toHaveLength(1);
    expect(analysis.unexpectedRetries).toHaveLength(1);
    expect(analysis.quarantinedRetries).toHaveLength(0);
  });

  it("reports but does not classify an active quarantine as unexpected", () => {
    const analysis = analyzePlaywrightResults(
      report(),
      registry([validQuarantine]),
      { today: "2026-08-28" },
    );

    expect(analysis.unexpectedRetries).toHaveLength(0);
    expect(analysis.quarantinedRetries).toHaveLength(1);
    expect(analysis.staleQuarantines).toHaveLength(0);
  });

  it("rejects stale quarantine IDs after a test rename or removal", () => {
    const analysis = analyzePlaywrightResults(
      report("expected"),
      registry([{ ...validQuarantine, testId: "removed-test" }]),
      { today: "2026-08-28" },
    );

    expect(analysis.staleQuarantines).toEqual([
      expect.objectContaining({ testId: "removed-test" }),
    ]);
  });

  it("renders bounded retry metadata without error payloads", () => {
    const markdown = renderFlakeAnalysis(
      analyzePlaywrightResults(report(), registry(), {
        today: "2026-08-28",
      }),
    );

    expect(markdown).toContain("Unexpected retries | 1");
    expect(markdown).toContain(testId);
    expect(markdown).not.toContain("request payload");
  });

  it("fails closed when no tests are discovered", () => {
    const analysis = analyzePlaywrightResults(
      { suites: [] },
      registry(),
      { today: "2026-08-28" },
    );

    expect(analysis.noTestsDiscovered).toBe(true);
    expect(analysis.testCount).toBe(0);
  });

  it("reports slow tests without classifying them as flakes", () => {
    const slowReport = report("expected");
    slowReport.suites[0].suites[0].specs[0].tests[0].results[0].duration =
      12_000;
    const analysis = analyzePlaywrightResults(slowReport, registry(), {
      today: "2026-08-28",
    });

    expect(analysis.slowTests).toEqual([
      expect.objectContaining({ durationMs: 12_000, testId }),
    ]);
    expect(analysis.retryObservations).toHaveLength(0);
  });
});
