import type { NodeLabel } from './graph/types.js';

export type FeatureClusterKind =
  | 'feature'
  | 'page'
  | 'domain'
  | 'service'
  | 'api'
  | 'tooling'
  | 'data'
  | 'docs'
  | 'test'
  | 'infrastructure';

export interface FeatureClusterSignal {
  kind:
    | 'path'
    | 'symbol'
    | 'route'
    | 'tool'
    | 'process'
    | 'community'
    | 'test'
    | 'docs'
    | 'package'
    | 'contract';
  value: string;
  weight: number;
}

export type ClusterSignal = FeatureClusterSignal;

export interface CrossRepoClusterLink {
  sourceRepo: string;
  sourceService?: string;
  sourceClusterId: string;
  sourceClusterName?: string;
  targetRepo: string;
  targetService?: string;
  targetClusterId?: string;
  targetClusterName?: string;
  contractName?: string;
  relationship: 'provider' | 'consumer' | 'shared-contract' | 'depends-on';
  confidence: number;
  evidence: string[];
}

export interface FeatureCluster {
  id: string;
  name: string;
  slug: string;
  featureKind: FeatureClusterKind;
  summary: string;
  description: string;
  repo?: string;
  service?: string;
  signals: string[];
  memberCount: number;
  entryPointIds: string[];
  routes: string[];
  tools: string[];
  testCoverageHints: string[];
  lastIndexedCommit?: string;
  confidence: number;
  source: 'heuristic' | 'manual' | 'imported';
  crossRepoLinks?: CrossRepoClusterLink[];
}

export interface FeatureClusterMember {
  nodeId?: string;
  id?: string;
  clusterId?: string;
  name?: string;
  label?: NodeLabel;
  type?: NodeLabel;
  filePath?: string;
  startLine?: number;
  endLine?: number;
  role?: 'entrypoint' | 'definition' | 'implementation' | 'supporting';
  confidence: number;
  signals: string[];
}

export interface FeatureClusterDependency {
  sourceClusterId: string;
  targetClusterId: string;
  edgeCount: number;
  relationshipTypes: string[];
  confidence: number;
}

export interface FeatureClusterReference {
  id: string;
  name: string;
  slug?: string;
  featureKind?: FeatureClusterKind | string;
  confidence?: number;
  reason?: string;
}

export interface FeatureContextPack {
  cluster: FeatureCluster;
  members: FeatureClusterMember[];
  dependencies: {
    incoming: FeatureClusterReference[];
    outgoing: FeatureClusterReference[];
  };
  dependencyEdges?: FeatureClusterDependency[];
  entryPoints?: FeatureClusterMember[];
  routes?: FeatureClusterMember[];
  tools?: FeatureClusterMember[];
  processes?: Array<{
    id: string;
    label: string;
    processType?: string;
    stepCount?: number;
  }>;
  tests?: FeatureClusterMember[];
  docs?: FeatureClusterMember[];
  crossRepoLinks?: CrossRepoClusterLink[];
  safeEditSurface?: {
    files: string[];
    symbols: string[];
    warnings: string[];
  };
}

export type ClusterContextPack = FeatureContextPack;
