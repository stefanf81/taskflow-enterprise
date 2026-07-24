import { colors } from '../src/theme/colors';

describe('theme/colors', () => {
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
    expect(colors.text.muted).toBe('#71717a');
    expect(colors.text.dark).toBe('#090d16');
  });

  it('has status color keys', () => {
    expect(colors.status.pending).toBe('#fbbf24');
    expect(colors.status.approved).toBe('#34d399');
    expect(colors.status.denied).toBe('#f87171');
    expect(colors.status.info).toBe('#3B82F6');
  });
});
