import {
  DeterministicPriceDecisionEngine,
  EstimatePropertyPrice,
  GeneratePriceDecisionExplanation,
  type EstimatePropertyPriceInput,
  type PreparedPriceDecision,
  type PriceDecisionExplanation,
  type PriceDecisionExplainerPort,
} from "@chaoran-property-intelligence/application";
import { OpenAIPriceDecisionExplainer } from "@chaoran-property-intelligence/openai";
import {
  RentCastPriceDecisionClient,
  RentCastPriceDecisionEvidenceProvider,
  type RentCastPriceDecisionPort,
} from "@chaoran-property-intelligence/rentcast";

export type PriceEstimationProvider = "rentcast" | "openai";

export interface PriceEstimationExecutionOptions {
  readonly signal?: AbortSignal;
  readonly onProviderRequest?: (provider: PriceEstimationProvider) => void;
}

export interface PriceEstimationExecution {
  readonly prepared: PreparedPriceDecision;
  readonly explanation: PriceDecisionExplanation;
  readonly providerRequestCounts: {
    readonly rentcast: number;
    readonly openai: number;
  };
}

export interface PriceEstimationUseCase {
  execute(
    input: EstimatePropertyPriceInput,
    options?: PriceEstimationExecutionOptions,
  ): Promise<PriceEstimationExecution>;
}

export interface PriceEstimationWorkflowConfig {
  readonly rentCastApiKey: string;
  readonly openAIApiKey: string | null;
  readonly rentCastRequestTimeoutMs: number;
  readonly openAIRequestTimeoutMs: number;
}

export interface PriceEstimationWorkflowOptions {
  readonly config: PriceEstimationWorkflowConfig;
  readonly fetch: typeof fetch;
  readonly now?: () => Date;
  readonly nowMilliseconds?: () => number;
}

export class PriceEstimationWorkflow implements PriceEstimationUseCase {
  private readonly now: () => Date;
  private readonly nowMilliseconds: () => number;

  constructor(private readonly options: PriceEstimationWorkflowOptions) {
    this.now = options.now ?? (() => new Date());
    this.nowMilliseconds = options.nowMilliseconds ?? Date.now;
  }

  async execute(
    input: EstimatePropertyPriceInput,
    options: PriceEstimationExecutionOptions = {},
  ): Promise<PriceEstimationExecution> {
    let rentCastRequestCount = 0;
    let openAIRequestCount = 0;
    const notify = (provider: PriceEstimationProvider): void => {
      try {
        options.onProviderRequest?.(provider);
      } catch {
        // Request telemetry must not change estimation behavior.
      }
    };
    const rawRentCastClient = new RentCastPriceDecisionClient({
      apiKey: this.options.config.rentCastApiKey,
      fetch: this.options.fetch,
      timeoutMs: this.options.config.rentCastRequestTimeoutMs,
      nowMilliseconds: this.nowMilliseconds,
    });
    const rentCastClient = new CountingRentCastPriceDecisionClient(
      rawRentCastClient,
      () => {
        rentCastRequestCount += 1;
        notify("rentcast");
      },
    );
    const estimate = new EstimatePropertyPrice({
      evidenceProvider: new RentCastPriceDecisionEvidenceProvider({
        client: rentCastClient,
        now: this.now,
      }),
      engine: new DeterministicPriceDecisionEngine(),
      now: this.now,
    });
    const primary = this.createPrimaryExplainer(() => {
      openAIRequestCount += 1;
      notify("openai");
    });

    const prepared = await estimate.prepare(input, options.signal);
    const explanation = await new GeneratePriceDecisionExplanation({
      primary,
    }).execute(
      { evidence: prepared.evidence, result: prepared.result },
      options.signal,
    );

    return Object.freeze({
      prepared,
      explanation,
      providerRequestCounts: Object.freeze({
        rentcast: rentCastRequestCount,
        openai: openAIRequestCount,
      }),
    });
  }

  private createPrimaryExplainer(onRequest: () => void): PriceDecisionExplainerPort {
    const apiKey = this.options.config.openAIApiKey;
    if (apiKey === null) return new UnavailablePriceDecisionExplainer();
    return new CountingPriceDecisionExplainer(
      new OpenAIPriceDecisionExplainer({
        apiKey,
        fetch: this.options.fetch,
        timeoutMs: this.options.config.openAIRequestTimeoutMs,
        now: this.nowMilliseconds,
      }),
      onRequest,
    );
  }
}

class CountingPriceDecisionExplainer implements PriceDecisionExplainerPort {
  constructor(
    private readonly delegate: PriceDecisionExplainerPort,
    private readonly onRequest: () => void,
  ) {}

  async explain(
    context: Parameters<PriceDecisionExplainerPort["explain"]>[0],
    signal?: AbortSignal,
  ): Promise<Awaited<ReturnType<PriceDecisionExplainerPort["explain"]>>> {
    this.onRequest();
    return this.delegate.explain(context, signal);
  }
}

class CountingRentCastPriceDecisionClient
  implements RentCastPriceDecisionPort
{
  constructor(
    private readonly delegate: RentCastPriceDecisionPort,
    private readonly onRequest: () => void,
  ) {}

  getValueEstimate(
    address: string,
    signal?: AbortSignal,
  ): ReturnType<RentCastPriceDecisionPort["getValueEstimate"]> {
    this.onRequest();
    return this.delegate.getValueEstimate(address, signal);
  }

  getRecordedSales(
    address: string,
    propertyType: string,
    signal?: AbortSignal,
  ): ReturnType<RentCastPriceDecisionPort["getRecordedSales"]> {
    this.onRequest();
    return this.delegate.getRecordedSales(address, propertyType, signal);
  }

  getSaleListing(
    propertyId: string,
    signal?: AbortSignal,
  ): ReturnType<RentCastPriceDecisionPort["getSaleListing"]> {
    this.onRequest();
    return this.delegate.getSaleListing(propertyId, signal);
  }

  getSaleMarket(
    zipCode: string,
    signal?: AbortSignal,
  ): ReturnType<RentCastPriceDecisionPort["getSaleMarket"]> {
    this.onRequest();
    return this.delegate.getSaleMarket(zipCode, signal);
  }
}

class UnavailablePriceDecisionExplainer implements PriceDecisionExplainerPort {
  async explain(): Promise<never> {
    throw new Error("Price Decision narrative enhancement is unconfigured");
  }
}
