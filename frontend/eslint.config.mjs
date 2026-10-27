// @ts-check
import eslint from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import angular from 'angular-eslint';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores([
    'dist/**',
    'coverage/**',
    '.angular/**',
    'playwright-report/**',
    'test-results/**',
  ]),
  {
    files: ['**/*.ts'],
    extends: [
      eslint.configs.recommended,
      ...tseslint.configs.recommended,
      ...angular.configs.tsRecommended,
    ],
    processor: angular.processInlineTemplates,
    rules: {
      '@angular-eslint/directive-selector': [
        'error',
        { type: 'attribute', prefix: 'app', style: 'camelCase' },
      ],
      '@angular-eslint/component-selector': [
        'error',
        { type: 'element', prefix: 'app', style: 'kebab-case' },
      ],
      // Allow intentionally-unused parameters/variables (e.g. interface stubs,
      // mock signatures) when prefixed with an underscore — mirrors the
      // TypeScript `noUnusedParameters` convention already used in this repo.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    // The booking wizard is `@defer`red on `/`; a static import of its store from the landing
    // page pulls Signal Forms and the wizard back into main.js (BENCHMARKS.md §63).
    files: ['src/app/features/landing/**/*.ts'],
    ignores: ['**/*.spec.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/booking/booking.store'],
              message:
                'Use LookbookSelectionBus: importing BookingStore puts Signal Forms in main.js (§63).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.html'],
    extends: [...angular.configs.templateRecommended, ...angular.configs.templateAccessibility],
  },
  prettier,
);
