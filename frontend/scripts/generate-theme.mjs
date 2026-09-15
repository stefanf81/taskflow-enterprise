#!/usr/bin/env node
/**
 * Generates the Tailwind v4 @theme block from src/theme/tokens.json.
 *
 * The JSON file stays the single source of truth for the design system;
 * `styles.css` imports the generated CSS instead of hand-maintaining hex
 * values. Run with `--check` to fail when the generated file is stale (CI).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tokensPath = resolve(root, 'src/theme/tokens.json');
const outputPath = resolve(root, 'src/theme/tokens.generated.css');

const tokens = JSON.parse(readFileSync(tokensPath, 'utf8'));

const colors = [
  ['--color-gold-light', tokens.colors.gold.light],
  ['--color-gold', tokens.colors.gold.main],
  ['--color-gold-dark', tokens.colors.gold.dark],
  ['--color-obsidian-light', tokens.colors.obsidian.light],
  ['--color-obsidian', tokens.colors.obsidian.bg],
  ['--color-obsidian-dark', tokens.colors.obsidian.dark],
  ['--color-status-pending', tokens.colors.status.pending],
  ['--color-status-approved', tokens.colors.status.approved],
  ['--color-status-denied', tokens.colors.status.denied],
  ['--color-status-info', tokens.colors.status.info],
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
    ...colors.map(([name, value]) => `  ${name}: ${value};`),
    '}',
    '',
  ].join('\n'),
  { parser: 'css' },
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
