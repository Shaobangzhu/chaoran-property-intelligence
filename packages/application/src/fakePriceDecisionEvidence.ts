import { normalizePriceDecisionAddress } from "@chaoran-property-intelligence/domain";

import type {
  PriceDecisionEngineInput,
  PriceDecisionEnginePort,
  PriceDecisionResult,
} from "./estimatePropertyPrice.js";
import {
  normalizePriceDecisionEvidence,
  type PriceDecisionEvidence,
  type PriceDecisionEvidencePort,
  type PriceDecisionEvidenceRequest,
} from "./priceDecisionEvidence.js";

export type FakePriceDecisionEvidenceOutcome =
  | {
      readonly type: "success";
      readonly evidence: PriceDecisionEvidence;
    }
  | {
      readonly type: "failure";
      readonly error: Error;
    };

export class FakePriceDecisionEvidenceProvider
  implements PriceDecisionEvidencePort
{
  readonly calls: PriceDecisionEvidenceRequest[] = [];
  private unsafeEvidence: unknown | undefined;

  constructor(private readonly outcome: FakePriceDecisionEvidenceOutcome) {}

  returnUnsafeEvidence(value: unknown): void {
    this.unsafeEvidence = value;
  }

  async load(
    request: PriceDecisionEvidenceRequest,
  ): Promise<PriceDecisionEvidence> {
    const address = normalizePriceDecisionAddress({
      streetAddress: request.address.streetAddress,
      city: request.address.city,
      zipCode: request.address.zipCode,
    });
    this.calls.push(
      Object.freeze(
        request.signal === undefined
          ? { address }
          : { address, signal: request.signal },
      ),
    );

    if (this.outcome.type === "failure") {
      throw this.outcome.error;
    }
    if (this.unsafeEvidence !== undefined) {
      return this.unsafeEvidence as PriceDecisionEvidence;
    }
    return cloneEvidence(this.outcome.evidence);
  }
}

export type FakePriceDecisionEngineOutcome =
  | {
      readonly type: "success";
      readonly result: PriceDecisionResult;
    }
  | {
      readonly type: "failure";
      readonly error: Error;
    };

export class FakePriceDecisionEngine implements PriceDecisionEnginePort {
  readonly calls: PriceDecisionEngineInput[] = [];

  constructor(private readonly outcome: FakePriceDecisionEngineOutcome) {}

  estimate(input: PriceDecisionEngineInput): PriceDecisionResult {
    this.calls.push(Object.freeze({ ...input }));
    if (this.outcome.type === "failure") {
      throw this.outcome.error;
    }
    return this.outcome.result;
  }
}

function cloneEvidence(evidence: PriceDecisionEvidence): PriceDecisionEvidence {
  return normalizePriceDecisionEvidence(structuredClone(evidence));
}
