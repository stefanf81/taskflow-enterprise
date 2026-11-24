import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { palette } from '@taskflow/theme';
import { colors, semantic, withAlpha } from '../src/theme/colors';

describe('theme/colors', () => {
  it('renders with the tokens the web app uses (shared/theme/tokens.json)', () => {
    expect(colors).toBe(palette);
    expect(semantic.accent).toBe(colors.gold.main);
    expect(semantic['fg-muted']).toBe(colors.text.secondary);
    expect(withAlpha(colors.status.approved, 0.12)).toBe('rgba(52, 211, 153, 0.12)');
  });

  it('has obsidian color keys', () => {
    expect(colors.obsidian).toBeDefined();
    expect(colors.obsidian.bg).toBe('#090d16');
    expect(colors.obsidian.card).toBe('#09090b');
    expect(colors.obsidian.surface).toBe('#18181b');
    expect(colors.obsidian.border).toBe('#27272a');
    expect(colors.obsidian.muted).toBe('#1f1f22');
    expect(colors.obsidian.inputBg).toBe('#000000');
  });

  it('has gold color keys', () => {
    expect(colors.gold.main).toBe('#c5a059');
    expect(colors.gold.bright).toBe('#d4af37');
    expect(colors.gold.light).toBe('#e5c185');
    expect(colors.gold.dark).toBe('#8e7a5c');
    expect(colors.gold.dim).toBe('rgba(197, 160, 89, 0.15)');
    expect(colors.gold.border).toBe('rgba(197, 160, 89, 0.3)');
  });

  it('has text color keys', () => {
    expect(colors.text.primary).toBe('#f4f4f5');
    expect(colors.text.secondary).toBe('#a1a1aa');
    expect(colors.text.muted).toBe('#8a8a93'); // same as web (zinc-500 override)
    expect(colors.text.dark).toBe('#090d16');
  });

  it('has status color keys', () => {
    expect(colors.status.pending).toBe('#fbbf24');
    expect(colors.status.approved).toBe('#34d399');
    expect(colors.status.denied).toBe('#f87171');
    expect(colors.status.info).toBe('#3B82F6');
  });

  describe('WCAG AA contrast', () => {
    /** WCAG 2.x relative luminance of an opaque #rrggbb colour. */
    const luminance = (hex: string): number => {
      const [r, g, b] = [1, 3, 5].map((i) => {
        const channel = parseInt(hex.slice(i, i + 2), 16) / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      }) as [number, number, number];
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const contrast = (a: string, b: string): number => {
      const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
      return (light + 0.05) / (dark + 0.05);
    };

    // Obsidian tokens rendered behind text (border/muted/light are not text backgrounds).
    const surfaces = {
      bg: colors.obsidian.bg,
      card: colors.obsidian.card,
      surface: colors.obsidian.surface,
      inputBg: colors.obsidian.inputBg,
      dark: colors.obsidian.dark,
    };
    const textTokens = {
      'text.primary': colors.text.primary,
      'text.secondary': colors.text.secondary,
      'text.muted': colors.text.muted,
      'gold.main': colors.gold.main,
      'gold.bright': colors.gold.bright,
      'gold.light': colors.gold.light,
      'status.pending': colors.status.pending,
      'status.approved': colors.status.approved,
      'status.denied': colors.status.denied,
      'status.info': colors.status.info,
    };

    it.each(Object.entries(textTokens))('%s reaches 4.5:1 on every dark surface', (_name, fg) => {
      for (const bg of Object.values(surfaces)) {
        expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
      }
    });

    it('keeps dark labels readable on gold fills (buttons, selected slots, completed steps)', () => {
      for (const fill of [colors.gold.main, colors.gold.bright, colors.gold.light]) {
        expect(contrast(colors.text.dark, fill)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(colors.obsidian.bg, fill)).toBeGreaterThanOrEqual(4.5);
      }
    });
  });

  it('has no hard-coded colours in the app source (use colors, semantic or withAlpha)', () => {
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/\.tsx?$/.test(entry.name) && !path.endsWith(join('theme', 'colors.ts'))) {
          readFileSync(path, 'utf8')
            .split('\n')
            .forEach((line, i) => {
              if (/['"`](#[0-9a-f]{3,8}|rgba?\()/i.test(line)) offenders.push(`${path}:${i + 1}`);
            });
        }
      }
    };
    walk(join(__dirname, '..', 'src'));
    expect(offenders).toEqual([]);
  });
});
