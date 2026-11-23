import tokens from '../tokens.json';

/**
 * TaskFlow's design tokens, shared by the web app and the mobile app.
 *
 * `tokens.json` is the single source. The web build turns its `semantic` colours, radii, shadows
 * and font into Tailwind theme variables (`frontend/scripts/generate-theme.mjs`, which also fails
 * on WCAG AA contrast); the mobile app imports the objects below. Edit the JSON, never a copy.
 */

/** The raw palette. The contrast checks read it; screens should prefer {@link semantic}. */
export const palette = tokens.colors;

type Palette = typeof palette;
type SemanticName = Exclude<keyof typeof tokens.semantic, '$comment'>;

/** `gold.main` -> `#c5a059`: each semantic token names a palette colour. */
function paletteColor(path: string): string {
  const value = path
    .split('.')
    .reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], palette);
  if (typeof value !== 'string') throw new Error(`semantic token points at unknown colour "${path}"`);
  return value;
}

/**
 * Colours by purpose (`page`, `surface`, `raised`, `fg`, `fg-muted`, `accent`, `accent-tint`,
 * `danger`, …), resolved to their palette values. The same names are the web's Tailwind colours
 * (`bg-surface`, `text-accent`).
 */
export const semantic = Object.fromEntries(
  Object.entries(tokens.semantic)
    .filter(([name]) => !name.startsWith('$'))
    .map(([name, path]) => [name, paletteColor(path)]),
) as Record<SemanticName, string>;

export const radius = tokens.radius;
export const fontFamily = tokens.font;

/**
 * `withAlpha('#34d399', 0.12)` -> `rgba(52, 211, 153, 0.12)`: a translucent tint of an opaque
 * token, for platforms without CSS `color-mix` (React Native).
 */
export function withAlpha(hex: string, alpha: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) throw new Error(`withAlpha needs an opaque #rrggbb colour, got "${hex}"`);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(match[1]!.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export type { Palette, SemanticName };
