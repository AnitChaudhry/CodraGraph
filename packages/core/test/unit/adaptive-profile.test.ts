import { describe, expect, it } from 'vitest';
import {
  decideEmbeddingRun,
  parseAnalyzeProfile,
  parseCompressionOption,
  parseEmbeddingMode,
  resolveAdaptiveAnalyzePlan,
  resolveAnalyzeProfile,
  resolveCompression,
  workerPlanForProfile,
  type MachineSnapshot,
} from '../../src/core/adaptive-profile.js';

const snapshot = (overrides: Partial<MachineSnapshot> = {}): MachineSnapshot => ({
  platform: 'linux',
  arch: 'x64',
  logicalCpus: 8,
  availableParallelism: 8,
  totalMemoryBytes: 32 * 1024 * 1024 * 1024,
  freeMemoryBytes: 20 * 1024 * 1024 * 1024,
  heapLimitBytes: 8 * 1024 * 1024 * 1024,
  nodeVersion: 'v24.0.0',
  httpEmbeddingsConfigured: false,
  ...overrides,
});

describe('adaptive analyze profile', () => {
  it('classifies auto profile from machine capacity', () => {
    expect(resolveAnalyzeProfile('auto', snapshot())).toBe('power');
    expect(
      resolveAnalyzeProfile(
        'auto',
        snapshot({
          availableParallelism: 4,
          totalMemoryBytes: 12 * 1024 * 1024 * 1024,
          heapLimitBytes: 4 * 1024 * 1024 * 1024,
        }),
      ),
    ).toBe('balanced');
    expect(
      resolveAnalyzeProfile(
        'auto',
        snapshot({
          availableParallelism: 2,
          totalMemoryBytes: 4 * 1024 * 1024 * 1024,
          heapLimitBytes: 2 * 1024 * 1024 * 1024,
        }),
      ),
    ).toBe('lean');
  });

  it('validates user-facing modes', () => {
    expect(parseAnalyzeProfile('power')).toBe('power');
    expect(parseEmbeddingMode('off')).toBe('off');
    expect(parseCompressionOption('auto')).toBe('auto');
    expect(() => parseAnalyzeProfile('turbo')).toThrow(/profile must be one of/);
    expect(() => parseEmbeddingMode('maybe')).toThrow(/embedding-mode must be one of/);
    expect(() => parseCompressionOption('zip')).toThrow(/compress must be one of/);
  });

  it('uses brotli only for first lean auto indexes and preserves existing compression', () => {
    expect(resolveCompression('auto', 'lean')).toBe('brotli');
    expect(resolveCompression('auto', 'lean', { compress: 'none' })).toBe('none');
    expect(resolveCompression('auto', 'power', { compress: 'zstd' })).toBe('zstd');
    expect(resolveCompression('none', 'lean')).toBe('none');
  });

  it('sizes worker pressure by profile', () => {
    expect(workerPlanForProfile('power', snapshot()).workerPoolSize).toBe(7);
    expect(workerPlanForProfile('balanced', snapshot()).workerPoolSize).toBe(4);
    expect(workerPlanForProfile('lean', snapshot()).workerPoolSize).toBe(1);
  });

  it('preserves embeddings in auto mode and respects profile limits', () => {
    const plan = resolveAdaptiveAnalyzePlan({ machine: snapshot(), embeddingMode: 'auto' });
    expect(decideEmbeddingRun(plan, { nodes: 10_000, embeddings: 42 })).toMatchObject({
      enabled: true,
      reason: 'preserving existing embeddings',
    });
    expect(decideEmbeddingRun(plan, { nodes: 120_000, embeddings: 0 })).toMatchObject({
      enabled: false,
    });
  });

  it('treats --embeddings as explicit on', () => {
    const plan = resolveAdaptiveAnalyzePlan({
      machine: snapshot({
        availableParallelism: 2,
        totalMemoryBytes: 4 * 1024 * 1024 * 1024,
        heapLimitBytes: 2 * 1024 * 1024 * 1024,
      }),
      embeddings: true,
    });
    expect(plan.profile).toBe('lean');
    expect(plan.embeddingMode).toBe('on');
    expect(decideEmbeddingRun(plan, { nodes: 500, embeddings: 0 })).toMatchObject({
      enabled: true,
    });
  });
});
