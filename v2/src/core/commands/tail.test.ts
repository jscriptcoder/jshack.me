import { describe, expect, it } from 'vitest';
import { tail } from './tail';
import { buildDirectory, buildFile } from '../../test/factories/filesystem';
import { mockCommandEnv, mockFsViewFromTree, mockSession } from '../../test/factories/commandEnv';
import { asAbsPath } from '../types';
import type { CommandResult } from './types';

const NO_FLAGS = new Map<string, string | true>();

const lastLines = (count: string): ReadonlyMap<string, string | true> =>
  new Map<string, string | true>([['-n', count]]);

/** `line 1` … `line <count>`, newline-terminated like a log file. */
const numberedLines = (count: number): string =>
  Array.from({ length: count }, (_, index) => `line ${index + 1}\n`).join('');

const range = (from: number, to: number): string[] =>
  Array.from({ length: to - from + 1 }, (_, index) => `line ${from + index}`);

/** Each line a pipe's upstream stage printed, in order. */
const piped = (lines: readonly string[]): AsyncIterable<string> =>
  (async function* () {
    yield* lines;
  })();

/** alice, in her home, holding `notes.txt` with the given content, a `docs`
 *  directory, and `secret.txt`, which only root may read. */
const aliceWith = (content: string, stdin?: AsyncIterable<string>) =>
  mockCommandEnv({
    ...(stdin === undefined ? {} : { stdin }),
    fs: mockFsViewFromTree(
      buildDirectory({
        home: buildDirectory({
          alice: buildDirectory(
            {
              'notes.txt': buildFile(content, { owner: 'alice' }),
              docs: buildDirectory({}, { owner: 'alice' }),
              'secret.txt': buildFile('root only\n', { owner: 'root', perms: { read: ['root'] } }),
            },
            { owner: 'alice' },
          ),
        }),
      }),
      { userType: 'user', cwd: asAbsPath('/home/alice') },
    ),
    session: mockSession({ username: 'alice', userType: 'user' }),
  });

const printed = (result: CommandResult) =>
  result.kind === 'sync'
    ? { exitCode: result.exitCode, lines: result.lines.map((line) => `${line.kind}: ${line.content}`) }
    : { exitCode: null, lines: [] };

const text = (lines: readonly string[]): string[] => lines.map((line) => `text: ${line}`);

describe('tail on a file', () => {
  it('prints the last ten lines by default', async () => {
    const result = await tail.execute(aliceWith(numberedLines(12)), ['notes.txt'], NO_FLAGS);

    expect(printed(result)).toEqual({ exitCode: 0, lines: text(range(3, 12)) });
  });

  it('prints the last n lines with -n', async () => {
    const result = await tail.execute(aliceWith(numberedLines(12)), ['notes.txt'], lastLines('3'));

    expect(printed(result)).toEqual({ exitCode: 0, lines: text(range(10, 12)) });
  });

  it('prints nothing for -n 0', async () => {
    const result = await tail.execute(aliceWith(numberedLines(12)), ['notes.txt'], lastLines('0'));

    expect(printed(result)).toEqual({ exitCode: 0, lines: [] });
  });

  it('prints a file shorter than n whole', async () => {
    const result = await tail.execute(aliceWith(numberedLines(12)), ['notes.txt'], lastLines('20'));

    expect(printed(result)).toEqual({ exitCode: 0, lines: text(range(1, 12)) });
  });

  it('prints exactly n lines when the file has exactly n', async () => {
    const result = await tail.execute(aliceWith(numberedLines(3)), ['notes.txt'], lastLines('3'));

    expect(printed(result)).toEqual({ exitCode: 0, lines: text(range(1, 3)) });
  });

  it('does not count the newline that ends a file as a line', async () => {
    const result = await tail.execute(aliceWith('a\nb\n'), ['notes.txt'], lastLines('1'));

    expect(printed(result)).toEqual({ exitCode: 0, lines: text(['b']) });
  });

  it('keeps a last line that has no newline after it', async () => {
    const result = await tail.execute(aliceWith('a\nb\nc'), ['notes.txt'], lastLines('2'));

    expect(printed(result)).toEqual({ exitCode: 0, lines: text(['b', 'c']) });
  });
});

describe('tail on piped input', () => {
  it('prints the last lines of what the pipe carried', async () => {
    const env = aliceWith('', piped(['alpha', 'beta', 'gamma']));

    const result = await tail.execute(env, [], lastLines('2'));

    expect(printed(result)).toEqual({ exitCode: 0, lines: text(['beta', 'gamma']) });
  });

  it('prints the last ten piped lines by default', async () => {
    const env = aliceWith('', piped(range(1, 12)));

    const result = await tail.execute(env, [], NO_FLAGS);

    expect(printed(result)).toEqual({ exitCode: 0, lines: text(range(3, 12)) });
  });

  it('reads the named file rather than the pipe when given one', async () => {
    const env = aliceWith('from the file\n', piped(['from the pipe']));

    const result = await tail.execute(env, ['notes.txt'], NO_FLAGS);

    expect(printed(result)).toEqual({ exitCode: 0, lines: text(['from the file']) });
  });

  it('refuses with a missing operand when there is no file and no pipe', async () => {
    const result = await tail.execute(aliceWith(''), [], NO_FLAGS);

    expect(printed(result)).toEqual({ exitCode: 1, lines: ['error: tail: missing file operand'] });
  });
});

describe('tail refusals', () => {
  it.each(['abc', '-1', '1e3', '0x10', '3x', 'x3', ''])(
    "refuses -n '%s', which is not a whole number of lines",
    async (value) => {
      const result = await tail.execute(aliceWith('a'), ['notes.txt'], lastLines(value));

      expect(printed(result)).toEqual({
        exitCode: 1,
        lines: [`error: tail: invalid number of lines: '${value}'`],
      });
    },
  );

  it('refuses a second file', async () => {
    const result = await tail.execute(aliceWith('a'), ['notes.txt', 'other.txt'], NO_FLAGS);

    expect(printed(result)).toEqual({
      exitCode: 1,
      lines: ["error: tail: extra operand 'other.txt'"],
    });
  });

  it.each([
    ['missing.txt', 'No such file or directory'],
    ['docs', 'Is a directory'],
    ['secret.txt', 'Permission denied'],
  ])('refuses %s: %s', async (file, reason) => {
    const result = await tail.execute(aliceWith('a'), [file], NO_FLAGS);

    expect(printed(result)).toEqual({ exitCode: 1, lines: [`error: tail: ${file}: ${reason}`] });
  });
});
