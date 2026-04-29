// LLM-based compressor — TS port of the original Python codragraph_compress.py.
//
// Strategy:
//   - Short text: single inference call.
//   - Long text: sentence-split, compress each sentence (preserves locality
//     of meaning, avoids the model dropping context).
//
// Provider-agnostic: takes any InferenceProvider from codragraph-harness.
// Embedding similarity is opt-in (off by default to avoid extra API calls).

import type { InferenceProvider } from "codragraph-harness/inference/interface";
import type {
  Compressor,
  CompressOptions,
  CompressResult,
  DecompressOptions,
  DecompressResult,
} from "./types.js";
import {
  COMPRESSION_PROMPT,
  DECOMPRESSION_PROMPT,
  MAX_LEVEL_SUFFIX,
  MIN_LEVEL_SUFFIX,
} from "./prompts.js";
import { cosineSimilarity, estimateTokens, isProse, splitSentences } from "./utils.js";

const DEFAULT_THRESHOLD = 1500;

export class LlmCompressor implements Compressor {
  readonly name = "llm";

  async compress(text: string, options: CompressOptions): Promise<CompressResult> {
    const level = options.level ?? "balanced";
    const strategy = options.strategy ?? "auto";
    const threshold = options.sentenceSplitThreshold ?? DEFAULT_THRESHOLD;

    const systemPrompt = buildSystemPrompt(level);
    let compressed: string;
    let metadata: Record<string, unknown> = { level, strategy };

    if (strategy === "single-call" || (strategy === "auto" && text.length <= threshold) || !isProse(text)) {
      compressed = await compressOnce(options.inference, text, systemPrompt, options.model);
      metadata.sentenceCount = 1;
    } else {
      const sentences = splitSentences(text);
      metadata.sentenceCount = sentences.length;
      const out: string[] = [];
      for (const s of sentences) {
        if (!s.trim()) continue;
        out.push(await compressOnce(options.inference, s, systemPrompt, options.model));
      }
      compressed = out.join(" ");
    }

    const originalTokens = estimateTokens(text);
    const compressedTokens = estimateTokens(compressed);
    const reduction =
      originalTokens > 0 ? Math.max(0, (originalTokens - compressedTokens) / originalTokens) : 0;

    let embeddingSimilarity: number | undefined;
    if (options.computeSimilarity) {
      embeddingSimilarity = await computeSimilarity(
        options.inference,
        text,
        compressed,
        options.embeddingModel,
      );
    }

    return {
      compressed,
      originalTokens,
      compressedTokens,
      reduction,
      embeddingSimilarity,
      metadata,
    };
  }

  async decompress(
    compressed: string,
    options: DecompressOptions,
  ): Promise<DecompressResult> {
    const result = await options.inference.complete({
      model: options.model,
      systemPrompt: "You are an expert at expanding compressed text.",
      messages: [
        {
          role: "user",
          content: DECOMPRESSION_PROMPT.replace("{text}", compressed),
        },
      ],
      temperature: 0.3,
    });
    const decompressed = result.content.trim();
    const inputTokens = estimateTokens(compressed);
    const outputTokens = estimateTokens(decompressed);
    const expansion = inputTokens > 0 ? outputTokens / inputTokens : 0;
    return { decompressed, expansion };
  }
}

function buildSystemPrompt(level: "min" | "balanced" | "max"): string {
  if (level === "max") return COMPRESSION_PROMPT + MAX_LEVEL_SUFFIX;
  if (level === "min") return COMPRESSION_PROMPT + MIN_LEVEL_SUFFIX;
  return COMPRESSION_PROMPT;
}

async function compressOnce(
  inference: InferenceProvider,
  text: string,
  systemPrompt: string,
  model?: string,
): Promise<string> {
  const result = await inference.complete({
    model,
    systemPrompt:
      "You are an expert at codragraph compression. Always compress the provided text, never ask for clarification.",
    messages: [
      {
        role: "user",
        content: systemPrompt.replace("{text}", text),
      },
    ],
    temperature: 0.3,
  });
  return result.content.trim();
}

/**
 * Optional embedding similarity calculation.
 *
 * Note: the InferenceProvider interface doesn't currently expose an
 * embeddings method (only `complete`). For Phase 1.5 we approximate by
 * asking the model to score similarity directly. A proper embeddings API
 * lands as a follow-up — flagged in the SDK README.
 */
async function computeSimilarity(
  inference: InferenceProvider,
  original: string,
  compressed: string,
  _model?: string,
): Promise<number> {
  const result = await inference.complete({
    systemPrompt:
      "Rate semantic similarity of two passages. Reply ONLY with a number from 0 to 1 (1 = identical meaning). No other text.",
    messages: [
      {
        role: "user",
        content: `Original:\n${original}\n\nCompressed:\n${compressed}\n\nSimilarity (0..1):`,
      },
    ],
    temperature: 0,
    maxTokens: 16,
  });
  const n = parseFloat(result.content.trim());
  if (Number.isFinite(n) && n >= 0 && n <= 1) return n;
  return Number.NaN;
}

// `cosineSimilarity` is exported from utils.ts and remains the right call
// site once a real embeddings API is added to InferenceProvider.
void cosineSimilarity;
