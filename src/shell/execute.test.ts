import { describe, it, expect, vi } from 'vitest';
import { execute } from './execute';
import type { Command } from '../components/Terminal/types';
import type { Pipeline } from './types';

const makeCommand = (name: string, fn: (...args: unknown[]) => unknown): Command => ({
  name,
  category: 'general',
  description: '',
  fn,
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
});
