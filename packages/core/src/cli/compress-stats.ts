/**
 * Token-savings reporter for CLI output.
 *
 * Surfaces the @codragraph/compress value proposition on every `query`,
 * `context`, `impact`, and `analyze` invocation: how many tokens of
 * structured context did we return vs the equivalent raw-grep response.
 *
 * Uses the same chars/4 heuristic as @codragraph/compress's `estimateTokens`
 * for cross-package consistency. Inlined rather than imported because pulling
 * in @codragraph/compress as a runtime dep also pulls @codragraph/harness as a
 * transitive — too heavy for what is logically a one-line approximation. When
 * we add real LLM compression (`--compress` opt-in), the package import will
 * follow.
 */
import * as fsSync from 'node:fs';

/** chars/4 token estimate. Matches @codragraph/compress's `estimateTokens`. */
export function estimateTokens(text: string): number {
  return Math.max(0, Math.floor(text.trim().length / 4));
}

/**
 * Walk a result object and collect every file path we can find. Looks for
 * `filePath`, `file_path`, and `file` keys at any depth. Used to estimate
 * the raw-grep baseline (sum of source bytes the agent would have read
 * without CodraGraph).
 */
export function collectFilePaths(obj: unknown, paths: Set<string> = new Set()): Set<string> {
  if (!obj || typeof obj !== 'object') return paths;
  if (Array.isArray(obj)) {
    for (const item of obj) collectFilePaths(item, paths);
    return paths;
  }
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (
      (key === 'filePath' || key === 'file_path' || key === 'file') &&
      typeof value === 'string' &&
      value.length > 0
    ) {
      paths.add(value);
    } else if (typeof value === 'object') {
      collectFilePaths(value, paths);
    }
  }
  return paths;
}

/**
 * Estimate raw-grep-equivalent token count by summing on-disk byte sizes of
 * the referenced files. Returns null if any file is missing or unreadable —
 * in that case we silently skip the comparison rather than show a misleading
 * number.
 */
export function estimateRawGrepTokens(filePaths: Iterable<string>): number | null {
  let totalChars = 0;
  for (const fp of filePaths) {
    try {
      const stat = fsSync.statSync(fp);
      if (!stat.isFile()) return null;
      totalChars += stat.size;
    } catch {
      return null;
    }
  }
  return Math.floor(totalChars / 4);
}

/**
 * Format a one-line token-savings summary suitable for stderr display.
 * If a raw baseline is provided AND it's larger than the structured response,
 * the line includes the savings percentage. Otherwise it only reports
 * the structured token count.
 */
export function formatTokenLine(structuredTokens: number, rawTokens?: number | null): string {
  if (rawTokens && rawTokens > structuredTokens) {
    const savings = Math.round((1 - structuredTokens / rawTokens) * 100);
    return (
      `  @codragraph/compress: ~${structuredTokens.toLocaleString()} tokens of structured context ` +
      `(vs ~${rawTokens.toLocaleString()} tokens of raw source — ${savings}% smaller).`
    );
  }
  return `  @codragraph/compress: ~${structuredTokens.toLocaleString()} tokens of structured context.`;
}

/**
 * Compute and print the token-savings line for a tool result. Best-effort:
 * never throws, never blocks output. Goes to stderr so JSON consumers piping
 * stdout to jq stay clean.
 */
export function emitTokenStats(result: unknown): void {
  try {
    const structured = typeof result === 'string' ? result : JSON.stringify(result);
    const sTokens = estimateTokens(structured);
    const files = collectFilePaths(result);
    const rawTokens = files.size > 0 ? estimateRawGrepTokens(files) : null;
    process.stderr.write('\n' + formatTokenLine(sTokens, rawTokens) + '\n');
  } catch {
    /* never let stats break the actual output */
  }
}
