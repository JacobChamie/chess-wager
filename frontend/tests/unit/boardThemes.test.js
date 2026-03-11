import { describe, it, expect } from 'vitest';
import { BOARD_THEMES, THEME_KEYS } from '../../src/utils/boardThemes.js';

describe('boardThemes', () => {
  it('should export 5 themes', () => {
    expect(THEME_KEYS).toHaveLength(5);
  });

  it('should have expected theme keys', () => {
    expect(THEME_KEYS).toContain('default');
    expect(THEME_KEYS).toContain('dark');
    expect(THEME_KEYS).toContain('blue');
    expect(THEME_KEYS).toContain('green');
    expect(THEME_KEYS).toContain('purple');
  });

  it('should have name, lightSquare, and darkSquare for each theme', () => {
    for (const key of THEME_KEYS) {
      const theme = BOARD_THEMES[key];
      expect(theme.name).toBeDefined();
      expect(typeof theme.name).toBe('string');
      expect(theme.lightSquare).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(theme.darkSquare).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it('should have Classic as the default theme', () => {
    expect(BOARD_THEMES.default.name).toBe('Classic');
  });

  it('should have distinct colors for each theme', () => {
    for (const key of THEME_KEYS) {
      const theme = BOARD_THEMES[key];
      expect(theme.lightSquare).not.toBe(theme.darkSquare);
    }
  });
});
