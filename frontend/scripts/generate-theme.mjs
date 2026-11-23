#!/usr/bin/env node
/**
 * Generates the Tailwind v4 @theme block from src/theme/tokens.json.
 *
 * The JSON file stays the single source of truth for the design system;
 * `styles.css` imports the generated CSS instead of hand-maintaining hex
 * values. Run with `--check` to fail when the generated file is stale (CI).
 * Both modes also fail when a token pair drops below WCAG AA contrast (see
 * theme-contrast.mjs).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';
import { evaluateContrast } from './theme-contrast.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tokensPath = resolve(root, 'src/theme/tokens.json');
const outputPath = resolve(root, 'src/theme/tokens.generated.css');

const tokens = JSON.parse(readFileSync(tokensPath, 'utf8'));

const contrastFailures = evaluateContrast(tokens).filter((result) => !result.pass);
if (contrastFailures.length > 0) {
  console.error('src/theme/tokens.json fails WCAG AA contrast:');
  for (const { fg, bg, ratio, min } of contrastFailures) {
    console.error(`  ${fg} on ${bg}: ${ratio.toFixed(2)}:1 (needs ${min}:1)`);
  }
  process.exit(1);
}

/** `gold.main` -> `#c5a059`: a semantic token names a palette colour. */
function paletteColor(path) {
  const value = path.split('.').reduce((node, key) => node?.[key], tokens.colors);
  if (typeof value !== 'string')
    throw new Error(`semantic token points at unknown colour "${path}"`);
  return value;
}

// Only purpose names reach the theme (and so Tailwind's utilities: bg-surface, text-accent, …).
// The palette under `colors` is the raw material the contrast rules check.
const variables = [
  ...Object.entries(tokens.semantic)
    .filter(([name]) => !name.startsWith('$'))
    .map(([name, path]) => [`--color-${name}`, paletteColor(path)]),
  ...Object.entries(tokens.radius).map(([name, value]) => [`--radius-${name}`, value]),
  ...Object.entries(tokens.shadow).map(([name, value]) => [`--shadow-${name}`, value]),
  ...Object.entries(tokens.font).map(([name, value]) => [`--font-${name}`, value]),
];

// Format with the repo's Prettier config so `prettier --check .` stays green
// and the --check comparison is stable.
const generated = await prettier.format(
  [
    '/* GENERATED FILE — do not edit.',
    ' * Source: src/theme/tokens.json',
    ' * Regenerate with: npm run theme:build',
    ' */',
    '@theme {',
    ...variables.map(([name, value]) => `  ${name}: ${value};`),
    '}',
    '',
  ].join('\n'),
  { ...(await prettier.resolveConfig(outputPath)), parser: 'css' },
);

if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = readFileSync(outputPath, 'utf8');
  } catch {
    current = '';
  }
  if (current !== generated) {
    console.error(
      'src/theme/tokens.generated.css is stale. Run `npm run theme:build` and commit the result.',
    );
    process.exit(1);
  }
  console.log('theme tokens are in sync.');
} else {
  writeFileSync(outputPath, generated);
  console.log(`wrote ${outputPath}`);
}
