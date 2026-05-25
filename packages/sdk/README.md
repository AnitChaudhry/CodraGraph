# @codragraph/sdk

One-import surface for the [CodraGraph](../core/) platform.

> Developer preview. Single-import surface that re-exports the
> graph, harness, swarm, graphstore, recipes, and compression
> namespaces with subpath imports for selective bundling.
>
> Install `@codragraph/cli` as the indexing layer first; the SDK reads the
> repositories that the CLI already indexed and registered locally.

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

// Feature-level context packs for product areas like Settings/Auth/AI
const settings = await graphClient.contextPack({ name: "Settings" });
const settingsImpact = await graphClient.clusterImpact({ name: "Settings", direction: "both" });
console.log(settings.members.map((m) => [m.file, m.startLine, m.endLine]));
console.log(settingsImpact.impactSummary.riskLevel);
```

## Package composition

Use `@codragraph/sdk` when you are building your own agent, eval harness, or
internal tool. Pair it with:

| Pair with | Why |
|---|---|
| `@codragraph/cli` | Index repos, build FeatureCluster context packs, and register them for local graph clients |
| `@codragraph/harness` | Run Pareto search over task families using the same graph client |
| `@codragraph/graphstore` | Snapshot/diff the graph when you need history or review automation |
| `@codragraph/compress` | Compress feature context packs before sending them to an LLM |

## Out-of-process / hosted access

For programmatic access to a *running* `codragraph serve` instance from
another process or machine, use `graph.HttpGraphClient`. It supports search,
symbol context, symbol impact, feature-cluster lists, context packs, and
cluster impact over the same REST API the web app uses. Use MCP over HTTP when
you need the full MCP tool/resource surface.

```ts
import { HttpGraphClient } from "@codragraph/sdk/graph";

const graph = new HttpGraphClient({ baseURL: "http://127.0.0.1:4747" });
const settings = await graph.contextPack({ name: "Settings", repo: "MyRepo" });
```

When `baseURL` is omitted, `HttpGraphClient` reads `CODRAGRAPH_URL` and then
falls back to `http://127.0.0.1:4747`.

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

## License

Apache-2.0. You can use, modify, redistribute, bundle, and host this package
commercially, subject to the Apache-2.0 notice and attribution requirements.
