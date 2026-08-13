/**
 * Test helper: the `@codragraph/cli@<version>` spec written into MCP configs
 *
 * `src/cli/setup.ts` derives this from package.json at runtime, so asserting
 * a hard-coded version makes every release bump fail CI until the literals
 * are hand-edited. Deriving it the same way keeps the tests version-agnostic.
 */
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json') as { version: string };

export const CLI_PACKAGE_SPEC = `@codragraph/cli@${pkg.version}`;
