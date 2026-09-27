import { describe, expect, it } from 'vitest';
import { wc } from './wc.js';
import { buildDirectory, buildFile } from '../../test/factories/filesystem.js';
import { mockCommandEnv, mockFsViewFromTree, mockSession } from '../../test/factories/commandEnv.js';
import { asAbsPath } from '../types.js';
import type { CommandResult } from './types.js';

const NO_FLAGS = new Map<string, string | true>();
const LINES = new Map<string, string | true>([['-l', true]]);
const WORDS = new Map<string, string | true>([['-w', true]]);
const LINES_AND_WORDS = new Map<string, string | true>([
  ['-l', true],
  ['-w', true],
]);

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

describe('wc on a file', () => {
  it.each([
    ['-l', LINES, 'text: 2 notes.txt'],
    ['-w', WORDS, 'text: 3 notes.txt'],
    ['no flag', NO_FLAGS, 'text: 2 3 notes.txt'],
    ['-l and -w', LINES_AND_WORDS, 'text: 2 3 notes.txt'],
  ])('counts with %s, naming the file', async (_label, flags, line) => {
    const result = await wc.execute(aliceWith('a\nb c\n'), ['notes.txt'], flags);

    expect(printed(result)).toEqual({ exitCode: 0, lines: [line] });
  });

  it.each([
    ['a\nb\nc', 3],
    ['a\nb\n', 2],
    ['', 0],
  ])('counts the lines cat shows in %j as %i', async (content, count) => {
    const result = await wc.execute(aliceWith(content), ['notes.txt'], LINES);

    expect(printed(result)).toEqual({ exitCode: 0, lines: [`text: ${count} notes.txt`] });
  });

  it('counts an empty file as no lines and no words', async () => {
    const result = await wc.execute(aliceWith(''), ['notes.txt'], NO_FLAGS);

    expect(printed(result)).toEqual({ exitCode: 0, lines: ['text: 0 0 notes.txt'] });
  });

  it('splits words on any run of spaces and tabs, ignoring the ends of a line', async () => {
    const result = await wc.execute(aliceWith('  one \t two  \n\nthree\n'), ['notes.txt'], WORDS);

    expect(printed(result)).toEqual({ exitCode: 0, lines: ['text: 3 notes.txt'] });
  });
});

describe('wc on piped input', () => {
  it('prints the bare line count of what the pipe carried', async () => {
    const env = aliceWith('', piped(['a', 'b c']));

    const result = await wc.execute(env, [], LINES);

    expect(printed(result)).toEqual({ exitCode: 0, lines: ['text: 2'] });
  });

  it('prints bare line and word counts with no flag', async () => {
    const env = aliceWith('', piped(['a', 'b c']));

    const result = await wc.execute(env, [], NO_FLAGS);

    expect(printed(result)).toEqual({ exitCode: 0, lines: ['text: 2 3'] });
  });

  it('counts an empty pipe as nothing', async () => {
    const result = await wc.execute(aliceWith('', piped([])), [], NO_FLAGS);

    expect(printed(result)).toEqual({ exitCode: 0, lines: ['text: 0 0'] });
  });

  it('reads the named file rather than the pipe when given one', async () => {
    const env = aliceWith('one\n', piped(['a', 'b', 'c']));

    const result = await wc.execute(env, ['notes.txt'], LINES);

    expect(printed(result)).toEqual({ exitCode: 0, lines: ['text: 1 notes.txt'] });
  });
});

describe('wc refusals', () => {
  it('refuses a second file', async () => {
    const result = await wc.execute(aliceWith('a'), ['notes.txt', 'other.txt'], NO_FLAGS);

    expect(printed(result)).toEqual({ exitCode: 1, lines: ["error: wc: extra operand 'other.txt'"] });
  });

  it('refuses with a missing operand when there is no file and no pipe', async () => {
    const result = await wc.execute(aliceWith(''), [], NO_FLAGS);

    expect(printed(result)).toEqual({ exitCode: 1, lines: ['error: wc: missing file operand'] });
  });

  it.each([
    ['missing.txt', 'No such file or directory'],
    ['docs', 'Is a directory'],
    ['secret.txt', 'Permission denied'],
  ])('refuses %s: %s', async (file, reason) => {
    const result = await wc.execute(aliceWith('a'), [file], NO_FLAGS);

    expect(printed(result)).toEqual({ exitCode: 1, lines: [`error: wc: ${file}: ${reason}`] });
  });
});
