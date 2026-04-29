import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { FsCAS } from '@codragraph/graphstore/dist/cas/fs-cas.js';
import { CasAuditLogger, orgScopedLogger } from '../src/audit/cas-log.js';
import { auditEventIdOf, buildAuditEvent, verifyAuditEvent } from '../src/audit/event.js';
import { makeOrgId, makeUserId } from '../src/types.js';

describe('audit/event — id derivation', () => {
  it('produces a stable id for the same body', () => {
    const orgId = makeOrgId('org_acme');
    const userId = makeUserId('user_alice');
    const a = buildAuditEvent({
      ts: '2026-04-29T10:00:00Z',
      orgId,
      actor: { kind: 'user', userId },
      action: 'repo.analyze',
      resource: { type: 'repo', id: 'demo' },
      result: 'success',
    });
    const b = buildAuditEvent({
      ts: '2026-04-29T10:00:00Z',
      orgId,
      actor: { kind: 'user', userId },
      action: 'repo.analyze',
      resource: { type: 'repo', id: 'demo' },
      result: 'success',
    });
    expect(a.id).toBe(b.id);
  });

  it('different bodies produce different ids', () => {
    const orgId = makeOrgId('org_acme');
    const userId = makeUserId('user_alice');
    const base = {
      ts: '2026-04-29T10:00:00Z',
      orgId,
      actor: { kind: 'user' as const, userId },
      action: 'repo.analyze',
      resource: { type: 'repo', id: 'demo' },
      result: 'success' as const,
    };
    const a = buildAuditEvent(base);
    const b = buildAuditEvent({ ...base, action: 'repo.delete' });
    expect(a.id).not.toBe(b.id);
  });

  it('verifyAuditEvent is true for an unmodified event', () => {
    const event = buildAuditEvent({
      ts: '2026-04-29T10:00:00Z',
      orgId: makeOrgId('org_acme'),
      actor: { kind: 'system', component: 'bg-job' },
      action: 'graphstore.gc',
      resource: { type: 'repo', id: 'demo' },
      result: 'success',
    });
    expect(verifyAuditEvent(event)).toBe(true);
  });

  it('verifyAuditEvent is false when fields are tampered', () => {
    const event = buildAuditEvent({
      ts: '2026-04-29T10:00:00Z',
      orgId: makeOrgId('org_acme'),
      actor: { kind: 'system', component: 'bg-job' },
      action: 'graphstore.gc',
      resource: { type: 'repo', id: 'demo' },
      result: 'success',
    });
    const tampered = { ...event, action: 'graphstore.delete' };
    expect(verifyAuditEvent(tampered)).toBe(false);
  });
});

describe('audit/cas-log — CasAuditLogger', () => {
  let tmp: string;
  let logger: CasAuditLogger;

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), 'codragraph-org-audit-'));
    const cas = new FsCAS({ root: path.join(tmp, 'cas') });
    logger = new CasAuditLogger(cas, path.join(tmp, 'log'));
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('records and lists a single event', async () => {
    const orgId = makeOrgId('org_acme');
    const event = await logger.record({
      ts: '2026-04-29T10:00:00Z',
      orgId,
      actor: { kind: 'user', userId: makeUserId('user_alice') },
      action: 'repo.analyze',
      resource: { type: 'repo', id: 'demo' },
      result: 'success',
    });
    expect(event.id).toBe(
      auditEventIdOf({
        ts: '2026-04-29T10:00:00Z',
        orgId,
        actor: { kind: 'user', userId: makeUserId('user_alice') },
        action: 'repo.analyze',
        resource: { type: 'repo', id: 'demo' },
        result: 'success',
      }),
    );

    const out: (typeof event)[] = [];
    for await (const e of logger.list()) out.push(e);
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe(event.id);
    expect(verifyAuditEvent(out[0]!)).toBe(true);
  });

  it('filters by orgId, action, and date range', async () => {
    const acme = makeOrgId('org_acme');
    const beta = makeOrgId('org_beta');
    await logger.record({
      ts: '2026-04-28T08:00:00Z',
      orgId: acme,
      actor: { kind: 'system', component: 'ingest' },
      action: 'repo.analyze',
      resource: { type: 'repo', id: 'a' },
      result: 'success',
    });
    await logger.record({
      ts: '2026-04-29T09:00:00Z',
      orgId: acme,
      actor: { kind: 'system', component: 'ingest' },
      action: 'repo.delete',
      resource: { type: 'repo', id: 'a' },
      result: 'success',
    });
    await logger.record({
      ts: '2026-04-29T09:30:00Z',
      orgId: beta,
      actor: { kind: 'system', component: 'ingest' },
      action: 'repo.analyze',
      resource: { type: 'repo', id: 'x' },
      result: 'success',
    });

    const acmeAnalyzes: unknown[] = [];
    for await (const e of logger.list({ orgId: acme, action: 'repo.analyze' })) {
      acmeAnalyzes.push(e);
    }
    expect(acmeAnalyzes).toHaveLength(1);

    const sinceFiltered: unknown[] = [];
    for await (const e of logger.list({ since: '2026-04-29T00:00:00Z' })) {
      sinceFiltered.push(e);
    }
    expect(sinceFiltered).toHaveLength(2);
  });

  it('orgScopedLogger injects orgId on record and list', async () => {
    const orgId = makeOrgId('org_scope');
    const scoped = orgScopedLogger(logger, orgId);
    await scoped.record({
      ts: '2026-04-29T11:00:00Z',
      // orgId omitted — wrapper supplies it.
      orgId: makeOrgId('org_will_be_replaced'),
      actor: { kind: 'system', component: 'scoped' },
      action: 'repo.read',
      resource: { type: 'repo', id: 'x' },
      result: 'success',
    });
    const out: { orgId: string }[] = [];
    for await (const e of scoped.list()) out.push(e);
    expect(out).toHaveLength(1);
    expect(out[0]?.orgId).toBe(orgId);
  });

  it('records survive a re-instantiation of the logger (durable)', async () => {
    const orgId = makeOrgId('org_durable');
    await logger.record({
      ts: '2026-04-29T12:00:00Z',
      orgId,
      actor: { kind: 'system', component: 'durable' },
      action: 'repo.read',
      resource: { type: 'repo', id: 'x' },
      result: 'success',
    });
    const cas2 = new FsCAS({ root: path.join(tmp, 'cas') });
    const reopened = new CasAuditLogger(cas2, path.join(tmp, 'log'));
    const out: unknown[] = [];
    for await (const e of reopened.list()) out.push(e);
    expect(out).toHaveLength(1);
  });
});
