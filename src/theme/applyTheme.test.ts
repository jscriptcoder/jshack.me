import { describe, it, expect, beforeEach } from 'vitest';
import { applyTheme } from './applyTheme';
import { THEMES } from './themes';

describe('applyTheme', () => {
  beforeEach(() => {
    document.documentElement.style.cssText = '';
  });

  it('sets CSS custom properties for amber theme', () => {
    applyTheme(THEMES.amber);
    const style = document.documentElement.style;
    expect(style.getPropertyValue('--theme-bg')).toBe('#000000');
    expect(style.getPropertyValue('--theme-text')).toBe('#f59e0b');
    expect(style.getPropertyValue('--theme-error')).toBe('#ef4444');
  });

  it('sets CSS custom properties for green theme', () => {
    applyTheme(THEMES.green);
    const style = document.documentElement.style;
    expect(style.getPropertyValue('--theme-bg')).toBe('#000000');
    expect(style.getPropertyValue('--theme-text')).toBe('#22c55e');
  });

  it('converts camelCase keys to kebab-case CSS variables', () => {
    applyTheme(THEMES.amber);
    const style = document.documentElement.style;
    expect(style.getPropertyValue('--theme-text-bright')).toBe('#fcd34d');
    expect(style.getPropertyValue('--theme-scroll-thumb')).toBeTruthy();
    expect(style.getPropertyValue('--theme-scroll-thumb-hover')).toBeTruthy();
    expect(style.getPropertyValue('--theme-avatar-border')).toBeTruthy();
  });

  it('sets all expected color properties', () => {
    applyTheme(THEMES.cyan);
    const style = document.documentElement.style;
    const expectedVars = [
      '--theme-bg',
      '--theme-text',
      '--theme-text-bright',
      '--theme-text-dim',
      '--theme-error',
      '--theme-accent',
      '--theme-accent-text',
      '--theme-border',
      '--theme-scroll-thumb',
      '--theme-scroll-thumb-hover',
      '--theme-caret',
      '--theme-link',
      '--theme-link-hover',
      '--theme-avatar-border',
    ];
    expectedVars.forEach((varName) => {
      expect(style.getPropertyValue(varName)).toBeTruthy();
    });
  });

  it('overwrites previous theme properties', () => {
    applyTheme(THEMES.amber);
    expect(document.documentElement.style.getPropertyValue('--theme-text')).toBe('#f59e0b');

    applyTheme(THEMES.green);
    expect(document.documentElement.style.getPropertyValue('--theme-text')).toBe('#22c55e');
  });
});
