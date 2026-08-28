import { describe, expect, it } from "vitest";

import {
  classifyCdkDiff,
  renderCdkDiffSummary,
} from "./classifyCdkDiff.mjs";

describe("classifyCdkDiff", () => {
  it("classifies CDK resource lines without treating property details as resources", () => {
    const changes = classifyCdkDiff(`Stack DevFoundation
[+] AWS::SNS::Topic DeploymentFailureTopic DeploymentFailureTopic1234
[~] AWS::AppRunner::Service ApiService ApiService1234
 └─ [~] SourceConfiguration
[~] AWS::ECS::TaskDefinition Worker Worker1234 replace
Stack DevEdge
[-] AWS::WAFv2::WebACL LegacyAcl LegacyAcl1234
`);

    expect(changes.create).toEqual([
      expect.objectContaining({
        logicalId: "DeploymentFailureTopic1234",
        stack: "DevFoundation",
      }),
    ]);
    expect(changes.update).toEqual([
      expect.objectContaining({ logicalId: "ApiService1234" }),
    ]);
    expect(changes.replace).toEqual([
      expect.objectContaining({ logicalId: "Worker1234" }),
    ]);
    expect(changes.delete).toEqual([
      expect.objectContaining({
        logicalId: "LegacyAcl1234",
        stack: "DevEdge",
      }),
    ]);
  });

  it("returns empty classifications when CDK reports no changes", () => {
    expect(classifyCdkDiff("There were no differences\n")).toEqual({
      create: [],
      delete: [],
      replace: [],
      update: [],
    });
  });

  it("renders all four release-review categories", () => {
    const summary = renderCdkDiffSummary({
      create: [],
      delete: [],
      replace: [],
      update: [],
    });

    expect(summary).toContain("## CREATE (0)");
    expect(summary).toContain("## UPDATE (0)");
    expect(summary).toContain("## REPLACE (0)");
    expect(summary).toContain("## DELETE (0)");
  });
});
