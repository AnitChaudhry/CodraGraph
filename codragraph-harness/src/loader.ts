// Candidate loader — esbuild compile + dynamic import.
//
// Phase 1 originally relied on `tsx` runtime to import .ts directly. That works
// for CLI dev but not for the published binary. esbuild compiles each
// candidate's source/index.ts into source/_compiled/index.js (bundled, ESM),
// then we dynamic-import the .js. Esbuild is fast enough (~50ms per candidate)
// that we run it on every loadCandidate call; we skip recompile when the .js
// mtime is newer than the .ts source.
//
// Why bundle? Proposer-written candidates may import helpers from sibling
// files in the same source/ tree. Bundle lets a candidate be a self-contained
// .js with no relative-import resolution surprises. We mark codragraph,
// codragraph-shared, and codragraph-harness as external so harnesses can
// `import type { Harness } from "@codragraph/harness/harness"` without
// pulling the whole library into the bundle.

import { build, type Plugin } from 'esbuild';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Harness } from './harness/interface.js';

export interface LoaderOptions {
  /** Cache-bust each load — useful in long-lived dev sessions. Default true. */
  cacheBust?: boolean;
  /** Override target node version. Default "node20". */
  target?: string;
}

const DEFAULT_EXTERNAL = [
  '@codragraph/cli',
  '@codragraph/shared',
  '@codragraph/harness',
  '@anthropic-ai/sdk',
  'openai',
  '@modelcontextprotocol/sdk',
];

/**
 * Compile (if needed) and load a candidate harness from disk.
 *
 * Compiles `<candidateDir>/source/index.ts` via esbuild into
 * `<candidateDir>/source/_compiled/index.js`, then dynamic-imports the .js
 * and returns the default-exported Harness.
 */
export async function compileAndLoadCandidate(
  candidateDir: string,
  options: LoaderOptions = {},
): Promise<Harness> {
  const sourceTs = path.join(candidateDir, 'source', 'index.ts');
  const compiledDir = path.join(candidateDir, 'source', '_compiled');
  const compiledJs = path.join(compiledDir, 'index.js');

  if (!(await isUpToDate(sourceTs, compiledJs))) {
    await fs.mkdir(compiledDir, { recursive: true });
    await build({
      entryPoints: [sourceTs],
      outfile: compiledJs,
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: options.target ?? 'node20',
      external: DEFAULT_EXTERNAL,
      sourcemap: 'inline',
      logLevel: 'silent',
      plugins: [externalizeBareImports()],
    });
  }

  const cacheBuster = options.cacheBust === false ? '' : `?t=${Date.now()}`;
  const url = pathToFileURL(compiledJs).href + cacheBuster;
  const mod = (await import(url)) as Record<string, unknown>;
  const harness = (mod.default ?? mod.harness) as Harness | undefined;
  if (!harness || typeof harness.run !== 'function') {
    throw new Error(`Candidate at ${sourceTs} does not default-export a Harness`);
  }
  return harness;
}

async function isUpToDate(src: string, dst: string): Promise<boolean> {
  try {
    const [s, d] = await Promise.all([fs.stat(src), fs.stat(dst)]);
    return d.mtimeMs >= s.mtimeMs;
  } catch {
    return false;
  }
}

/**
 * Externalize any bare module specifier (e.g. "lodash", "uuid") that the
 * proposer might import. We can't predict what bare imports they'll choose;
 * leaving them external means the runtime resolves from the harness package's
 * node_modules (which inherits everything via npm workspaces).
 */
function externalizeBareImports(): Plugin {
  return {
    name: 'externalize-bare-imports',
    setup(b) {
      b.onResolve({ filter: /^[^./]/ }, (args) => {
        // Don't externalize built-in node modules — esbuild handles those.
        if (args.path.startsWith('node:')) return { path: args.path, external: true };
        return { path: args.path, external: true };
      });
    },
  };
}
