import { describe, expect, it } from "vitest";

import {
  evaluateDeployedRelease,
  formatReleaseVerificationMarkdown,
} from "./verifyDeployedRelease.mjs";

const deployedSha = "a".repeat(40);
const candidateSha = "b".repeat(40);
const release = { gitSha: deployedSha, stage: "dev" };

describe("deployed release verification", () => {
  it("accepts an exact deployed candidate", () => {
    expect(
      evaluateDeployedRelease({
        apiRelease: release,
        candidateSha: deployedSha,
        changedFiles: [],
        isAncestor: true,
        webRelease: release,
      }),
    ).toMatchObject({
      deployedSha,
      deploymentSkipped: false,
      stage: "dev",
    });
  });

  it("accepts an ancestor deployment followed only by docs and tests", () => {
    const result = evaluateDeployedRelease({
      apiRelease: release,
      candidateSha,
      changedFiles: ["docs/runbook.md", "apps/api/src/createApp.test.ts"],
      isAncestor: true,
      webRelease: release,
    });

    expect(result).toMatchObject({
      deployedSha,
      deploymentSkipped: true,
      impact: { deployRequired: false },
    });
    expect(formatReleaseVerificationMarkdown(result)).toContain(
      "Deployment skipped for intervening non-runtime changes: yes",
    );
  });

  it("rejects an undeployed runtime change", () => {
    expect(() =>
      evaluateDeployedRelease({
        apiRelease: release,
        candidateSha,
        changedFiles: ["apps/api/src/createApp.ts"],
        isAncestor: true,
        webRelease: release,
      }),
    ).toThrow("Candidate contains deployable changes");
  });

  it("rejects release identity mismatch", () => {
    expect(() =>
      evaluateDeployedRelease({
        apiRelease: { gitSha: "c".repeat(40), stage: "dev" },
        candidateSha,
        changedFiles: [],
        isAncestor: true,
        webRelease: release,
      }),
    ).toThrow("Web and API release identities do not match");
  });

  it("rejects non-DEV and non-ancestor releases", () => {
    expect(() =>
      evaluateDeployedRelease({
        apiRelease: { gitSha: deployedSha, stage: "production" },
        candidateSha,
        changedFiles: [],
        isAncestor: true,
        webRelease: { gitSha: deployedSha, stage: "production" },
      }),
    ).toThrow("Expected DEV release stage");

    expect(() =>
      evaluateDeployedRelease({
        apiRelease: release,
        candidateSha,
        changedFiles: [],
        isAncestor: false,
        webRelease: release,
      }),
    ).toThrow("not an ancestor");
  });
});

