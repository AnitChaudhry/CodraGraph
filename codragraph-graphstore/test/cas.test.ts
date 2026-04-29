import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FsCAS } from "../src/cas/fs-cas.js";
import {
  ObjectNotFoundError,
  putJson,
  getJson,
} from "../src/cas/interface.js";
import { makeObjectId } from "../src/types.js";

let tmpRoot: string;
let cas: FsCAS;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "graphstore-cas-"));
  cas = new FsCAS({ root: tmpRoot });
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe("FsCAS", () => {
  it("put + get roundtrips raw bytes", async () => {
    const bytes = new TextEncoder().encode("hello");
    const id = await cas.put(bytes);
    expect(id).toMatch(/^sha256:[0-9a-f]{64}$/);

    const fetched = await cas.get(id);
    expect(new TextDecoder().decode(fetched)).toBe("hello");
  });

  it("put is idempotent: same bytes → same id, no second write", async () => {
    const bytes = new TextEncoder().encode("dedup-me");
    const id1 = await cas.put(bytes);
    const id2 = await cas.put(bytes);
    expect(id1).toBe(id2);

    // Only one object on disk.
    const all: string[] = [];
    for await (const found of cas.list()) all.push(found);
    expect(all.length).toBe(1);
    expect(all[0]).toBe(id1);
  });

  it("has reflects presence", async () => {
    const id = await cas.put(new TextEncoder().encode("ping"));
    expect(await cas.has(id)).toBe(true);

    const fakeId = makeObjectId("0".repeat(64));
    expect(await cas.has(fakeId)).toBe(false);
  });

  it("get throws ObjectNotFoundError when the object is missing", async () => {
    const fakeId = makeObjectId("1".repeat(64));
    await expect(cas.get(fakeId)).rejects.toBeInstanceOf(ObjectNotFoundError);
  });

  it("list yields every stored id and ignores stray files", async () => {
    const a = await cas.put(new TextEncoder().encode("a"));
    const b = await cas.put(new TextEncoder().encode("b"));

    // Plant a stray file at the prefix level — list() must skip it.
    const objectsDir = path.join(tmpRoot, "objects");
    await fs.mkdir(objectsDir, { recursive: true });
    await fs.writeFile(path.join(objectsDir, "stray.txt"), "noise");

    const seen = new Set<string>();
    for await (const id of cas.list()) seen.add(id);
    expect(seen).toEqual(new Set([a, b]));
  });

  it("two-char fan-out: object lands at <root>/objects/<aa>/<rest>.json", async () => {
    const id = await cas.put(new TextEncoder().encode("filename-shape"));
    const target = cas.pathFor(id);
    const rel = path.relative(tmpRoot, target);
    expect(rel.startsWith(`objects${path.sep}`)).toBe(true);
    const parts = rel.split(path.sep);
    expect(parts.length).toBe(3);
    expect(parts[1]).toMatch(/^[0-9a-f]{2}$/);
    expect(parts[2]).toMatch(/^[0-9a-f]{62}\.json$/);
  });

  it("putJson and getJson round-trip with sorted keys", async () => {
    const a = await putJson(cas, { z: 1, a: 2 });
    const b = await putJson(cas, { a: 2, z: 1 });
    expect(a).toBe(b); // canonical → same hash regardless of key order

    const value = await getJson<{ a: number; z: number }>(cas, a);
    expect(value).toEqual({ a: 2, z: 1 });
  });
});
