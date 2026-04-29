// Per-1k-token pricing for cost calculation. Update when providers change rates.
// Self-hosted providers (vllm, ollama, tgi, llamacpp) cost $0/token.

import type { ModelSpec } from "./types.js";

export interface ModelPricing {
  /** USD per 1,000 input tokens. */
  inputPer1k: number;
  /** USD per 1,000 output tokens. */
  outputPer1k: number;
}

const PRICES_BY_MODEL_ID: Record<string, ModelPricing> = {
  // Anthropic (as of 2026-04; check console.anthropic.com for current pricing)
  "claude-haiku-4-5-20251001": { inputPer1k: 0.001, outputPer1k: 0.005 },
  "claude-sonnet-4-6": { inputPer1k: 0.003, outputPer1k: 0.015 },
  "claude-opus-4-7": { inputPer1k: 0.015, outputPer1k: 0.075 },

  // OpenAI (as of 2026-04; check platform.openai.com/docs/pricing)
  "gpt-4o-mini-2024-07-18": { inputPer1k: 0.00015, outputPer1k: 0.0006 },
  "gpt-4o-2024-11-20": { inputPer1k: 0.0025, outputPer1k: 0.01 },
  "gpt-5-5": { inputPer1k: 0.005, outputPer1k: 0.02 }, // placeholder
};

/** Compute cost for a single completion call. Returns 0 for self-hosted models. */
export function computeCost(
  model: ModelSpec,
  inputTokens: number,
  outputTokens: number,
): number {
  if (model.provider !== "anthropic" && model.provider !== "openai") return 0;
  const price = PRICES_BY_MODEL_ID[model.modelId];
  if (!price) {
    // Unknown closed-API model — return 0 with a stderr warning
    console.error(
      `[pricing] no entry for ${model.modelId}; reporting cost as $0. Update Benchmarking/scripts/pricing.ts.`,
    );
    return 0;
  }
  return (inputTokens / 1000) * price.inputPer1k + (outputTokens / 1000) * price.outputPer1k;
}
