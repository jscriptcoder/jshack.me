import { describe, it, expect, vi } from 'vitest';
import { createThemeCommand } from './theme';
import type { ThemeId } from '../theme/themes';

const createTestCommand = (currentTheme: ThemeId = 'amber') => {
  const setTheme = vi.fn();
  const command = createThemeCommand({
    setTheme,
    getCurrentTheme: () => currentTheme,
  });
  return { command, setTheme };
};

describe('theme command', () => {
  it('lists all themes with current marked when called with no args', () => {
    const { command } = createTestCommand('amber');
    const result = command.fn();
    expect(result).toContain('* amber');
    expect(result).toContain('green');
    expect(result).toContain('cyan');
    expect(result).toContain('light');
  });

  it('marks the current theme with asterisk', () => {
    const { command } = createTestCommand('green');
    const result = command.fn() as string;
    const lines = result.split('\n');
    const greenLine = lines.find((l) => l.includes('green'));
    const amberLine = lines.find((l) => l.includes('amber'));
    expect(greenLine).toContain('*');
    expect(amberLine).not.toContain('*');
  });

  it('switches to a valid theme', () => {
    const { command, setTheme } = createTestCommand('amber');
    const result = command.fn('green');
    expect(setTheme).toHaveBeenCalledWith('green');
    expect(result).toContain('Green Phosphor');
  });

  it('throws for an invalid theme name', () => {
    const { command } = createTestCommand('amber');
    expect(() => command.fn('neon')).toThrow("unknown theme 'neon'");
  });

  it('throws for non-string argument', () => {
    const { command } = createTestCommand('amber');
    expect(() => command.fn(42)).toThrow('expected string argument');
  });

  it('lists themes when called with undefined arg', () => {
    const { command } = createTestCommand('amber');
    const result = command.fn(undefined);
    expect(result).toContain('amber');
  });
});
