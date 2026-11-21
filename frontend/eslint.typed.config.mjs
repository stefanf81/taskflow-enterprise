// @ts-check
// Type-aware ESLint rules, run as a separate, uncached pass (`npm run lint`).
//
// The main config (eslint.config.mjs) runs with `--cache --cache-strategy content`: a file's cached
// result is reused while that file is unchanged, which is only sound because none of its rules uses
// type information. A type-aware rule depends on other files too (a function that starts returning
// a Promise makes every unawaited caller wrong), so these rules live here and always run in full.
// The set is deliberately narrow: upstream's whole `recommendedTypeChecked` preset was measured at
// 92 findings, 79 of them `no-unsafe-*` noise in spec doubles (BENCHMARKS.md §84).
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig({
  files: ['src/**/*.ts'],
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
  },
  plugins: { '@typescript-eslint': tseslint.plugin },
  // Disable-comments for rules that live in the main config would otherwise be reported here.
  linterOptions: { reportUnusedDisableDirectives: 'off' },
  rules: {
    // An unhandled Promise hides failures and races (a test asserting before the save settled).
    // Await it, or mark a deliberate fire-and-forget with `void`.
    '@typescript-eslint/no-floating-promises': 'error',
    // A Promise passed where a boolean or a void callback is expected (if (promise), event handlers).
    '@typescript-eslint/no-misused-promises': 'error',
  },
});
