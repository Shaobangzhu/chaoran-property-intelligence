import { App } from "aws-cdk-lib";
import { describe, expect, it } from "vitest";

import {
  accountGuardrailsStackId,
  createAccountGuardrailsStack,
} from "../lib/accountGuardrailsApplication.js";

describe("account Guardrails CDK application", () => {
  it("synthesizes only the isolated account Guardrails stack", () => {
    const app = new App({ autoSynth: false });

    createAccountGuardrailsStack(app, {
      account: "111111111111",
      region: "us-west-2",
    });

    expect(app.synth().stacks.map((stack) => stack.stackName)).toEqual([
      accountGuardrailsStackId,
    ]);
  });
});
