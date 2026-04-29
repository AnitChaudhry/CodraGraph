# @codragraph/sdk

One-import surface for the [CodraGraph](../codragraph/) platform.

> Developer preview. Single-import surface that re-exports the
> graph, harness, swarm, graphstore, recipes, and compression
> namespaces with subpath imports for selective bundling.

## Install

```bash
npm i @codragraph/sdk
```

## Use

```ts
import { harness, graph } from "@codragraph/sdk";

// In-process graph client — wraps the same LocalBackend the codragraph
// CLI uses, so you read from the registered repos without an HTTP hop.
const graphClient = await graph.createLocalGraphClient();

// Run a Meta-Harness search over a task family
const inference = await harness.makeInferenceProvider("claude");
const result = await harness.search({
  tasks: tasksFromJsonFile,
  iterations: 20,
  candidatesPerIteration: 2,
  inference,
  graph: graphClient,
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

// Direct graph queries against the same in-process backend
const ctx = await graphClient.context({ name: "validateUser" });
```

## Out-of-process / hosted access

For programmatic access to a *running* `codragraph serve` instance from
another process or machine, talk to it over **MCP** using
[`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk).
The HTTP surface is intentionally narrow today (only `/api/query` is
structured JSON); MCP-over-HTTP gives you the full toolset.

> `graph.HttpGraphClient` is exported for forward compatibility but is a
> Phase 2 placeholder — calling its methods throws. Use
> `graph.createLocalGraphClient()` (in-process) or MCP for now.

## Sub-namespaces

```ts
import { search, ALL_SEEDS } from "@codragraph/sdk/harness";
import { createLocalGraphClient, LocalGraphClient } from "@codragraph/sdk/graph";
```

## Provider-agnostic inference

Built-in adapters: `claude`, `openai` (covers Codex), `opencode`. Any
provider implementing `InferenceProvider` works:

```ts
import type { InferenceProvider } from "@codragraph/sdk";

class MyProvider implements InferenceProvider {
  readonly name = "my";
  async complete(input) {
    /* ... */
  }
}
```
