import { beforeEach, expect } from 'vitest';
import * as matchers from '@testing-library/jest-dom/matchers';

// Register jest-dom matchers against the local vitest's expect.
// We can't use `import '@testing-library/jest-dom/vitest'` because that
// side-effect entry resolves `vitest` from jest-dom's hoisted location
// (root node_modules / vitest@4) instead of this package's vitest@3, so the
// matchers register against the wrong expect and tests fail with
// `Invalid Chai property: toHaveTextContent`.
expect.extend(matchers);

// Reset storage between tests
beforeEach(() => {
  sessionStorage.removeItem('codragraph-llm-settings');
  localStorage.removeItem('codragraph-llm-settings'); // legacy key (migration)
});
