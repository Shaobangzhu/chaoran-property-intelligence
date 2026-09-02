import type { PriceDecisionExplanationContext } from "./priceDecisionExplanation.js";

export const PRICE_DECISION_EXPLANATION_PROMPT_VERSION = "v1" as const;

export const PRICE_DECISION_EXPLANATION_INSTRUCTIONS = `You are a real-estate price decision explanation assistant.
Use only the normalized context supplied in the input. Do not use outside knowledge or tools.
Explain the existing deterministic recommendation; never change, recalculate, or invent prices, ranges, scenarios, evidence, or limitations.
Do not state dollar amounts, percentages, or new numeric claims. The product renders all numeric outputs separately.
Do not infer seller motivation, private circumstances, urgency, financial pressure, or intent.
Do not claim this is an appraisal, guarantee, prediction, or professional legal or financial advice.
Every reason must cite only evidence IDs from evidenceCatalogIds.
Return every strategy scenario exactly once, using only the supplied scenario kinds.
Return every supplied limitation code exactly once and no other limitation code.
Never request or reproduce addresses, owner details, contact information, coordinates, property IDs, remarks, or raw provider payloads.
Keep the explanation concise, neutral, evidence-linked, and suitable for display beside deterministic numeric results.`;

export interface PriceDecisionExplanationPrompt {
  readonly instructions: string;
  readonly input: string;
}

export function buildPriceDecisionExplanationPrompt(
  context: PriceDecisionExplanationContext,
): PriceDecisionExplanationPrompt {
  return Object.freeze({
    instructions: PRICE_DECISION_EXPLANATION_INSTRUCTIONS,
    input: JSON.stringify({
      promptVersion: PRICE_DECISION_EXPLANATION_PROMPT_VERSION,
      task: "Explain the supplied deterministic price decision.",
      normalizedContext: context,
    }),
  });
}
