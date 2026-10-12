/**
 * WCAG 2.x AA colour-contrast rules for src/theme/tokens.json.
 *
 * `generate-theme.mjs` runs these on every `theme:build` / `theme:check` (and so on
 * `npm run lint`), so a token edit that drops a text/background pair below AA fails CI
 * instead of shipping. Only pairs the UI actually renders are asserted: text tokens on
 * the dark surfaces that sit behind text, and the dark label colour on gold fills.
 */

/** Obsidian tokens used as backgrounds behind text (`border`/`muted`/`light` are not). */
export const TEXT_SURFACES = ['bg', 'card', 'surface', 'inputBg', 'dark'];

/** Tokens rendered as normal-size text on the dark surfaces (WCAG 1.4.3: 4.5:1). */
export const TEXT_TOKENS = [
  'text.primary',
  'text.secondary',
  'text.muted',
  'gold.main',
  'gold.bright',
  'gold.light',
  'status.pending',
  'status.approved',
  'status.denied',
  'status.info',
];

/** @typedef {{ fg: string; bg: string; min: number }} ContrastRule */

/** @type {ContrastRule[]} */
export const CONTRAST_RULES = [
  ...TEXT_TOKENS.flatMap((fg) =>
    TEXT_SURFACES.map((surface) => ({ fg, bg: `obsidian.${surface}`, min: 4.5 })),
  ),
  // Dark labels on gold fills (primary buttons, selected slots, completed steps).
  { fg: 'text.dark', bg: 'gold.main', min: 4.5 },
  { fg: 'text.dark', bg: 'gold.bright', min: 4.5 },
  { fg: 'text.dark', bg: 'gold.light', min: 4.5 },
  // gold.dark: small month label on the black date chips, and a non-text accent
  // (progress line, focus borders) everywhere else (WCAG 1.4.11: 3:1).
  { fg: 'gold.dark', bg: 'obsidian.inputBg', min: 4.5 },
  ...TEXT_SURFACES.map((surface) => ({ fg: 'gold.dark', bg: `obsidian.${surface}`, min: 3 })),
];

/** WCAG relative luminance of a `#rrggbb` colour. */
export function relativeLuminance(hex) {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) throw new Error(`Expected an opaque #rrggbb colour, got "${hex}"`);
  const [r, g, b] = [0, 2, 4].map((i) => {
    const channel = parseInt(match[1].slice(i, i + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio (1–21) between two `#rrggbb` colours. */
export function contrastRatio(a, b) {
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

function resolve(colors, path) {
  const value = path.split('.').reduce((node, key) => node?.[key], colors);
  if (typeof value !== 'string') throw new Error(`Unknown colour token "${path}"`);
  return value;
}

/**
 * Evaluates every rule against `tokens.colors`.
 * @returns {{ fg: string; bg: string; min: number; ratio: number; pass: boolean }[]}
 */
export function evaluateContrast(tokens, rules = CONTRAST_RULES) {
  return rules.map((rule) => {
    const ratio = contrastRatio(resolve(tokens.colors, rule.fg), resolve(tokens.colors, rule.bg));
    return { ...rule, ratio, pass: ratio >= rule.min };
  });
}
