import { describe, it, expect } from 'vitest';
import { roleAtLeast } from '../src/rbac/roles.js';
import {
  DEFAULT_POLICY,
  PermissionDeniedError,
  checkPermission,
  requirePermission,
} from '../src/rbac/check.js';

describe('rbac/roles', () => {
  it('orders roles strictly', () => {
    expect(roleAtLeast('owner', 'admin')).toBe(true);
    expect(roleAtLeast('admin', 'member')).toBe(true);
    expect(roleAtLeast('member', 'viewer')).toBe(true);
    expect(roleAtLeast('viewer', 'member')).toBe(false);
    expect(roleAtLeast('member', 'admin')).toBe(false);
    expect(roleAtLeast('admin', 'owner')).toBe(false);
  });

  it('a role is at-least itself', () => {
    expect(roleAtLeast('admin', 'admin')).toBe(true);
    expect(roleAtLeast('viewer', 'viewer')).toBe(true);
  });
});

describe('rbac/check — DEFAULT_POLICY', () => {
  it('viewer can read repos and recipes', () => {
    expect(checkPermission(DEFAULT_POLICY, 'viewer', 'repo.read')).toBe(true);
    expect(checkPermission(DEFAULT_POLICY, 'viewer', 'recipe.read')).toBe(true);
  });

  it('viewer cannot analyze, create, or delete', () => {
    expect(checkPermission(DEFAULT_POLICY, 'viewer', 'repo.analyze')).toBe(false);
    expect(checkPermission(DEFAULT_POLICY, 'viewer', 'recipe.create')).toBe(false);
    expect(checkPermission(DEFAULT_POLICY, 'viewer', 'repo.delete')).toBe(false);
  });

  it('admin can read audit; member cannot', () => {
    expect(checkPermission(DEFAULT_POLICY, 'admin', 'audit.read')).toBe(true);
    expect(checkPermission(DEFAULT_POLICY, 'member', 'audit.read')).toBe(false);
  });

  it('only owner can transfer or delete the org', () => {
    expect(checkPermission(DEFAULT_POLICY, 'owner', 'org.delete')).toBe(true);
    expect(checkPermission(DEFAULT_POLICY, 'admin', 'org.delete')).toBe(false);
  });

  it('unknown permissions default to owner-only (fail closed)', () => {
    expect(checkPermission(DEFAULT_POLICY, 'admin', 'unknown.action')).toBe(false);
    expect(checkPermission(DEFAULT_POLICY, 'owner', 'unknown.action')).toBe(true);
  });

  it('requirePermission throws PermissionDeniedError on miss', () => {
    expect(() => requirePermission(DEFAULT_POLICY, 'viewer', 'repo.delete')).toThrow(
      PermissionDeniedError,
    );
  });

  it('requirePermission is a no-op on hit', () => {
    expect(() => requirePermission(DEFAULT_POLICY, 'admin', 'repo.delete')).not.toThrow();
  });
});
