import { describe, it, expect } from 'vitest';
import type { Command } from '../components/Terminal/types';
import { createManCommand } from './man';

// --- Factory Functions ---

const getMockCommand = (overrides?: Partial<Command>): Command => ({
  name: 'test',
  description: 'A test command',
  fn: () => 'test result',
  ...overrides,
});

const createCommandMap = (commands: readonly Command[]): Map<string, Command> =>
  new Map(commands.map((cmd) => [cmd.name, cmd]));

// --- Tests ---

describe('man command', () => {
  describe('error handling', () => {
    it('should throw error when no command name given', () => {
      const man = createManCommand(() => new Map());

      expect(() => man.fn()).toThrow('man: missing command name');
      expect(() => man.fn()).toThrow('Usage: man("command")');
    });

    it('should throw error for unknown command', () => {
      const man = createManCommand(() => new Map());

      expect(() => man.fn('unknown')).toThrow("man: no manual entry for 'unknown'");
    });
  });

  describe('basic sections', () => {
    it('should display header with uppercase command name', () => {
      const commands = createCommandMap([
        getMockCommand({ name: 'test', description: 'Test command' }),
      ]);

      const man = createManCommand(() => commands);
      const result = man.fn('test');

      expect(result).toContain('TEST(1)');
    });

    it('should display NAME section', () => {
      const commands = createCommandMap([
        getMockCommand({ name: 'foo', description: 'Does foo things' }),
      ]);

      const man = createManCommand(() => commands);
      const result = man.fn('foo');

      expect(result).toContain('NAME');
      expect(result).toContain('foo - Does foo things');
    });

    it('should display fallback message when no manual', () => {
      const commands = createCommandMap([
        getMockCommand({ name: 'simple', description: 'Simple', manual: undefined }),
      ]);

      const man = createManCommand(() => commands);
      const result = man.fn('simple');

      expect(result).toContain('No detailed manual available for this command.');
    });
  });

  describe('manual sections', () => {
    it('should display SYNOPSIS section', () => {
      const commands = createCommandMap([
        getMockCommand({
          name: 'test',
          description: 'Test',
          manual: {
            synopsis: 'test(arg)',
            description: 'Full description',
          },
        }),
      ]);

      const man = createManCommand(() => commands);
      const result = man.fn('test');

      expect(result).toContain('SYNOPSIS');
      expect(result).toContain('test(arg)');
    });

    it('should display DESCRIPTION section', () => {
      const commands = createCommandMap([
        getMockCommand({
          name: 'test',
          description: 'Short desc',
          manual: {
            synopsis: 'test()',
            description: 'This is the full detailed description.',
          },
        }),
      ]);

      const man = createManCommand(() => commands);
      const result = man.fn('test');

      expect(result).toContain('DESCRIPTION');
      expect(result).toContain('This is the full detailed description.');
    });

    it('should display ARGUMENTS section with required/optional labels', () => {
      const commands = createCommandMap([
        getMockCommand({
          name: 'test',
          description: 'Test',
          manual: {
            synopsis: 'test(path, options)',
            description: 'Description',
            arguments: [
              { name: 'path', description: 'The file path', required: true },
              { name: 'options', description: 'Optional flags', required: false },
            ],
          },
        }),
      ]);

      const man = createManCommand(() => commands);
      const result = man.fn('test');

      expect(result).toContain('ARGUMENTS');
      expect(result).toContain('path (required)');
      expect(result).toContain('The file path');
      expect(result).toContain('options (optional)');
      expect(result).toContain('Optional flags');
    });

    it('should not display ARGUMENTS section when empty', () => {
      const commands = createCommandMap([
        getMockCommand({
          name: 'test',
          description: 'Test',
          manual: {
            synopsis: 'test()',
            description: 'Description',
            arguments: [],
          },
        }),
      ]);

      const man = createManCommand(() => commands);
      const result = man.fn('test');

      expect(result).not.toContain('ARGUMENTS');
    });

    it('should display EXAMPLES section', () => {
      const commands = createCommandMap([
        getMockCommand({
          name: 'test',
          description: 'Test',
          manual: {
            synopsis: 'test()',
            description: 'Description',
            examples: [
              { command: 'test("foo")', description: 'Test with foo' },
              { command: 'test("bar")', description: 'Test with bar' },
            ],
          },
        }),
      ]);

      const man = createManCommand(() => commands);
      const result = man.fn('test');

      expect(result).toContain('EXAMPLES');
      expect(result).toContain('test("foo")');
      expect(result).toContain('Test with foo');
      expect(result).toContain('test("bar")');
      expect(result).toContain('Test with bar');
    });

    it('should not display EXAMPLES section when empty', () => {
      const commands = createCommandMap([
        getMockCommand({
          name: 'test',
          description: 'Test',
          manual: {
            synopsis: 'test()',
            description: 'Description',
            examples: [],
          },
        }),
      ]);

      const man = createManCommand(() => commands);
      const result = man.fn('test');

      expect(result).not.toContain('EXAMPLES');
    });
  });
});
