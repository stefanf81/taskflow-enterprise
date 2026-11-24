import { describe, expect, it } from 'vitest';
import tokens from '../tokens.json';
import { palette, semantic, withAlpha } from './index';

describe('@taskflow/theme', () => {
  it('resolves every semantic colour to its palette value', () => {
    expect(semantic.accent).toBe(palette.gold.main);
    expect(semantic.surface).toBe(palette.obsidian.card);
    expect(semantic['fg-muted']).toBe(palette.text.secondary);
    expect(semantic['danger-strong']).toBe(palette.status.deniedStrong);
    const names = Object.keys(tokens.semantic).filter((n) => !n.startsWith('$'));
    expect(Object.keys(semantic).sort()).toEqual(names.sort());
    for (const value of Object.values(semantic)) expect(value).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('builds translucent tints of opaque colours', () => {
    expect(withAlpha('#34d399', 0.12)).toBe('rgba(52, 211, 153, 0.12)');
    expect(withAlpha('#FFFFFF', 0.05)).toBe('rgba(255, 255, 255, 0.05)');
    expect(() => withAlpha('rgba(0, 0, 0, 0.5)', 0.1)).toThrow(/opaque/);
  });
});
