import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import { createRequire } from 'module';

const _require = createRequire(import.meta.url);
const codragraphPkg = _require('../codragraph/package.json');

// Resolve a workspace-hoisted package's file path. npm workspaces hoist
// shared deps to the monorepo root node_modules, so __dirname-relative
// paths from the package break. require.resolve walks up the standard
// resolution chain and finds them wherever they actually live.
// Returns null when the file no longer exists — we then drop the alias
// rather than wedge the build (defensive across SDK version bumps).
const tryResolveHoisted = (specifier: string): string | null => {
  try {
    return _require.resolve(specifier);
  } catch {
    return null;
  }
};

const aliases: Record<string, string> = {
  '@': path.resolve(__dirname, './src'),
  '@shared': path.resolve(__dirname, '../shared'),
  '@codragraph/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
};

// `@langchain/anthropic` imports a SDK internal that newer SDK versions
// no longer ship. Use the upstream file when present; otherwise fall
// back to a no-op shim so the bundle can resolve the import. The
// dashboard's actual chat path doesn't traverse this helper.
aliases['@anthropic-ai/sdk/lib/transform-json-schema'] =
  tryResolveHoisted('@anthropic-ai/sdk/lib/transform-json-schema.mjs') ??
  path.resolve(__dirname, 'src/vendor/anthropic-transform-json-schema-shim.mjs');
// Mermaid d3-color prototype crash workaround (mermaid 10.9.0+ + Vite).
const mermaidEsm = tryResolveHoisted('mermaid/dist/mermaid.esm.min.mjs');
if (mermaidEsm) {
  aliases.mermaid = mermaidEsm;
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __REQUIRED_NODE_VERSION__: JSON.stringify(codragraphPkg.engines.node.replace(/[>=^~\s]/g, '')),
  },
  resolve: {
    alias: aliases,
  },
  server: {
    // Allow serving files from node_modules
    fs: {
      allow: ['..'],
    },
  },
});
