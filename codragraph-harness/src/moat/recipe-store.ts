import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { Recipe } from "./types.js";

/**
 * Persistent store for harness recipes.
 *
 * Implementations MUST guarantee:
 *   - put(recipe) is idempotent — writing the same canonical content
 *     produces the same recipe id and is a no-op the second time.
 *   - findExact / findByFamily are consistent with put — anything
 *     successfully put is discoverable until explicitly deleted.
 *   - The on-disk layout is human-readable so users can inspect /
 *     diff recipes directly, the same way they can inspect candidates.
 */
export interface RecipeStore {
  /** Persist a recipe; returns the stored Recipe (with its assigned id). */
  put(recipe: RecipeInput): Promise<Recipe>;

  /** Read a recipe by id, or null if not present. */
  get(id: string): Promise<Recipe | null>;

  /** All recipes, optionally filtered. Order: newest first. */
  list(filter?: RecipeListFilter): Promise<Recipe[]>;

  /** Find recipes that exactly match a (snapshotId, taskFamily) pair. */
  findExact(snapshotId: string, taskFamily: string): Promise<Recipe[]>;

  /** Find every recipe for a task family across snapshots. */
  findByFamily(taskFamily: string): Promise<Recipe[]>;

  /** Remove a recipe. Idempotent on missing ids. Returns true if removed. */
  delete(id: string): Promise<boolean>;
}

export interface RecipeInput extends Omit<Recipe, "id"> {
  /** When omitted, the store derives a sha256 id from the canonical content. */
  readonly id?: string;
}

export interface RecipeListFilter {
  readonly snapshotId?: string;
  readonly taskFamily?: string;
}

// ──────────────────────────────────────────────────────────────────────
// FsRecipeStore
// ──────────────────────────────────────────────────────────────────────
//
// Layout under <root>/:
//
//   index.json                       — ordered metadata array (newest first)
//   by-id/<recipeId>.json            — full recipe content
//
// The index is rebuildable from by-id/*.json; treating it as a cache lets
// listing be cheap. Concurrent writers are NOT supported (this store is
// expected to live inside a single-process analyze/swarm flow); future
// versions can add a flock for multi-writer safety.

export interface FsRecipeStoreOptions {
  /** Directory the store owns. Created on first put if missing. */
  readonly root: string;
}

export class FsRecipeStore implements RecipeStore {
  private readonly root: string;

  constructor(opts: FsRecipeStoreOptions) {
    this.root = opts.root;
  }

  async put(input: RecipeInput): Promise<Recipe> {
    const id = input.id ?? deriveRecipeId(input);
    const recipe: Recipe = {
      id,
      taskFamily: input.taskFamily,
      snapshotId: input.snapshotId,
      searchedAt: input.searchedAt,
      searchSource: input.searchSource,
      harness: input.harness,
      paretoCoords: input.paretoCoords,
      scores: input.scores,
      ...(input.provenance !== undefined ? { provenance: input.provenance } : {}),
    };
    await fs.mkdir(path.join(this.root, "by-id"), { recursive: true });
    const target = this.idPath(id);
    // Idempotent: if the same id already exists, leave it (canonical
    // content guarantees byte-equality).
    try {
      await fs.access(target);
    } catch {
      const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(recipe, null, 2));
      try {
        await fs.rename(tmp, target);
      } catch {
        try {
          await fs.unlink(tmp);
        } catch {
          /* swallow */
        }
        // If the target appeared while we were writing, that's fine
        // (concurrent put of identical content) — fall through to refresh
        // the index.
      }
    }
    await this.refreshIndex();
    return recipe;
  }

  async get(id: string): Promise<Recipe | null> {
    try {
      const raw = await fs.readFile(this.idPath(id), "utf-8");
      return JSON.parse(raw) as Recipe;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async list(filter?: RecipeListFilter): Promise<Recipe[]> {
    const all = await this.readAll();
    let filtered = all;
    if (filter?.snapshotId !== undefined) {
      filtered = filtered.filter((r) => r.snapshotId === filter.snapshotId);
    }
    if (filter?.taskFamily !== undefined) {
      filtered = filtered.filter((r) => r.taskFamily === filter.taskFamily);
    }
    // Newest first.
    return filtered.sort((a, b) => b.searchedAt.localeCompare(a.searchedAt));
  }

  async findExact(snapshotId: string, taskFamily: string): Promise<Recipe[]> {
    return this.list({ snapshotId, taskFamily });
  }

  async findByFamily(taskFamily: string): Promise<Recipe[]> {
    return this.list({ taskFamily });
  }

  async delete(id: string): Promise<boolean> {
    try {
      await fs.unlink(this.idPath(id));
      await this.refreshIndex();
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw err;
    }
  }

  /** Path on disk for a given recipe id. */
  idPath(id: string): string {
    return path.join(this.root, "by-id", `${sanitizeIdForFs(id)}.json`);
  }

  /** Index file path; exposed for tests/debugging. */
  indexPath(): string {
    return path.join(this.root, "index.json");
  }

  /** Re-derive the index from disk. Cheap — recipes are O(hundreds). */
  private async refreshIndex(): Promise<void> {
    const all = await this.readAll();
    const idx = all
      .map((r) => ({
        id: r.id,
        taskFamily: r.taskFamily,
        snapshotId: r.snapshotId,
        searchedAt: r.searchedAt,
        accuracy: r.paretoCoords.accuracy,
        tokens: r.paretoCoords.tokens,
        latencyMs: r.paretoCoords.latencyMs,
      }))
      .sort((a, b) => b.searchedAt.localeCompare(a.searchedAt));
    await fs.mkdir(this.root, { recursive: true });
    const tmp = `${this.indexPath()}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(idx, null, 2));
    try {
      await fs.rename(tmp, this.indexPath());
    } catch {
      try {
        await fs.unlink(tmp);
      } catch {
        /* swallow */
      }
    }
  }

  private async readAll(): Promise<Recipe[]> {
    const dir = path.join(this.root, "by-id");
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
    const recipes: Recipe[] = [];
    for (const name of entries) {
      if (!name.endsWith(".json")) continue;
      try {
        const raw = await fs.readFile(path.join(dir, name), "utf-8");
        recipes.push(JSON.parse(raw) as Recipe);
      } catch {
        // Skip unreadable files rather than failing the whole listing.
      }
    }
    return recipes;
  }
}

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

/**
 * Compute a deterministic id from a recipe's canonical content. Same
 * harness body + same taskFamily + same snapshotId + same scores ⇒ same
 * id ⇒ idempotent put.
 */
export const deriveRecipeId = (input: Omit<Recipe, "id">): string => {
  const canonical = canonicalJson({
    taskFamily: input.taskFamily,
    snapshotId: input.snapshotId,
    searchedAt: input.searchedAt,
    searchSource: input.searchSource,
    harness: input.harness,
    paretoCoords: input.paretoCoords,
    scores: input.scores,
  });
  const digest = crypto.createHash("sha256").update(canonical).digest("hex");
  return `recipe:${digest.slice(0, 32)}`;
};

const canonicalJson = (value: unknown): string =>
  JSON.stringify(value, (_k, v) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        sorted[k] = (v as Record<string, unknown>)[k];
      }
      return sorted;
    }
    return v;
  });

/**
 * Replace path-unfriendly characters in a recipe id so we can use it as
 * a filename on every platform. The transformation is one-to-one for
 * the formats we generate (hex digests, optional `recipe:` prefix).
 */
const sanitizeIdForFs = (id: string): string => id.replace(/[^A-Za-z0-9._-]/g, "_");
