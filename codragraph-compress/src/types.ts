// Public contracts for codragraph-compress.

import type { InferenceProvider } from 'codragraph-harness';

/** Compression aggressiveness; affects the prompt and target token-reduction ratio. */
export type CompressionLevel = 'min' | 'balanced' | 'max';

export interface Compressor {
  /** Stable identifier; "llm" / "nlp" / "mlm" / etc. */
  readonly name: string;

  compress(text: string, options: CompressOptions): Promise<CompressResult>;
  decompress(compressed: string, options: DecompressOptions): Promise<DecompressResult>;
}

export interface CompressOptions {
  /** Inference provider for LLM-based compression. Required for LlmCompressor. */
  inference: InferenceProvider;
  /** Compression aggressiveness. Default: "balanced" (~30-40% reduction). */
  level?: CompressionLevel;
  /** Provider-specific model id; falls through to provider defaults. */
  model?: string;
  /**
   * For long text, compress sentence-by-sentence (better quality, more API
   * calls) vs whole-text (single call, may dilute on very long input).
   * Default: "auto" — sentence-split when text is over `sentenceSplitThreshold` chars.
   */
  strategy?: 'auto' | 'single-call' | 'per-sentence';
  /** Char-count threshold for auto strategy. Default 1500. */
  sentenceSplitThreshold?: number;
  /** Optional: compute embedding similarity between original and compressed. Costs extra API calls. */
  computeSimilarity?: boolean;
  /** Embedding model id for similarity. Provider-specific. */
  embeddingModel?: string;
}

export interface CompressResult {
  /** The compressed text. */
  compressed: string;
  /** Estimated tokens in original (chars / 4 heuristic). */
  originalTokens: number;
  /** Estimated tokens in compressed. */
  compressedTokens: number;
  /** 0..1 fraction reduction; e.g. 0.42 = 42% fewer tokens. */
  reduction: number;
  /** Cosine similarity of embeddings if `computeSimilarity` was true. */
  embeddingSimilarity?: number;
  /** Per-strategy metadata (e.g. number of sentences processed). */
  metadata?: Record<string, unknown>;
}

export interface DecompressOptions {
  inference: InferenceProvider;
  model?: string;
}

export interface DecompressResult {
  decompressed: string;
  /** Token expansion ratio (decompressed / compressed). */
  expansion: number;
}
