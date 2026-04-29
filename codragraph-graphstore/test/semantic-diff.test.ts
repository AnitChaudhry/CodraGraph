import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FsCAS } from "../src/cas/fs-cas.js";
import { serializeSnapshot } from "../src/snapshot/serializer.js";
import { diffSemantic } from "../src/diff/semantic.js";
import { type GraphRow, type RowSource } from "../src/snapshot/row-source.js";

let tmpRoot: string;
let cas: FsCAS;

interface FakeGraph {
  readonly nodes: Record<string, GraphRow[]>;
  readonly edges: GraphRow[];
}

const fakeSource = (graph: FakeGraph): RowSource => ({
  listNodeTables: async () => Object.keys(graph.nodes),
  streamNodeTable: async function* (table: string): AsyncIterable<GraphRow> {
    for (const row of graph.nodes[table] ?? []) yield row;
  },
  streamEdges: async function* (): AsyncIterable<GraphRow> {
    for (const row of graph.edges) yield row;
  },
});

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "graphstore-sem-"));
  cas = new FsCAS({ root: tmpRoot });
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe("diffSemantic", () => {
  it("classifies signature change", async () => {
    const before = await serializeSnapshot({
      source: fakeSource({
        nodes: {
          Function: [
            { id: "fn:foo", name: "foo", parameterCount: 1, returnType: "string", isExported: true, content: "body1", filePath: "a.ts", startLine: 1, endLine: 5 },
          ],
        },
        edges: [],
      }),
      cas,
    });
    const after = await serializeSnapshot({
      source: fakeSource({
        nodes: {
          Function: [
            { id: "fn:foo", name: "foo", parameterCount: 2, returnType: "string", isExported: true, content: "body1", filePath: "a.ts", startLine: 1, endLine: 5 },
          ],
        },
        edges: [],
      }),
      cas,
    });

    const d = await diffSemantic({ cas, from: before.snapshotId, to: after.snapshotId });
    expect(d.semanticVersion).toBe("semantic-v1");
    expect(d.classifiedModifications.length).toBe(1);
    expect(d.classifiedModifications[0]?.changes).toContain("signature");
    expect(d.classifiedModifications[0]?.signatureChange?.parameterCountChanged).toEqual({ from: 1, to: 2 });
  });

  it("classifies visibility flip", async () => {
    const before = await serializeSnapshot({
      source: fakeSource({
        nodes: {
          Function: [{ id: "fn:foo", name: "foo", isExported: true, content: "x" }],
        },
        edges: [],
      }),
      cas,
    });
    const after = await serializeSnapshot({
      source: fakeSource({
        nodes: {
          Function: [{ id: "fn:foo", name: "foo", isExported: false, content: "x" }],
        },
        edges: [],
      }),
      cas,
    });

    const d = await diffSemantic({ cas, from: before.snapshotId, to: after.snapshotId });
    expect(d.classifiedModifications[0]?.changes).toContain("visibility");
    expect(d.classifiedModifications[0]?.visibilityFlip).toEqual({ from: true, to: false });
  });

  it("classifies body-only change", async () => {
    const before = await serializeSnapshot({
      source: fakeSource({
        nodes: { Function: [{ id: "fn:foo", name: "foo", isExported: true, content: "old" }] },
        edges: [],
      }),
      cas,
    });
    const after = await serializeSnapshot({
      source: fakeSource({
        nodes: { Function: [{ id: "fn:foo", name: "foo", isExported: true, content: "new" }] },
        edges: [],
      }),
      cas,
    });
    const d = await diffSemantic({ cas, from: before.snapshotId, to: after.snapshotId });
    expect(d.classifiedModifications[0]?.changes).toEqual(["body"]);
  });

  it("surfaces added APIs", async () => {
    const before = await serializeSnapshot({
      source: fakeSource({
        nodes: { Function: [{ id: "fn:a", name: "a", isExported: true }] },
        edges: [],
      }),
      cas,
    });
    const after = await serializeSnapshot({
      source: fakeSource({
        nodes: {
          Function: [
            { id: "fn:a", name: "a", isExported: true },
            { id: "fn:newApi", name: "newApi", isExported: true, filePath: "src/new.ts" },
            { id: "fn:internal", name: "internal", isExported: false },
          ],
        },
        edges: [],
      }),
      cas,
    });

    const d = await diffSemantic({ cas, from: before.snapshotId, to: after.snapshotId });
    expect(d.addedAPIs.map((a) => a.id)).toEqual(["fn:newApi"]);
    expect(d.addedAPIs[0]?.name).toBe("newApi");
  });

  it("surfaces removed and added Processes", async () => {
    const before = await serializeSnapshot({
      source: fakeSource({
        nodes: { Process: [{ id: "proc:old", name: "oldFlow" }] },
        edges: [],
      }),
      cas,
    });
    const after = await serializeSnapshot({
      source: fakeSource({
        nodes: { Process: [{ id: "proc:new", name: "newFlow" }] },
        edges: [],
      }),
      cas,
    });
    const d = await diffSemantic({ cas, from: before.snapshotId, to: after.snapshotId });
    expect(d.addedProcesses.map((p) => p.id)).toEqual(["proc:new"]);
    expect(d.removedProcesses.map((p) => p.id)).toEqual(["proc:old"]);
  });
});
