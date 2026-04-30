// Compress namespace — re-exports from codragraph-compress.
//
// Phase 1.5: TS port of the original Python compression library.
// LLM-based compression ships first; NLP / MLM paths land later (or via
// Docker sidecar — see project memory).

export { LlmCompressor, estimateTokens } from '@codragraph/compress';

export type {
  Compressor,
  CompressOptions,
  CompressResult,
  DecompressOptions,
  DecompressResult,
  CompressionLevel,
} from '@codragraph/compress';
