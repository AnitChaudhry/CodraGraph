import { describe, it, expect } from 'vitest';
import {
  NoTenantContextError,
  getTenant,
  requireTenant,
  withTenant,
} from '../src/tenancy/context.js';
import { makeOrgId, makeUserId } from '../src/types.js';

describe('tenancy/context', () => {
  it('returns undefined when no context is set', () => {
    expect(getTenant()).toBeUndefined();
  });

  it('requireTenant throws NoTenantContextError when not set', () => {
    expect(() => requireTenant()).toThrow(NoTenantContextError);
  });

  it('withTenant scopes a synchronous block', () => {
    const orgId = makeOrgId('org_acme');
    withTenant({ orgId }, () => {
      expect(getTenant()?.orgId).toBe(orgId);
      expect(requireTenant().orgId).toBe(orgId);
    });
    expect(getTenant()).toBeUndefined();
  });

  it('withTenant scopes across an async boundary', async () => {
    const orgId = makeOrgId('org_async');
    const userId = makeUserId('user_async');
    const inner = await withTenant({ orgId, userId }, async () => {
      await Promise.resolve();
      return getTenant();
    });
    expect(inner?.orgId).toBe(orgId);
    expect(inner?.userId).toBe(userId);
    expect(getTenant()).toBeUndefined();
  });

  it('nested withTenant replaces, does not merge', () => {
    const a = makeOrgId('org_a');
    const b = makeOrgId('org_b');
    withTenant({ orgId: a, ip: '10.0.0.1' }, () => {
      withTenant({ orgId: b }, () => {
        const inner = requireTenant();
        expect(inner.orgId).toBe(b);
        expect(inner.ip).toBeUndefined();
      });
      expect(requireTenant().orgId).toBe(a);
    });
  });
});
