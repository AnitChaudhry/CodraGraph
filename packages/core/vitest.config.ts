import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Shared settings — inherited by all projects via extends: true.
    //
    // NOTE: `globalSetup: ['test/global-setup.ts']` USED to live here, but it
    // opens a LadybugDB native binding before any test runs — which segfaults
    // the worker process on Windows + Git Bash and then hangs the whole
    // `vitest run` invocation with no error output. Unit tests don't need a
    // pre-warmed cgdb; only the `cgdb-db` integration project does. The hook
    // is now scoped to that project below — keeps integration coverage intact
    // while unblocking the entire unit suite on Windows.
    testTimeout: 30000,
    hookTimeout: 120000,
    pool: 'forks',
    globals: true,
    teardownTimeout: 3000,
    // N-API destructors can crash worker forks on macOS during process exit.
    // This is independent of the QueryResult lifetime fix in @ladybugdb/core 0.15.2 —
    // it's a vitest forks + native addon interaction where destructors run in
    // arbitrary order at exit. Tests themselves pass; only the exit crashes.
    // TODO: remove once LadybugDB fixes all N-API destructor ordering issues.
    dangerouslyIgnoreUnhandledErrors: true,

    // Coverage stays at root (not supported in project configs)
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/cli/index.ts', // CLI entry point (commander wiring)
        'src/server/**', // HTTP server (requires network)
        'src/core/wiki/**', // Wiki generation (requires LLM)
      ],
      // Auto-ratchet: vitest bumps thresholds when coverage exceeds them.
      // CI will fail if a PR drops below these floors.
      thresholds: {
        statements: 26,
        branches: 23,
        functions: 28,
        lines: 27,
      },
    },

    // LadybugDB's native mmap addon causes file-lock conflicts when vitest
    // runs cgdb test files in parallel forks on Windows.  The 'cgdb-db'
    // project forces sequential execution (fileParallelism: false).
    //
    // Each file runs in its own fork — the fork exits after the file
    // completes, triggering an N-API destructor segfault that is caught
    // by dangerouslyIgnoreUnhandledErrors.  Tests themselves pass; only
    // the exit crashes.  This is safer than isolate: false, which causes
    // native state corruption after 2-3 open/close cycles in the same fork.
    projects: [
      {
        extends: true,
        test: {
          name: 'cgdb-db',
          // Pre-warm a shared LadybugDB once for these tests. Native bindings
          // can't be opened pre-test on Windows + Git Bash without segfaulting
          // (see top-level note), so this hook is scoped to the integration
          // suite that actually consumes it via inject('cgdbDbPath').
          globalSetup: ['test/global-setup.ts'],
          include: [
            'test/integration/cgdb-core-adapter.test.ts',
            'test/integration/cgdb-pool.test.ts',
            'test/integration/cgdb-pool-stability.test.ts',
            'test/integration/local-backend.test.ts',
            'test/integration/local-backend-calltool.test.ts',
            'test/integration/search-core.test.ts',
            'test/integration/search-pool.test.ts',
            'test/integration/augmentation.test.ts',
            'test/integration/staleness-and-stability.test.ts',
            'test/integration/cgdb-lock-retry.test.ts',
            'test/integration/api-impact-e2e.test.ts',
            'test/integration/shape-check-regression.test.ts',
          ],
          fileParallelism: false,
          sequence: { groupOrder: 1 },
        },
      },
      {
        extends: true,
        test: {
          name: 'default',
          sequence: { groupOrder: 2 },
          include: ['test/**/*.test.ts'],
          exclude: [
            'test/integration/cgdb-core-adapter.test.ts',
            'test/integration/cgdb-pool.test.ts',
            'test/integration/cgdb-pool-stability.test.ts',
            'test/integration/local-backend.test.ts',
            'test/integration/local-backend-calltool.test.ts',
            'test/integration/search-core.test.ts',
            'test/integration/search-pool.test.ts',
            'test/integration/augmentation.test.ts',
            'test/integration/staleness-and-stability.test.ts',
            'test/integration/cgdb-lock-retry.test.ts',
            'test/integration/cgdb-lock-retry.test.ts',
            'test/integration/api-impact-e2e.test.ts',
            'test/integration/shape-check-regression.test.ts',
          ],
        },
      },
    ],
  },
});
