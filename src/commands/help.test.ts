import { describe, it, expect } from 'vitest';
import type { Command, CommandCategory } from '../components/Terminal/types';
import { createHelpCommand } from './help';

// --- Factory Functions ---

const getMockCommand = (overrides?: Partial<Command>): Command => ({
  name: 'test',
  category: 'general',
  description: 'A test command',
  fn: () => 'test result',
  ...overrides,
});

// --- Tests ---

describe('help command', () => {
  it('should display category headers', () => {
    const commands = [
      getMockCommand({ name: 'foo', category: 'general', description: 'General cmd' }),
      getMockCommand({ name: 'bar', category: 'network', description: 'Network cmd' }),
    ];

    const help = createHelpCommand(() => commands);
    const result = String(help.fn());

    expect(result).toContain('General');
    expect(result).toContain('Network');
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

  it('should sort commands alphabetically within each category', () => {
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

  it('should align descriptions by padding synopses across categories', () => {
    const commands = [
      getMockCommand({
        name: 'short',
        category: 'general',
        description: 'Short one',
        manual: { synopsis: 'short()', description: '' },
      }),
      getMockCommand({
        name: 'longer',
        category: 'network',
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
    const result = String(help.fn());

    expect(result).toContain('man(command)');
  });

  it('should display categories in fixed order', () => {
    const commands = [
      getMockCommand({ name: 'wifi-cmd', category: 'wifi', description: 'WiFi' }),
      getMockCommand({ name: 'net-cmd', category: 'network', description: 'Network' }),
      getMockCommand({ name: 'gen-cmd', category: 'general', description: 'General' }),
      getMockCommand({ name: 'fs-cmd', category: 'filesystem', description: 'Filesystem' }),
      getMockCommand({ name: 'mis-cmd', category: 'mission', description: 'Mission' }),
    ];

    const help = createHelpCommand(() => commands);
    const result = String(help.fn());

    const order: readonly CommandCategory[] = [
      'general',
      'filesystem',
      'mission',
      'network',
      'wifi',
    ];
    const positions = order.map((cat) =>
      result.indexOf(
        cat === 'general'
          ? 'General'
          : cat === 'filesystem'
            ? 'Filesystem'
            : cat === 'mission'
              ? 'Mission'
              : cat === 'network'
                ? 'Network'
                : 'WiFi',
      ),
    );

    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]!).toBeGreaterThan(positions[i - 1]!);
    }
  });

  it('should only show categories that have commands', () => {
    const commands = [
      getMockCommand({ name: 'net-cmd', category: 'network', description: 'Network cmd' }),
    ];

    const help = createHelpCommand(() => commands);
    const result = String(help.fn());

    expect(result).toContain('Network');
    expect(result).not.toContain('General');
    expect(result).not.toContain('WiFi');
  });

  it('should show man hint at the bottom', () => {
    const help = createHelpCommand(() => [getMockCommand()]);
    const result = String(help.fn());

    expect(result).toContain('man(command)');
  });
});
