/**
 * RFC 0001 (in-graph body compression) — Phase 2.
 *
 * What's done in this file:
 *   - Phase 1 (1.7.x): decodeContent / normalizeRowForHash with the
 *     hash-stability invariant. A row with no encoding field, an explicit
 *     `contentEncoding: 'none'`, and a (decoded) compressed row all
 *     canonicalize to the same JSON.
 *   - Phase 2 (1.8.x): real brotli + zstd encoders/decoders behind
 *     `encodeContent` / `decodeContent`. Compression params are pinned for
 *     determinism (brotli quality 6, zstd level 3); changing them is a
 *     wire-format break and must be a major version bump.
 *
 * What's NOT done (deferred; grep `RFC0001-DEFERRED` to find every site
 * that will need updating):
 *   - Schema: `contentEncoding STRING DEFAULT 'none'` column on every node
 *     table that has `content`. RFC §7 prescribes this; deferred because
 *     LadybugDB's ALTER TABLE behavior on existing 1.6.x indexes hasn't
 *     been validated end-to-end. New indexes should add the column at the
 *     same time the writer flag is wired up.
 *   - `--compress brotli|zstd|none` CLI flag on `codragraph analyze`.
 *   - Writer integration in cgdb-adapter (call `encodeContent` before
 *     INSERT when --compress is set).
 *   - MCP read-path decode shim: `local-backend.ts` reads `n.content` at
 *     ~10 sites and returns it raw to the agent. With Phase 2 writers
 *     active, those paths must call `decodeContent` before returning, or
 *     compressed bytes will leak to MCP consumers. Tagged with
 *     `RFC0001-DEFERRED` comments at the call sites.
 *   - Direct CLI tool consumers (wiki, skill-gen, query/context CLI):
 *     same shim requirement as MCP read path.
 *
 * Materializer is NOT in the deferred list — it reads rows from CAS, which
 * already hold normalized (decoded) content because the serializer
 * normalized before storing. Round-trip works correctly today and stays
 * correct once writers start emitting encoded rows.
 *
 * Read RFC 0001 (`docs/rfc/0001-in-graph-body-compression.md`) for the
 * full migration plan and risks.
 */

import {
  brotliCompressSync,
  brotliDecompressSync,
  constants as zlibConstants,
  // zstd helpers are gated at runtime — Node added them in 22.15.0.
  // Importing the namespace lets us feature-detect without crashing
  // on older runtimes.
} from 'node:zlib';
import * as zlib from 'node:zlib';

import type { GraphRow } from './row-source.js';

/** Supported per-row encodings for the `content` column. */
export type ContentEncoding = 'none' | 'brotli' | 'zstd';

/**
 * Deterministic compression params. CHANGING ANY OF THESE BREAKS WIRE
 * FORMAT — every previously-written compressed row will hash to a new id.
 * Treat as a major-version operation.
 */
const BROTLI_QUALITY = 6;
const ZSTD_LEVEL = 3;

/** True iff the running Node has native zstd (added in 22.15.0). */
const ZSTD_AVAILABLE =
  typeof (zlib as unknown as { zstdCompressSync?: unknown }).zstdCompressSync === 'function' &&
  typeof (zlib as unknown as { zstdDecompressSync?: unknown }).zstdDecompressSync === 'function';

/**
 * Encodings this CLI build can decode. Computed at module load:
 *   - 'none' is always supported (passthrough).
 *   - 'brotli' is always supported (Node ≥ 18 ships native brotli).
 *   - 'zstd' is included only when running Node ≥ 22.15.
 *
 * Readers on older Node receiving a zstd-encoded row will hit the
 * forward-compat error path in `decodeContent` with a clear upgrade
 * message rather than silently producing wrong content.
 */
export const SUPPORTED_DECODE_ENCODINGS: ReadonlySet<ContentEncoding> = new Set<ContentEncoding>(
  ZSTD_AVAILABLE ? ['none', 'brotli', 'zstd'] : ['none', 'brotli'],
);

/** Sentinel: a row with this encoding (or no field) needs no decode work. */
export const PASSTHROUGH_ENCODING: ContentEncoding = 'none';

/** True iff this CLI build can decode rows tagged with `encoding`. */
export function isEncodingSupported(encoding: ContentEncoding | undefined): boolean {
  if (!encoding || encoding === 'none') return true;
  return SUPPORTED_DECODE_ENCODINGS.has(encoding);
}

/**
 * Encode a logical content string into the on-the-wire form for the given
 * encoding. The output is always a string (base64 for binary encodings)
 * so it round-trips through JSON unchanged — important because the
 * snapshot CAS canonicalizes rows as JSON.
 *
 * Determinism: same input + same params → byte-identical output. This is
 * a load-bearing property for content-addressed storage.
 */
export function encodeContent(content: string, encoding: ContentEncoding | undefined): string {
  if (!encoding || encoding === 'none') return content;
  const input = Buffer.from(content, 'utf8');
  if (encoding === 'brotli') {
    const compressed = brotliCompressSync(input, {
      params: { [zlibConstants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY },
    });
    return compressed.toString('base64');
  }
  if (encoding === 'zstd') {
    if (!ZSTD_AVAILABLE) {
      throw new Error(
        `encodeContent: zstd is not available on this Node runtime ` +
          `(requires Node ≥ 22.15.0 for native node:zlib zstd support). ` +
          `Use --compress brotli on older Node.`,
      );
    }
    const compressed = (
      zlib as unknown as {
        zstdCompressSync: (buf: Uint8Array, opts?: { params?: Record<number, number> }) => Buffer;
        constants: { ZSTD_c_compressionLevel?: number };
      }
    ).zstdCompressSync(input, {
      params: zlib.constants.ZSTD_c_compressionLevel
        ? { [zlib.constants.ZSTD_c_compressionLevel]: ZSTD_LEVEL }
        : undefined,
    });
    return compressed.toString('base64');
  }
  throw new Error(
    `encodeContent: unknown encoding '${String(encoding)}'. ` +
      `Valid values: 'none', 'brotli', 'zstd'.`,
  );
}

/**
 * Decode an on-the-wire content string into the logical content string.
 * The inverse of `encodeContent`. Phase 1 implemented only the
 * passthrough case; Phase 2 plugs in real brotli + zstd.
 *
 * Throws a forward-compat error for encodings this build does not
 * support, pointing the user at upgrading the CLI.
 */
export function decodeContent(content: string, encoding: ContentEncoding | undefined): string {
  if (!encoding || encoding === 'none') return content;
  if (!SUPPORTED_DECODE_ENCODINGS.has(encoding)) {
    throw new Error(
      `decodeContent: encoding '${encoding}' not supported by this CLI build. ` +
        `Upgrade to a CLI version (or Node runtime) that includes the matching decoder ` +
        `(see CHANGELOG for when each encoding shipped).`,
    );
  }
  const compressed = Buffer.from(content, 'base64');
  if (encoding === 'brotli') {
    return brotliDecompressSync(compressed).toString('utf8');
  }
  if (encoding === 'zstd') {
    // ZSTD_AVAILABLE is implied by the SUPPORTED_DECODE_ENCODINGS check above.
    const decompressed = (
      zlib as unknown as { zstdDecompressSync: (buf: Uint8Array) => Buffer }
    ).zstdDecompressSync(compressed);
    return decompressed.toString('utf8');
  }
  // Unreachable given the support-set check, but keeps the type-checker happy.
  throw new Error(`decodeContent: unhandled encoding '${String(encoding)}'.`);
}

/**
 * Return a hash-stable version of a row. The cornerstone invariant:
 *
 *   normalize({...row, content: 'foo'})            // no contentEncoding field
 *   normalize({...row, content: 'foo', contentEncoding: 'none'})
 *   normalize({...row, content: '<brotli-bytes>', contentEncoding: 'brotli'})
 *
 * must all produce JSON-equal outputs (and therefore identical CAS ids).
 *
 * That means `contentEncoding` must be STRIPPED from the output when it's
 * present — even when it's the trivial 'none' value. Returning the row
 * unchanged just because the encoding is 'none' is a footgun: a 1.7.x
 * snapshot (no field) would not hash-equal a 1.8.x snapshot (explicit
 * 'none' default) of identical source, so detect_changes / blame / diff
 * would surface ghost modifications.
 *
 * Phase 1 (1.7.x) writers don't emit the field at all, so in practice
 * this function is identity-on-input today. Phase 2 (1.8.x) flips on
 * writers that emit the field; THIS function is what makes that flip safe.
 */
export function normalizeRowForHash(row: GraphRow): GraphRow {
  const enc = row['contentEncoding'];

  // No encoding field — already in canonical hash form.
  if (enc === undefined) return row;

  const content = row['content'];

  // Resolve the logical content. Trivial encoding ('none') is passthrough;
  // non-trivial requires decode (brotli/zstd in Phase 2).
  let logicalContent: unknown = content;
  if (typeof enc === 'string' && enc !== PASSTHROUGH_ENCODING) {
    if (typeof content !== 'string') {
      // Encoding declared but no string content to decode — treat as the
      // hash-canonical row (encoding stripped, content as-is). Avoids
      // throwing on malformed rows.
    } else {
      logicalContent = decodeContent(content, enc as ContentEncoding);
    }
  }

  // Build a new row WITHOUT contentEncoding. Always — even for 'none'.
  // This is the hash-stability invariant: the JSON output is identical
  // to a row that never had the encoding field at all.
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(row)) {
    if (k === 'contentEncoding') continue;
    if (k === 'content') {
      out[k] = logicalContent;
      continue;
    }
    out[k] = row[k];
  }
  return out as GraphRow;
}
