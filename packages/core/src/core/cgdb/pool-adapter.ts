/**
 * LadybugDB connection pool (core). Used by MCP, sync, search, wiki, etc.
 *
 * LadybugDB Adapter (Connection Pool)
 *
 * Manages a pool of LadybugDB databases keyed by repoId, each with
 * multiple Connection objects for safe concurrent query execution.
 *
 * LadybugDB Connections are NOT thread-safe — a single Connection
 * segfaults if concurrent .query() calls hit it simultaneously.
 * This adapter provides a checkout/return connection pool so each
 * concurrent query gets its own Connection from the same Database.
 *
 * @see https://docs.ladybugdb.com/concurrency — multiple Connections
 * from the same Database is the officially supported concurrency pattern.
 */

import fs from 'fs/promises';
import cgdb from '@ladybugdb/core';

/** Per-repo pool: one Database, many Connections */
interface PoolEntry {
  db: cgdb.Database;
  /** Available connections ready for checkout */
  available: cgdb.Connection[];
  /** Number of connections currently checked out */
  checkedOut: number;
  /** Queued waiters for when all connections are busy */
  waiters: Array<(conn: cgdb.Connection) => void>;
  lastUsed: number;
  dbPath: string;
  /** Set to true when the pool entry is closed — checkin will close orphaned connections */
  closed: boolean;
}

const pool = new Map<string, PoolEntry>();

/**
 * Listeners notified when a pool entry is torn down (LRU eviction, idle
 * timeout, explicit close). Used by upper layers (e.g. the BM25 search
 * module) to invalidate per-repo caches that must not outlive the pool
 * entry that produced them.
 *
 * Listeners run synchronously inside `closeOne` after the pool entry has
 * been removed; throwing listeners are isolated so one bad listener does
 * not prevent others from firing or break teardown.
 */
type PoolCloseListener = (repoId: string) => void;
const poolCloseListeners = new Set<PoolCloseListener>();

/**
 * Subscribe to pool-close events. Returns a disposer that removes the
 * listener (handy for tests).
 */
export function addPoolCloseListener(listener: PoolCloseListener): () => void {
  poolCloseListeners.add(listener);
  return () => {
    poolCloseListeners.delete(listener);
  };
}

/**
 * Shared Database cache keyed by resolved dbPath.
 * Multiple repoIds pointing to the same path share one native Database
 * object to avoid exhausting the buffer manager's mmap budget.
 */
interface SharedDB {
  db: cgdb.Database;
  refCount: number;
  ftsLoaded: boolean;
  vectorLoaded: boolean;
  /** When true, closeOne skips db.close() — the Database is owned externally. */
  external?: boolean;
}
const dbCache = new Map<string, SharedDB>();

/** Max repos in the pool (LRU eviction) */
const MAX_POOL_SIZE = 5;
/** Idle timeout before closing a repo's connections */
const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
/** Max connections per repo (caps concurrent queries per repo) */
const MAX_CONNS_PER_REPO = 8;

let idleTimer: ReturnType<typeof setInterval> | null = null;

/** Saved real stdout/stderr write — used to silence native module output without race conditions */
export const realStdoutWrite = process.stdout.write.bind(process.stdout);
export const realStderrWrite = process.stderr.write.bind(process.stderr);
let stdoutSilenceCount = 0;
/** True while pre-warming connections — prevents watchdog from prematurely restoring stdout */
let preWarmActive = false;

/**
 * Start the idle cleanup timer (runs every 60s)
 */
function ensureIdleTimer(): void {
  if (idleTimer) return;
  idleTimer = setInterval(() => {
    const now = Date.now();
    for (const [repoId, entry] of pool) {
      if (now - entry.lastUsed > IDLE_TIMEOUT_MS && entry.checkedOut === 0) {
        closeOne(repoId);
      }
    }
  }, 60_000);
  if (idleTimer && typeof idleTimer === 'object' && 'unref' in idleTimer) {
    (idleTimer as NodeJS.Timeout).unref();
  }
}

/**
 * Touch a repo to reset its idle timeout.
 * Call this during long-running operations to prevent the connection from being closed.
 */
export const touchRepo = (repoId: string): void => {
  const entry = pool.get(repoId);
  if (entry) {
    entry.lastUsed = Date.now();
  }
};

/**
 * Evict the least-recently-used repo if pool is at capacity
 */
function evictLRU(): void {
  if (pool.size < MAX_POOL_SIZE) return;

  let oldestId: string | null = null;
  let oldestTime = Infinity;
  for (const [id, entry] of pool) {
    if (entry.checkedOut === 0 && entry.lastUsed < oldestTime) {
      oldestTime = entry.lastUsed;
      oldestId = id;
    }
  }
  if (oldestId) {
    closeOne(oldestId);
  }
}

/**
 * Remove a repo from the pool, close its connections, and release its
 * shared Database ref.  Only closes the Database when no other repoIds
 * reference it (refCount === 0).
 */
function closeOne(repoId: string): void {
  const entry = pool.get(repoId);
  if (!entry) return;

  entry.closed = true;

  // Close available connections — fire-and-forget with .catch() to prevent
  // unhandled rejections.  Native close() returns Promise<void> but can crash
  // the N-API destructor on macOS/Windows; deferring to process exit lets
  // dangerouslyIgnoreUnhandledErrors absorb the crash.
  for (const conn of entry.available) {
    conn.close().catch(() => {});
  }
  entry.available.length = 0;

  // Checked-out connections can't be closed here — they're in-flight.
  // The checkin() function detects entry.closed and closes them on return.

  // Only close the Database when no other repoIds reference it.
  // External databases (injected via initCgdbWithDb) are never closed here —
  // the core adapter owns them and handles their lifecycle.
  const shared = dbCache.get(entry.dbPath);
  if (shared) {
    shared.refCount--;
    if (shared.refCount === 0) {
      if (shared.external) {
        // External databases are owned by the core adapter — don't close
        // or remove from cache.  Keep the entry so future initCgdb() calls
        // for the same dbPath reuse it instead of hitting a file lock.
        shared.refCount = 0;
        shared.ftsLoaded = false;
        shared.vectorLoaded = false;
      } else {
        shared.db.close().catch(() => {});
        dbCache.delete(entry.dbPath);
      }
    }
  }

  pool.delete(repoId);

  // Notify listeners AFTER the pool entry is gone so any cache-invalidation
  // they perform is consistent with `isCgdbReady(repoId) === false`.
  for (const listener of poolCloseListeners) {
    try {
      listener(repoId);
    } catch {
      // Isolate listener failures — teardown must complete.
    }
  }
}

/**
 * Create a new Connection from a repo's Database.
 * Silences stdout to prevent native module output from corrupting MCP stdio.
 */
let activeQueryCount = 0;

/**
 * Silence stdout by replacing process.stdout.write with a no-op.
 * Uses a reference counter so nested silence/restore pairs are safe.
 * Exported so other modules (e.g. embedder) use the same mechanism instead
 * of independently patching stdout, which causes restore-order conflicts.
 */
export function silenceStdout(): void {
  if (stdoutSilenceCount++ === 0) {
    process.stdout.write = (() => true) as any;
  }
}

export function restoreStdout(): void {
  if (--stdoutSilenceCount <= 0) {
    stdoutSilenceCount = 0;
    process.stdout.write = realStdoutWrite;
  }
}

// Safety watchdog: restore stdout if it gets stuck silenced (e.g. native crash
// inside createConnection before restoreStdout runs).
// Exempts active queries and pre-warm — these legitimately hold silence for
// longer than 1 second (queries can take up to QUERY_TIMEOUT_MS = 30s).
setInterval(() => {
  if (stdoutSilenceCount > 0 && !preWarmActive && activeQueryCount === 0) {
    stdoutSilenceCount = 0;
    process.stdout.write = realStdoutWrite;
  }
}, 1000).unref();

function createConnection(db: cgdb.Database): cgdb.Connection {
  silenceStdout();
  try {
    return new cgdb.Connection(db);
  } finally {
    restoreStdout();
  }
}

/** Query timeout in milliseconds */
const QUERY_TIMEOUT_MS = 30_000;
/** Waiter queue timeout in milliseconds */
const WAITER_TIMEOUT_MS = 15_000;

const LOCK_RETRY_ATTEMPTS = 3;
const LOCK_RETRY_DELAY_MS = 2000;

/** Deduplicates concurrent initCgdb calls for the same repoId */
const initPromises = new Map<string, Promise<void>>();

/**
 * Initialize (or reuse) a Database + connection pool for a specific repo.
 * Retries on lock errors (e.g., when `codragraph analyze` is running).
 *
 * Concurrent calls for the same repoId are deduplicated — the second caller
 * awaits the first's in-progress init rather than starting a redundant one.
 */
export const initCgdb = async (repoId: string, dbPath: string): Promise<void> => {
  const existing = pool.get(repoId);
  if (existing) {
    existing.lastUsed = Date.now();
    return;
  }

  // Deduplicate concurrent init calls for the same repoId —
  // prevents double-init race when multiple parallel tool calls
  // trigger initialization for the same repo simultaneously.
  const pending = initPromises.get(repoId);
  if (pending) return pending;

  const promise = doInitCgdb(repoId, dbPath);
  initPromises.set(repoId, promise);
  try {
    await promise;
  } finally {
    initPromises.delete(repoId);
  }
};

/**
 * Internal init — creates DB, pre-warms connections, loads FTS, then registers pool.
 * Pool entry is registered LAST so concurrent executeQuery calls see either
 * "not initialized" (and throw) or a fully ready pool — never a half-built one.
 */
async function doInitCgdb(repoId: string, dbPath: string): Promise<void> {
  // Check if database exists
  try {
    await fs.stat(dbPath);
  } catch {
    throw new Error(`LadybugDB not found at ${dbPath}. Run: codragraph analyze`);
  }

  evictLRU();

  // Reuse an existing native Database if another repoId already opened this path.
  // This prevents buffer manager exhaustion from multiple mmap regions on the same file.
  let shared = dbCache.get(dbPath);
  if (!shared) {
    // Open in read-only mode — MCP server never writes to the database.
    // This allows multiple MCP server instances to read concurrently, and
    // avoids lock conflicts when `codragraph analyze` is writing.
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= LOCK_RETRY_ATTEMPTS; attempt++) {
      silenceStdout();
      try {
        const db = new cgdb.Database(
          dbPath,
          0, // bufferManagerSize (default)
          false, // enableCompression (default)
          true, // readOnly
        );
        restoreStdout();
        shared = { db, refCount: 0, ftsLoaded: false, vectorLoaded: false };
        dbCache.set(dbPath, shared);
        break;
      } catch (err: any) {
        restoreStdout();
        lastError = err instanceof Error ? err : new Error(String(err));
        const isLockError =
          lastError.message.includes('Could not set lock') || lastError.message.includes('lock');
        if (!isLockError || attempt === LOCK_RETRY_ATTEMPTS) break;
        await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_DELAY_MS * attempt));
      }
    }

    if (!shared) {
      throw new Error(
        `LadybugDB unavailable for ${repoId}. Another process may be rebuilding the index. ` +
          `Retry later. (${lastError?.message || 'unknown error'})`,
      );
    }
  }

  shared.refCount++;
  const db = shared.db;

  // Pre-create the full pool upfront so createConnection() (which silences
  // stdout) is never called lazily during active query execution.
  // Mark preWarmActive so the watchdog timer doesn't interfere.
  preWarmActive = true;
  const available: cgdb.Connection[] = [];
  try {
    for (let i = 0; i < MAX_CONNS_PER_REPO; i++) {
      available.push(createConnection(db));
    }
  } finally {
    preWarmActive = false;
  }

  // Load FTS + VECTOR extensions on EVERY connection in the pool.
  //
  // CRITICAL: LadybugDB's extension state is per-connection on macOS (and
  // possibly other platforms) — loading on `available[0]` does NOT propagate
  // to the other connections. Since checkout pops from the end of the array,
  // queries would otherwise hit unloaded connections and `QUERY_FTS_INDEX`
  // would silently return 0 rows (catch in queryFTSViaExecutor swallows the
  // "extension not loaded" error). That broke every search on macOS.
  //
  // Load on all connections concurrently, but BEFORE the pool is registered
  // so no checkout can race the load.
  await loadExtensionsOnConnections(available, shared);

  // Register pool entry only after all connections are pre-warmed and FTS is
  // loaded.  Concurrent executeQuery calls see either "not initialized"
  // (and throw cleanly) or a fully ready pool — never a half-built one.
  pool.set(repoId, {
    db,
    available,
    checkedOut: 0,
    waiters: [],
    lastUsed: Date.now(),
    dbPath,
    closed: false,
  });
  ensureIdleTimer();
}

/**
 * Load FTS + VECTOR extensions on every connection in the pool.
 * Per-connection load is required because LadybugDB's extension state is
 * not always shared across connections of the same Database (observed on
 * macOS native bindings — silent FTS failures otherwise).
 */
async function loadExtensionsOnConnections(
  conns: cgdb.Connection[],
  shared: { ftsLoaded: boolean; vectorLoaded: boolean },
): Promise<void> {
  // FTS: every connection needs `LOAD EXTENSION fts` independently.
  await Promise.all(
    conns.map(async (c) => {
      try {
        await c.query('LOAD EXTENSION fts');
      } catch {
        // already-loaded / not-installed — FTS queries fail gracefully if missing
      }
    }),
  );
  shared.ftsLoaded = true;

  // VECTOR: install once on the Database (idempotent), then LOAD on every
  // connection. INSTALL is a no-op after the first call but we run it on
  // conn[0] to guarantee the package is present before fanning out LOADs.
  try {
    await conns[0].query('INSTALL VECTOR');
  } catch {
    /* not available — semantic search will be a no-op */
  }
  await Promise.all(
    conns.map(async (c) => {
      try {
        await c.query('LOAD EXTENSION VECTOR');
      } catch {
        /* not available — semantic search will be a no-op */
      }
    }),
  );
  shared.vectorLoaded = true;
}

/**
 * Initialize a pool entry from a pre-existing Database object.
 *
 * Used in tests to avoid the writable→close→read-only cycle that crashes
 * on macOS due to N-API destructor segfaults.  The pool adapter reuses
 * the core adapter's writable Database instead of opening a new read-only one.
 *
 * The Database is registered in the shared dbCache so closeOne() decrements
 * the refCount correctly.  If the Database is already cached (e.g. another
 * repoId already injected it), the existing entry is reused.
 */
export async function initCgdbWithDb(
  repoId: string,
  existingDb: cgdb.Database,
  dbPath: string,
): Promise<void> {
  const existing = pool.get(repoId);
  if (existing) {
    existing.lastUsed = Date.now();
    return;
  }

  // Register in dbCache with external: true so other initCgdb() calls
  // for the same dbPath reuse this Database instead of trying to open
  // a new one (which would fail with a file lock error).
  // closeOne() respects the external flag and skips db.close().
  let shared = dbCache.get(dbPath);
  if (!shared) {
    shared = { db: existingDb, refCount: 0, ftsLoaded: false, vectorLoaded: false, external: true };
    dbCache.set(dbPath, shared);
  }
  shared.refCount++;

  const available: cgdb.Connection[] = [];
  preWarmActive = true;
  try {
    for (let i = 0; i < MAX_CONNS_PER_REPO; i++) {
      available.push(createConnection(existingDb));
    }
  } finally {
    preWarmActive = false;
  }

  // Load FTS + VECTOR on every connection (see loadExtensionsOnConnections
  // for why per-connection load is required on macOS native bindings).
  await loadExtensionsOnConnections(available, shared);

  pool.set(repoId, {
    db: existingDb,
    available,
    checkedOut: 0,
    waiters: [],
    lastUsed: Date.now(),
    dbPath,
    closed: false,
  });
  ensureIdleTimer();
}

/**
 * Checkout a connection from the pool.
 * Returns an available connection, or creates a new one if under the cap.
 * If all connections are busy and at cap, queues the caller until one is returned.
 */
function checkout(entry: PoolEntry): Promise<cgdb.Connection> {
  // Fast path: grab an available connection
  if (entry.available.length > 0) {
    entry.checkedOut++;
    return Promise.resolve(entry.available.pop()!);
  }

  // Pool was pre-warmed to MAX_CONNS_PER_REPO during init.  If we're here
  // with fewer total connections, something leaked — surface the bug rather
  // than silently creating a connection (which would silence stdout mid-query).
  const totalConns = entry.available.length + entry.checkedOut;
  if (totalConns < MAX_CONNS_PER_REPO) {
    throw new Error(
      `Connection pool integrity error: expected ${MAX_CONNS_PER_REPO} ` +
        `connections but found ${totalConns} (${entry.available.length} available, ` +
        `${entry.checkedOut} checked out)`,
    );
  }

  // At capacity — queue the caller with a timeout.
  return new Promise<cgdb.Connection>((resolve, reject) => {
    const waiter = (conn: cgdb.Connection) => {
      clearTimeout(timer);
      resolve(conn);
    };
    const timer = setTimeout(() => {
      const idx = entry.waiters.indexOf(waiter);
      if (idx !== -1) entry.waiters.splice(idx, 1);
      reject(
        new Error(
          `Connection pool exhausted: timed out after ${WAITER_TIMEOUT_MS}ms waiting for a free connection`,
        ),
      );
    }, WAITER_TIMEOUT_MS);
    entry.waiters.push(waiter);
  });
}

/**
 * Return a connection to the pool after use.
 * If the pool entry was closed while the connection was checked out (e.g.
 * LRU eviction), close the orphaned connection instead of returning it.
 * If there are queued waiters, hand the connection directly to the next one
 * instead of putting it back in the available array (avoids race conditions).
 */
function checkin(entry: PoolEntry, conn: cgdb.Connection): void {
  if (entry.closed) {
    // Pool entry was deleted during checkout — close the orphaned connection
    conn.close().catch(() => {});
    return;
  }
  if (entry.waiters.length > 0) {
    // Hand directly to the next waiter — no intermediate available state
    const waiter = entry.waiters.shift()!;
    waiter(conn);
  } else {
    entry.checkedOut--;
    entry.available.push(conn);
  }
}

/**
 * Execute a query on a specific repo's connection pool.
 * Automatically checks out a connection, runs the query, and returns it.
 */
/** Race a promise against a timeout */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export const executeQuery = async (repoId: string, cypher: string): Promise<any[]> => {
  const entry = pool.get(repoId);
  if (!entry) {
    throw new Error(`LadybugDB not initialized for repo "${repoId}". Call initCgdb first.`);
  }

  if (isWriteQuery(cypher)) {
    throw new Error('Write operations are not allowed. The pool adapter is read-only.');
  }

  entry.lastUsed = Date.now();

  const conn = await checkout(entry);
  silenceStdout();
  activeQueryCount++;
  try {
    const queryResult = await withTimeout(conn.query(cypher), QUERY_TIMEOUT_MS, 'Query');
    const result = Array.isArray(queryResult) ? queryResult[0] : queryResult;
    const rows = await result.getAll();
    return rows;
  } finally {
    activeQueryCount--;
    restoreStdout();
    checkin(entry, conn);
  }
};

/**
 * Execute a parameterized query on a specific repo's connection pool.
 * Uses prepare/execute pattern to prevent Cypher injection.
 */
export const executeParameterized = async (
  repoId: string,
  cypher: string,
  params: Record<string, any>,
): Promise<any[]> => {
  const entry = pool.get(repoId);
  if (!entry) {
    throw new Error(`LadybugDB not initialized for repo "${repoId}". Call initCgdb first.`);
  }

  entry.lastUsed = Date.now();

  const conn = await checkout(entry);
  silenceStdout();
  activeQueryCount++;
  try {
    const stmt = await withTimeout(conn.prepare(cypher), QUERY_TIMEOUT_MS, 'Prepare');
    if (!stmt.isSuccess()) {
      const errMsg = await stmt.getErrorMessage();
      throw new Error(`Prepare failed: ${errMsg}`);
    }
    const queryResult = await withTimeout(conn.execute(stmt, params), QUERY_TIMEOUT_MS, 'Execute');
    const result = Array.isArray(queryResult) ? queryResult[0] : queryResult;
    const rows = await result.getAll();
    return rows;
  } finally {
    activeQueryCount--;
    restoreStdout();
    checkin(entry, conn);
  }
};

/**
 * Close one or all repo pools.
 * If repoId is provided, close only that repo's connections.
 * If omitted, close all repos.
 */
export const closeCgdb = async (repoId?: string): Promise<void> => {
  if (repoId) {
    closeOne(repoId);
    return;
  }

  for (const id of [...pool.keys()]) {
    closeOne(id);
  }

  if (idleTimer) {
    clearInterval(idleTimer);
    idleTimer = null;
  }
};

/**
 * Check if a specific repo's pool is active
 */
export const isCgdbReady = (repoId: string): boolean => pool.has(repoId);

/** Regex to detect write operations in user-supplied Cypher queries.
 * Note: CALL is NOT blocked — it's used for read-only FTS (CALL QUERY_FTS_INDEX)
 * and vector search (CALL QUERY_VECTOR_INDEX). The database is opened in
 * read-only mode as defense-in-depth against write procedures. */
export const CYPHER_WRITE_RE =
  /(?<!:)\b(CREATE|DELETE|SET|MERGE|REMOVE|DROP|ALTER|COPY|DETACH|FOREACH|INSTALL|LOAD)\b/i;

/** Check if a Cypher query contains write operations */
export function isWriteQuery(query: string): boolean {
  return CYPHER_WRITE_RE.test(query);
}
