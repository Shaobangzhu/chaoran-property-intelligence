import { describe, expect, it } from "vitest";

import {
  createDevAdminBootstrapApproval,
  renderDevAdminBootstrapApproval,
} from "./createDevAdminBootstrapApproval.mjs";

describe("createDevAdminBootstrapApproval", () => {
  it("binds a sanitized DEV runtime plan to an immutable commit", () => {
    const approval = createDevAdminBootstrapApproval({
      commit: "a".repeat(40),
      rawPlan: JSON.stringify(createPlan()),
    });

    expect(approval.approvalDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(approval.planSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(approval.operation).toBe("create-dev-admin");
    expect(renderDevAdminBootstrapApproval(approval)).toContain(
      approval.approvalDigest,
    );
  });

  it("normalizes object key order", () => {
    const plan = createPlan();
    const reversed = Object.fromEntries(Object.entries(plan).reverse());
    const left = createDevAdminBootstrapApproval({
      commit: "b".repeat(40),
      rawPlan: JSON.stringify(plan),
    });
    const right = createDevAdminBootstrapApproval({
      commit: "b".repeat(40),
      rawPlan: JSON.stringify(reversed),
    });

    expect(left).toEqual(right);
  });

  it("changes with commit, task revision, or email identity", () => {
    const baseline = createDevAdminBootstrapApproval({
      commit: "c".repeat(40),
      rawPlan: JSON.stringify(createPlan()),
    });
    const changedCommit = createDevAdminBootstrapApproval({
      commit: "d".repeat(40),
      rawPlan: JSON.stringify(createPlan()),
    });
    const changedTask = createDevAdminBootstrapApproval({
      commit: "c".repeat(40),
      rawPlan: JSON.stringify(
        createPlan({ taskDefinitionArn: "arn:aws:ecs:task-definition:2" }),
      ),
    });
    const changedEmail = createDevAdminBootstrapApproval({
      commit: "c".repeat(40),
      rawPlan: JSON.stringify(
        createPlan({ adminEmailSha256: "f".repeat(64) }),
      ),
    });

    expect(changedCommit.approvalDigest).not.toBe(
      baseline.approvalDigest,
    );
    expect(changedTask.approvalDigest).not.toBe(baseline.approvalDigest);
    expect(changedEmail.approvalDigest).not.toBe(baseline.approvalDigest);
  });

  it("rejects enabled schedules and credential-bearing plan keys", () => {
    expect(() =>
      createDevAdminBootstrapApproval({
        commit: "a".repeat(40),
        rawPlan: JSON.stringify(
          createPlan({ scheduleStates: { daily: "ENABLED", weekly: "DISABLED" } }),
        ),
      }),
    ).toThrow("DEV schedules must be disabled");
    expect(() =>
      createDevAdminBootstrapApproval({
        commit: "a".repeat(40),
        rawPlan: JSON.stringify({ ...createPlan(), password: "secret" }),
      }),
    ).toThrow("plan keys did not match the bounded schema");
  });
});

function createPlan(overrides = {}) {
  return {
    accountId: "111111111111",
    adminEmailSha256: "e".repeat(64),
    clusterArn: "arn:aws:ecs:us-west-2:111111111111:cluster/dev",
    containerImage: "image.invalid/admin@sha256:1234",
    containerImageDigest: `sha256:${"1".repeat(64)}`,
    containerName: "DevAdminBootstrap",
    region: "us-west-2",
    scheduleStates: { daily: "DISABLED", weekly: "DISABLED" },
    schemaVersion: 1,
    securityGroupId: "sg-1234abcd",
    stage: "dev",
    subnetIds: ["subnet-1234abcd", "subnet-abcd1234"],
    taskDefinitionArn: "arn:aws:ecs:task-definition:1",
    ...overrides,
  };
}
