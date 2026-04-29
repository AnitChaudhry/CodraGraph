# codragraph-sdk

One-import surface for the [CodraGraph](../codragraph/) platform.

> Developer preview. Single-import surface that re-exports the
> graph, harness, swarm, graphstore, recipes, and compression
> namespaces with subpath imports for selective bundling.

## Install

```bash
npm i codragraph-sdk
```

## Use

```ts
import { harness, graph } from "codragraph-sdk";

// Run a Meta-Harness search over a task family
const result = await harness.search({
  tasks: tasksFromJsonFile,
  iterations: 20,
  candidatesPerIteration: 2,
  inference: harness.makeInferenceProvider("claude"),
  graph: new graph.HttpGraphClient(),
  proposer: new harness.ClaudeCodeProposer({ contractPath: "..." }),
  store: new harness.CandidateStore("./runs/today/candidates"),
  evaluator: new harness.CodebaseQAEvaluator(),
  seeds: harness.ALL_SEEDS,
  budget: { maxInputTokens: 16000, maxOutputTokens: 1024 },
  loadCandidate: async (dir) => {
    /* dynamic import of dir/source/index.ts */
  },
});

console.log(result.frontier);

// Direct graph queries
const client = new graph.HttpGraphClient({ baseURL: "http://localhost:4747" });
const ctx = await client.context({ name: "validateUser" });
```

## Sub-namespaces

```ts
import { search, ALL_SEEDS } from "codragraph-sdk/harness";
import { HttpGraphClient } from "codragraph-sdk/graph";
```

## Provider-agnostic inference

Built-in adapters: `claude`, `openai` (covers Codex), `opencode`. Any
provider implementing `InferenceProvider` works:

```ts
import type { InferenceProvider } from "codragraph-sdk";

class MyProvider implements InferenceProvider {
  readonly name = "my";
  async complete(input) {
    /* ... */
  }
}
```
