import { describe, expect, it } from "vitest";

import {
  createDeploymentApproval,
  renderDeploymentApproval,
} from "./createDeploymentApproval.mjs";

describe("createDeploymentApproval", () => {
  it("binds the production diff to an immutable commit", () => {
    const approval = createDeploymentApproval({
      commit: "a".repeat(40),
      rawDiff: "Stack Production\n[+] AWS::S3::Bucket Web Web1234\n",
      stage: "production",
    });

    expect(approval.approvalDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(approval.diffSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(renderDeploymentApproval(approval)).toContain(
      approval.approvalDigest,
    );
  });

  it("normalizes terminal color and line endings", () => {
    const base = {
      commit: "b".repeat(40),
      stage: "production",
    };
    const left = createDeploymentApproval({
      ...base,
      rawDiff: "\u001B[32mStack Production\u001B[0m\r\n",
    });
    const right = createDeploymentApproval({
      ...base,
      rawDiff: "Stack Production\n\n",
    });

    expect(left).toEqual(right);
  });

  it("changes when the commit or diff changes", () => {
    const baseline = createDeploymentApproval({
      commit: "c".repeat(40),
      rawDiff: "no changes",
      stage: "production",
    });
    const changedCommit = createDeploymentApproval({
      commit: "d".repeat(40),
      rawDiff: "no changes",
      stage: "production",
    });
    const changedDiff = createDeploymentApproval({
      commit: "c".repeat(40),
      rawDiff: "one change",
      stage: "production",
    });

    expect(changedCommit.approvalDigest).not.toBe(baseline.approvalDigest);
    expect(changedDiff.approvalDigest).not.toBe(baseline.approvalDigest);
  });

  it("rejects non-production and malformed commit input", () => {
    expect(() =>
      createDeploymentApproval({
        commit: "a".repeat(40),
        rawDiff: "none",
        stage: "dev",
      }),
    ).toThrow("stage must be production");
    expect(() =>
      createDeploymentApproval({
        commit: "main",
        rawDiff: "none",
        stage: "production",
      }),
    ).toThrow("commit must be a lowercase 40-character Git SHA");
  });
});
