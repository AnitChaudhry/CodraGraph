// codragraph-compress — lossless semantic compression for LLM contexts.
//
// Phase 1.5 (started 2026-04-29): TS port of the original Python library.
// LLM-based path lands first (highest leverage, simplest port). MLM (RoBERTa)
// and NLP (spaCy) paths are deferred — their TS equivalents (transformers.js,
// node-spacy via WASM) have lower quality. For Phase 1.5 those paths run as
// a Docker sidecar over HTTP if needed.
//
// SPEC: ../SPEC.md
// Prompts: ../prompts/{compression,decompression}.txt

export { LlmCompressor } from './llm.js';
export type {
  Compressor,
  CompressOptions,
  CompressContextPackOptions,
  CompressContextPackResult,
  CompressibleContextPack,
  CompressResult,
  DecompressOptions,
  DecompressResult,
  CompressionLevel,
} from './types.js';
export { estimateTokens } from './utils.js';

import type {
  Compressor,
  CompressContextPackOptions,
  CompressContextPackResult,
  CompressibleContextPack,
} from './types.js';

export async function compressContextPack(
  compressor: Compressor,
  contextPack: CompressibleContextPack,
  options: CompressContextPackOptions,
): Promise<CompressContextPackResult> {
  const contextPackText =
    options.format === 'json'
      ? JSON.stringify(contextPack)
      : serializeContextPackOutline(contextPack);
  const result = await compressor.compress(contextPackText, options);
  const cluster = (contextPack as { cluster?: { name?: unknown } }).cluster;
  return {
    ...result,
    contextPackText,
    clusterName: typeof cluster?.name === 'string' ? cluster.name : undefined,
  };
}

function serializeContextPackOutline(contextPack: CompressibleContextPack): string {
  const pack = contextPack as {
    cluster?: Record<string, unknown>;
    members?: Array<Record<string, unknown>>;
    entryPoints?: Array<Record<string, unknown>>;
    routes?: Array<Record<string, unknown>>;
    tools?: Array<Record<string, unknown>>;
    processes?: Array<Record<string, unknown>>;
    dependencies?: { incoming?: unknown[]; outgoing?: unknown[] } | unknown[];
    tests?: Array<Record<string, unknown>>;
    docs?: Array<Record<string, unknown>>;
    safeEditSurface?: Record<string, unknown>;
  };

  const lines: string[] = [];
  const cluster = pack.cluster || {};
  lines.push(`cluster: ${String(cluster.name || cluster.slug || cluster.id || 'unknown')}`);
  if (cluster.summary) lines.push(`summary: ${String(cluster.summary)}`);
  if (cluster.description) lines.push(`description: ${String(cluster.description)}`);
  appendItems(lines, 'entry_points', pack.entryPoints);
  appendItems(lines, 'routes', pack.routes);
  appendItems(lines, 'tools', pack.tools);
  appendItems(lines, 'members', pack.members, 80);
  appendItems(lines, 'processes', pack.processes, 30);
  appendItems(lines, 'tests', pack.tests, 30);
  appendItems(lines, 'docs', pack.docs, 30);
  lines.push(`dependencies: ${JSON.stringify(pack.dependencies || {})}`);
  lines.push(`safe_edit_surface: ${JSON.stringify(pack.safeEditSurface || {})}`);
  return lines.join('\n');
}

function appendItems(
  lines: string[],
  label: string,
  items: Array<Record<string, unknown>> | undefined,
  limit = 25,
): void {
  if (!items?.length) return;
  lines.push(`${label}:`);
  for (const item of items.slice(0, limit)) {
    const name = item.name || item.label || item.id || 'item';
    const file = item.filePath || item.file || '';
    const range = item.startLine ? `:${String(item.startLine)}` : '';
    lines.push(`- ${String(name)} ${String(file)}${range}`.trim());
  }
  if (items.length > limit) lines.push(`- ... ${items.length - limit} more`);
}
