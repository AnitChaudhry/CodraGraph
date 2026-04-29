import type { ObjectId } from "../types.js";

/**
 * Content-addressed object store. Every value is keyed by its sha256
 * digest, encoded as a {@link ObjectId} (`sha256:<hex>`). Implementations
 * MUST guarantee:
 *   - `put` is idempotent: writing the same bytes twice yields the same
 *     id and is a no-op the second time.
 *   - `get(put(b))` returns bytes byte-for-byte equal to `b`.
 *   - `has` is consistent with `get` — `has(id) === true` ⇒ `get(id)`
 *     resolves; otherwise `get` rejects with {@link ObjectNotFoundError}.
 *
 * The CAS does not own JSON encoding — callers serialize to UTF-8
 * bytes themselves. This keeps the store generic enough to also hold
 * binary blobs in future phases (e.g. compressed parser output).
 */
export interface ContentAddressedStore {
  /**
   * Write `bytes` to the store and return the resulting {@link ObjectId}.
   * Returns the same id whether or not the object already existed.
   */
  put(bytes: Uint8Array): Promise<ObjectId>;

  /**
   * Fetch the bytes for `id`. Rejects with {@link ObjectNotFoundError}
   * when the object is not present.
   */
  get(id: ObjectId): Promise<Uint8Array>;

  /** Whether `id` is currently present in the store. */
  has(id: ObjectId): Promise<boolean>;

  /**
   * Stream every {@link ObjectId} the store knows about. Order is
   * unspecified and may not be stable across calls. Used for
   * housekeeping and integrity checks; not load-bearing for normal
   * read paths.
   */
  list(): AsyncIterable<ObjectId>;
}

/** Convenience: JSON-encode `value` and `put` it. Returns the new id. */
export const putJson = async (
  cas: ContentAddressedStore,
  value: unknown,
): Promise<ObjectId> => {
  const json = canonicalJsonStringify(value);
  const bytes = new TextEncoder().encode(json);
  return cas.put(bytes);
};

/** Convenience: fetch and JSON-parse `id`. Throws if the bytes are not valid JSON. */
export const getJson = async <T = unknown>(
  cas: ContentAddressedStore,
  id: ObjectId,
): Promise<T> => {
  const bytes = await cas.get(id);
  const text = new TextDecoder("utf-8").decode(bytes);
  return JSON.parse(text) as T;
};

/**
 * Stable JSON serialization with sorted object keys. Two semantically
 * equal values must produce byte-for-byte identical output so that
 * content addressing is meaningful — `JSON.stringify` alone is not
 * sufficient because key insertion order leaks into the output.
 *
 * Notes:
 *   - Arrays preserve order (semantically meaningful).
 *   - `undefined` values are omitted (matching `JSON.stringify`).
 *   - Numbers go through the default `JSON.stringify` representation —
 *     callers that care about exact numeric encoding should hand us
 *     strings.
 */
export const canonicalJsonStringify = (value: unknown): string => {
  return JSON.stringify(value, (_key, v) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        sorted[k] = (v as Record<string, unknown>)[k];
      }
      return sorted;
    }
    return v;
  });
};

/** Thrown by {@link ContentAddressedStore.get} when the object is missing. */
export class ObjectNotFoundError extends Error {
  readonly kind = "ObjectNotFoundError" as const;
  constructor(public readonly id: ObjectId) {
    super(`Object ${id} not found in content-addressed store`);
    this.name = "ObjectNotFoundError";
  }
}
