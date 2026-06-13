import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  FsCAS,
  getJson,
  parseObjectId,
  readCommit,
  resolveHeadCommit,
  type GraphRow,
  type Snapshot,
  type SnapshotManifest,
} from '@codragraph/graphstore';
import { GRAPHSTORE_SUBDIR } from '../graphstore/index.js';

export const SEMANTIC_RELATIONSHIP_VERSION = 'semantic-extractor-v1' as const;

export type SemanticRelationshipFamily =
  | 'COMPOSES'
  | 'ADAPTS'
  | 'DELEGATES_TO'
  | 'WRAPS'
  | 'CONFIGURES'
  | 'FACTORY_CREATES'
  | 'ORCHESTRATES'
  | 'PROXIES_TO'
  | 'MAPS_TO';

export type SemanticRelationshipProvenance =
  | 'extracted'
  | 'inferred'
  | 'LLM_INFERRED'
  | 'human-confirmed';

export interface SemanticRelationshipEvidence {
  readonly filePath?: string;
  readonly startLine?: number;
  readonly endLine?: number;
  readonly rawEdgeType: string;
  readonly rawEdgeConfidence?: number;
  readonly reason: string;
}

export interface SemanticRelationship {
  readonly id: string;
  readonly family: SemanticRelationshipFamily;
  readonly sourceId: string;
  readonly sourceName?: string;
  readonly targetId: string;
  readonly targetName?: string;
  readonly confidence: number;
  readonly provenance: SemanticRelationshipProvenance;
  readonly extractorVersion: typeof SEMANTIC_RELATIONSHIP_VERSION;
  readonly evidence: SemanticRelationshipEvidence;
}

export interface SemanticRelationshipReport {
  readonly snapshotId?: string;
  readonly extractorVersion: typeof SEMANTIC_RELATIONSHIP_VERSION;
  readonly llmEnabled: boolean;
  readonly relationships: readonly SemanticRelationship[];
  readonly summary: Record<SemanticRelationshipFamily, number>;
}

interface NodeRow {
  readonly id: string;
  readonly table: string;
  readonly name?: string;
  readonly filePath?: string;
  readonly startLine?: number;
  readonly endLine?: number;
}

export const analyzeSemanticRelationships = async (opts: {
  readonly storagePath: string;
  readonly limit?: number;
  readonly llm?: boolean;
  readonly write?: boolean;
}): Promise<SemanticRelationshipReport> => {
  const graphstoreRoot = path.join(opts.storagePath, GRAPHSTORE_SUBDIR);
  const cas = new FsCAS({ root: graphstoreRoot });
  const head = await resolveHeadCommit({ root: graphstoreRoot });
  if (head === null) {
    throw new Error('semantic analyze requires a graphstore HEAD. Run `codragraph analyze` first.');
  }
  const commit = await readCommit(cas, head);
  const snapshot = await getJson<Snapshot>(cas, commit.snapshot);
  const manifest = await getJson<SnapshotManifest>(cas, parseObjectId(snapshot.manifestId));
  const nodes = await loadNodes(cas, manifest);
  const relationships = await inferRelationships({
    cas,
    manifest,
    nodes,
    limit: opts.limit ?? 1000,
  });
  const report: SemanticRelationshipReport = {
    snapshotId: commit.snapshot,
    extractorVersion: SEMANTIC_RELATIONSHIP_VERSION,
    llmEnabled: opts.llm === true,
    relationships,
    summary: summarize(relationships),
  };
  if (opts.write) {
    await fs.writeFile(
      path.join(opts.storagePath, 'semantic-relationships.json'),
      `${JSON.stringify(report, null, 2)}\n`,
      'utf-8',
    );
  }
  return report;
};

const loadNodes = async (cas: FsCAS, manifest: SnapshotManifest): Promise<Map<string, NodeRow>> => {
  const nodes = new Map<string, NodeRow>();
  for (const [table, tableManifest] of Object.entries(manifest.nodeTables)) {
    for (const [id, objectId] of Object.entries(tableManifest.rows)) {
      const row = await getJson<GraphRow>(cas, parseObjectId(objectId));
      nodes.set(id, {
        id,
        table,
        name: stringProp(row, 'name'),
        filePath: stringProp(row, 'filePath'),
        startLine: numberProp(row, 'startLine'),
        endLine: numberProp(row, 'endLine'),
      });
    }
  }
  return nodes;
};

const inferRelationships = async (opts: {
  readonly cas: FsCAS;
  readonly manifest: SnapshotManifest;
  readonly nodes: Map<string, NodeRow>;
  readonly limit: number;
}): Promise<SemanticRelationship[]> => {
  const highSignal: SemanticRelationship[] = [];
  const fallback: SemanticRelationship[] = [];
  const seen = new Set<string>();
  const edgeEntries = Object.entries(opts.manifest.edges.rows);
  for (const [edgeKey, objectId] of edgeEntries) {
    let edge: GraphRow | undefined;
    const parsed = parseEdgeKey(edgeKey);
    if (!parsed) edge = await getJson<GraphRow>(opts.cas, parseObjectId(objectId));
    const from = parsed?.from ?? stringProp(edge!, 'from');
    const to = parsed?.to ?? stringProp(edge!, 'to');
    const rawType = parsed?.rawType ?? stringProp(edge!, 'type');
    if (!from || !to || !rawType) continue;
    if (!SEMANTIC_RAW_EDGE_TYPES.has(rawType)) continue;
    const source = opts.nodes.get(from);
    const target = opts.nodes.get(to);
    const classified = classifySemanticEdge({ rawType, source, target });
    if (!classified) continue;
    const key = `${from}|${classified.family}|${to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const relationship: SemanticRelationship = {
      id: `semantic:${hashKey(key).slice(0, 32)}`,
      family: classified.family,
      sourceId: from,
      ...(source?.name ? { sourceName: source.name } : {}),
      targetId: to,
      ...(target?.name ? { targetName: target.name } : {}),
      confidence: classified.confidence,
      provenance: rawType === classified.family ? 'extracted' : 'inferred',
      extractorVersion: SEMANTIC_RELATIONSHIP_VERSION,
      evidence: {
        filePath: source?.filePath ?? target?.filePath,
        startLine: source?.startLine ?? target?.startLine,
        endLine: source?.endLine ?? target?.endLine,
        rawEdgeType: rawType,
        rawEdgeConfidence: edge ? numberProp(edge, 'confidence') : undefined,
        reason: classified.reason,
      },
    };
    const bucket = classified.family === 'COMPOSES' ? fallback : highSignal;
    bucket.push(relationship);
    if (highSignal.length >= opts.limit) break;
  }
  return [
    ...highSignal.sort(compareSemanticRelationships),
    ...fallback.sort(compareSemanticRelationships),
  ].slice(0, opts.limit);
};

const SEMANTIC_RAW_EDGE_TYPES = new Set([
  'CALLS',
  'IMPORTS',
  'EXTENDS',
  'IMPLEMENTS',
  'HAS_METHOD',
  'HAS_PROPERTY',
  'ACCESSES',
  'METHOD_OVERRIDES',
  'METHOD_IMPLEMENTS',
  'WRAPS',
  'FETCHES',
  'HANDLES_ROUTE',
  'HANDLES_TOOL',
  'QUERIES',
]);

const parseEdgeKey = (edgeKey: string): { from: string; rawType: string; to: string } | null => {
  const parts = edgeKey.split('|');
  if (parts.length < 3) return null;
  const [from, rawType, ...toParts] = parts;
  if (!from || !rawType || toParts.length === 0) return null;
  return { from, rawType, to: toParts.join('|') };
};

const classifySemanticEdge = (input: {
  readonly rawType: string;
  readonly source?: NodeRow;
  readonly target?: NodeRow;
}): { family: SemanticRelationshipFamily; confidence: number; reason: string } | null => {
  const sourceName = input.source?.name ?? input.source?.id ?? '';
  const targetName = input.target?.name ?? input.target?.id ?? '';
  const source = sourceName.toLowerCase();
  const target = targetName.toLowerCase();
  const rawType = input.rawType;

  if (rawType === 'WRAPS' || hasAny(source, ['wrapper', 'middleware', 'decorator'])) {
    return {
      family: 'WRAPS',
      confidence: rawType === 'WRAPS' ? 0.95 : 0.78,
      reason: 'wrapper/decorator naming or raw WRAPS edge',
    };
  }
  if (rawType === 'IMPLEMENTS' && hasAny(source, ['adapter', 'adaptor'])) {
    return { family: 'ADAPTS', confidence: 0.86, reason: 'adapter implementation edge' };
  }
  if (hasAny(source, ['adapter', 'adaptor']) && ['CALLS', 'IMPORTS'].includes(rawType)) {
    return { family: 'ADAPTS', confidence: 0.72, reason: 'adapter symbol delegates to target' };
  }
  if (hasAny(source, ['proxy', 'client']) && ['CALLS', 'FETCHES', 'IMPORTS'].includes(rawType)) {
    return {
      family: 'PROXIES_TO',
      confidence: 0.74,
      reason: 'proxy/client symbol forwards to target',
    };
  }
  if (hasAny(source, ['factory', 'builder']) || /^(create|make|build)[A-Z_]/.test(sourceName)) {
    if (['CALLS', 'HAS_METHOD', 'IMPORTS'].includes(rawType)) {
      return {
        family: 'FACTORY_CREATES',
        confidence: 0.75,
        reason: 'factory/create/build symbol reaches constructed target',
      };
    }
  }
  if (
    hasAny(source, ['config', 'configure', 'setup', 'options']) &&
    ['CALLS', 'ACCESSES', 'IMPORTS'].includes(rawType)
  ) {
    return {
      family: 'CONFIGURES',
      confidence: 0.7,
      reason: 'configuration symbol controls target behavior',
    };
  }
  if (
    hasAny(source, ['orchestrator', 'coordinator', 'workflow', 'pipeline', 'runner']) &&
    rawType === 'CALLS'
  ) {
    return {
      family: 'ORCHESTRATES',
      confidence: 0.76,
      reason: 'orchestrator/coordinator call edge',
    };
  }
  if (
    hasAny(source, ['mapper', 'map', 'dto', 'transformer', 'serializer']) ||
    hasAny(target, ['dto', 'schema', 'model'])
  ) {
    if (['CALLS', 'IMPORTS', 'ACCESSES'].includes(rawType)) {
      return { family: 'MAPS_TO', confidence: 0.7, reason: 'mapper/DTO transformation signal' };
    }
  }
  if (rawType === 'HAS_PROPERTY' || rawType === 'ACCESSES') {
    return {
      family: 'COMPOSES',
      confidence: 0.68,
      reason: 'field/property ownership or access edge',
    };
  }
  if (rawType === 'CALLS' && /^(handle|run|execute|process|dispatch)/i.test(sourceName)) {
    return {
      family: 'DELEGATES_TO',
      confidence: 0.66,
      reason: 'handler/executor delegates to callee',
    };
  }
  return null;
};

const summarize = (
  relationships: readonly SemanticRelationship[],
): Record<SemanticRelationshipFamily, number> => {
  const summary: Record<SemanticRelationshipFamily, number> = {
    COMPOSES: 0,
    ADAPTS: 0,
    DELEGATES_TO: 0,
    WRAPS: 0,
    CONFIGURES: 0,
    FACTORY_CREATES: 0,
    ORCHESTRATES: 0,
    PROXIES_TO: 0,
    MAPS_TO: 0,
  };
  for (const rel of relationships) summary[rel.family]++;
  return summary;
};

const compareSemanticRelationships = (a: SemanticRelationship, b: SemanticRelationship): number => {
  const byFamily = familyPriority(a.family) - familyPriority(b.family);
  if (byFamily !== 0) return byFamily;
  return b.confidence - a.confidence;
};

const familyPriority = (family: SemanticRelationshipFamily): number => {
  switch (family) {
    case 'ADAPTS':
      return 0;
    case 'WRAPS':
      return 1;
    case 'PROXIES_TO':
      return 2;
    case 'FACTORY_CREATES':
      return 3;
    case 'ORCHESTRATES':
      return 4;
    case 'CONFIGURES':
      return 5;
    case 'MAPS_TO':
      return 6;
    case 'DELEGATES_TO':
      return 7;
    case 'COMPOSES':
      return 8;
  }
};

const hasAny = (value: string, needles: readonly string[]): boolean =>
  needles.some((needle) => value.includes(needle));

const stringProp = (row: GraphRow, key: string): string | undefined => {
  const value = row[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
};

const numberProp = (row: GraphRow, key: string): number | undefined => {
  const value = row[key];
  return typeof value === 'number' ? value : undefined;
};

const hashKey = (key: string): string => {
  return crypto.createHash('sha256').update(key).digest('hex');
};
