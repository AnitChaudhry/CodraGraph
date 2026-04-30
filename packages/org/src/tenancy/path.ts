import path from 'node:path';
import type { OrgId } from '../types.js';

/**
 * Compute the on-disk root for an org's data. The org id is treated
 * as opaque — callers MUST go through this function rather than
 * concatenating ids into paths themselves, because `path.resolve` here
 * is what enforces the no-traversal invariant.
 */
export const tenantStorageRoot = (storageRoot: string, orgId: OrgId): string => {
  const normalizedRoot = path.resolve(storageRoot);
  const candidate = path.resolve(normalizedRoot, 'orgs', orgId);
  // Defense-in-depth: even though OrgId is branded and validated, an
  // attacker who bypasses `makeOrgId` (e.g. via deserialization) must
  // not be able to escape the storage root.
  const rel = path.relative(normalizedRoot, candidate);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new TenantPathTraversalError(orgId);
  }
  return candidate;
};

/** Subdir within a tenant's root. Same traversal guard applies. */
export const tenantSubpath = (storageRoot: string, orgId: OrgId, ...segments: string[]): string => {
  const root = tenantStorageRoot(storageRoot, orgId);
  const candidate = path.resolve(root, ...segments);
  const rel = path.relative(root, candidate);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new TenantPathTraversalError(orgId, segments.join('/'));
  }
  return candidate;
};

export class TenantPathTraversalError extends Error {
  readonly kind = 'TenantPathTraversalError' as const;
  constructor(
    public readonly orgId: string,
    public readonly attemptedSegments?: string,
  ) {
    super(
      `Refused to compute path that escapes tenant root for org ${orgId}` +
        (attemptedSegments ? ` (segments: ${attemptedSegments})` : ''),
    );
    this.name = 'TenantPathTraversalError';
  }
}
