import type { Role } from '../types.js';
import { roleAtLeast } from './roles.js';

/**
 * Permissions are strings of the form `<resource>.<verb>`. Resources
 * and verbs are not enumerated here on purpose: callers add their own
 * permissions without modifying this package.
 */
export type Permission = `${string}.${string}`;

/**
 * Minimum role required for a permission. Permissions not in the map
 * default to `owner` — fail closed.
 */
export interface PermissionPolicy {
  readonly minRole: ReadonlyMap<Permission, Role>;
  readonly defaultMinRole?: Role;
}

export const checkPermission = (
  policy: PermissionPolicy,
  actorRole: Role,
  permission: Permission,
): boolean => {
  const required = policy.minRole.get(permission) ?? policy.defaultMinRole ?? 'owner';
  return roleAtLeast(actorRole, required);
};

/**
 * Default policy covering the core resources every CodraGraph deployment
 * exposes. Integrators extend by composing additional entries.
 */
export const DEFAULT_POLICY: PermissionPolicy = {
  defaultMinRole: 'owner',
  minRole: new Map<Permission, Role>([
    // Repos
    ['repo.read', 'viewer'],
    ['repo.analyze', 'member'],
    ['repo.delete', 'admin'],

    // Feature clusters / context packs
    ['cluster.read', 'viewer'],
    ['cluster.context_pack', 'viewer'],
    ['cluster.impact', 'member'],
    ['cluster.audit', 'admin'],

    // Recipes
    ['recipe.read', 'viewer'],
    ['recipe.create', 'member'],
    ['recipe.delete', 'admin'],

    // Graphstore
    ['graphstore.read', 'viewer'],
    ['graphstore.commit', 'member'],
    ['graphstore.merge', 'admin'],
    ['graphstore.gc', 'admin'],

    // Org admin
    ['org.invite', 'admin'],
    ['org.remove_member', 'admin'],
    ['org.transfer', 'owner'],
    ['org.delete', 'owner'],

    // Audit
    ['audit.read', 'admin'],
  ]),
};

export class PermissionDeniedError extends Error {
  readonly kind = 'PermissionDeniedError' as const;
  constructor(
    public readonly actorRole: Role,
    public readonly permission: Permission,
  ) {
    super(`Role '${actorRole}' is not permitted to perform '${permission}'`);
    this.name = 'PermissionDeniedError';
  }
}

export const requirePermission = (
  policy: PermissionPolicy,
  actorRole: Role,
  permission: Permission,
): void => {
  if (!checkPermission(policy, actorRole, permission)) {
    throw new PermissionDeniedError(actorRole, permission);
  }
};
