/**
 * Read-side decoder for `content` columns in cgdb node rows.
 *
 * RFC 0001 Phase 2 introduces an optional `contentEncoding` column on
 * every node table that has `content`. Default is `'none'` (passthrough)
 * so existing reads keep working unchanged. When a writer opts into
 * `--compress brotli|zstd`, the column carries the encoding tag and the
 * `content` column carries base64-encoded compressed bytes — readers
 * MUST run those bytes back through `decodeContent` before handing them
 * to a consumer (MCP tool result, HTTP API response, embedding model,
 * LLM input).
 *
 * Centralizing the decode in one helper has two benefits:
 *   1. Shim sites are 2-line changes: add `, n.contentEncoding AS
 *      contentEncoding` to the Cypher RETURN, and pipe the row through
 *      `decodeContentField` (or `decodeContentRow`) at the boundary.
 *   2. Anyone hunting for "where does the read path decode compressed
 *      bytes" greps for `decodeContentField` and gets every site in one
 *      shot — no per-table feature detection scattered across files.
 */

import { decodeContent, type ContentEncoding } from '@codragraph/graphstore';

/**
 * Decode a single (content, contentEncoding) pair from a Cypher row.
 *
 * Returns the input content unchanged when:
 *   - the encoding is missing / empty / `'none'` (the common case for
 *     1.6.x – 1.7.x indexes, plus any 1.8+ index written without
 *     `--compress`);
 *   - content is null/undefined (caller decides whether that's an error);
 *   - content is not a string (pre-Phase-2 indexes never wrote non-string
 *     content, but defensive: don't crash a read path on a malformed row).
 *
 * Throws (via `decodeContent`) only when the row claims an encoding this
 * CLI build can't decode — that's a forward-compat error and the right
 * behavior is to fail loudly rather than return wrong content.
 */
export function decodeContentField(content: unknown, encoding: unknown): string | undefined {
  if (content === undefined || content === null) return undefined;
  if (typeof content !== 'string') return content as string;
  if (typeof encoding !== 'string' || encoding === '' || encoding === 'none') {
    return content;
  }
  return decodeContent(content, encoding as ContentEncoding);
}

/**
 * Apply `decodeContentField` to a row that carries `content` and
 * `contentEncoding` keys (or their numeric column-index aliases).
 *
 * The numeric-fallback shape (`r[N]`) mirrors LadybugDB's row format —
 * driver versions vary on whether named keys are populated, so existing
 * read sites do `r.content ?? r[N]`. This helper accepts the same
 * pattern. Returns a NEW object (does not mutate input).
 */
export function decodeContentRow<T extends Record<string, unknown>>(
  row: T,
  contentKey: keyof T = 'content',
  encodingKey: keyof T = 'contentEncoding',
): T {
  const content = row[contentKey];
  if (content === undefined || content === null) return row;
  const encoding = row[encodingKey];
  if (typeof encoding !== 'string' || encoding === '' || encoding === 'none') return row;
  return { ...row, [contentKey]: decodeContentField(content, encoding) };
}
