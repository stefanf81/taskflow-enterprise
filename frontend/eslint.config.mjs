// @ts-check
import eslint from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import angular from 'angular-eslint';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

// The router already pulls @angular/common's shared chunk into the initial bundle, so a template
// pipe or directive from it, even in a lazy component, ships its code and locale data to every
// guest page (~22 kB raw). Use the Intl formatters in core/format.ts and [class] bindings instead.
// A separate constant because each block below sets the rule again, which replaces its options.
const COMMON_TEMPLATE_IMPORTS = {
  name: '@angular/common',
  importNames: [
    'CommonModule',
    'NgClass',
    'NgStyle',
    'CurrencyPipe',
    'DatePipe',
    'DecimalPipe',
    'PercentPipe',
  ],
  message:
    'Pulls @angular/common formatters into the initial bundle: use core/format.ts or [class]/[style] bindings.',
};

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
      'no-restricted-imports': ['error', { paths: [COMMON_TEMPLATE_IMPORTS] }],
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
          paths: [COMMON_TEMPLATE_IMPORTS],
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
    // core/ is the app-wide layer (API clients, singletons, session). Features depend on it, never
    // the other way round; lazy feature loading lives in app.routes.ts / dashboard-loaders.ts.
    files: ['src/app/core/**/*.ts'],
    ignores: ['**/*.spec.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [COMMON_TEMPLATE_IMPORTS],
          patterns: [
            {
              group: ['**/features/**'],
              message:
                'core/ must not depend on features/; inject an abstraction from core instead.',
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
