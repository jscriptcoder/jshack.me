import { describe, it, expect } from 'vitest';
import type { Command } from '../components/Terminal/types';
import { createHelpCommand } from './help';

// --- Factory Functions ---

const getMockCommand = (overrides?: Partial<Command>): Command => ({
  name: 'test',
  description: 'A test command',
  fn: () => 'test result',
  ...overrides,
});

// --- Tests ---

describe('help command', () => {
  it('should display header', () => {
    const help = createHelpCommand(() => []);
    const result = help.fn();

    expect(result).toContain('Available commands:');
  });

  it('should list all commands with descriptions', () => {
    const commands = [
      getMockCommand({ name: 'foo', description: 'Does foo things' }),
      getMockCommand({ name: 'bar', description: 'Does bar things' }),
    ];

    const help = createHelpCommand(() => commands);
    const result = help.fn();

    expect(result).toContain('foo()');
    expect(result).toContain('Does foo things');
    expect(result).toContain('bar()');
    expect(result).toContain('Does bar things');
  });

  it('should sort commands alphabetically', () => {
    const commands = [
      getMockCommand({ name: 'zebra', description: 'Last' }),
      getMockCommand({ name: 'alpha', description: 'First' }),
      getMockCommand({ name: 'middle', description: 'Middle' }),
    ];

    const help = createHelpCommand(() => commands);
    const result = String(help.fn());

    const alphaIndex = result.indexOf('alpha');
    const middleIndex = result.indexOf('middle');
    const zebraIndex = result.indexOf('zebra');

    expect(alphaIndex).toBeLessThan(middleIndex);
    expect(middleIndex).toBeLessThan(zebraIndex);
  });

  it('should use synopsis from manual when available', () => {
    const commands = [
      getMockCommand({
        name: 'test',
        description: 'Test command',
        manual: {
          synopsis: 'test(arg1, [arg2])',
          description: 'Full description',
        },
      }),
    ];

    const help = createHelpCommand(() => commands);
    const result = help.fn();

    expect(result).toContain('test(arg1, [arg2])');
    expect(result).not.toContain('test() -');
  });

  it('should fall back to name() when no manual', () => {
    const commands = [
      getMockCommand({
        name: 'simple',
        description: 'Simple command',
        manual: undefined,
      }),
    ];

    const help = createHelpCommand(() => commands);
    const result = help.fn();

    expect(result).toContain('simple()');
  });

  it('should align descriptions by padding synopses', () => {
    const commands = [
      getMockCommand({
        name: 'short',
        description: 'Short one',
        manual: { synopsis: 'short()', description: '' },
      }),
      getMockCommand({
        name: 'longer',
        description: 'Longer one',
        manual: { synopsis: 'longer(a, b, c)', description: '' },
      }),
    ];

    const help = createHelpCommand(() => commands);
    const result = String(help.fn());

    // Both descriptions should start at the same column
    const descCol = (line: string) => line.indexOf(line.includes('Short') ? 'Short' : 'Longer');
    const lines = result.split('\n').filter((l) => l.includes('one'));
    expect(descCol(lines[0]!)).toBe(descCol(lines[1]!));
  });

  it('should handle empty command list', () => {
    const help = createHelpCommand(() => []);
    const result = help.fn();

    expect(result).toBe('Available commands:\n');
  });
});
