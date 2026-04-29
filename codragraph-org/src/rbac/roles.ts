import type { Role } from '../types.js';

/**
 * Role hierarchy — strictly ordered. Each role implies all roles below
 * it. Adding a role means inserting it into this array; the rest of
 * the rbac code derives its semantics from index position.
 */
export const ROLE_HIERARCHY: ReadonlyArray<Role> = ['viewer', 'member', 'admin', 'owner'];

const ROLE_RANK: Readonly<Record<Role, number>> = (() => {
  const out: Record<string, number> = {};
  ROLE_HIERARCHY.forEach((r, i) => {
    out[r] = i;
  });
  return out as Record<Role, number>;
})();

/** True iff `actual` confers at least the privileges of `required`. */
export const roleAtLeast = (actual: Role, required: Role): boolean => {
  return ROLE_RANK[actual] >= ROLE_RANK[required];
};
