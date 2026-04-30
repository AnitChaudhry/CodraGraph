import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { TenantPathTraversalError, tenantStorageRoot, tenantSubpath } from '../src/tenancy/path.js';
import { makeOrgId } from '../src/types.js';

describe('tenancy/path', () => {
  const root = '/var/codragraph';
  const orgId = makeOrgId('org_acme');

  it('derives the tenant storage root under <root>/orgs/<orgId>', () => {
    const p = tenantStorageRoot(root, orgId);
    expect(p).toBe(path.resolve(root, 'orgs', orgId));
  });

  it('rejects subpath segments that escape the tenant root', () => {
    expect(() => tenantSubpath(root, orgId, '..', '..', 'etc')).toThrow(TenantPathTraversalError);
  });

  it('composes legitimate subpaths', () => {
    const p = tenantSubpath(root, orgId, 'audit', 'index', '2026-04-29.jsonl');
    expect(p).toBe(path.resolve(root, 'orgs', orgId, 'audit', 'index', '2026-04-29.jsonl'));
  });

  it('normalizes the storage root', () => {
    const p = tenantStorageRoot('/var/./codragraph/foo/..', orgId);
    expect(p).toBe(path.resolve('/var/codragraph', 'orgs', orgId));
  });
});
