import { describe, expect, it } from "vitest";

import {
  defaultAwsRegion,
  resolveDeploymentEnvironment,
} from "../lib/deploymentEnvironment.js";

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
