import { describe, expect, it } from "vitest";

import {
  defaultAwsRegion,
  resolveDeploymentEnvironment,
} from "../lib/deploymentEnvironment.js";
import {
  resolveDeploymentStage,
  stageResourceName,
} from "../lib/deploymentStage.js";

describe("resolveDeploymentEnvironment", () => {
  it("uses the project region instead of an ambient CDK profile region", () => {
    expect(
      resolveDeploymentEnvironment({
        CDK_DEFAULT_ACCOUNT: "111111111111",
        CDK_DEFAULT_REGION: "us-east-1",
      }),
    ).toEqual({
      account: "111111111111",
      region: defaultAwsRegion,
    });
  });

  it("accepts an explicit project region override", () => {
    expect(
      resolveDeploymentEnvironment({ CPI_AWS_REGION: "us-west-1" }),
    ).toEqual({ region: "us-west-1" });
  });
});

describe("deployment stage", () => {
  it("defaults to production and accepts only the isolated DEV stage", () => {
    expect(resolveDeploymentStage(undefined)).toBe("production");
    expect(resolveDeploymentStage("production")).toBe("production");
    expect(resolveDeploymentStage("dev")).toBe("dev");
    expect(() => resolveDeploymentStage("staging")).toThrow(
      "targetStage must be production or dev",
    );
  });

  it("preserves production names while namespacing DEV resources", () => {
    expect(stageResourceName("production", "daily-property-alert")).toBe(
      "cpi-daily-property-alert",
    );
    expect(stageResourceName("dev", "daily-property-alert")).toBe(
      "cpi-dev-daily-property-alert",
    );
  });
});
