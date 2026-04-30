/**
 * Integration test for the RFC 0001 Phase 1 hash-stability invariant —
 * exercised through the real `serializeSnapshot` path, not just
 * `normalizeRowForHash` in isolation.
 *
 * The bug this test exists to catch:
 *
 *   serializeSnapshot(rowsWithoutEncoding).snapshotId
 *     must equal
 *   serializeSnapshot(rowsWithEncodingNone).snapshotId
 *
 * If the two snapshot ids drift, every consumer of versioned graphs
 * (detect_changes, diff, blame) silently surfaces ghost modifications
 * between 1.7.x snapshots (no field) and 1.8.x snapshots (explicit
 * 'none' default per RFC 0001's schema change).
 *
 * The unit test in content-codec.test.ts pins the per-row contract; this
 * test pins the same contract end-to-end through serializer + CAS +
 * snapshot manifest, which is what production actually uses.
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  serializeSnapshot,
  type ContentAddressedStore,
  type ObjectId,
  ObjectNotFoundError,
  type RowSource,
  type GraphRow,
  makeObjectId,
  encodeContent,
} from '@codragraph/graphstore';

// ── Minimal in-memory CAS for tests ───────────────────────────────────
// Implements the ContentAddressedStore contract: put returns a stable
// sha256-prefixed id, get round-trips bytes, idempotent across duplicates.
class InMemoryCAS implements ContentAddressedStore {
  private readonly store = new Map<string, Uint8Array>();

  async put(bytes: Uint8Array): Promise<ObjectId> {
    const hash = sha256Bytes(bytes);
    const id = makeObjectId(hash);
    if (!this.store.has(id)) this.store.set(id, bytes);
    return id;
  }

  async get(id: ObjectId): Promise<Uint8Array> {
    const bytes = this.store.get(id);
    if (!bytes) throw new ObjectNotFoundError(id);
    return bytes;
  }

  async has(id: ObjectId): Promise<boolean> {
    return this.store.has(id);
  }

  async *list(): AsyncIterable<ObjectId> {
    for (const k of this.store.keys()) yield k as ObjectId;
  }
}

function sha256Bytes(bytes: Uint8Array): string {
  return createHash('sha256').update(Buffer.from(bytes)).digest('hex');
}

// ── Mock RowSource ─────────────────────────────────────────────────────
class MockRowSource implements RowSource {
  constructor(
    private readonly nodeTables: Record<string, GraphRow[]>,
    private readonly edges: GraphRow[] = [],
  ) {}

  async listNodeTables(): Promise<string[]> {
    return Object.keys(this.nodeTables).sort();
  }

  async *streamNodeTable(tableName: string): AsyncIterable<GraphRow> {
    for (const row of this.nodeTables[tableName] ?? []) yield row;
  }

  async *streamEdges(): AsyncIterable<GraphRow> {
    for (const row of this.edges) yield row;
  }
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('serializeSnapshot — RFC 0001 Phase 1 hash stability', () => {
  it("rows without contentEncoding hash-equal rows with contentEncoding: 'none'", async () => {
    // The cornerstone invariant. Two row sets that represent the SAME logical
    // graph, written in two different valid wire formats. The snapshot ids
    // must be identical.
    const rowsWithout: GraphRow[] = [
      { id: 'fn:1', name: 'foo', filePath: 'src/a.ts', content: 'function foo() {}' },
      { id: 'fn:2', name: 'bar', filePath: 'src/b.ts', content: 'function bar() { foo(); }' },
    ];
    const rowsWithNone: GraphRow[] = rowsWithout.map((r) => ({
      ...r,
      contentEncoding: 'none',
    }));

    const sourceA = new MockRowSource({ Function: rowsWithout });
    const sourceB = new MockRowSource({ Function: rowsWithNone });

    // Use a fixed createdAt so snapshot ids are deterministic across runs.
    const createdAt = '2026-01-01T00:00:00.000Z';

    const casA = new InMemoryCAS();
    const casB = new InMemoryCAS();

    const a = await serializeSnapshot({ source: sourceA, cas: casA, createdAt });
    const b = await serializeSnapshot({ source: sourceB, cas: casB, createdAt });

    // The cornerstone assertion: snapshot ids match. If normalizeRowForHash
    // leaves contentEncoding in the JSON, this fails — which is exactly the
    // bug the RFC was written to prevent.
    expect(b.snapshotId).toBe(a.snapshotId);
    expect(b.stats.totalNodeRows).toBe(a.stats.totalNodeRows);
  });

  it('snapshot ids differ when content actually differs (sanity check)', async () => {
    // Make sure we didn't accidentally make snapshot ids constant. Different
    // content must produce different ids.
    const sourceA = new MockRowSource({
      Function: [{ id: 'fn:1', name: 'foo', content: 'A' }],
    });
    const sourceB = new MockRowSource({
      Function: [{ id: 'fn:1', name: 'foo', content: 'B' }],
    });

    const createdAt = '2026-01-01T00:00:00.000Z';
    const a = await serializeSnapshot({
      source: sourceA,
      cas: new InMemoryCAS(),
      createdAt,
    });
    const b = await serializeSnapshot({
      source: sourceB,
      cas: new InMemoryCAS(),
      createdAt,
    });

    expect(b.snapshotId).not.toBe(a.snapshotId);
  });

  it('encoding stripping survives even when other unrelated fields differ in key order', async () => {
    // Object literal key ordering shouldn't matter — canonicalJsonStringify
    // sorts keys before hashing. This test catches a regression where the
    // codec or canonicalizer accidentally cares about insertion order.
    const sourceA = new MockRowSource({
      Function: [{ id: 'fn:1', content: 'body', name: 'foo', filePath: 'a.ts', startLine: 1 }],
    });
    const sourceB = new MockRowSource({
      Function: [
        // Same row, different key order, plus explicit 'none'.
        {
          startLine: 1,
          contentEncoding: 'none',
          filePath: 'a.ts',
          name: 'foo',
          content: 'body',
          id: 'fn:1',
        },
      ],
    });

    const createdAt = '2026-01-01T00:00:00.000Z';
    const a = await serializeSnapshot({
      source: sourceA,
      cas: new InMemoryCAS(),
      createdAt,
    });
    const b = await serializeSnapshot({
      source: sourceB,
      cas: new InMemoryCAS(),
      createdAt,
    });

    expect(b.snapshotId).toBe(a.snapshotId);
  });

  it('brotli-encoded rows produce the same snapshotId as unencoded rows', async () => {
    // Phase 2 end-to-end coverage: a row carrying brotli-compressed
    // content + `contentEncoding: 'brotli'` must hash to the same
    // snapshot id as the same logical row written without encoding.
    // If the serializer's normalize step or the brotli decoder drifts,
    // this fails — which is exactly the cross-version migration bug
    // the RFC was written to prevent.
    const original1 = 'function foo() {}';
    const original2 = 'function bar() { foo(); }';

    const rowsPlain: GraphRow[] = [
      { id: 'fn:1', name: 'foo', filePath: 'src/a.ts', content: original1 },
      { id: 'fn:2', name: 'bar', filePath: 'src/b.ts', content: original2 },
    ];
    const rowsBrotli: GraphRow[] = [
      {
        id: 'fn:1',
        name: 'foo',
        filePath: 'src/a.ts',
        content: encodeContent(original1, 'brotli'),
        contentEncoding: 'brotli',
      },
      {
        id: 'fn:2',
        name: 'bar',
        filePath: 'src/b.ts',
        content: encodeContent(original2, 'brotli'),
        contentEncoding: 'brotli',
      },
    ];

    const sourceA = new MockRowSource({ Function: rowsPlain });
    const sourceB = new MockRowSource({ Function: rowsBrotli });

    const createdAt = '2026-01-01T00:00:00.000Z';
    const a = await serializeSnapshot({ source: sourceA, cas: new InMemoryCAS(), createdAt });
    const b = await serializeSnapshot({ source: sourceB, cas: new InMemoryCAS(), createdAt });

    expect(b.snapshotId).toBe(a.snapshotId);
  });
});
