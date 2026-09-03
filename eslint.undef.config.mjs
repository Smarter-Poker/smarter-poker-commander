/**
 * BLOCKING LINT GATE - undefined identifiers only.
 *
 * `npm run lint` (next lint, full ruleset) is advisory in CI and has been red
 * for months, so nobody reads it. On 2026-09-03 that meant `no-undef` was
 * reporting `completeLogin is not defined` in pages/commander/login.js on
 * every build while every Commander login in production failed with exactly
 * that ReferenceError. A lint that cannot fail the build is a lint nobody
 * sees.
 *
 * This config runs ONE rule, `no-undef`, and `npm run lint:undef` is a
 * REQUIRED CI step. Anything it flags is a ReferenceError waiting for a user.
 * Keep it green; do not add exceptions here - fix the code.
 */
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import importPlugin from 'eslint-plugin-import';
import nextPlugin from '@next/eslint-plugin-next';

export default [
  {
    files: [
      'pages/**/*.{js,jsx}',
      'src/**/*.{js,jsx}',
      'vendor/commander-shared/src/**/*.{js,jsx}',
      'scripts/**/*.{js,mjs}',
    ],
    ignores: ['**/*.test.js', '**/*.spec.js'],
    // Registered only so existing `eslint-disable react-hooks/...` and
    // `import/...` directives resolve; their rules are NOT enabled here.
    plugins: { 'react-hooks': reactHooks, import: importPlugin, '@next/next': nextPlugin },
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2021,
        React: 'readonly',
        // Web APIs newer than the globals package snapshot
        BarcodeDetector: 'readonly',
      },
    },
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    rules: { 'no-undef': 'error' },
  },
];
