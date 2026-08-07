import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import kit from './eslint-rules/index.js';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/blob-report/**',
      'images/mollie-mock/src/**',
      // Prepared module trees: third-party source copied in by `e2e-kit prepare-module`, plus its
      // composer/npm vendor output. Never ours to lint.
      '**/.e2e-kit/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Everything here runs on Node; declaring the globals explicitly avoids depending on
    // the `globals` package for a handful of names.
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        fetch: 'readonly',
        Response: 'readonly',
        AbortController: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        RequestInit: 'readonly',
        HTMLButtonElement: 'readonly',
        HTMLElement: 'readonly',
        getComputedStyle: 'readonly',
        document: 'readonly',
        window: 'readonly',
        NodeJS: 'readonly',
        HTMLInputElement: 'readonly',
        HTMLAnchorElement: 'readonly',
      },
    },
  },
  {
    plugins: { kit },
    rules: {
      'kit/require-intent-comment': 'error',
      'kit/no-direct-playwright-import': 'error',

      // Spec §7.3: no hard sleeps anywhere in test code.
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.property.name='waitForTimeout']",
          message:
            'page.waitForTimeout is banned (spec §7.3). Use an auto-waiting assertion, waitForURL, or expect.poll.',
        },
        {
          // Spec §7.1: nth() needs an explicit FRAGILE justification, which this rule
          // cannot read; the comment check lives in review. Flag bare .nth() so it is
          // never accidental.
          selector: "CallExpression[callee.property.name='nth']",
          message:
            'Locator.nth() requires a `// FRAGILE:` comment justifying it (spec §7.1). Add the comment and disable this rule on the line.',
        },
      ],

      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    // The CLI and build scripts are plain Node, not test code.
    files: ['packages/*/bin/**', 'scripts/**'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    // `async ({}, use) => …` is Playwright's own idiom for a fixture with no dependencies.
    files: ['packages/*/src/fixtures/**', 'packages/*/src/test.ts'],
    rules: { 'no-empty-pattern': 'off' },
  },
);
