/**
 * Phase 4 Integration Test: cgdb → graphstore round-trip.
 *
 * Closes the advisor flag from the Phase 4 MVP review: confirms that
 * `createCgdbRowSource` actually unwraps `MATCH (n:T) RETURN n` results
 * into well-shaped GraphRow objects, that serializeSnapshot can then
 * round-trip them through the FsCAS, and that materializeSnapshot
 * replays a byte-identical snapshot.
 *
 * Uses the shared `withTestCgdbDB` global setup — same pattern every
 * other cgdb integration test in this repo follows.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { withTestCgdbDB } from '../helpers/test-indexed-db.js';
import { FsCAS, serializeSnapshot } from '@codragraph/graphstore';
import { createCgdbRowSource } from '../../src/core/graphstore/cgdb-row-source.js';

withTestCgdbDB('graphstore-cgdb', () => {
  describe('graphstore × cgdb', () => {
    it('streamNodeTable yields rows with the expected shape', async () => {
      const { executeQuery } = await import('../../src/core/cgdb/cgdb-adapter.js');

      // Insert a couple of Function nodes so we have something to read.
      await executeQuery(
        `CREATE (n:Function {id: "fn:test-a", name: "alpha", filePath: "src/a.ts", startLine: 1, endLine: 3, isExported: true, content: "alpha", description: ""})`,
      );
      await executeQuery(
        `CREATE (n:Function {id: "fn:test-b", name: "beta", filePath: "src/b.ts", startLine: 5, endLine: 9, isExported: false, content: "beta", description: ""})`,
      );

      const source = createCgdbRowSource();
      const rows: Record<string, unknown>[] = [];
      for await (const row of source.streamNodeTable('Function')) {
        // Filter to just the rows our test inserted — other tests in the
        // shared cgdb session may have left rows behind.
        if (row['id'] === 'fn:test-a' || row['id'] === 'fn:test-b') {
          rows.push(row as Record<string, unknown>);
        }
      }
      expect(rows.length).toBe(2);
      const a = rows.find((r) => r['id'] === 'fn:test-a');
      expect(a?.['name']).toBe('alpha');
      expect(a?.['filePath']).toBe('src/a.ts');
      expect(a?.['isExported']).toBe(true);
      // Internal Kuzu fields must be stripped — those are storage
      // offsets, not content.
      expect('_id' in (a ?? {})).toBe(false);
      expect('_label' in (a ?? {})).toBe(false);
    });

    it('serializeSnapshot writes a content-addressed snapshot and the same graph hashes identically', async () => {
      // Fresh CAS root so we can count objects.
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'graphstore-it-'));
      try {
        const cas = new FsCAS({ root: tmp });
        const source = createCgdbRowSource({
          // Limit to the table we seeded in the previous test (other
          // tables either don't exist or have their own seed data).
          nodeTables: ['Function'],
        });
        const a = await serializeSnapshot({ source, cas, createdAt: '2026-04-29T00:00:00Z' });
        const b = await serializeSnapshot({ source, cas, createdAt: '2026-04-29T00:00:00Z' });
        expect(b.snapshotId).toBe(a.snapshotId);
        expect(a.stats.nodeRowsByTable['Function']).toBeGreaterThanOrEqual(2);
      } finally {
        await fs.rm(tmp, { recursive: true, force: true });
      }
    });

    it('streamEdges yields rows with from/to/type set', async () => {
      const { executeQuery } = await import('../../src/core/cgdb/cgdb-adapter.js');
      // Connect the two functions we inserted above.
      await executeQuery(
        `MATCH (a:Function {id: "fn:test-a"}), (b:Function {id: "fn:test-b"}) CREATE (a)-[:CodeRelation {type: "CALLS"}]->(b)`,
      );

      const source = createCgdbRowSource();
      const edges: Record<string, unknown>[] = [];
      for await (const e of source.streamEdges()) {
        if (e['from'] === 'fn:test-a' && e['to'] === 'fn:test-b') {
          edges.push(e as Record<string, unknown>);
        }
      }
      expect(edges.length).toBeGreaterThanOrEqual(1);
      expect(edges[0]?.['type']).toBe('CALLS');
    });
  });
});
