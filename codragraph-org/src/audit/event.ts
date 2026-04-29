import { createHash } from 'node:crypto';
import { canonicalJsonStringify } from 'codragraph-graphstore/cas';
import type { ObjectId } from 'codragraph-graphstore/types';
import type { OrgId, UserId } from '../types.js';

/**
 * One immutable audit record. Fields are deliberately conservative:
 * everything an external SIEM expects (actor, action, resource, result,
 * timestamp) plus opaque `metadata` for caller-specific detail.
 *
 * The `id` is the sha256 of the canonical JSON of the record itself
 * (with `id` excluded during hashing) — making the log tamper-evident
 * by construction. Anyone can re-hash and verify.
 */
export interface AuditEvent {
  /** sha256 of the canonical JSON of this record sans `id`. */
  id: ObjectId;
  schemaVersion: 1;
  type: 'audit-event';
  ts: string;
  orgId: OrgId;
  actor: AuditActor;
  action: string;
  resource: AuditResource;
  result: 'success' | 'failure';
  ip?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}

export type AuditActor =
  | { kind: 'user'; userId: UserId }
  | { kind: 'api-key'; keyId: string }
  | { kind: 'system'; component: string };

export interface AuditResource {
  type: string;
  id: string;
}

export type AuditEventInput = Omit<AuditEvent, 'id' | 'schemaVersion' | 'type'>;

const HEX_RE = /^[0-9a-f]{64}$/;

const sha256Hex = (input: string): string => {
  return createHash('sha256').update(input, 'utf-8').digest('hex');
};

/** Compute the deterministic id for an event. */
export const auditEventIdOf = (input: AuditEventInput): ObjectId => {
  const canonical = canonicalJsonStringify({
    ...input,
    schemaVersion: 1,
    type: 'audit-event',
  });
  const hex = sha256Hex(canonical);
  if (!HEX_RE.test(hex)) {
    // Defensive — sha256 should always be 64 lowercase hex.
    throw new Error(`Bad sha256 output: ${hex}`);
  }
  return `sha256:${hex}` as ObjectId;
};

export const buildAuditEvent = (input: AuditEventInput): AuditEvent => {
  const id = auditEventIdOf(input);
  return {
    id,
    schemaVersion: 1,
    type: 'audit-event',
    ...input,
  };
};

/**
 * Re-derive the id from the body and check it matches the stored id.
 * False indicates the record was modified after writing.
 */
export const verifyAuditEvent = (event: AuditEvent): boolean => {
  const { id: _id, schemaVersion: _v, type: _t, ...body } = event;
  return auditEventIdOf(body) === event.id;
};
