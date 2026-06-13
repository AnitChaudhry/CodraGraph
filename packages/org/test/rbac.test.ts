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

  it('supports cluster-level read, context-pack, impact, and audit permissions', () => {
    expect(checkPermission(DEFAULT_POLICY, 'viewer', 'cluster.read')).toBe(true);
    expect(checkPermission(DEFAULT_POLICY, 'viewer', 'cluster.context_pack')).toBe(true);
    expect(checkPermission(DEFAULT_POLICY, 'viewer', 'cluster.impact')).toBe(false);
    expect(checkPermission(DEFAULT_POLICY, 'member', 'cluster.impact')).toBe(true);
    expect(checkPermission(DEFAULT_POLICY, 'member', 'cluster.audit')).toBe(false);
    expect(checkPermission(DEFAULT_POLICY, 'admin', 'cluster.audit')).toBe(true);
  });

  it('admin can read audit; member cannot', () => {
    expect(checkPermission(DEFAULT_POLICY, 'admin', 'audit.read')).toBe(true);
    expect(checkPermission(DEFAULT_POLICY, 'member', 'audit.read')).toBe(false);
  });

  it('covers team graphpack, semantic, recipe reuse, and team MCP permissions', () => {
    expect(checkPermission(DEFAULT_POLICY, 'viewer', 'graphpack.read')).toBe(true);
    expect(checkPermission(DEFAULT_POLICY, 'viewer', 'graphpack.pull')).toBe(true);
    expect(checkPermission(DEFAULT_POLICY, 'member', 'graphpack.publish')).toBe(false);
    expect(checkPermission(DEFAULT_POLICY, 'admin', 'graphpack.publish')).toBe(true);
    expect(checkPermission(DEFAULT_POLICY, 'viewer', 'semantic.read')).toBe(true);
    expect(checkPermission(DEFAULT_POLICY, 'member', 'semantic.extract')).toBe(true);
    expect(checkPermission(DEFAULT_POLICY, 'viewer', 'recipe.reuse')).toBe(true);
    expect(checkPermission(DEFAULT_POLICY, 'member', 'recipe.publish')).toBe(true);
    expect(checkPermission(DEFAULT_POLICY, 'viewer', 'team_mcp.access')).toBe(true);
    expect(checkPermission(DEFAULT_POLICY, 'viewer', 'team_mcp.serve')).toBe(false);
    expect(checkPermission(DEFAULT_POLICY, 'member', 'team_mcp.serve')).toBe(true);
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
