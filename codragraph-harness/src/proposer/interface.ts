import type { CandidateStore } from '../filesystem.js';

/**
 * Proposer — generates new harness candidates from the filesystem 𝒟 of all
 * prior runs (their source code, traces, and scores).
 *
 * The Meta-Harness paper's key insight is to give the proposer rich filesystem
 * access (median 82 files read per iteration in their experiments) rather than
 * a compressed feedback budget. We mirror that: ProposeInput carries the
 * CandidateStore and the proposer is expected to navigate it directly.
 */
export interface Proposer {
  readonly name: string;

  /** Generate `input.count` new candidates. May return fewer if the proposer cannot find valid mutations. */
  propose(input: ProposeInput): Promise<HarnessSource[]>;
}

export interface ProposeInput {
  /** Read access to the full candidate store 𝒟. */
  filesystem: CandidateStore;
  /** k — number of new candidates the outer loop is requesting this iteration. */
  count: number;
  /** Current population size |ℋ|. */
  populationSize: number;
  /** Outer-loop iteration index, 1..N. */
  iteration: number;
}

/**
 * A new harness as raw TS source files. The outer loop validates this compiles
 * + implements `Harness` before adding to the store.
 */
export interface HarnessSource {
  /** Stable name for this candidate (e.g., "graph-aware-v3"). */
  name: string;
  /** Source files, paths relative to the candidate's `source/` directory. Must include an entry exporting the Harness. */
  files: SourceFile[];
  /** The proposer's natural-language explanation; saved alongside source as rationale.md. */
  rationale: string;
  /** Optional parent candidate ids this was derived from. */
  parents?: string[];
}

export interface SourceFile {
  /** Relative path under source/, e.g. "index.ts" or "lib/router.ts". */
  path: string;
  /** Raw TS code. */
  content: string;
}
