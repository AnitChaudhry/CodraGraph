import os from 'node:os';
import v8 from 'node:v8';
import type { ContentEncoding } from '@codragraph/graphstore';
import type { RepoMeta } from '../storage/repo-manager.js';

export type AnalyzeProfileOption = 'auto' | 'lean' | 'balanced' | 'power';
export type ResolvedAnalyzeProfile = Exclude<AnalyzeProfileOption, 'auto'>;
export type EmbeddingMode = 'auto' | 'off' | 'on';
export type CompressionOption = ContentEncoding | 'auto';

export interface MachineSnapshot {
  platform: NodeJS.Platform;
  arch: NodeJS.Architecture;
  logicalCpus: number;
  availableParallelism: number;
  totalMemoryBytes: number;
  freeMemoryBytes: number;
  heapLimitBytes: number;
  nodeVersion: string;
  httpEmbeddingsConfigured: boolean;
}

export interface AdaptiveAnalyzePlan {
  requestedProfile: AnalyzeProfileOption;
  profile: ResolvedAnalyzeProfile;
  machine: MachineSnapshot;
  compress: ContentEncoding;
  embeddingMode: EmbeddingMode;
  embeddingNodeLimit: number;
  workerPoolSize: number;
  workerSubBatchSize: number;
  reasons: string[];
}

export interface EmbeddingDecision {
  enabled: boolean;
  reason: string;
  limit: number;
}

const GIB = 1024 * 1024 * 1024;

const validProfiles = new Set<AnalyzeProfileOption>(['auto', 'lean', 'balanced', 'power']);
const validEmbeddingModes = new Set<EmbeddingMode>(['auto', 'off', 'on']);
const validCompressionOptions = new Set<CompressionOption>(['auto', 'none', 'brotli', 'zstd']);

const safeAvailableParallelism = (): number => {
  const fn = (os as typeof os & { availableParallelism?: () => number }).availableParallelism;
  if (typeof fn === 'function') {
    try {
      return Math.max(1, fn());
    } catch {
      /* fall back to os.cpus */
    }
  }
  return Math.max(1, os.cpus().length);
};

export const parseAnalyzeProfile = (value?: string): AnalyzeProfileOption => {
  const normalized = (value ?? 'auto').toLowerCase();
  if (validProfiles.has(normalized as AnalyzeProfileOption)) {
    return normalized as AnalyzeProfileOption;
  }
  throw new Error(`profile must be one of: auto, lean, balanced, power (got: ${value})`);
};

export const parseEmbeddingMode = (value?: string): EmbeddingMode => {
  const normalized = (value ?? 'auto').toLowerCase();
  if (validEmbeddingModes.has(normalized as EmbeddingMode)) {
    return normalized as EmbeddingMode;
  }
  throw new Error(`embedding-mode must be one of: auto, off, on (got: ${value})`);
};

export const parseCompressionOption = (value?: string): CompressionOption => {
  const normalized = (value ?? 'auto').toLowerCase();
  if (validCompressionOptions.has(normalized as CompressionOption)) {
    return normalized as CompressionOption;
  }
  throw new Error(`compress must be one of: auto, none, brotli, zstd (got: ${value})`);
};

export const detectMachineSnapshot = (): MachineSnapshot => ({
  platform: process.platform,
  arch: process.arch,
  logicalCpus: Math.max(1, os.cpus().length),
  availableParallelism: safeAvailableParallelism(),
  totalMemoryBytes: os.totalmem(),
  freeMemoryBytes: os.freemem(),
  heapLimitBytes: v8.getHeapStatistics().heap_size_limit,
  nodeVersion: process.version,
  httpEmbeddingsConfigured: Boolean(
    process.env.CODRAGRAPH_EMBEDDING_URL && process.env.CODRAGRAPH_EMBEDDING_MODEL,
  ),
});

export const resolveAnalyzeProfile = (
  requested: AnalyzeProfileOption,
  machine: MachineSnapshot,
): ResolvedAnalyzeProfile => {
  if (requested !== 'auto') return requested;

  const memoryGiB = machine.totalMemoryBytes / GIB;
  const heapGiB = machine.heapLimitBytes / GIB;
  const parallelism = machine.availableParallelism;

  if (parallelism >= 8 && memoryGiB >= 24 && heapGiB >= 6) return 'power';
  if (parallelism >= 4 && memoryGiB >= 8 && heapGiB >= 3) return 'balanced';
  return 'lean';
};

export const resolveEmbeddingMode = (
  embeddingsFlag: boolean | undefined,
  requestedMode: string | undefined,
): EmbeddingMode => {
  if (embeddingsFlag === true) return 'on';
  return parseEmbeddingMode(requestedMode);
};

export const resolveCompression = (
  requested: CompressionOption,
  profile: ResolvedAnalyzeProfile,
  existingMeta?: Pick<RepoMeta, 'compress'> | null,
): ContentEncoding => {
  if (requested !== 'auto') return requested;

  if (existingMeta) return existingMeta.compress ?? 'none';

  // Lean machines optimize for index footprint and lower read amplification.
  // Balanced/power machines keep full body BM25 by default for maximum recall.
  return profile === 'lean' ? 'brotli' : 'none';
};

export const embeddingLimitForProfile = (
  profile: ResolvedAnalyzeProfile,
  httpEmbeddingsConfigured: boolean,
): number => {
  if (httpEmbeddingsConfigured) return profile === 'lean' ? 25_000 : 150_000;
  if (profile === 'power') return 100_000;
  if (profile === 'balanced') return 35_000;
  return 8_000;
};

export const workerPlanForProfile = (
  profile: ResolvedAnalyzeProfile,
  machine: Pick<MachineSnapshot, 'availableParallelism'>,
): Pick<AdaptiveAnalyzePlan, 'workerPoolSize' | 'workerSubBatchSize'> => {
  const spare = Math.max(1, machine.availableParallelism - 1);
  if (profile === 'power') {
    return { workerPoolSize: Math.min(8, spare), workerSubBatchSize: 250 };
  }
  if (profile === 'balanced') {
    return { workerPoolSize: Math.min(4, spare), workerSubBatchSize: 160 };
  }
  return { workerPoolSize: 1, workerSubBatchSize: 80 };
};

export const resolveAdaptiveAnalyzePlan = (input: {
  profile?: string;
  embeddingMode?: string;
  embeddings?: boolean;
  compress?: string;
  existingMeta?: Pick<RepoMeta, 'compress'> | null;
  machine?: MachineSnapshot;
}): AdaptiveAnalyzePlan => {
  const machine = input.machine ?? detectMachineSnapshot();
  const requestedProfile = parseAnalyzeProfile(input.profile);
  const profile = resolveAnalyzeProfile(requestedProfile, machine);
  const embeddingMode = resolveEmbeddingMode(input.embeddings, input.embeddingMode);
  const compress = resolveCompression(
    parseCompressionOption(input.compress),
    profile,
    input.existingMeta,
  );
  const workerPlan = workerPlanForProfile(profile, machine);
  const embeddingNodeLimit = embeddingLimitForProfile(profile, machine.httpEmbeddingsConfigured);
  const reasons = [
    `${machine.platform}/${machine.arch}`,
    `${machine.availableParallelism} parallel slot(s)`,
    `${(machine.totalMemoryBytes / GIB).toFixed(1)} GiB RAM`,
    `${(machine.heapLimitBytes / GIB).toFixed(1)} GiB heap`,
  ];
  if (machine.httpEmbeddingsConfigured) reasons.push('HTTP embeddings configured');

  return {
    requestedProfile,
    profile,
    machine,
    compress,
    embeddingMode,
    embeddingNodeLimit,
    workerPoolSize: workerPlan.workerPoolSize,
    workerSubBatchSize: workerPlan.workerSubBatchSize,
    reasons,
  };
};

export const decideEmbeddingRun = (
  plan: Pick<AdaptiveAnalyzePlan, 'embeddingMode' | 'embeddingNodeLimit' | 'profile' | 'machine'>,
  stats?: Pick<NonNullable<RepoMeta['stats']>, 'nodes' | 'embeddings'>,
): EmbeddingDecision => {
  const nodes = stats?.nodes;
  const existingEmbeddings = stats?.embeddings ?? 0;
  const overLimit = typeof nodes === 'number' && nodes > plan.embeddingNodeLimit;

  if (plan.embeddingMode === 'off') {
    return { enabled: false, reason: 'embedding-mode is off', limit: plan.embeddingNodeLimit };
  }

  if (overLimit) {
    return {
      enabled: false,
      reason: `${nodes.toLocaleString('en-US')} nodes exceeds ${plan.profile} embedding limit ${plan.embeddingNodeLimit.toLocaleString('en-US')}`,
      limit: plan.embeddingNodeLimit,
    };
  }

  if (plan.embeddingMode === 'on') {
    return { enabled: true, reason: 'explicit embedding request', limit: plan.embeddingNodeLimit };
  }

  if (existingEmbeddings > 0) {
    return {
      enabled: true,
      reason: 'preserving existing embeddings',
      limit: plan.embeddingNodeLimit,
    };
  }

  if (plan.machine.httpEmbeddingsConfigured) {
    return {
      enabled: true,
      reason: 'HTTP embedding endpoint configured',
      limit: plan.embeddingNodeLimit,
    };
  }

  if (plan.profile === 'power') {
    return {
      enabled: true,
      reason: 'power profile can run local embeddings',
      limit: plan.embeddingNodeLimit,
    };
  }

  if (plan.profile === 'balanced' && (nodes ?? Number.POSITIVE_INFINITY) <= 5_000) {
    return {
      enabled: true,
      reason: 'small repo on balanced profile',
      limit: plan.embeddingNodeLimit,
    };
  }

  if (plan.profile === 'lean' && (nodes ?? Number.POSITIVE_INFINITY) <= 1_000) {
    return { enabled: true, reason: 'small repo on lean profile', limit: plan.embeddingNodeLimit };
  }

  return {
    enabled: false,
    reason: 'auto mode skipped first-time local embeddings on this profile',
    limit: plan.embeddingNodeLimit,
  };
};

export const formatAdaptiveAnalyzePlan = (plan: AdaptiveAnalyzePlan): string =>
  `Adaptive analyze: ${plan.profile} profile (${plan.reasons.join(', ')}); ` +
  `workers=${plan.workerPoolSize}, subBatch=${plan.workerSubBatchSize}, ` +
  `compress=${plan.compress}, embeddings=${plan.embeddingMode}.`;
