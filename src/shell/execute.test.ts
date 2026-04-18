import { describe, it, expect, vi } from 'vitest';
import { execute } from './execute';
import type { Command, AsyncOutput } from '../components/Terminal/types';
import type { Pipeline, ShellContext } from './types';

const makeCommand = (name: string, fn: (...args: unknown[]) => unknown): Command => ({
  name,
  category: 'general',
  description: '',
  fn,
});

const makeShellCommand = (
  name: string,
  fnShell: (ctx: ShellContext, ...args: unknown[]) => unknown,
): Command => ({
  name,
  category: 'general',
  description: '',
  fn: () => {
    throw new Error(`${name}: called without shell context`);
  },
  fnShell,
});

const asyncOutputOf = (lines: readonly string[]): AsyncOutput => ({
  __type: 'async',
  start: (emit, done) => {
    lines.forEach((line) => emit(line));
    done();
  },
});

const registryOf = (...commands: readonly Command[]): ReadonlyMap<string, Command> =>
  new Map(commands.map((c) => [c.name, c]));

describe('execute', () => {
  it('returns undefined for an empty pipeline', () => {
    const pipeline: Pipeline = { stages: [] };
    expect(execute(pipeline, new Map())).toBeUndefined();
  });

  it('invokes the command by name with no args', () => {
    const fn = vi.fn(() => 'hello');
    const pipeline: Pipeline = { stages: [{ command: 'greet', args: [] }] };

    const result = execute(pipeline, registryOf(makeCommand('greet', fn)));

    expect(fn).toHaveBeenCalledWith();
    expect(result).toBe('hello');
  });

  it('passes positional args as strings to the command', () => {
    const fn = vi.fn(() => 'ok');
    const pipeline: Pipeline = {
      stages: [{ command: 'nmap', args: ['10.10.10.10', '-sV', '--tree'] }],
    };

    execute(pipeline, registryOf(makeCommand('nmap', fn)));

    expect(fn).toHaveBeenCalledWith('10.10.10.10', '-sV', '--tree');
  });

  it('returns whatever the command returns (passes through strings)', () => {
    const pipeline: Pipeline = { stages: [{ command: 'echo', args: ['hi'] }] };
    const result = execute(pipeline, registryOf(makeCommand('echo', (...args) => args.join(' '))));
    expect(result).toBe('hi');
  });

  it('returns whatever the command returns (passes through async output)', () => {
    const asyncOutput = { __type: 'async', start: vi.fn() };
    const pipeline: Pipeline = { stages: [{ command: 'stream', args: [] }] };

    const result = execute(pipeline, registryOf(makeCommand('stream', () => asyncOutput)));

    expect(result).toBe(asyncOutput);
  });

  it('throws bash-style error when command is not found', () => {
    const pipeline: Pipeline = { stages: [{ command: 'bogus', args: [] }] };
    expect(() => execute(pipeline, new Map())).toThrow('bash: bogus: command not found');
  });

  it('propagates errors thrown by the command', () => {
    const pipeline: Pipeline = { stages: [{ command: 'boom', args: [] }] };
    const fn = (): never => {
      throw new Error('cat: /no: No such file or directory');
    };

    expect(() => execute(pipeline, registryOf(makeCommand('boom', fn)))).toThrow(
      'cat: /no: No such file or directory',
    );
  });

  describe('pipes', () => {
    it("feeds left stage's stdout into right stage's ctx.stdin", () => {
      const producer = makeCommand('cat', () => 'alpha\nbeta\nroot\ngamma');
      const consumer = makeShellCommand('grep', (ctx, pattern) =>
        (ctx.stdin ?? '')
          .split('\n')
          .filter((l) => l.includes(pattern as string))
          .join('\n'),
      );
      const pipeline: Pipeline = {
        stages: [
          { command: 'cat', args: [] },
          { command: 'grep', args: ['root'] },
        ],
      };

      expect(execute(pipeline, registryOf(producer, consumer))).toBe('root');
    });

    it('chains three stages', () => {
      const a = makeCommand('a', () => 'x\ny\nz');
      const upper = makeShellCommand('upper', (ctx) => (ctx.stdin ?? '').toUpperCase());
      const tail = makeShellCommand('tail', (ctx) => (ctx.stdin ?? '').split('\n').slice(-1)[0]);
      const pipeline: Pipeline = {
        stages: [
          { command: 'a', args: [] },
          { command: 'upper', args: [] },
          { command: 'tail', args: [] },
        ],
      };

      expect(execute(pipeline, registryOf(a, upper, tail))).toBe('Z');
    });

    it('falls back to fn when a piped command has no fnShell (ignores stdin)', () => {
      const producer = makeCommand('gen', () => 'ignored');
      const consumer = makeCommand('echoHi', () => 'hi');
      const pipeline: Pipeline = {
        stages: [
          { command: 'gen', args: [] },
          { command: 'echoHi', args: [] },
        ],
      };

      expect(execute(pipeline, registryOf(producer, consumer))).toBe('hi');
    });

    it('collects AsyncOutput from an intermediate stage into a string for the next stdin', () => {
      const producer = makeCommand('stream', () => asyncOutputOf(['line-a', 'line-b', 'line-c']));
      const consumer = makeShellCommand('capture', (ctx) => ctx.stdin ?? '<empty>');
      const pipeline: Pipeline = {
        stages: [
          { command: 'stream', args: [] },
          { command: 'capture', args: [] },
        ],
      };

      expect(execute(pipeline, registryOf(producer, consumer))).toBe('line-a\nline-b\nline-c');
    });

    it('passes the final stage AsyncOutput through unchanged', () => {
      const producer = makeCommand('cat', () => 'data');
      const finalAsync = asyncOutputOf(['streamed']);
      const finalStage = makeShellCommand('watch', () => finalAsync);
      const pipeline: Pipeline = {
        stages: [
          { command: 'cat', args: [] },
          { command: 'watch', args: [] },
        ],
      };

      expect(execute(pipeline, registryOf(producer, finalStage))).toBe(finalAsync);
    });

    it('throws bash-style error when a piped command is not found', () => {
      const producer = makeCommand('cat', () => 'data');
      const pipeline: Pipeline = {
        stages: [
          { command: 'cat', args: [] },
          { command: 'bogus', args: [] },
        ],
      };

      expect(() => execute(pipeline, registryOf(producer))).toThrow(
        'bash: bogus: command not found',
      );
    });
  });
});
