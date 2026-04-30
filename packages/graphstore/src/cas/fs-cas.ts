import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { ContentAddressedStore, ObjectNotFoundError } from './interface.js';
import { makeObjectId, objectIdHex, type ObjectId } from '../types.js';

export interface FsCASOptions {
  /**
   * Root directory for the store. Objects land at
   * `<root>/objects/<aa>/<rest>` where `<aa>` is the first two hex
   * characters of the digest — same fan-out trick git uses to keep any
   * single directory's entry count bounded.
   */
  readonly root: string;
}

/**
 * Filesystem-backed content-addressed store.
 *
 * Layout under `<root>/objects/`:
 *
 *   <root>/objects/aa/bbcc...{62 more hex chars}.json
 *
 * Writes are atomic via tmpfile + rename. Reads return the raw bytes
 * exactly as written; callers handle JSON encoding/decoding via the
 * helpers in `./interface.ts`.
 */
export class FsCAS implements ContentAddressedStore {
  private readonly root: string;
  private readonly objectsDir: string;

  constructor(opts: FsCASOptions) {
    this.root = opts.root;
    this.objectsDir = path.join(opts.root, 'objects');
  }

  async put(bytes: Uint8Array): Promise<ObjectId> {
    const hex = sha256Hex(bytes);
    const id = makeObjectId(hex);
    const target = this.pathFor(id);

    // Idempotent: don't rewrite if the object is already there.
    try {
      await fs.access(target);
      return id;
    } catch {
      /* fall through to write */
    }

    const dir = path.dirname(target);
    await fs.mkdir(dir, { recursive: true });

    // Atomic write: tmpfile in the same dir, then rename. Same-dir
    // rename is atomic on every supported filesystem; cross-dir is
    // not, which is why the tmpfile sits next to the final target.
    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, bytes);
    try {
      await fs.rename(tmp, target);
    } catch (err) {
      // Concurrent writer beat us to it — that's fine, both byte
      // streams are equal by construction (same hash). Drop the
      // tmpfile and treat the existing object as ours.
      try {
        await fs.unlink(tmp);
      } catch {
        /* swallow */
      }
      try {
        await fs.access(target);
        return id;
      } catch {
        // Genuinely failed — re-throw the original rename error.
        throw err;
      }
    }
    return id;
  }

  async get(id: ObjectId): Promise<Uint8Array> {
    const target = this.pathFor(id);
    try {
      const buf = await fs.readFile(target);
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new ObjectNotFoundError(id);
      }
      throw err;
    }
  }

  async has(id: ObjectId): Promise<boolean> {
    try {
      await fs.access(this.pathFor(id));
      return true;
    } catch {
      return false;
    }
  }

  async *list(): AsyncIterable<ObjectId> {
    let prefixDirs: string[];
    try {
      prefixDirs = await fs.readdir(this.objectsDir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw err;
    }
    for (const prefix of prefixDirs) {
      // Skip stray files at the prefix-level — only 2-hex dirs are valid.
      if (prefix.length !== 2 || !/^[0-9a-f]{2}$/.test(prefix)) continue;
      const sub = path.join(this.objectsDir, prefix);
      let entries: string[];
      try {
        entries = await fs.readdir(sub);
      } catch {
        continue;
      }
      for (const file of entries) {
        // Object files are 62 hex chars + ".json"
        const m = /^([0-9a-f]{62})\.json$/.exec(file);
        if (!m) continue;
        const rest = m[1];
        if (rest === undefined) continue;
        yield makeObjectId(prefix + rest);
      }
    }
  }

  /** Path on disk for a given object id. Exposed for tests/debugging. */
  pathFor(id: ObjectId): string {
    const hex = objectIdHex(id);
    const prefix = hex.slice(0, 2);
    const rest = hex.slice(2);
    return path.join(this.objectsDir, prefix, `${rest}.json`);
  }
}

const sha256Hex = (bytes: Uint8Array): string => {
  // Wrap in a Buffer view for crypto — avoids a copy.
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return crypto.createHash('sha256').update(buf).digest('hex');
};
