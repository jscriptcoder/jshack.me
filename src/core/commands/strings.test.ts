import { describe, expect, it } from 'vitest';
import { strings } from './strings';
import { buildDirectory, buildFile } from '../../test/factories/filesystem';
import { mockCommandEnv, mockFsViewFromTree } from '../../test/factories/commandEnv';
import { asAbsPath } from '../types';
import type { TerminalLine } from './types';
import type { Directory } from '../filesystem/types';
import { createBinaryEntries } from '../generation/binaries';

const NO_FLAGS = new Map<string, string | true>();

const textLines = (result: { readonly lines: readonly TerminalLine[] }): string[] =>
  result.lines.filter((line) => line.kind === 'text').map((line) => line.content);

/** Run `strings` over a one-file box, as the user who owns the file. The
 *  content is the variable in every test here; nothing else is. */
const stringsOver = (content: string) =>
  strings.execute(
    mockCommandEnv({
      fs: mockFsViewFromTree(
        buildDirectory({ 'sample.bin': buildFile(content, { owner: 'alice' }) }),
        { userType: 'user', cwd: asAbsPath('/') },
      ),
    }),
    ['/sample.bin'],
    NO_FLAGS,
  );

describe('strings — pulling readable text out of something that is not text', () => {
  it('prints each run of printable characters as its own line', async () => {
    const result = await stringsOver(`ab\x01HELLO\x02wide open\x03xy`);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    // The unreadable bytes are separators, not content: they end a run and
    // are never printed. `ab` and `xy` are too short to be words, which is
    // the whole reason the minimum exists — a binary is full of two-byte
    // coincidences that would bury anything worth reading.
    expect(textLines(result)).toEqual(['HELLO', 'wide open']);
    expect(result.exitCode).toBe(0);
  });

  it('keeps a run of exactly four characters and drops one of three', async () => {
    const result = await stringsOver(`abc\x01abcd\x01wxyz`);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    // Four is the real tool's default and legacy's fixed value. The boundary
    // is worth a test of its own because off-by-one here is invisible in
    // ordinary output — it just quietly changes how much noise you wade
    // through.
    expect(textLines(result)).toEqual(['abcd', 'wxyz']);
  });

  it('keeps the last printable character and treats anything above it as noise', async () => {
    // `~` is 126, the top of the printable range; the accented bytes are above
    // it. Both ends of that comparison are a boundary, and neither shows up in
    // ordinary test data — a range that stopped one short would quietly drop a
    // character from the middle of a word, and one that ran past would splice
    // two unrelated runs into a single line of nonsense.
    const result = await stringsOver(`~tilde~\u00e9\u00e9plain`);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(textLines(result)).toEqual(['~tilde~', 'plain']);
  });

  it('counts newlines and tabs as printable, so a text file reads back as itself', async () => {
    const result = await stringsOver(`root:x:0:0\nalice:x:1000:1000\n\tshell\n`);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    // A text file is one long printable run, and it must arrive as SEPARATE
    // lines: a single line carrying embedded newlines would render as one
    // wrapped blob, and a piped `strings f | grep x` would see one line and
    // hand back the whole file or nothing.
    expect(textLines(result)).toEqual(['root:x:0:0', 'alice:x:1000:1000', '\tshell']);
  });

  it('says nothing about a run that is only whitespace', async () => {
    const result = await stringsOver(`\x01  \t\t  \x01real content\x01    `);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    // Four spaces is four printable characters and no information. Padding is
    // the most common long run in a binary and reporting it would fill the
    // screen with blank lines — so it is silenced at BOTH flush points, the
    // one between fields and the one at the end of the file.
    expect(textLines(result)).toEqual(['real content']);
  });
});

const errorLines = (result: { readonly lines: readonly TerminalLine[] }): string[] =>
  result.lines.filter((line) => line.kind === 'error').map((line) => line.content);

/** One box carrying every way a read can fail: a file that is there, one this
 *  session may not read, and a directory. */
const boxWithEveryRefusal = (): Directory =>
  buildDirectory({
    'notes.txt': buildFile('readable\n', { owner: 'alice' }),
    'secrets.txt': buildFile('not for you\n', { owner: 'root' }),
    etc: buildDirectory({}, { owner: 'root' }),
  });

const stringsIn = (args: readonly string[]) =>
  strings.execute(
    mockCommandEnv({
      fs: mockFsViewFromTree(boxWithEveryRefusal(), {
        userType: 'user',
        cwd: asAbsPath('/'),
      }),
    }),
    args,
    NO_FLAGS,
  );

describe('strings — what it refuses', () => {
  it('asks for a file when handed nothing', async () => {
    const result = await stringsIn([]);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    // No stdin fallback, unlike `cat`: reading a pipe byte by byte for
    // printable runs is a different tool, and a silent success here would
    // look like a file full of nothing.
    expect(errorLines(result)).toEqual(['strings: missing file operand']);
    expect(result.exitCode).toBe(1);
  });

  it('reports a file that is not there, in the words the player typed', async () => {
    const result = await stringsIn(['nope.bin']);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    // Unquoted, unlike `find`'s paths. The two dialects are legacy's and v2
    // already carries the same split between `cat` and `grep` — worth
    // matching rather than tidying, so a player's eye learns one shell.
    expect(errorLines(result)).toEqual(['strings: nope.bin: No such file or directory']);
    expect(result.exitCode).toBe(1);
  });

  it('refuses a directory rather than describing its name', async () => {
    const result = await stringsIn(['/etc']);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(errorLines(result)).toEqual(['strings: /etc: Is a directory']);
    expect(result.exitCode).toBe(1);
  });

  it('refuses a file the session may not read', async () => {
    const result = await stringsIn(['/secrets.txt']);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    // The point of the whole command is reading what is not meant to be read
    // as text — which makes it the obvious way around a read permission, if
    // it had its own idea about permissions. It reads through the same view
    // `cat` does and gets the same answer.
    expect(errorLines(result)).toEqual(['strings: /secrets.txt: Permission denied']);
    expect(textLines(result)).toEqual([]);
    expect(result.exitCode).toBe(1);
  });
});

describe('strings — on the binaries every machine carries', () => {
  const machineWithABinDirectory = (): Directory =>
    buildDirectory({ bin: buildDirectory(createBinaryEntries(['ls'])) });

  const stringsOnLs = () =>
    strings.execute(
      mockCommandEnv({
        fs: mockFsViewFromTree(machineWithABinDirectory(), {
          userType: 'user',
          cwd: asAbsPath('/'),
        }),
      }),
      ['/bin/ls'],
      NO_FLAGS,
    );

  it('has something to say about a stamped binary', async () => {
    const result = await stringsOnLs();

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    // The reason the tool is worth shipping before there is any content to
    // find: a binary is the one file on a fresh box that is not text, so it
    // is the first thing anyone points this at. Silence there is
    // indistinguishable from a command that does not work.
    expect(textLines(result)).not.toEqual([]);
    expect(result.exitCode).toBe(0);
  });

  it('shows the loader path a real ELF binary carries', async () => {
    const result = await stringsOnLs();

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    // Named rather than merely counted, so the stub cannot satisfy this with
    // any four bytes that happen to be printable. What `strings` finds first
    // in a real dynamically linked binary is its interpreter.
    expect(textLines(result)).toContain('/lib64/ld-linux-x86-64.so.2');
  });
});
