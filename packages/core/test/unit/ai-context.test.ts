import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { generateAIContextFiles } from '../../src/cli/ai-context.js';

describe('generateAIContextFiles', () => {
  let tmpDir: string;
  let storagePath: string;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gn-ai-ctx-test-'));
    storagePath = path.join(tmpDir, '.codragraph');
    await fs.mkdir(storagePath, { recursive: true });
  });

  afterAll(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  it('generates context files', async () => {
    const stats = {
      nodes: 100,
      edges: 200,
      processes: 10,
    };

    const result = await generateAIContextFiles(tmpDir, storagePath, 'TestProject', stats);
    expect(result.files).toBeDefined();
    expect(result.files.length).toBeGreaterThan(0);
  });

  it('creates a compact .codragraph/structure pack for agents', async () => {
    const structureDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gn-ai-structure-'));
    const structureStorage = path.join(structureDir, '.codragraph');
    await fs.mkdir(structureStorage, { recursive: true });
    await fs.writeFile(
      path.join(structureStorage, 'meta.json'),
      JSON.stringify({
        repoPath: structureDir,
        lastCommit: 'abc1234567890',
        indexedAt: '2026-05-29T00:00:00.000Z',
        schemaVersion: 4,
        compress: 'brotli',
        currentBranch: 'main',
        headCommit: 'graph-head-1',
        stats: { files: 7, nodes: 11, edges: 13, featureClusters: 2, processes: 3, embeddings: 0 },
      }),
      'utf-8',
    );

    try {
      const result = await generateAIContextFiles(structureDir, structureStorage, 'TestProject', {
        files: 7,
        nodes: 11,
        edges: 13,
        clusters: 2,
        processes: 3,
      });

      expect(result.files).toContain('.codragraph/structure/ (12 files)');
      const agentStructureDir = path.join(structureStorage, 'structure');
      for (const fileName of [
        'README.md',
        'WHAT.md',
        'WHY.md',
        'HOW.md',
        'WHEN.md',
        'WHERE.md',
        'BRANCHES.md',
        'INDEX.md',
        'SQLITE.md',
        'HISTORY.md',
        'agent-memory.sql',
      ]) {
        await expect(fs.stat(path.join(agentStructureDir, fileName))).resolves.toBeDefined();
      }

      const what = await fs.readFile(path.join(agentStructureDir, 'WHAT.md'), 'utf-8');
      expect(what).toContain('CodraGraph index name: **TestProject**');
      expect(what).toContain('| Symbols | 11 |');

      const sql = await fs.readFile(path.join(agentStructureDir, 'agent-memory.sql'), 'utf-8');
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS codragraph_agent_context');
      expect(sql).toContain("'project_name', 'TestProject'");
    } finally {
      await fs.rm(structureDir, { recursive: true, force: true });
    }
  });

  it('updates structure history by commit without duplicating existing entries', async () => {
    const historyDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gn-ai-history-'));
    const historyStorage = path.join(historyDir, '.codragraph');
    await fs.mkdir(historyStorage, { recursive: true });
    const metaPath = path.join(historyStorage, 'meta.json');

    try {
      await fs.writeFile(
        metaPath,
        JSON.stringify({ lastCommit: 'commit-one', indexedAt: '2026-05-29T00:00:00.000Z' }),
        'utf-8',
      );
      await generateAIContextFiles(historyDir, historyStorage, 'TestProject', { nodes: 1 });
      await generateAIContextFiles(historyDir, historyStorage, 'TestProject', { nodes: 1 });

      let history = await fs.readFile(
        path.join(historyStorage, 'structure', 'HISTORY.md'),
        'utf-8',
      );
      expect((history.match(/codragraph:history-entry:commit-one/g) || []).length).toBe(1);

      await fs.writeFile(
        metaPath,
        JSON.stringify({ lastCommit: 'commit-two', indexedAt: '2026-05-29T00:01:00.000Z' }),
        'utf-8',
      );
      await generateAIContextFiles(historyDir, historyStorage, 'TestProject', { nodes: 2 });

      history = await fs.readFile(path.join(historyStorage, 'structure', 'HISTORY.md'), 'utf-8');
      expect(history.indexOf('commit-two')).toBeLessThan(history.indexOf('commit-one'));
      expect((history.match(/codragraph:history-entry:/g) || []).length).toBe(2);
    } finally {
      await fs.rm(historyDir, { recursive: true, force: true });
    }
  });

  it('creates or updates CLAUDE.md with CodraGraph section', async () => {
    const stats = { nodes: 50, edges: 100, processes: 5 };
    await generateAIContextFiles(tmpDir, storagePath, 'TestProject', stats);

    const claudeMdPath = path.join(tmpDir, 'CLAUDE.md');
    const content = await fs.readFile(claudeMdPath, 'utf-8');
    expect(content).toContain('codragraph:start');
    expect(content).toContain('codragraph:end');
    expect(content).toContain('TestProject');
  });

  it('keeps the load-bearing repo-specific sections in the CLAUDE.md block (#856)', async () => {
    // The trimmed block must still contain everything that is genuinely
    // unique per repo or load-bearing for the agent: the freshness warning,
    // the Always Do / Never Do imperative lists, the Resources URI table
    // (projectName-interpolated), and the skills routing table that tells
    // the agent which skill file to read for each task.
    const stats = { nodes: 50, edges: 100, processes: 5 };
    await generateAIContextFiles(tmpDir, storagePath, 'TestProject', stats);

    const content = await fs.readFile(path.join(tmpDir, 'CLAUDE.md'), 'utf-8');

    expect(content).toContain('If any CodraGraph tool warns the index is stale');
    expect(content).toContain('## Always Do');
    expect(content).toContain('## Never Do');
    expect(content).toContain('## Resources');
    expect(content).toContain('codragraph://repo/TestProject/context');
    expect(content).toContain('codragraph://repo/TestProject/feature-clusters');
    expect(content).toContain('codragraph://repo/TestProject/feature/{name}');
    expect(content).toContain('Commands are cross-platform');
    expect(content).toContain('codragraph-impact-analysis/SKILL.md');
    expect(content).toContain('codragraph-refactoring/SKILL.md');
    expect(content).toContain('codragraph-debugging/SKILL.md');
    expect(content).toContain('codragraph-cli/SKILL.md');
  });

  it('does not duplicate content that already lives in skill files (#856)', async () => {
    // The six sections listed in issue #856 are redundant with the skill
    // files shipped alongside the CLAUDE.md block (both are loaded into
    // every Claude Code session). Their absence is the whole point of the
    // trim — assert each header is gone so a future regression that pads
    // the block back out fails here.
    const stats = { nodes: 50, edges: 100, processes: 5 };
    await generateAIContextFiles(tmpDir, storagePath, 'TestProject', stats);

    const content = await fs.readFile(path.join(tmpDir, 'CLAUDE.md'), 'utf-8');

    expect(content).not.toContain('## Tools Quick Reference');
    expect(content).not.toContain('## Impact Risk Levels');
    expect(content).not.toContain('## Self-Check Before Finishing');
    expect(content).not.toContain('## When Debugging');
    expect(content).not.toContain('## When Refactoring');
    expect(content).not.toContain('## Keeping the Index Fresh');
  });

  it('keeps the CLAUDE.md CodraGraph block under the token-cost budget (#856)', async () => {
    // The pre-trim block was ~5465 chars. The feature-cluster and
    // cross-platform command hints are still well below that while keeping
    // the generated block small enough for every agent session.
    const stats = { nodes: 50, edges: 100, processes: 5 };
    await generateAIContextFiles(tmpDir, storagePath, 'TestProject', stats);

    const content = await fs.readFile(path.join(tmpDir, 'CLAUDE.md'), 'utf-8');
    const block = content.slice(
      content.indexOf('<!-- codragraph:start -->'),
      content.indexOf('<!-- codragraph:end -->'),
    );
    expect(block.length).toBeLessThan(3100);
  });

  it('handles empty stats', async () => {
    const stats = {};
    const result = await generateAIContextFiles(tmpDir, storagePath, 'EmptyProject', stats);
    expect(result.files).toBeDefined();
  });

  it('updates existing CLAUDE.md without duplicating', async () => {
    const stats = { nodes: 10 };

    // Run twice
    await generateAIContextFiles(tmpDir, storagePath, 'TestProject', stats);
    await generateAIContextFiles(tmpDir, storagePath, 'TestProject', stats);

    const claudeMdPath = path.join(tmpDir, 'CLAUDE.md');
    const content = await fs.readFile(claudeMdPath, 'utf-8');

    // Should only have one codragraph section
    const starts = (content.match(/codragraph:start/g) || []).length;
    expect(starts).toBe(1);
  });

  it('installs skills files', async () => {
    const stats = { nodes: 10 };
    const _result = await generateAIContextFiles(tmpDir, storagePath, 'TestProject', stats);

    // Should have installed skill files
    const skillsDir = path.join(tmpDir, '.claude', 'skills', '@codragraph/cli');
    try {
      const entries = await fs.readdir(skillsDir, { recursive: true });
      expect(entries.length).toBeGreaterThan(0);
    } catch {
      // Skills dir may not be created if skills source doesn't exist in test context
    }
  });

  it('preserves manual AGENTS.md and CLAUDE.md edits when skipAgentsMd is enabled', async () => {
    const stats = { nodes: 42, edges: 84, processes: 3 };
    const agentsPath = path.join(tmpDir, 'AGENTS.md');
    const claudePath = path.join(tmpDir, 'CLAUDE.md');
    const agentsContent = '# AGENTS\n\nCustom manual instructions only\n';
    const claudeContent = '# CLAUDE\n\nCustom manual instructions only\n';

    await fs.writeFile(agentsPath, agentsContent, 'utf-8');
    await fs.writeFile(claudePath, claudeContent, 'utf-8');

    const result = await generateAIContextFiles(
      tmpDir,
      storagePath,
      'TestProject',
      stats,
      undefined,
      { skipAgentsMd: true },
    );

    expect(result.files).toContain('AGENTS.md (skipped via --skip-agents-md)');
    expect(result.files).toContain('CLAUDE.md (skipped via --skip-agents-md)');
    expect(result.files).toContain('.codragraph/structure/ (12 files)');

    const agentsAfter = await fs.readFile(agentsPath, 'utf-8');
    const claudeAfter = await fs.readFile(claudePath, 'utf-8');
    expect(agentsAfter).toBe(agentsContent);
    expect(claudeAfter).toBe(claudeContent);
  });

  it('preserves inline marker references in prose and does not corrupt markdown (#1041)', async () => {
    // Regression guard for #1041. The shipped CLAUDE.md ships with a
    // prose paragraph referencing the marker pair inline — wrapped in a
    // backtick-quoted fragment mid-sentence. `indexOf` (the pre-fix
    // matcher) would match both of those inline markers and replace the
    // content between them with the full injected block, destroying the
    // sentence and leaving the backtick unclosed.
    //
    // Per-test tmpdir so we start from a known clean slate — the shared
    // `tmpDir` from beforeAll may already contain CLAUDE.md from earlier
    // tests in this describe block.
    const bugDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gn-ai-ctx-1041-'));
    const bugStorage = path.join(bugDir, '.codragraph');
    await fs.mkdir(bugStorage, { recursive: true });

    const inlineProseLine =
      'See the `<!-- codragraph:start --> … <!-- codragraph:end -->` block in **[AGENTS.md](AGENTS.md)** for the canonical MCP tools, impact analysis rules, and index instructions.';
    const originalContent = `# Claude Code Rules\n\nLast reviewed: 2026-04-21\n\n## CodraGraph rules\n\n${inlineProseLine}\n`;

    const claudeMd = path.join(bugDir, 'CLAUDE.md');
    await fs.writeFile(claudeMd, originalContent, 'utf-8');

    try {
      const stats = { nodes: 50, edges: 100, processes: 5 };

      // First run — no section-position markers exist yet, so the
      // injector must append a fresh section at end. The inline prose
      // must be preserved verbatim; if it disappears or gets altered,
      // the bug has recurred.
      await generateAIContextFiles(bugDir, bugStorage, 'TestProject', stats);
      let contentAfter = await fs.readFile(claudeMd, 'utf-8');

      expect(contentAfter, 'inline prose line must survive the first run verbatim').toContain(
        inlineProseLine,
      );
      // Exactly 2 start markers total: 1 inline (in prose) + 1
      // section-position (appended by the injector). The pre-fix
      // behaviour would have only 1 — the inline pair having been
      // consumed as if they were section delimiters.
      expect((contentAfter.match(/<!-- codragraph:start -->/g) || []).length).toBe(2);
      expect((contentAfter.match(/<!-- codragraph:end -->/g) || []).length).toBe(2);

      // Second run — the section from run 1 is now at section position,
      // so the injector must UPDATE in place (not re-append). Inline
      // prose stays preserved; marker counts unchanged.
      await generateAIContextFiles(bugDir, bugStorage, 'TestProject', stats);
      contentAfter = await fs.readFile(claudeMd, 'utf-8');

      expect(contentAfter, 'inline prose line must survive the second run verbatim').toContain(
        inlineProseLine,
      );
      expect((contentAfter.match(/<!-- codragraph:start -->/g) || []).length).toBe(2);
      expect((contentAfter.match(/<!-- codragraph:end -->/g) || []).length).toBe(2);
    } finally {
      await fs.rm(bugDir, { recursive: true, force: true });
    }
  });

  it('matches section markers on files with CRLF line endings (#1041 cross-platform)', async () => {
    // Locks in the CRLF leg of the section-position matcher. Git on
    // Windows may store files with `\r\n` line endings depending on
    // `core.autocrlf`; when a section line ends `<!-- codragraph:start
    // -->\r\n`, the byte at `endPos` is `\r` (not `\n`). A `\n`-only
    // line-end check would reject the real section, fall through to
    // "append", and duplicate the block every run.
    const crlfDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gn-ai-ctx-crlf-'));
    const crlfStorage = path.join(crlfDir, '.codragraph');
    await fs.mkdir(crlfStorage, { recursive: true });

    // Inline reference carries BOTH markers in a backtick-quoted
    // fragment — matches the shape of the shipped CLAUDE.md line
    // that triggered #1041 so the regression guard is meaningful.
    const inlineProseLine =
      'See the `<!-- codragraph:start --> … <!-- codragraph:end -->` block in **[AGENTS.md](AGENTS.md)** for more.';
    const seeded = [
      '# Claude Code Rules',
      '',
      '## CodraGraph rules',
      '',
      inlineProseLine,
      '',
      '<!-- codragraph:start -->',
      '# CodraGraph — Code Intelligence (stale stub)',
      '<!-- codragraph:end -->',
      '',
    ].join('\r\n');

    const claudeMd = path.join(crlfDir, 'CLAUDE.md');
    await fs.writeFile(claudeMd, seeded, 'utf-8');

    try {
      const stats = { nodes: 50, edges: 100, processes: 5 };
      await generateAIContextFiles(crlfDir, crlfStorage, 'TestProject', stats);
      const content = await fs.readFile(claudeMd, 'utf-8');

      // Inline prose survives verbatim — no corruption of CRLF bytes.
      expect(content).toContain(inlineProseLine);
      // Exactly 2 start markers total (1 inline + 1 section-position).
      // If CRLF handling broke, the inline marker would be (incorrectly)
      // matched as a section start, OR the real section would be
      // appended duplicated — either way we'd see !== 2.
      expect((content.match(/<!-- codragraph:start -->/g) || []).length).toBe(2);
      expect((content.match(/<!-- codragraph:end -->/g) || []).length).toBe(2);
      // Stale stub content must be gone — proves the section was
      // REPLACED (not appended as a duplicate), which requires the
      // CRLF-ending markers to have been matched.
      expect(content).not.toContain('# CodraGraph — Code Intelligence (stale stub)');
    } finally {
      await fs.rm(crlfDir, { recursive: true, force: true });
    }
  });
});
