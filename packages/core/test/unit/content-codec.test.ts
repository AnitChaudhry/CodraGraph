/**
 * Unit tests for the content-codec normalization layer.
 *
 * These tests pin down the cornerstone invariant from RFC 0001:
 *
 *   normalizeRowForHash(rowWithoutEncoding)
 *     produces the SAME JSON as
 *   normalizeRowForHash(rowWithEncodingNone)
 *     produces the SAME JSON as
 *   normalizeRowForHash(rowWithCompressedEncoding)  // brotli, zstd, etc.
 *
 * If this regresses, snapshot ids drift between 1.7.x (no field), 1.8.x
 * compressed snapshots, and explicit-'none' default snapshots — which
 * makes detect_changes, blame, and diff silently surface ghost
 * modifications. See `docs/rfc/0001-in-graph-body-compression.md`.
 *
 * IMPORTANT: tests do NOT manually strip `contentEncoding` from the
 * normalized output before comparing. The whole point is that the function
 * does the stripping itself. A test that strips manually would compensate
 * for a buggy normalizer and pass for the wrong reason.
 */

import { describe, it, expect } from 'vitest';
import {
  decodeContent,
  encodeContent,
  isEncodingSupported,
  normalizeRowForHash,
  SUPPORTED_DECODE_ENCODINGS,
  type ContentEncoding,
} from '@codragraph/graphstore';

const ZSTD_AVAILABLE = isEncodingSupported('zstd');

describe('content-codec', () => {
  describe('decodeContent', () => {
    it('passes through plain text when encoding is undefined', () => {
      expect(decodeContent('function foo() {}', undefined)).toBe('function foo() {}');
    });

    it("passes through plain text when encoding is 'none'", () => {
      expect(decodeContent('function foo() {}', 'none')).toBe('function foo() {}');
    });

    it('round-trips strings through brotli', () => {
      const original = 'function foo() { return 42; }\n// trailing comment\n';
      const encoded = encodeContent(original, 'brotli');
      // Encoded is base64 — plain ASCII, but never equals the input for
      // non-trivial input (it carries brotli framing bytes).
      expect(encoded).not.toBe(original);
      expect(decodeContent(encoded, 'brotli')).toBe(original);
    });

    it.skipIf(!ZSTD_AVAILABLE)('round-trips strings through zstd (Node ≥ 22.15)', () => {
      const original = 'function bar() { return [1, 2, 3]; }\nclass Baz {}\n';
      const encoded = encodeContent(original, 'zstd');
      expect(encoded).not.toBe(original);
      expect(decodeContent(encoded, 'zstd')).toBe(original);
    });

    it('throws a forward-compat error for encodings this build cannot decode', () => {
      // We synthesize an encoding tag that this build is guaranteed not to
      // know — newer CLI versions may add encodings, and an older CLI
      // reading those rows must fail loudly with an actionable message
      // rather than silently producing wrong content.
      const futureEncoding = 'lz4-v2' as ContentEncoding;
      expect(() => decodeContent('whatever', futureEncoding)).toThrow(/encoding 'lz4-v2'/);
      expect(() => decodeContent('whatever', futureEncoding)).toThrow(/Upgrade/i);
    });
  });

  describe('encodeContent', () => {
    it("passes through when encoding is 'none' or undefined", () => {
      expect(encodeContent('hello', 'none')).toBe('hello');
      expect(encodeContent('hello', undefined)).toBe('hello');
    });

    it('brotli output is deterministic at pinned quality', () => {
      // Determinism is load-bearing for content-addressed storage: the
      // same logical row must hash to the same CAS id every time.
      const input = 'export function add(a: number, b: number) { return a + b; }';
      const a = encodeContent(input, 'brotli');
      const b = encodeContent(input, 'brotli');
      expect(b).toBe(a);
    });

    it.skipIf(!ZSTD_AVAILABLE)(
      'zstd output is deterministic at pinned level (Node ≥ 22.15)',
      () => {
        const input = 'export function sub(a: number, b: number) { return a - b; }';
        const a = encodeContent(input, 'zstd');
        const b = encodeContent(input, 'zstd');
        expect(b).toBe(a);
      },
    );

    it('compresses large repetitive content', () => {
      // Sanity: brotli should comfortably shrink a kilobyte of repeats.
      // We don't assert a specific ratio (would couple us to Node's brotli
      // version), just that compression actually happens.
      const input = 'a'.repeat(4096);
      const encoded = encodeContent(input, 'brotli');
      // base64 inflates by ~33%, so under-3KB output proves real
      // compression happened upstream.
      expect(encoded.length).toBeLessThan(input.length);
    });
  });

  describe('SUPPORTED_DECODE_ENCODINGS', () => {
    it("always includes 'none' and 'brotli'", () => {
      expect(SUPPORTED_DECODE_ENCODINGS.has('none')).toBe(true);
      expect(SUPPORTED_DECODE_ENCODINGS.has('brotli')).toBe(true);
    });

    it("includes 'zstd' iff the runtime exposes native zstd", () => {
      // The set is computed once at module load. This test pins that
      // contract so a refactor doesn't accidentally drop the runtime gate.
      expect(SUPPORTED_DECODE_ENCODINGS.has('zstd')).toBe(ZSTD_AVAILABLE);
    });
  });

  describe('normalizeRowForHash', () => {
    it('returns the same reference when no contentEncoding is present', () => {
      // Identity-op: a row with no encoding field is already in canonical
      // hash form. Returning the same reference is a defensible perf
      // optimization (most rows in 1.7.x), but the contract is JSON-equality
      // — checked separately in the hash-stability suite below.
      const row = { id: 'a', name: 'foo', content: 'function foo() {}' };
      const normalized = normalizeRowForHash(row);
      expect(normalized).toBe(row);
    });

    it("strips contentEncoding when it is 'none'", () => {
      const row = {
        id: 'a',
        name: 'foo',
        content: 'function foo() {}',
        contentEncoding: 'none',
      };
      const normalized = normalizeRowForHash(row);
      // Must NOT be the same reference: we built a new row.
      expect(normalized).not.toBe(row);
      // Must NOT have the encoding field — that's the whole point.
      expect(Object.prototype.hasOwnProperty.call(normalized, 'contentEncoding')).toBe(false);
      // Content is preserved unchanged.
      expect(normalized.content).toBe('function foo() {}');
    });

    it('decodes brotli content and strips contentEncoding', () => {
      const original = 'function foo() {}';
      const encoded = encodeContent(original, 'brotli');
      const row = {
        id: 'a',
        name: 'foo',
        content: encoded,
        contentEncoding: 'brotli',
      };
      const normalized = normalizeRowForHash(row);
      expect(Object.prototype.hasOwnProperty.call(normalized, 'contentEncoding')).toBe(false);
      // Decoded back to logical content.
      expect(normalized.content).toBe(original);
    });

    it.skipIf(!ZSTD_AVAILABLE)(
      'decodes zstd content and strips contentEncoding (Node ≥ 22.15)',
      () => {
        const original = 'class Bar { x = 1; }';
        const encoded = encodeContent(original, 'zstd');
        const row = {
          id: 'a',
          name: 'Bar',
          content: encoded,
          contentEncoding: 'zstd',
        };
        const normalized = normalizeRowForHash(row);
        expect(Object.prototype.hasOwnProperty.call(normalized, 'contentEncoding')).toBe(false);
        expect(normalized.content).toBe(original);
      },
    );

    it('strips contentEncoding when decoding fails because content is non-string', () => {
      // Edge case: encoding declared but no string content. Don't throw;
      // strip the field and leave content as-is. The serializer's downstream
      // hash will be consistent because the field is gone.
      const row = { id: 'a', name: 'foo', contentEncoding: 'brotli' };
      const normalized = normalizeRowForHash(row);
      expect(normalized).not.toBe(row);
      expect(Object.prototype.hasOwnProperty.call(normalized, 'contentEncoding')).toBe(false);
    });
  });

  describe('hash stability invariant — the cornerstone', () => {
    it("identity row, explicit 'none', and brotli-encoded all canonicalize to the same JSON", () => {
      // Three rows that represent the SAME logical content, written in
      // three valid wire formats. Their JSON-after-normalize must match
      // exactly so they hash to the same CAS id.
      const original = 'body';
      const without = { id: 'a', name: 'foo', content: original, filePath: 'src/foo.ts' };
      const withNone = {
        id: 'a',
        name: 'foo',
        content: original,
        filePath: 'src/foo.ts',
        contentEncoding: 'none',
      };
      const withBrotli = {
        id: 'a',
        name: 'foo',
        content: encodeContent(original, 'brotli'),
        filePath: 'src/foo.ts',
        contentEncoding: 'brotli',
      };

      const normalizedWithout = normalizeRowForHash(without);
      const normalizedWithNone = normalizeRowForHash(withNone);
      const normalizedWithBrotli = normalizeRowForHash(withBrotli);

      // Compare canonical JSON forms directly. NO MANUAL STRIPPING.
      // If the function leaves contentEncoding in the output, this fails.
      const jsonWithout = JSON.stringify(sortKeys(normalizedWithout));
      expect(JSON.stringify(sortKeys(normalizedWithNone))).toBe(jsonWithout);
      expect(JSON.stringify(sortKeys(normalizedWithBrotli))).toBe(jsonWithout);
    });

    it.skipIf(!ZSTD_AVAILABLE)(
      'zstd-encoded row hash-equals the same logical row (Node ≥ 22.15)',
      () => {
        const original = 'body';
        const without = { id: 'a', name: 'foo', content: original, filePath: 'src/foo.ts' };
        const withZstd = {
          id: 'a',
          name: 'foo',
          content: encodeContent(original, 'zstd'),
          filePath: 'src/foo.ts',
          contentEncoding: 'zstd',
        };

        expect(JSON.stringify(sortKeys(normalizeRowForHash(withZstd)))).toBe(
          JSON.stringify(sortKeys(normalizeRowForHash(without))),
        );
      },
    );

    it('strips contentEncoding even when other keys are present in different orders', () => {
      // Object key ordering in JS is insertion order; the canonicalizer
      // sorts keys. Make sure normalize doesn't leave field-presence
      // differences that would survive canonicalization.
      const a = { contentEncoding: 'none', id: 'x', content: 'b', name: 'n' };
      const b = { name: 'n', id: 'x', content: 'b' };

      const na = normalizeRowForHash(a);
      const nb = normalizeRowForHash(b);

      // Same set of keys after normalize.
      expect(new Set(Object.keys(na))).toEqual(new Set(Object.keys(nb)));
      expect(Object.prototype.hasOwnProperty.call(na, 'contentEncoding')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(nb, 'contentEncoding')).toBe(false);
    });
  });
});

// Helper: deterministic key ordering for JSON comparison. Mirrors what
// canonicalJsonStringify does in the graphstore CAS. We re-implement here
// to avoid a graphstore-internal import in tests.
function sortKeys(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj).sort()) {
    out[k] = obj[k];
  }
  return out;
}
