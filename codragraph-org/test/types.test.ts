import { describe, it, expect } from 'vitest';
import { makeOrgId, makeUserId } from '../src/types.js';

describe('types — branded id constructors', () => {
  it('accepts well-formed org ids', () => {
    expect(() => makeOrgId('org_acme')).not.toThrow();
    expect(() => makeOrgId('org_AB-C_123')).not.toThrow();
  });

  it('rejects malformed org ids', () => {
    expect(() => makeOrgId('acme')).toThrow();
    expect(() => makeOrgId('org_')).toThrow();
    expect(() => makeOrgId('ORG_acme')).toThrow();
    expect(() => makeOrgId('org_with/slash')).toThrow();
    expect(() => makeOrgId('org_' + 'a'.repeat(65))).toThrow();
  });

  it('accepts well-formed user ids', () => {
    expect(() => makeUserId('user_alice')).not.toThrow();
    expect(() => makeUserId('user_42')).not.toThrow();
  });

  it('rejects malformed user ids', () => {
    expect(() => makeUserId('alice')).toThrow();
    expect(() => makeUserId('user_with space')).toThrow();
    expect(() => makeUserId('')).toThrow();
  });
});
