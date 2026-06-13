export const GRAPHPACK_LOCK_KIND = 'codragraph-index-lock' as const;
export const GRAPHPACK_LOCK_SCHEMA_VERSION = 1 as const;
export const INDEX_LOCK_RELATIVE_PATH = '.codragraph/index.lock.json' as const;
export const GRAPHPACK_MANIFEST_SCHEMA_VERSION = 1 as const;

export type GraphpackTarget = 'main' | 'pr';
export type GraphpackChunkKind =
  | 'manifest'
  | 'graphstore-cas'
  | 'semantic-relationships'
  | 'recipe-metadata';

export interface GraphpackChunk {
  readonly path: string;
  readonly kind: GraphpackChunkKind;
  readonly sha256: string;
  readonly bytes: number;
  readonly fileCount?: number;
}

export interface GraphpackLock {
  readonly kind: typeof GRAPHPACK_LOCK_KIND;
  readonly schemaVersion: typeof GRAPHPACK_LOCK_SCHEMA_VERSION;
  readonly repo: {
    readonly name: string;
    readonly gitCommit?: string;
    readonly remoteUrl?: string;
    readonly pathHint?: string;
  };
  readonly graphpack: {
    readonly id: string;
    readonly target: GraphpackTarget;
    readonly createdAt: string;
    readonly artifactUrl?: string;
    readonly artifactDir?: string;
    readonly graphstoreBranch?: string;
    readonly graphstoreHeadCommit?: string;
    readonly graphstoreSnapshot?: string;
  };
  readonly index: {
    readonly schemaVersion?: number;
    readonly analyzerVersion: string;
    readonly compression?: 'none' | 'brotli' | 'zstd';
    readonly semanticLayerVersion: string;
    readonly requiredCapabilities: readonly string[];
  };
  readonly chunks: readonly GraphpackChunk[];
  readonly overlay?: {
    readonly baseSnapshotId?: string;
    readonly headSnapshotId?: string;
    readonly pullRequest?: string;
  };
}

export interface GraphpackManifest {
  readonly kind: 'codragraph-graphpack-manifest';
  readonly schemaVersion: typeof GRAPHPACK_MANIFEST_SCHEMA_VERSION;
  readonly id: string;
  readonly target: GraphpackTarget;
  readonly createdAt: string;
  readonly repo: GraphpackLock['repo'];
  readonly graphstore: {
    readonly branch?: string;
    readonly headCommit?: string;
    readonly snapshot?: string;
    readonly digest: string;
    readonly fileCount: number;
    readonly bytes: number;
    readonly files: readonly GraphpackManifestFile[];
  };
  readonly semanticLayerVersion: string;
  readonly overlay?: GraphpackLock['overlay'];
}

export interface GraphpackManifestFile {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
}

export interface GraphpackStatus {
  readonly repoPath: string;
  readonly storagePath: string;
  readonly lockPath: string;
  readonly lockPresent: boolean;
  readonly lock?: GraphpackLock;
  readonly local: {
    readonly graphstorePresent: boolean;
    readonly headCommit?: string;
    readonly schemaVersion?: number;
    readonly analyzerVersion?: string;
  };
  readonly compatibility: {
    readonly ok: boolean;
    readonly reasons: string[];
  };
  readonly chunks: {
    readonly expected: number;
    readonly verified: number;
    readonly missing: readonly string[];
    readonly mismatched: readonly string[];
  };
  readonly source: 'canonical' | 'pr-overlay' | 'local' | 'missing';
}

export interface GraphpackPublishOptions {
  readonly repoPath: string;
  readonly storagePath: string;
  readonly repoName: string;
  readonly analyzerVersion: string;
  readonly target: GraphpackTarget;
  readonly artifactDir?: string;
  readonly artifactUrl?: string;
  readonly baseSnapshotId?: string;
  readonly headSnapshotId?: string;
  readonly pullRequest?: string;
  readonly lockPath?: string;
}

export interface GraphpackPublishResult {
  readonly lockPath: string;
  readonly manifestPath: string;
  readonly lock: GraphpackLock;
  readonly manifest: GraphpackManifest;
}

export interface GraphpackPullOptions {
  readonly repoPath: string;
  readonly storagePath: string;
  readonly lockPath?: string;
  readonly artifactDir?: string;
}

export interface GraphpackPullResult {
  readonly status: GraphpackStatus;
  readonly pulled: boolean;
  readonly materializable: boolean;
  readonly fallbackRequired: boolean;
  readonly reason?: string;
}

export interface GraphpackBootstrapResult extends GraphpackPullResult {
  readonly fallbackCommand: string;
}
