// Helpers shared by LlmCompressor (and future NLP/MLM impls if those are
// ported into this package).

/**
 * Estimate token count from char count.
 *
 * GPT-tokenizer-ish heuristic: average ~4 chars per token across English.
 * Cheap, deterministic, no extra deps. For exact counts, use the provider's
 * native tokenizer (tiktoken / @anthropic-ai/sdk's `count_tokens`).
 */
export function estimateTokens(text: string): number {
  return Math.max(0, Math.floor(text.trim().length / 4));
}

/**
 * Lightweight sentence splitter — handles ., !, ?, plus newlines as boundaries.
 * Preserves common abbreviations (Mr., Dr., Inc., etc.) by not splitting
 * after a single capital letter + period when followed by another word.
 *
 * For high-fidelity splitting (legal docs, multi-language), use a dedicated
 * library. This is good enough for compression-time prose.
 */
export function splitSentences(text: string): string[] {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return [];

  // Split on punctuation followed by whitespace + capital letter (or start of line).
  const parts = cleaned.split(/(?<=[.!?])\s+(?=[A-Z(\["'`])/g);
  // Filter empties and re-trim.
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

/**
 * Cosine similarity between two equal-length numeric vectors. Returns 1 for
 * identical, 0 for orthogonal, -1 for opposite. Used for embedding-loss
 * scoring. Throws on length mismatch.
 */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) {
    throw new Error(`cosineSimilarity: length mismatch ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/** Detect non-prose content where compression is unsafe (code, structured data). */
export function isProse(text: string): boolean {
  const codeIndicators = [
    "def ",
    "class ",
    "function ",
    "import ",
    "const ",
    "let ",
    "var ",
    "public ",
    "private ",
    "protected ",
    "#include",
    "package ",
    "=>",
    "->",
    "::",
    "!=",
    "==",
    "<=",
    ">=",
    "&&",
    "||",
  ];
  let codeScore = 0;
  for (const ind of codeIndicators) if (text.includes(ind)) codeScore++;
  const braceCount =
    (text.match(/[{}\[\]]/g) ?? []).length;
  const wordCount = text.split(/\s+/).filter((w) => w.length > 0).length;
  if (wordCount < 5) return true;
  if (codeScore >= 2 || braceCount > wordCount * 0.2) return false;
  return true;
}
