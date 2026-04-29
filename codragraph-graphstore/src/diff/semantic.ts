import {
  type GraphDiff,
  type ModifiedSymbol,
  type ObjectId,
  type Snapshot,
  type SnapshotManifest,
  type TableManifest,
  parseObjectId,
} from '../types.js';
import { type ContentAddressedStore, getJson } from '../cas/interface.js';
import { diffSnapshots, type DiffSnapshotsOptions } from './structural.js';

/**
 * Tables whose rows represent symbols carrying an `isExported` boolean.
 * Drives the "added/removed APIs" classification.
 */
const SYMBOL_TABLES_WITH_VISIBILITY: readonly string[] = [
  'Function',
  'Method',
  'Class',
  'Interface',
  'Struct',
  'Trait',
  'TypeAlias',
];

/**
 * Tables whose rows represent execution flows. Added/removed processes
 * are surfaced separately because they are the highest-impact diff
 * category — a missing process usually means a behavioural regression
 * rather than just a structural rearrangement.
 */
const PROCESS_TABLES: readonly string[] = ['Process'];

export interface SemanticDiff extends GraphDiff {
  /** Engine identity. `semantic-v1` means the classifier ran. */
  readonly semanticVersion: 'stub' | 'semantic-v1';

  /** Newly exported (or newly present) symbols on the `to` side. */
  readonly addedAPIs: SymbolRef[];

  /** Exported symbols that disappeared between `from` and `to`. */
  readonly removedAPIs: SymbolRef[];

  /** Process rows that appeared in `to`. */
  readonly addedProcesses: SymbolRef[];

  /** Process rows that disappeared. */
  readonly removedProcesses: SymbolRef[];

  /** Every modified symbol annotated with the kinds of change that fired. */
  readonly classifiedModifications: ClassifiedModification[];
}

export interface SymbolRef {
  readonly table: string;
  readonly id: string;
  readonly name?: string;
  readonly filePath?: string;
  readonly isExported?: boolean;
}

export interface ClassifiedModification {
  readonly table: string;
  readonly id: string;
  readonly name?: string;
  readonly filePath?: string;
  readonly fromHash: ObjectId;
  readonly toHash: ObjectId;
  readonly changes: SemanticChangeKind[];
  readonly visibilityFlip?: { from: boolean; to: boolean };
  readonly signatureChange?: SignatureChange;
}

export type SemanticChangeKind = 'signature' | 'visibility' | 'body' | 'location' | 'metadata';

export interface SignatureChange {
  readonly nameChanged?: { from: string; to: string };
  readonly parameterCountChanged?: { from: number; to: number };
  readonly returnTypeChanged?: { from: string; to: string };
}

/**
 * Higher-level diff over the structural one. Walks every modifiedSymbol
 * to classify the change (signature / visibility / body / location /
 * metadata), and walks added/removed nodes to surface added/removed
 * exported APIs and added/removed processes.
 *
 * Symbol-table coverage is intentionally narrow — only the tables that
 * carry an `isExported` flag plus the Process table. For other node
 * types the structural diff is already the answer.
 */
export const diffSemantic = async (opts: DiffSnapshotsOptions): Promise<SemanticDiff> => {
  const structural = await diffSnapshots(opts);
  const { cas } = opts;

  // Pre-load both manifests so we can resolve "removed" rows back to
  // their name/file (the row hash itself is opaque without lookup).
  const [fromManifest, toManifest] = await Promise.all([
    loadManifestFor(cas, structural.from),
    loadManifestFor(cas, structural.to),
  ]);

  const addedAPIs: SymbolRef[] = [];
  const removedAPIs: SymbolRef[] = [];
  const addedProcesses: SymbolRef[] = [];
  const removedProcesses: SymbolRef[] = [];
  const classifiedModifications: ClassifiedModification[] = [];

  // ── Added ────────────────────────────────────────────────────────
  for (const [table, rowIds] of Object.entries(structural.addedNodes)) {
    const isApiTable = SYMBOL_TABLES_WITH_VISIBILITY.includes(table);
    const isProcessTable = PROCESS_TABLES.includes(table);
    if (!isApiTable && !isProcessTable) continue;

    const tableManifest = toManifest.nodeTables[table];
    if (!tableManifest) continue;

    // Build a reverse hash → id lookup for this table so we can resolve
    // each added row hash back to its logical id (and from there fetch
    // the row content for name/filePath/isExported).
    const idByHash = invertTableIndex(tableManifest);
    for (const rowId of rowIds) {
      const id = idByHash.get(rowId);
      if (!id) continue;
      const ref = await loadSymbolRef(cas, table, id, rowId);
      if (isApiTable) {
        if (ref.isExported !== false) addedAPIs.push(ref);
      } else {
        addedProcesses.push(ref);
      }
    }
  }

  // ── Removed ──────────────────────────────────────────────────────
  for (const [table, rowIds] of Object.entries(structural.removedNodes)) {
    const isApiTable = SYMBOL_TABLES_WITH_VISIBILITY.includes(table);
    const isProcessTable = PROCESS_TABLES.includes(table);
    if (!isApiTable && !isProcessTable) continue;

    const tableManifest = fromManifest.nodeTables[table];
    if (!tableManifest) continue;

    const idByHash = invertTableIndex(tableManifest);
    for (const rowId of rowIds) {
      const id = idByHash.get(rowId);
      if (!id) continue;
      const ref = await loadSymbolRef(cas, table, id, rowId);
      if (isApiTable) {
        if (ref.isExported !== false) removedAPIs.push(ref);
      } else {
        removedProcesses.push(ref);
      }
    }
  }

  // ── Modified ─────────────────────────────────────────────────────
  for (const m of structural.modifiedSymbols) {
    const classified = await classifyModification(cas, m);
    classifiedModifications.push(classified);
  }

  return {
    ...structural,
    semanticVersion: 'semantic-v1',
    addedAPIs: sortRefs(addedAPIs),
    removedAPIs: sortRefs(removedAPIs),
    addedProcesses: sortRefs(addedProcesses),
    removedProcesses: sortRefs(removedProcesses),
    classifiedModifications,
  };
};

// ──────────────────────────────────────────────────────────────────────
// Internals
// ──────────────────────────────────────────────────────────────────────

const loadManifestFor = async (
  cas: ContentAddressedStore,
  snapshotId: ObjectId,
): Promise<SnapshotManifest> => {
  const snapshot = await getJson<Snapshot>(cas, snapshotId);
  return getJson<SnapshotManifest>(cas, parseObjectId(snapshot.manifestId));
};

const invertTableIndex = (tableManifest: TableManifest): Map<ObjectId, string> => {
  // Multiple ids could (in theory) hash to the same row — extremely rare
  // because the id field is part of the canonical content — but we still
  // pick the first to avoid silently dropping entries on collision.
  const out = new Map<ObjectId, string>();
  for (const [id, hash] of Object.entries(tableManifest.rows)) {
    if (!out.has(hash)) out.set(hash, id);
  }
  return out;
};

const loadSymbolRef = async (
  cas: ContentAddressedStore,
  table: string,
  id: string,
  rowId: ObjectId,
): Promise<SymbolRef> => {
  const row = await safeGetRow(cas, rowId);
  return {
    table,
    id,
    name: typeof row?.['name'] === 'string' ? (row['name'] as string) : undefined,
    filePath: typeof row?.['filePath'] === 'string' ? (row['filePath'] as string) : undefined,
    isExported:
      typeof row?.['isExported'] === 'boolean' ? (row['isExported'] as boolean) : undefined,
  };
};

const safeGetRow = async (
  cas: ContentAddressedStore,
  rowId: ObjectId,
): Promise<Record<string, unknown> | null> => {
  try {
    return await getJson<Record<string, unknown>>(cas, rowId);
  } catch {
    return null;
  }
};

const classifyModification = async (
  cas: ContentAddressedStore,
  m: ModifiedSymbol,
): Promise<ClassifiedModification> => {
  const [fromRow, toRow] = await Promise.all([
    safeGetRow(cas, m.fromHash),
    safeGetRow(cas, m.toHash),
  ]);
  const changes = new Set<SemanticChangeKind>();
  const out: {
    table: string;
    id: string;
    name?: string;
    filePath?: string;
    fromHash: ObjectId;
    toHash: ObjectId;
    changes: SemanticChangeKind[];
    visibilityFlip?: { from: boolean; to: boolean };
    signatureChange?: SignatureChange;
  } = {
    table: m.table,
    id: m.id,
    fromHash: m.fromHash,
    toHash: m.toHash,
    changes: [],
  };

  // Only proceed with classification if both sides are loadable. If
  // either is missing the GC may have run; default to "metadata".
  if (!fromRow || !toRow) {
    out.changes = ['metadata'];
    if (toRow && typeof toRow['name'] === 'string') out.name = toRow['name'] as string;
    return out;
  }

  if (typeof toRow['name'] === 'string') out.name = toRow['name'] as string;
  if (typeof toRow['filePath'] === 'string') out.filePath = toRow['filePath'] as string;

  // visibility
  const fromExp = fromRow['isExported'];
  const toExp = toRow['isExported'];
  if (typeof fromExp === 'boolean' && typeof toExp === 'boolean' && fromExp !== toExp) {
    changes.add('visibility');
    out.visibilityFlip = { from: fromExp, to: toExp };
  }

  // signature
  const sigChange: {
    nameChanged?: { from: string; to: string };
    parameterCountChanged?: { from: number; to: number };
    returnTypeChanged?: { from: string; to: string };
  } = {};
  let sawSignatureChange = false;
  if (
    typeof fromRow['name'] === 'string' &&
    typeof toRow['name'] === 'string' &&
    fromRow['name'] !== toRow['name']
  ) {
    sigChange.nameChanged = {
      from: fromRow['name'] as string,
      to: toRow['name'] as string,
    };
    sawSignatureChange = true;
  }
  if (
    typeof fromRow['parameterCount'] === 'number' &&
    typeof toRow['parameterCount'] === 'number' &&
    fromRow['parameterCount'] !== toRow['parameterCount']
  ) {
    sigChange.parameterCountChanged = {
      from: fromRow['parameterCount'] as number,
      to: toRow['parameterCount'] as number,
    };
    sawSignatureChange = true;
  }
  if (
    typeof fromRow['returnType'] === 'string' &&
    typeof toRow['returnType'] === 'string' &&
    fromRow['returnType'] !== toRow['returnType']
  ) {
    sigChange.returnTypeChanged = {
      from: fromRow['returnType'] as string,
      to: toRow['returnType'] as string,
    };
    sawSignatureChange = true;
  }
  if (sawSignatureChange) {
    changes.add('signature');
    out.signatureChange = sigChange;
  }

  // body
  if (
    typeof fromRow['content'] === 'string' &&
    typeof toRow['content'] === 'string' &&
    fromRow['content'] !== toRow['content']
  ) {
    changes.add('body');
  }

  // location
  if (
    fromRow['filePath'] !== toRow['filePath'] ||
    fromRow['startLine'] !== toRow['startLine'] ||
    fromRow['endLine'] !== toRow['endLine']
  ) {
    changes.add('location');
  }

  // If nothing else fired but the hash differs, the change is in some
  // metadata field we don't otherwise classify (description, etc.).
  if (changes.size === 0) changes.add('metadata');

  out.changes = [...changes].sort();
  return out;
};

const sortRefs = (refs: SymbolRef[]): SymbolRef[] => {
  return [...refs].sort((a, b) => {
    if (a.table !== b.table) return a.table.localeCompare(b.table);
    return a.id.localeCompare(b.id);
  });
};
