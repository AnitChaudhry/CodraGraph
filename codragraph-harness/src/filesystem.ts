// Filesystem 𝒟 — persistent, append-only store of every harness candidate.
//
// Layout per candidate:
//   candidates/
//   └── <id>/                       # e.g. "000_zero-shot", "003_proposer-001_graph-aware-v2"
//       ├── source/                 # TS source files implementing the Harness contract
//       │   ├── index.ts            # required: default export (or named "harness") of type Harness
//       │   └── ...                 # optional helper files
//       ├── traces/                 # one JSON file per evaluated task
//       │   ├── <taskId>.json       # full per-step trace record
//       │   └── ...
//       ├── score.json              # aggregate Scores after evaluator runs
//       ├── metadata.json           # CandidateMetadata
//       └── rationale.md            # proposer's natural-language explanation (origin = proposer)
//
// The proposer reads this directory tree directly (paper's pattern: median
// 82 files read per iteration). Nothing in here is hidden or schema-locked
// beyond what's documented above.

import { promises as fs } from "node:fs";
import path from "node:path";
import type { HarnessOrigin } from "./harness/interface.js";
import type { SourceFile } from "./proposer/interface.js";
import type { Scores } from "./evaluator/score.js";

/** Information returned when listing the store. */
export interface CandidateSummary {
  id: string;
  name: string;
  version: string;
  origin: HarnessOrigin;
  hasScore: boolean;
  createdAt: string;
}

/** Full metadata.json shape. */
export interface CandidateMetadata {
  id: string;
  name: string;
  version: string;
  origin: HarnessOrigin;
  parents?: string[];
  createdAt: string;
}

/** A single trace record, one per evaluated task. */
export interface TraceRecord {
  taskId: string;
  steps: Array<{ name: string; payload: Record<string, unknown>; t: number }>;
  startedAt: string;
  finishedAt: string;
}

/**
 * Append-only candidate store at a fixed root path. All writes are atomic
 * within a single candidate directory; the proposer can read at any time
 * without locking because we never mutate existing files (only add new ones).
 */
export class CandidateStore {
  constructor(public readonly rootPath: string) {}

  /** Initialize the store directory. Idempotent. */
  async init(): Promise<void> {
    await fs.mkdir(this.rootPath, { recursive: true });
  }

  /**
   * Add a new candidate. Returns the assigned id (zero-padded sequential).
   * The id format is `NNN_<name>` so the directory listing is human-readable
   * and sortable by insertion order.
   */
  async addCandidate(input: {
    name: string;
    version: string;
    origin: HarnessOrigin;
    files: SourceFile[];
    parents?: string[];
    rationale?: string;
  }): Promise<string> {
    const seq = await this.nextSequence();
    const safe = input.name.replace(/[^a-zA-Z0-9_-]/g, "-");
    const id = `${seq.toString().padStart(3, "0")}_${safe}`;
    const dir = path.join(this.rootPath, id);

    await fs.mkdir(path.join(dir, "source"), { recursive: true });
    await fs.mkdir(path.join(dir, "traces"), { recursive: true });

    for (const file of input.files) {
      const target = path.join(dir, "source", file.path);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, file.content, "utf8");
    }

    const metadata: CandidateMetadata = {
      id,
      name: input.name,
      version: input.version,
      origin: input.origin,
      parents: input.parents,
      createdAt: new Date().toISOString(),
    };
    await fs.writeFile(
      path.join(dir, "metadata.json"),
      JSON.stringify(metadata, null, 2),
      "utf8",
    );

    if (input.rationale) {
      await fs.writeFile(path.join(dir, "rationale.md"), input.rationale, "utf8");
    }

    return id;
  }

  /** Write the per-task trace JSON. Called by the evaluator. */
  async addTrace(id: string, trace: TraceRecord): Promise<void> {
    const target = path.join(this.rootPath, id, "traces", `${trace.taskId}.json`);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, JSON.stringify(trace, null, 2), "utf8");
  }

  /** Write the aggregate score.json. Overwritable: re-evaluation produces a new score. */
  async addScore(id: string, scores: Scores): Promise<void> {
    const target = path.join(this.rootPath, id, "score.json");
    await fs.writeFile(target, JSON.stringify(scores, null, 2), "utf8");
  }

  /** List every candidate in insertion order. */
  async listCandidates(): Promise<CandidateSummary[]> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.rootPath);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
    entries.sort();
    const out: CandidateSummary[] = [];
    for (const entry of entries) {
      const meta = await this.readMetadata(entry).catch(() => null);
      if (!meta) continue;
      const hasScore = await this.exists(path.join(this.rootPath, entry, "score.json"));
      out.push({
        id: meta.id,
        name: meta.name,
        version: meta.version,
        origin: meta.origin,
        hasScore,
        createdAt: meta.createdAt,
      });
    }
    return out;
  }

  async readMetadata(id: string): Promise<CandidateMetadata> {
    const raw = await fs.readFile(path.join(this.rootPath, id, "metadata.json"), "utf8");
    return JSON.parse(raw) as CandidateMetadata;
  }

  async readScore(id: string): Promise<Scores | null> {
    try {
      const raw = await fs.readFile(path.join(this.rootPath, id, "score.json"), "utf8");
      return JSON.parse(raw) as Scores;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async readSource(id: string): Promise<SourceFile[]> {
    const sourceDir = path.join(this.rootPath, id, "source");
    return await this.readDirRecursive(sourceDir, sourceDir);
  }

  async readTraces(id: string): Promise<TraceRecord[]> {
    const tracesDir = path.join(this.rootPath, id, "traces");
    let files: string[];
    try {
      files = await fs.readdir(tracesDir);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
    const out: TraceRecord[] = [];
    for (const f of files.sort()) {
      if (!f.endsWith(".json")) continue;
      const raw = await fs.readFile(path.join(tracesDir, f), "utf8");
      out.push(JSON.parse(raw) as TraceRecord);
    }
    return out;
  }

  /** Absolute path to the candidate's directory — useful for the proposer subprocess. */
  candidateDir(id: string): string {
    return path.join(this.rootPath, id);
  }

  // -- internals -------------------------------------------------------------

  private async nextSequence(): Promise<number> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.rootPath);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return 0;
      throw err;
    }
    let max = -1;
    for (const e of entries) {
      const m = /^(\d+)_/.exec(e);
      if (m && m[1]) {
        const n = parseInt(m[1], 10);
        if (n > max) max = n;
      }
    }
    return max + 1;
  }

  private async exists(p: string): Promise<boolean> {
    try {
      await fs.access(p);
      return true;
    } catch {
      return false;
    }
  }

  private async readDirRecursive(dir: string, base: string): Promise<SourceFile[]> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
    const out: SourceFile[] = [];
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        out.push(...(await this.readDirRecursive(full, base)));
      } else if (entry.isFile()) {
        const content = await fs.readFile(full, "utf8");
        out.push({ path: path.relative(base, full).replace(/\\/g, "/"), content });
      }
    }
    return out;
  }
}
