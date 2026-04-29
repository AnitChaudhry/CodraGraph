/**
 * Public surface of `@codragraph/graphstore`.
 *
 * Subpath imports (`@codragraph/graphstore/cas`, `/snapshot`, `/history`,
 * `/diff`) are also available for callers who only need a slice. The
 * default entry re-exports everything the CLI / MCP / dashboard need.
 */

// Types
export {
  type ObjectId,
  type SchemaVersion,
  SCHEMA_VERSION,
  OBJECT_ID_PATTERN,
  makeObjectId,
  parseObjectId,
  objectIdHex,
  type Snapshot,
  type SnapshotManifest,
  type TableManifest,
  type Commit,
  type CommitAuthor,
  type Branch,
  DEFAULT_BRANCH,
  type GraphDiff,
  type ModifiedSymbol,
} from './types.js';

// CAS
export {
  type ContentAddressedStore,
  ObjectNotFoundError,
  putJson,
  getJson,
  canonicalJsonStringify,
} from './cas/interface.js';
export { FsCAS, type FsCASOptions } from './cas/fs-cas.js';

// Snapshot
export {
  type RowSource,
  type RowSink,
  type GraphRow,
  synthesizeEdgeId,
} from './snapshot/row-source.js';
export {
  serializeSnapshot,
  type SerializeSnapshotOptions,
  type SerializeSnapshotResult,
  type SnapshotStats,
} from './snapshot/serializer.js';
export {
  materializeSnapshot,
  type MaterializeSnapshotOptions,
  type MaterializeSnapshotResult,
} from './snapshot/materializer.js';

// History
export {
  createCommit,
  readCommit,
  type CreateCommitOptions,
  type CreateCommitResult,
} from './history/commit.js';
export {
  createBranch,
  deleteBranch,
  setHead,
  getHead,
  listBranches,
  readHead,
  writeHeadBranch,
  writeHeadDetached,
  resolveHeadCommit,
  type HeadState,
  type BranchRefsOptions,
} from './history/branch.js';
export {
  walkCommits,
  findLowestCommonAncestor,
  type WalkCommitsOptions,
  type CommitLogEntry,
} from './history/log.js';

// Diff
export { diffSnapshots, type DiffSnapshotsOptions } from './diff/structural.js';
export {
  diffSemantic,
  type SemanticDiff,
  type SymbolRef,
  type ClassifiedModification,
  type SemanticChangeKind,
  type SignatureChange,
} from './diff/semantic.js';

// Merge
export {
  threeWayMerge,
  type ThreeWayMergeOptions,
  type ThreeWayMergeResult,
  type MergeConflict,
  type MergeStats,
  type ConflictReason,
} from './merge/three-way.js';

// GC
export {
  gc,
  collectReachableObjects,
  type GcOptions,
  type GcResult,
  type CollectReachableOptions,
} from './gc/sweep.js';
