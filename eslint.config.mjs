import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import unusedImports from 'eslint-plugin-unused-imports';
import reactHooks from 'eslint-plugin-react-hooks';
import prettierConfig from 'eslint-config-prettier';

export default [
  // Global ignores
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      // On-disk DIRECTORY paths — workspaces live under `packages/`, `apps/`,
      // and `integrations/`; packages publish under `@codragraph/<short>` names.
      'packages/core/vendor/**',
      'apps/web/src/vendor/**',
      'packages/core/test/fixtures/**',
      'apps/web/playwright-report/**',
      'apps/web/test-results/**',
      '**/*.d.ts',
      '.claude/**',
      '.history/**',
    ],
  },

  // Base TypeScript config for all packages
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'unused-imports': unusedImports,
    },
    rules: {
      // Unused imports — auto-fixable
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': [
        'warn',
        {
          vars: 'all',
          varsIgnorePattern: '^_',
          args: 'after-used',
          argsIgnorePattern: '^_',
          caughtErrors: 'all',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      // TypeScript quality
      '@typescript-eslint/no-unused-vars': 'off', // handled by unused-imports plugin
      'no-unused-vars': 'off', // handled by unused-imports plugin
      // These rules currently have a large known baseline across parser
      // fixtures/tests and some legacy integration code. Keeping them as
      // warnings makes `npm run lint` noisy while still passing; re-enable
      // with a baseline/ratchet when the existing usage is paid down.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',

      // General quality
      'no-debugger': 'error',
      'prefer-const': 'error',
      'no-var': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },

  // CLI package — allow console.log (it's a CLI tool)
  {
    files: ['packages/core/src/cli/**/*.ts', 'packages/core/src/server/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },

  // React-specific rules for the web app
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

  // Disable formatting rules (prettier handles those)
  prettierConfig,
];
