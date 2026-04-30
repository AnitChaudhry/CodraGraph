# RFC 0001 — In-Graph Body Compression

| Status | Draft (review) |
|---|---|
| Tracks task | `[DESIGN] #9 — Compress source bodies stored in graph (migration-grade)` |
| Author | Anit Chaudhary |
| Created | 2026-04-30 |
| Owner | repository maintainers |

> Don't implement until this RFC is reviewed and accepted. Doing the
> work blind will break detect-changes / blame / diff for existing
> 1.6.x users — those flows hash row content, and changing the canonical
> stored form changes the hashes.

## 1. Problem

Symbol body text is currently stored verbatim in LadybugDB. For typical
TypeScript/Python repos, body strings dominate the on-disk index size:

- ~50–70% of `.codragraph/cgdb` bytes are body text (estimated; needs
  measurement, see §10).
- Every MCP consumer that calls `context({content: true})` or
  `query({include_content: true})` retrieves the raw bytes over stdio.

Goal: reduce on-disk size and MCP transport cost without breaking any of
the read paths that depend on body hashing or text equality.

## 2. Goals & non-goals

**Goals**
- Optional body compression at storage time (off by default until
  benchmarks justify a flip).
- Backward-compatible reads: existing 1.6.x indexes continue to work
  unchanged.
- Forward-compatible writes: 1.7.0+ readers can read both compressed
  and uncompressed bodies.
- Stable hashes: graphstore commits referencing compressed bodies must
  not be confused with commits referencing the same bodies uncompressed.

**Non-goals**
- Compressing other graph payloads (signatures, names, file paths).
  Bodies are the dominant cost; everything else is negligible.
- Lossy compression. Body text is the canonical source for blame,
  detect-changes hashing, and rename validation. Loss is unacceptable.
- Encrypting bodies. Out of scope; different RFC.

## 3. Proposal

Add a per-row body encoding field at the LadybugDB schema level:

```sql
-- Existing schema (fragment), simplified
CREATE NODE TABLE Function (
  id        STRING,
  name      STRING,
  filePath  STRING,
  startLine INT64,
  body      STRING,
  -- ... other props
  PRIMARY KEY (id)
);

-- Proposed addition (new column, defaults to 'none')
ALTER TABLE Function ADD COLUMN bodyEncoding STRING DEFAULT 'none';
```

Supported encodings:

| `bodyEncoding` | Format | When to use |
|---|---|---|
| `'none'` | Raw UTF-8 | Default for 1.6.x reads; new analyze with `--no-compress` |
| `'brotli'` | Brotli, level 6 | Best ratio for source code (~70% reduction); slower decompress |
| `'zstd'` | zstd level 3 | Best balance: ~60% reduction, ~3x faster decompress than brotli |

The `body` column stores either raw UTF-8 (`bodyEncoding='none'`) or
base64-encoded compressed bytes (`bodyEncoding='brotli'|'zstd'`). All
reads route through `cgdb-adapter` which transparently decompresses.

## 4. Read path

Every consumer that reads `body` calls `decompressBody(row)` which is a
no-op when `bodyEncoding === 'none'`. The decompression layer is
centralized in:

```
packages/core/src/core/cgdb/cgdb-adapter.ts
  → decompressBody(row: { body: string; bodyEncoding?: string }): string
```

Touch points (must be audited before shipping):
- `LocalBackend.context({content: true})`
- `LocalBackend.query({include_content: true})`
- `codragraph_rename` (textual fallback path)
- `recordAnalysisSnapshot` — bodies feed into row hashing
- `materializeSnapshot` — bodies are written back during checkout
- Wiki generator (`wiki.ts`)
- Skill generator (uses bodies via `pipelineResult`)

## 5. Write path

Two write paths:

1. **Normal analyze** — controlled by `--compress=<encoding>` CLI flag and
   `~/.codragraph/config.json#bodyEncoding`. Default for 1.7.x: `'none'`
   (parity with 1.6.x). Default flips to `'zstd'` in 1.8.x AFTER the
   benchmark passes (§10).
2. **Migration** — `codragraph compress --encoding zstd` walks the live
   LadybugDB once, re-encodes all body rows, updates `bodyEncoding`. Idempotent.

## 6. Hash & graphstore implications

Graphstore content-addressing is the painful part. Consider:

```
Commit A: body=raw "function foo(){}", bodyEncoding=none
Commit B: body=zstd-compressed bytes,    bodyEncoding=zstd
```

These represent the **same source code** but produce different row
hashes — so `detect_changes`, `blame`, and `diff` between A and B would
report spurious "modifications."

**Resolution:** row hashing must hash the LOGICAL content (decompressed
body), not the stored bytes. Implementation:

```ts
// packages/core/src/core/graphstore/row-hash.ts
function hashBodyRow(row: GraphRow): ObjectId {
  const logicalBody = decompressBody(row);
  const normalized = { ...row, body: logicalBody, bodyEncoding: undefined };
  return hashRow(normalized);
}
```

This must be applied EVERYWHERE rows are hashed — `recordAnalysisSnapshot`,
`diffSnapshots`, `diffSemantic`, `blame`, `materializeSnapshot`. The
single-source-of-truth helper avoids drift.

## 7. Migration plan

Phase 1 — **1.7.x: read both, write none.**
- Schema gains `bodyEncoding` column with `'none'` default.
- All readers handle compressed bodies via `decompressBody` shim.
- Writers stay on `'none'`.
- Hash helper is updated to normalize before hashing.
- Outcome: zero behavior change for users; infrastructure laid.

Phase 2 — **1.8.x: opt-in write.**
- `codragraph analyze --compress=zstd` writes compressed bodies.
- New CLI command `codragraph compress` for one-shot migration.
- Benchmarks published in CHANGELOG.

Phase 3 — **1.9.x or later: default flip.**
- Only after 1.8.x has been in the wild long enough to surface decode
  perf issues.
- Default `bodyEncoding` becomes `'zstd'` for new analyzes.
- `'none'` continues to be supported indefinitely (read path).

Phase 4 — **never: removal of `'none'` support.**
- Indefinitely supported. There's no good reason to break old indexes.

## 8. MCP consumer impact

Every MCP tool returns the body verbatim today. After this RFC:

- **Default** behavior is unchanged (bodies arrive as raw UTF-8 because
  they were stored uncompressed).
- For users who flipped to `--compress=zstd`, MCP responses are still
  raw text — decompression happens server-side in the MCP process,
  before the response is serialized. **Wire format does not change.**

This is the critical compatibility property: external MCP clients see
zero difference. Only on-disk size and MCP-server-internal memory change.

## 9. Risks

| Risk | Mitigation |
|---|---|
| Hash drift between compressed/uncompressed snapshots | Normalize bodies BEFORE hashing in a single helper, apply everywhere |
| Decompression latency on hot MCP paths | zstd level 3 — ~500MB/s on a single core, dominates DB read time only marginally; if hot, switch to mmap+lazy-decompress |
| LadybugDB schema migration breaks on existing indexes | Defaultable column addition is non-destructive; old indexes remain readable |
| `materializeSnapshot` writes back wrong encoding | Materialize ALWAYS writes `'none'` to keep the materialized DB simple; re-compress is a separate command |
| Tree-sitter buffer size assumes raw text | No interaction — bodies are stored AFTER parsing; tree-sitter operates on file contents directly |
| User flips `--compress` mid-incremental | Mixed-encoding rows in a single index. Must be supported (decompressBody handles it). Test case included in §11 |

## 10. Required benchmarks before phase 2 ships

Don't believe the "70% reduction" claim until measured. Required runs:

1. **Size reduction**
   - Index `codragraph` itself (4325 symbols) with `'none'`, `'brotli-6'`,
     `'zstd-3'`. Compare `.codragraph/cgdb` sizes.
   - Repeat on a 50k-LoC representative repo (e.g. open-source TypeScript
     project — consider a public Astro / Vite / Next.js codebase).
   - Repeat on a 500k-LoC monorepo (eval/SWE-bench fixture).

2. **Decompression latency** (on hot MCP paths)
   - 1000-iteration `query({include_content: true})` benchmarks per encoding.
   - Target: zstd within 10% of `'none'` p95; brotli within 30%.

3. **Hash stability**
   - Index a fixture with `'none'`, snapshot. Re-index with `'zstd-3'`,
     snapshot. Diff the snapshots.
   - **Required:** zero modifications surfaced (proves the hashing
     normalization is correct).

4. **Mixed-encoding read**
   - Index with `'none'`, then re-analyze a single file with `'zstd-3'`
     so the index has two encodings simultaneously.
   - Verify all read paths return correct text.

If any benchmark fails, do NOT ship phase 2. Either fix the underlying
issue or shelve the RFC.

## 11. Test plan

- Unit: `decompressBody`, `hashBodyRow` round-trip across encodings.
- Unit: `detectChanges` between same source compressed/uncompressed → no false positives.
- Integration: MCP `query({include_content: true})` returns identical text regardless of encoding.
- Integration: `codragraph compress` migration is idempotent.
- Integration: graphstore `diff` between mixed-encoding snapshots is empty.
- E2E: full `analyze → MCP query → diff → blame` cycle on a fixture, with
  encoding flip mid-cycle.

## 12. Open questions

- Should `--compress` accept `auto` (zstd if available, fall back to brotli)?
- Do we expose `bodyEncoding` in the Cypher result rows (so users can see what's happening)?
- For users who set `bodyEncoding=zstd` then go back to `'none'` — do we re-encode automatically on next analyze, or require the explicit migration command?

## 13. Decision needed from maintainers

1. Approve the schema change (additive column, default `'none'`).
2. Confirm phase 1 / 2 / 3 cadence.
3. Confirm the benchmarks in §10 are sufficient before phase 2.
4. Decide on `'brotli'` vs `'zstd'` vs both as supported encodings.

Once these are decided, implementation in `packages/core/src/core/cgdb/`
+ `packages/core/src/core/graphstore/row-hash.ts` is straightforward
(estimated 4-6 days end-to-end including benchmarks + migration command).
