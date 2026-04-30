// In-memory TraceWriter — accumulates per-step records during a single
// harness invocation, then materializes a TraceRecord for the store.

import type { TraceWriter } from './types.js';
import type { TraceRecord } from './filesystem.js';

export class InMemoryTraceWriter implements TraceWriter {
  private steps: Array<{ name: string; payload: Record<string, unknown>; t: number }> = [];
  private readonly startedAtMs = Date.now();

  step(name: string, payload: Record<string, unknown>): void {
    this.steps.push({
      name,
      payload,
      t: Date.now() - this.startedAtMs,
    });
  }

  /** Build a persistable trace record. Called by the evaluator after harness.run() returns. */
  build(taskId: string): TraceRecord {
    return {
      taskId,
      steps: this.steps,
      startedAt: new Date(this.startedAtMs).toISOString(),
      finishedAt: new Date().toISOString(),
    };
  }

  /** No-op — the evaluator owns persistence via build() + CandidateStore.addTrace(). */
  async flush(): Promise<void> {}
}
