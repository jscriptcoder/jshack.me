import { describe, expect, it } from 'vitest';
import { runCommandLine } from './runLine';
import { cat } from '../commands/cat';
import type { Command, CommandResult, TerminalLine } from '../commands/types';
import { mockCommandEnv, mockFsViewFromTree } from '../../test/factories/commandEnv';
import { buildDirectory, buildFile } from '../../test/factories/filesystem';
import { asAbsPath } from '../types';

/** A `user`-tier session in /home/alice with two files she owns (and can read). */
const aliceEnv = () =>
  mockCommandEnv({
    fs: mockFsViewFromTree(
      buildDirectory({
        home: buildDirectory({
          alice: buildDirectory(
            {
              'notes.txt': buildFile('hello world\nfrom alice\n', { owner: 'alice' }),
              'todo.txt': buildFile('buy milk\n', { owner: 'alice' }),
            },
            { owner: 'alice' },
          ),
        }),
      }),
      { userType: 'user', cwd: asAbsPath('/home/alice') },
    ),
  });

const commands: ReadonlyMap<string, Command> = new Map([['cat', cat]]);

const expectSync = (result: CommandResult): Extract<CommandResult, { kind: 'sync' }> => {
  expect(result.kind).toBe('sync');
  if (result.kind !== 'sync') throw new Error('expected a sync result');
  return result;
};

const contentOf = (lines: readonly TerminalLine[]): string =>
  lines.map((line) => line.content).join('\n');

describe('runCommandLine', () => {
  it('dispatches a known command and returns its output', async () => {
    const result = expectSync(await runCommandLine(aliceEnv(), 'cat notes.txt', commands));

    expect(result.exitCode).toBe(0);
    expect(contentOf(result.lines)).toContain('hello world');
    expect(contentOf(result.lines)).toContain('from alice');
  });

  it('parses multiple arguments and passes them through to the command', async () => {
    const result = expectSync(await runCommandLine(aliceEnv(), 'cat notes.txt todo.txt', commands));

    expect(result.exitCode).toBe(0);
    expect(contentOf(result.lines)).toContain('hello world');
    expect(contentOf(result.lines)).toContain('buy milk');
  });

  it('trims surrounding whitespace before dispatching', async () => {
    const result = expectSync(await runCommandLine(aliceEnv(), '   cat notes.txt   ', commands));

    expect(result.exitCode).toBe(0);
    expect(contentOf(result.lines)).toContain('hello world');
  });

  it('reports "command not found" for an unknown command', async () => {
    const result = await runCommandLine(aliceEnv(), 'frobnicate --hard now', commands);

    expect(result).toEqual({
      kind: 'sync',
      lines: [{ kind: 'error', content: 'bash: frobnicate: command not found' }],
      exitCode: 127,
    });
  });

  it('runs nothing for empty input', async () => {
    const result = await runCommandLine(aliceEnv(), '', commands);

    expect(result).toEqual({ kind: 'sync', lines: [], exitCode: 0 });
  });

  it('runs nothing for whitespace-only input', async () => {
    const result = await runCommandLine(aliceEnv(), '   \t  ', commands);

    expect(result).toEqual({ kind: 'sync', lines: [], exitCode: 0 });
  });

  it("returns the command's own failing result unchanged", async () => {
    const result = expectSync(await runCommandLine(aliceEnv(), 'cat /nope', commands));

    expect(result.exitCode).toBe(1);
    expect(result.lines).toContainEqual({
      kind: 'error',
      content: 'cat: /nope: No such file or directory',
    });
  });

  it('rejects an unknown flag with exit code 2 and reports the offending option', async () => {
    // The error must come from the parser (exit 2) BEFORE cat is invoked —
    // otherwise cat would treat `-xyz` as a missing file and emit its own
    // exit-1 "No such file or directory" instead.
    const result = await runCommandLine(aliceEnv(), 'cat -xyz notes.txt', commands);

    expect(result).toEqual({
      kind: 'sync',
      lines: [{ kind: 'error', content: 'cat: unrecognized option: -xyz' }],
      exitCode: 2,
    });
  });

  it('passes recognised boolean flags through to the command', async () => {
    const result = expectSync(await runCommandLine(aliceEnv(), 'cat -n notes.txt', commands));

    expect(result.exitCode).toBe(0);
    expect(result.lines).toContainEqual({
      kind: 'text',
      content: '     1\thello world',
    });
    expect(result.lines).toContainEqual({
      kind: 'text',
      content: '     2\tfrom alice',
    });
  });
});
