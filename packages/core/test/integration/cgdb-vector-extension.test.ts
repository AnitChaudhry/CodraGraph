/**
 * Integration Tests: Vector extension loading and state reset
 *
 * Tests: loadVectorExtension idempotency, vectorExtensionLoaded reset
 * on closeCgdb and busy-retry cleanup paths.
 *
 * Follows existing cgdb integration test patterns (cgdb-core-adapter,
 * cgdb-lock-retry).
 */
import { describe, it, expect } from 'vitest';
import { withTestCgdbDB } from '../helpers/test-indexed-db.js';

withTestCgdbDB('vector-extension', (handle) => {
  describe('loadVectorExtension', () => {
    it('loads the VECTOR extension without error', async () => {
      const { loadVectorExtension } = await import('../../src/core/cgdb/cgdb-adapter.js');

      // Should resolve without throwing -- idempotent if already loaded by doInitCgdb
      await expect(loadVectorExtension()).resolves.toBeUndefined();
    });

    it('is idempotent -- calling twice does not throw', async () => {
      const { loadVectorExtension } = await import('../../src/core/cgdb/cgdb-adapter.js');

      await loadVectorExtension();
      await expect(loadVectorExtension()).resolves.toBeUndefined();
    });
  });

  describe('vectorExtensionLoaded reset on closeCgdb', () => {
    it('re-initializes vector extension after close + re-init cycle', async () => {
      const adapter = await import('../../src/core/cgdb/cgdb-adapter.js');

      // Ensure vector extension is loaded
      await adapter.loadVectorExtension();

      // Close the adapter -- should reset vectorExtensionLoaded
      await adapter.closeCgdb();
      expect(adapter.isCgdbReady()).toBe(false);

      // Re-initialize -- doInitCgdb calls loadVectorExtension internally
      await adapter.initCgdb(handle.dbPath);
      expect(adapter.isCgdbReady()).toBe(true);

      // loadVectorExtension should succeed (not skip due to stale flag)
      await expect(adapter.loadVectorExtension()).resolves.toBeUndefined();
    });
  });

  describe('vectorExtensionLoaded reset on busy-retry cleanup', () => {
    it('withCgdbDb resets vectorExtensionLoaded on BUSY retry', async () => {
      const adapter = await import('../../src/core/cgdb/cgdb-adapter.js');

      // Ensure vector extension is loaded
      await adapter.loadVectorExtension();

      // Simulate a BUSY error on first attempt, success on second.
      // The retry path should reset vectorExtensionLoaded so the
      // re-initialized DB gets a fresh extension load.
      let callCount = 0;
      const result = await adapter.withCgdbDb(handle.dbPath, async () => {
        callCount++;
        if (callCount === 1) throw new Error('database is BUSY');
        return 'recovered';
      });

      expect(result).toBe('recovered');
      expect(callCount).toBe(2);

      // After recovery, vector extension should still be loadable
      // (the flag was reset and re-loaded during re-init)
      await expect(adapter.loadVectorExtension()).resolves.toBeUndefined();
    });
  });
});
