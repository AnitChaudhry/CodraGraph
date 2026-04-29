import { describe, expect, it } from "vitest";
import {
  makeObjectId,
  parseObjectId,
  objectIdHex,
  OBJECT_ID_PATTERN,
} from "../src/types.js";
import { canonicalJsonStringify } from "../src/cas/interface.js";

describe("ObjectId", () => {
  const validHex = "a".repeat(64);

  it("makeObjectId accepts a 64-char lowercase hex digest", () => {
    const id = makeObjectId(validHex);
    expect(id).toBe(`sha256:${validHex}`);
    expect(OBJECT_ID_PATTERN.test(id)).toBe(true);
  });

  it("makeObjectId rejects malformed digests", () => {
    expect(() => makeObjectId("nothex")).toThrow(/64 lowercase hex chars/);
    expect(() => makeObjectId("A".repeat(64))).toThrow(/64 lowercase hex chars/);
    expect(() => makeObjectId("a".repeat(63))).toThrow(/64 lowercase hex chars/);
  });

  it("parseObjectId validates the sha256 prefix", () => {
    const id = parseObjectId(`sha256:${validHex}`);
    expect(id).toBe(`sha256:${validHex}`);
    expect(() => parseObjectId(validHex)).toThrow(/expected sha256:/);
    expect(() => parseObjectId(`sha512:${validHex}`)).toThrow();
    expect(() => parseObjectId("sha256:short")).toThrow();
  });

  it("objectIdHex strips the prefix", () => {
    const id = makeObjectId(validHex);
    expect(objectIdHex(id)).toBe(validHex);
  });
});

describe("canonicalJsonStringify", () => {
  it("sorts object keys recursively", () => {
    const a = canonicalJsonStringify({ b: 1, a: { y: 2, x: 1 } });
    const b = canonicalJsonStringify({ a: { x: 1, y: 2 }, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":{"x":1,"y":2},"b":1}');
  });

  it("preserves array order", () => {
    expect(canonicalJsonStringify([3, 1, 2])).toBe("[3,1,2]");
  });

  it("omits undefined values", () => {
    expect(canonicalJsonStringify({ a: 1, b: undefined })).toBe('{"a":1}');
  });
});
