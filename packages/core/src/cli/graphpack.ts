import path from 'node:path';
import { createRequire } from 'node:module';
import {
  bootstrapGraphpack,
  getGraphpackStatus,
  publishGraphpack,
  pullGraphpack,
  type GraphpackTarget,
} from '../core/graphpack/index.js';
import { analyzeSemanticRelationships } from '../core/semantic/relationships.js';
import { findRepo, getStoragePaths, registerRepo } from '../storage/repo-manager.js';
import { getGitRoot, getInferredRepoName } from '../storage/git.js';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json') as { version: string };

interface ResolvedGraphpackRepo {
  readonly repoPath: string;
  readonly storagePath: string;
  readonly repoName: string;
}

const resolveRepoForGraphpack = async (): Promise<ResolvedGraphpackRepo> => {
  const indexed = await findRepo(process.cwd());
  if (indexed) {
    return {
      repoPath: indexed.repoPath,
      storagePath: indexed.storagePath,
      repoName: getInferredRepoName(indexed.repoPath) ?? path.basename(indexed.repoPath),
    };
  }
  const gitRoot = getGitRoot(process.cwd());
  if (!gitRoot) {
    throw new Error('Not inside a git repository and no CodraGraph index was found.');
  }
  const paths = getStoragePaths(gitRoot);
  return {
    repoPath: gitRoot,
    storagePath: paths.storagePath,
    repoName: getInferredRepoName(gitRoot) ?? path.basename(gitRoot),
  };
};

export const bootstrapCommand = async (
  opts: {
    lock?: string;
    artifactDir?: string;
    materialize?: boolean;
    json?: boolean;
  } = {},
): Promise<void> => {
  const repo = await resolveRepoForGraphpack();
  const result = await bootstrapGraphpack({
    repoPath: repo.repoPath,
    storagePath: repo.storagePath,
    lockPath: opts.lock ? path.resolve(opts.lock) : undefined,
    artifactDir: opts.artifactDir ? path.resolve(opts.artifactDir) : undefined,
  });
  await maybeRegisterRepo(repo);
  if (opts.materialize !== false && result.materializable) {
    await materializeGraphpackHead(result.status.lock?.graphpack.graphstoreHeadCommit);
  }
  if (opts.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  printPullLikeResult('bootstrap', result);
};

export const graphpackPublishCommand = async (
  opts: {
    target?: GraphpackTarget;
    repo?: string;
    artifactDir?: string;
    artifactUrl?: string;
    baseSnapshot?: string;
    headSnapshot?: string;
    pr?: string;
    json?: boolean;
  } = {},
): Promise<void> => {
  const repo = await resolveRepoForGraphpack();
  const result = await publishGraphpack({
    repoPath: repo.repoPath,
    storagePath: repo.storagePath,
    repoName: opts.repo ?? repo.repoName,
    analyzerVersion: pkg.version,
    target: opts.target ?? 'main',
    artifactDir: opts.artifactDir ? path.resolve(opts.artifactDir) : undefined,
    artifactUrl: opts.artifactUrl,
    baseSnapshotId: opts.baseSnapshot,
    headSnapshotId: opts.headSnapshot,
    pullRequest: opts.pr,
  });
  if (opts.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  process.stdout.write(
    [
      `graphpack: ${result.lock.graphpack.id}`,
      `target: ${result.lock.graphpack.target}`,
      `lock: ${result.lockPath}`,
      `manifest: ${result.manifestPath}`,
      `snapshot: ${result.lock.graphpack.graphstoreSnapshot ?? '(unknown)'}`,
      `chunks: ${result.lock.chunks.length}`,
    ].join('\n') + '\n',
  );
};

export const graphpackPullCommand = async (
  opts: {
    lock?: string;
    artifactDir?: string;
    materialize?: boolean;
    json?: boolean;
  } = {},
): Promise<void> => {
  const repo = await resolveRepoForGraphpack();
  const result = await pullGraphpack({
    repoPath: repo.repoPath,
    storagePath: repo.storagePath,
    lockPath: opts.lock ? path.resolve(opts.lock) : undefined,
    artifactDir: opts.artifactDir ? path.resolve(opts.artifactDir) : undefined,
  });
  await maybeRegisterRepo(repo);
  if (opts.materialize !== false && result.materializable) {
    await materializeGraphpackHead(result.status.lock?.graphpack.graphstoreHeadCommit);
  }
  if (opts.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  printPullLikeResult('pull', result);
};

export const graphpackStatusCommand = async (
  opts: {
    lock?: string;
    strict?: boolean;
    json?: boolean;
  } = {},
): Promise<void> => {
  const repo = await resolveRepoForGraphpack();
  const status = await getGraphpackStatus({
    repoPath: repo.repoPath,
    storagePath: repo.storagePath,
    lockPath: opts.lock ? path.resolve(opts.lock) : undefined,
    strict: opts.strict,
  });
  if (opts.json) {
    process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
    return;
  }
  const lines = [
    `source: ${status.source}`,
    `lock: ${status.lockPresent ? status.lockPath : 'missing'}`,
    `local_graphstore: ${status.local.graphstorePresent ? 'present' : 'missing'}`,
    status.local.headCommit ? `local_head: ${status.local.headCommit}` : undefined,
    status.lock?.graphpack.graphstoreSnapshot
      ? `lock_snapshot: ${status.lock.graphpack.graphstoreSnapshot}`
      : undefined,
    `chunks: ${status.chunks.verified}/${status.chunks.expected} verified`,
    `compatible: ${status.compatibility.ok ? 'yes' : 'no'}`,
  ].filter(Boolean);
  if (status.compatibility.reasons.length > 0) {
    lines.push('reasons:');
    for (const reason of status.compatibility.reasons) lines.push(`  - ${reason}`);
  }
  if (status.chunks.missing.length > 0) {
    lines.push('missing:');
    for (const chunk of status.chunks.missing) lines.push(`  - ${chunk}`);
  }
  process.stdout.write(`${lines.join('\n')}\n`);
};

export const semanticAnalyzeCommand = async (
  opts: {
    llm?: boolean;
    limit?: string;
    write?: boolean;
    json?: boolean;
  } = {},
): Promise<void> => {
  const repo = await resolveRepoForGraphpack();
  const report = await analyzeSemanticRelationships({
    storagePath: repo.storagePath,
    llm: opts.llm,
    write: opts.write !== false,
    limit: opts.limit ? Number.parseInt(opts.limit, 10) : undefined,
  });
  if (opts.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  const lines = [
    `snapshot: ${report.snapshotId ?? '(unknown)'}`,
    `extractor: ${report.extractorVersion}`,
    `llm: ${report.llmEnabled ? 'enabled' : 'disabled'}`,
    `relationships: ${report.relationships.length}`,
  ];
  for (const [family, count] of Object.entries(report.summary)) {
    if (count > 0) lines.push(`  ${family}: ${count}`);
  }
  process.stdout.write(`${lines.join('\n')}\n`);
};

export const recipesLookupCommand = async (
  opts: {
    taskFamily?: string;
    snapshotId?: string;
    recipeStore?: string;
    requiredSubgraphSignature?: string;
    limit?: string;
    json?: boolean;
  } = {},
): Promise<void> => {
  if (!opts.taskFamily) throw new Error('recipes lookup requires --task-family <name>');
  const repo = await resolveRepoForGraphpack();
  const snapshotId =
    opts.snapshotId ??
    (await getGraphpackStatus({ repoPath: repo.repoPath, storagePath: repo.storagePath })).lock
      ?.graphpack.graphstoreSnapshot;
  if (!snapshotId) {
    throw new Error('recipes lookup requires --snapshot-id when no graphpack lock is available.');
  }
  const moduleId: string = '@codragraph/harness/mcp/handler';
  const mod = (await import(/* @vite-ignore */ moduleId)) as {
    handleHarnessRecipesLookup?: (input: unknown) => Promise<unknown>;
  };
  if (!mod.handleHarnessRecipesLookup) {
    throw new Error('@codragraph/harness/mcp/handler does not export handleHarnessRecipesLookup');
  }
  const result = await mod.handleHarnessRecipesLookup({
    task_family: opts.taskFamily,
    snapshot_id: snapshotId,
    recipe_store: opts.recipeStore ?? path.join(repo.storagePath, 'recipes'),
    required_subgraph_signature: opts.requiredSubgraphSignature,
    limit: opts.limit ? Number.parseInt(opts.limit, 10) : undefined,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
};

export const teamServeCommand = async (
  opts: {
    graphpack?: string;
    port?: string;
    host?: string;
    web?: string;
  } = {},
): Promise<void> => {
  const repo = await resolveRepoForGraphpack();
  const status = await getGraphpackStatus({
    repoPath: repo.repoPath,
    storagePath: repo.storagePath,
  });
  if (opts.graphpack && status.lock?.graphpack.id !== opts.graphpack) {
    throw new Error(
      `Requested graphpack ${opts.graphpack}, but lock points at ${
        status.lock?.graphpack.id ?? '(none)'
      }. Run graphpack pull or pass the matching id.`,
    );
  }
  process.env.CODRAGRAPH_TEAM_GRAPH_MODE = '1';
  process.env.CODRAGRAPH_ACTIVE_GRAPHPACK = opts.graphpack ?? status.lock?.graphpack.id ?? '';
  const { serveCommand } = await import('./serve.js');
  await serveCommand({ port: opts.port, host: opts.host, web: opts.web ?? 'hosted' });
};

const maybeRegisterRepo = async (repo: ResolvedGraphpackRepo): Promise<void> => {
  const indexed = await findRepo(repo.repoPath);
  if (!indexed?.meta) return;
  await registerRepo(repo.repoPath, indexed.meta);
};

const materializeGraphpackHead = async (headCommit?: string): Promise<void> => {
  if (!headCommit) return;
  const { checkoutCommand } = await import('./graphstore.js');
  await checkoutCommand(headCommit, { materialize: true });
};

const printPullLikeResult = (
  label: string,
  result: {
    fallbackRequired: boolean;
    materializable: boolean;
    reason?: string;
    fallbackCommand?: string;
    status: { source: string; lock?: { graphpack: { id: string } } };
  },
): void => {
  if (result.fallbackRequired) {
    process.stdout.write(
      [
        `${label}: fallback required`,
        `reason: ${result.reason ?? 'graphpack is not available locally'}`,
        `fallback: ${result.fallbackCommand ?? 'codragraph analyze --skip-agents-md --no-setup'}`,
      ].join('\n') + '\n',
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write(
    [
      `${label}: ok`,
      `source: ${result.status.source}`,
      `graphpack: ${result.status.lock?.graphpack.id ?? '(none)'}`,
      `materializable: ${result.materializable ? 'yes' : 'no'}`,
    ].join('\n') + '\n',
  );
};
