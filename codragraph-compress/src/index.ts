// codragraph-compress — lossless semantic compression for LLM contexts.
//
// Phase 1.5 (started 2026-04-29): TS port of the original Python library.
// LLM-based path lands first (highest leverage, simplest port). MLM (RoBERTa)
// and NLP (spaCy) paths are deferred — their TS equivalents (transformers.js,
// node-spacy via WASM) have lower quality. For Phase 1.5 those paths run as
// a Docker sidecar over HTTP if needed.
//
// SPEC: ../SPEC.md
// Prompts: ../prompts/{compression,decompression}.txt

export { LlmCompressor } from './llm.js';
export type {
  Compressor,
  CompressOptions,
  CompressResult,
  DecompressOptions,
  DecompressResult,
  CompressionLevel,
} from './types.js';
export { estimateTokens } from './utils.js';
