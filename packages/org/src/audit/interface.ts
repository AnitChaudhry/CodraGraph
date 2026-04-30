import type { OrgId } from '../types.js';
import type { AuditEvent, AuditEventInput } from './event.js';

/**
 * Append-only audit log scoped to a single org. Implementations MUST be:
 *   - **Append-only:** `record` cannot replace or delete an existing event.
 *   - **Tamper-evident:** the persisted form is verifiable via
 *     {@link verifyAuditEvent} — re-hashing must reproduce the stored id.
 *   - **Synchronous:** `record` resolves only after the bytes are durable
 *     (no in-memory buffering). Audit must not be lost if the process
 *     crashes immediately after the call returns.
 */
export interface AuditLogger {
  record(input: AuditEventInput): Promise<AuditEvent>;
  list(filter?: AuditListFilter): AsyncIterable<AuditEvent>;
}

export interface AuditListFilter {
  orgId?: OrgId;
  action?: string;
  /** Lower bound on `event.ts`, ISO 8601 inclusive. */
  since?: string;
  /** Upper bound on `event.ts`, ISO 8601 inclusive. */
  until?: string;
  /** Hard cap on results; the iterable terminates after this many. */
  limit?: number;
}
