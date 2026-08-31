import { describe, expect, it } from "vitest";

import {
  createProductionAdminBootstrapApproval,
  renderProductionAdminBootstrapApproval,
} from "./createProductionAdminBootstrapApproval.mjs";

describe("createProductionAdminBootstrapApproval", () => {
  it("binds a sanitized production runtime plan to an immutable commit", () => {
    const approval = createProductionAdminBootstrapApproval({
      commit: "a".repeat(40),
      rawPlan: JSON.stringify(createPlan()),
    });

    expect(approval.approvalDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(approval.planSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(approval.operation).toBe("create-production-admin");
    expect(approval.stage).toBe("production");
    expect(renderProductionAdminBootstrapApproval(approval)).toContain(
      approval.approvalDigest,
    );
  });

  it("changes with commit, task revision, or email identity", () => {
    const baseline = createApproval("a", createPlan());
    const changedCommit = createApproval("b", createPlan());
    const changedTask = createApproval(
      "a",
      createPlan({ taskDefinitionArn: "arn:aws:ecs:task-definition:2" }),
    );
    const changedEmail = createApproval(
      "a",
      createPlan({ adminEmailSha256: "f".repeat(64) }),
    );

    expect(changedCommit.approvalDigest).not.toBe(baseline.approvalDigest);
    expect(changedTask.approvalDigest).not.toBe(baseline.approvalDigest);
    expect(changedEmail.approvalDigest).not.toBe(baseline.approvalDigest);
  });

  it("rejects enabled schedules and credential-bearing plan keys", () => {
    expect(() =>
      createApproval(
        "a",
        createPlan({ scheduleStates: { daily: "ENABLED", weekly: "DISABLED" } }),
      ),
    ).toThrow("Production schedules must be disabled");
    expect(() =>
      createApproval("a", { ...createPlan(), password: "secret" }),
    ).toThrow("plan keys did not match the bounded schema");
  });

  it("rejects a DEV plan", () => {
    expect(() => createApproval("a", createPlan({ stage: "dev" }))).toThrow(
      "plan stage or schemaVersion was invalid",
    );
  });
});

function createApproval(commitCharacter, plan) {
  return createProductionAdminBootstrapApproval({
    commit: commitCharacter.repeat(40),
    rawPlan: JSON.stringify(plan),
  });
}

function createPlan(overrides = {}) {
  return {
    accountId: "111111111111",
    adminEmailSha256: "e".repeat(64),
    clusterArn: "arn:aws:ecs:us-west-2:111111111111:cluster/production",
    containerImage: "image.invalid/admin@sha256:1234",
    containerImageDigest: `sha256:${"1".repeat(64)}`,
    containerName: "ProductionAdminBootstrap",
    region: "us-west-2",
    scheduleStates: { daily: "DISABLED", weekly: "DISABLED" },
    schemaVersion: 1,
    securityGroupId: "sg-1234abcd",
    stage: "production",
    subnetIds: ["subnet-1234abcd", "subnet-abcd1234"],
    taskDefinitionArn: "arn:aws:ecs:task-definition:1",
    ...overrides,
  };
}
