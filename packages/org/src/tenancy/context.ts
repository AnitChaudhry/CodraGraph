import { AsyncLocalStorage } from 'node:async_hooks';
import type { OrgId, UserId } from '../types.js';

/**
 * The active tenant for the current async execution. Carried through
 * every async hop without threading parameters explicitly. All storage,
 * audit, and RBAC operations consult this to scope themselves.
 */
export interface TenantContext {
  readonly orgId: OrgId;
  readonly userId?: UserId;
  /** Optional client metadata captured for audit logging. */
  readonly ip?: string;
  readonly userAgent?: string;
}

const storage = new AsyncLocalStorage<TenantContext>();

/**
 * Run `fn` inside `ctx`. Nested calls REPLACE the parent context — there
 * is no merging by design, since a nested handler that intends to act
 * as a different tenant must be explicit. Callers that want to keep
 * the parent fields should spread `getTenant()` into the new ctx.
 */
export const withTenant = <T>(ctx: TenantContext, fn: () => T): T => {
  return storage.run(ctx, fn);
};

/**
 * The active tenant, or `undefined` when none is set. Public callers
 * should usually prefer {@link requireTenant} to fail loud at boundaries.
 */
export const getTenant = (): TenantContext | undefined => storage.getStore();

/**
 * The active tenant, or throw {@link NoTenantContextError}. Use this at
 * the top of any handler that must run scoped to a specific org —
 * forgetting `withTenant` then becomes a clear error rather than a silent
 * cross-tenant read.
 */
export const requireTenant = (): TenantContext => {
  const t = storage.getStore();
  if (!t) {
    throw new NoTenantContextError();
  }
  return t;
};

export class NoTenantContextError extends Error {
  readonly kind = 'NoTenantContextError' as const;
  constructor() {
    super('No tenant context is active. Wrap the call in withTenant({ orgId, ... }, fn).');
    this.name = 'NoTenantContextError';
  }
}
