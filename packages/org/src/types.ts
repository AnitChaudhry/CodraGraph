/**
 * Public types for codragraph-org.
 *
 * Branded ids prevent the type system from confusing org / user / membership
 * identifiers — a `UserId` cannot be passed where an `OrgId` is expected.
 */

declare const orgIdBrand: unique symbol;
declare const userIdBrand: unique symbol;

export type OrgId = string & { readonly [orgIdBrand]: true };
export type UserId = string & { readonly [userIdBrand]: true };

export const makeOrgId = (s: string): OrgId => {
  if (!ORG_ID_RE.test(s)) {
    throw new Error(`Invalid OrgId: ${JSON.stringify(s)}`);
  }
  return s as OrgId;
};

export const makeUserId = (s: string): UserId => {
  if (!USER_ID_RE.test(s)) {
    throw new Error(`Invalid UserId: ${JSON.stringify(s)}`);
  }
  return s as UserId;
};

const ORG_ID_RE = /^org_[A-Za-z0-9_-]{1,64}$/;
const USER_ID_RE = /^user_[A-Za-z0-9_-]{1,64}$/;

export type Role = 'owner' | 'admin' | 'member' | 'viewer';

export type Plan = 'free' | 'team' | 'enterprise';

export interface Org {
  id: OrgId;
  name: string;
  plan: Plan;
  createdAt: string;
  /** Optional storage scope override; defaults to derive-from-id. */
  storageNamespace?: string;
}

export interface User {
  id: UserId;
  email: string;
  emailVerified: boolean;
  name?: string;
  createdAt: string;
  /** SSO provenance — `${providerName}:${subject}`. Used for re-login lookup. */
  ssoSubject?: string;
}

export interface Membership {
  orgId: OrgId;
  userId: UserId;
  role: Role;
  addedAt: string;
}
