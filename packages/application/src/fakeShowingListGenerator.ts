import type {
  ShowingListContext,
  ShowingListGenerationResult,
  ShowingListGenerator,
} from "./showingListGenerator.js";

export type FakeShowingListGeneratorOutcome =
  | {
      type: "success";
      result: ShowingListGenerationResult;
    }
  | {
      type: "failure";
      error: Error;
    };

export class FakeShowingListGenerator implements ShowingListGenerator {
  readonly calls: ShowingListContext[] = [];

  constructor(private readonly outcome: FakeShowingListGeneratorOutcome) {}

  async generate(
    context: ShowingListContext,
  ): Promise<ShowingListGenerationResult> {
    this.calls.push(context);

    if (this.outcome.type === "failure") {
      throw this.outcome.error;
    }
    return this.outcome.result;
  }
}
