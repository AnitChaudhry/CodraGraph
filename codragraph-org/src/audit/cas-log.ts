import { promises as fs } from 'node:fs';
import path from 'node:path';
import { type ContentAddressedStore, putJson, getJson } from 'codragraph-graphstore/cas';
import type { ObjectId } from 'codragraph-graphstore/types';
import type { OrgId } from '../types.js';
import type { AuditEvent, AuditEventInput } from './event.js';
import { buildAuditEvent } from './event.js';
import type { AuditListFilter, AuditLogger } from './interface.js';

/**
 * CAS-backed audit log. Each event is stored as one immutable CAS
 * object; a per-day index file lists event ids in append order. This
 * inherits the graphstore's tamper-evidence story: any mutation changes
 * the CAS id, which then no longer matches the index entry.
 *
 * Layout:
 *   <indexRoot>/index/YYYY-MM-DD.jsonl   one event id per line, append order
 *   <cas>/objects/<aa>/<rest>.json       the event body (via graphstore CAS)
 */
export class CasAuditLogger implements AuditLogger {
  constructor(
    private readonly cas: ContentAddressedStore,
    private readonly indexRoot: string,
  ) {}

  async record(input: AuditEventInput): Promise<AuditEvent> {
    const event = buildAuditEvent(input);

    // Store the body WITHOUT `id` so the CAS digest of the bytes
    // matches the event's id by construction (the id is the digest of
    // the body sans id). CAS is idempotent — same bytes = same id, so
    // duplicates are naturally deduplicated.
    const { id: _id, ...body } = event;
    const casId = await putJson(this.cas, body);
    if (casId !== event.id) {
      throw new Error(
        `CAS id ${casId} disagrees with computed audit-event id ${event.id}; ` +
          `canonical JSON or hashing logic is out of sync.`,
      );
    }

    // Append to the day index. Use day-bucketed files so listing for
    // a date range is cheap and so very busy logs can be archived
    // by day.
    const day = event.ts.slice(0, 10);
    const indexPath = path.join(this.indexRoot, 'index', `${day}.jsonl`);
    await fs.mkdir(path.dirname(indexPath), { recursive: true });
    const line =
      JSON.stringify({ id: event.id, orgId: event.orgId, ts: event.ts, action: event.action }) +
      '\n';
    await fs.appendFile(indexPath, line, 'utf-8');

    return event;
  }

  async *list(filter: AuditListFilter = {}): AsyncIterable<AuditEvent> {
    const days = await this.listDays();
    let yielded = 0;
    for (const day of days) {
      if (filter.since && day < filter.since.slice(0, 10)) continue;
      if (filter.until && day > filter.until.slice(0, 10)) continue;
      const indexPath = path.join(this.indexRoot, 'index', `${day}.jsonl`);
      let raw: string;
      try {
        raw = await fs.readFile(indexPath, 'utf-8');
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw err;
      }
      for (const line of raw.split('\n')) {
        if (!line) continue;
        const head = JSON.parse(line) as {
          id: ObjectId;
          orgId: string;
          ts: string;
          action: string;
        };
        if (filter.orgId && head.orgId !== filter.orgId) continue;
        if (filter.action && head.action !== filter.action) continue;
        if (filter.since && head.ts < filter.since) continue;
        if (filter.until && head.ts > filter.until) continue;
        const body = await getJson<Omit<AuditEvent, 'id'>>(this.cas, head.id);
        // Synthesize the full event by attaching the id read from the
        // index — this is the inverse of the strip-on-write in record().
        const event: AuditEvent = { ...body, id: head.id };
        yield event;
        yielded++;
        if (filter.limit !== undefined && yielded >= filter.limit) return;
      }
    }
  }

  private async listDays(): Promise<string[]> {
    const dir = path.join(this.indexRoot, 'index');
    try {
      const files = await fs.readdir(dir);
      return files
        .filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
        .map((f) => f.slice(0, 10))
        .sort();
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
  }
}

/**
 * Convenience: a pre-scoped logger that injects the active org's id
 * into every record. Wrap a {@link CasAuditLogger} (or any
 * {@link AuditLogger}) for use inside a tenant-aware request handler.
 */
export const orgScopedLogger = (logger: AuditLogger, orgId: OrgId): AuditLogger => ({
  record: (input) => logger.record({ ...input, orgId }),
  list: (filter) => logger.list({ ...filter, orgId }),
});
