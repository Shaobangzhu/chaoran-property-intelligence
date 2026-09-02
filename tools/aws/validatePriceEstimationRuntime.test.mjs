import { describe, expect, it } from "vitest";

import { validatePriceEstimationRuntime } from "./validatePriceEstimationRuntime.mjs";

describe("validatePriceEstimationRuntime", () => {
  it("keeps the runtime disabled without a cost approval", () => {
    expect(
      validatePriceEstimationRuntime({
        budgetApproved: "false",
        openAiEnabled: "false",
        runtimeEnabled: "false",
      }),
    ).toEqual({
      budgetApproved: false,
      openAiEnabled: false,
      runtimeEnabled: false,
    });
  });

  it("accepts an explicitly budget-approved deterministic runtime", () => {
    expect(
      validatePriceEstimationRuntime({
        budgetApproved: "true",
        openAiEnabled: "false",
        runtimeEnabled: "true",
      }),
    ).toMatchObject({ runtimeEnabled: true, openAiEnabled: false });
  });

  it("accepts OpenAI only with the enabled and budget-approved runtime", () => {
    expect(
      validatePriceEstimationRuntime({
        budgetApproved: "true",
        openAiEnabled: "true",
        runtimeEnabled: "true",
      }),
    ).toMatchObject({ runtimeEnabled: true, openAiEnabled: true });
  });

  it.each([
    {
      config: {
        budgetApproved: "false",
        openAiEnabled: "false",
        runtimeEnabled: "true",
      },
      message: "requires explicit NAT and provider budget approval",
    },
    {
      config: {
        budgetApproved: "true",
        openAiEnabled: "true",
        runtimeEnabled: "false",
      },
      message: "OpenAI enhancement requires the runtime",
    },
    {
      config: {
        budgetApproved: "yes",
        openAiEnabled: "false",
        runtimeEnabled: "false",
      },
      message: "budget approved must be true or false",
    },
  ])("rejects an unsafe configuration %#", ({ config, message }) => {
    expect(() => validatePriceEstimationRuntime(config)).toThrow(message);
  });
});
