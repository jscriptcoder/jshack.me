import { describe, expect, it } from 'vitest';
import { head } from './head';
import { buildDirectory, buildFile } from '../../test/factories/filesystem';
import { mockCommandEnv, mockFsViewFromTree } from '../../test/factories/commandEnv';
import { asAbsPath } from '../types';
import type { TerminalLine } from './types';

const NO_FLAGS = new Map<string, string | true>();

const textLines = (result: { readonly lines: readonly TerminalLine[] }): string[] =>
  result.lines.filter((line) => line.kind === 'text').map((line) => line.content);

const errorLines = (result: { readonly lines: readonly TerminalLine[] }): string[] =>
  result.lines.filter((line) => line.kind === 'error').map((line) => line.content);

/** /tmp/sample.log — a 12-line file alice owns, so the default user tier
 *  can read it without us having to fiddle with perms. */
const treeWithLog = () =>
  buildDirectory({
    tmp: buildDirectory(
      {
        'sample.log': buildFile(
          'line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\nline11\nline12\n',
          { owner: 'alice' },
        ),
      },
      { owner: 'alice' },
    ),
  });

const envWithLog = () =>
  mockCommandEnv({
    fs: mockFsViewFromTree(treeWithLog(), { userType: 'user', cwd: asAbsPath('/tmp') }),
  });

describe('head', () => {
  it('outputs the first 10 lines by default', async () => {
    const result = await head.execute(envWithLog(), ['/tmp/sample.log'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(0);
    expect(textLines(result)).toEqual([
      'line1',
      'line2',
      'line3',
      'line4',
      'line5',
      'line6',
      'line7',
      'line8',
      'line9',
      'line10',
    ]);
  });

  it('outputs the first N lines when -n N is set', async () => {
    const result = await head.execute(
      envWithLog(),
      ['/tmp/sample.log'],
      new Map([['-n', '3']]),
    );

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(0);
    expect(textLines(result)).toEqual(['line1', 'line2', 'line3']);
  });

  it('outputs nothing when -n is 0', async () => {
    const result = await head.execute(
      envWithLog(),
      ['/tmp/sample.log'],
      new Map([['-n', '0']]),
    );

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(0);
    expect(textLines(result)).toEqual([]);
  });

  it('outputs the entire file when N exceeds the line count', async () => {
    const result = await head.execute(
      envWithLog(),
      ['/tmp/sample.log'],
      new Map([['-n', '999']]),
    );

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(0);
    expect(textLines(result)).toHaveLength(12);
    expect(textLines(result)[0]).toBe('line1');
    expect(textLines(result)[11]).toBe('line12');
  });

  it('reports invalid number for a non-integer -n value', async () => {
    const result = await head.execute(
      envWithLog(),
      ['/tmp/sample.log'],
      new Map([['-n', 'foo']]),
    );

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(2);
    expect(errorLines(result)).toEqual(["head: invalid number of lines: 'foo'"]);
  });

  it('reports invalid number for a negative -n value', async () => {
    const result = await head.execute(
      envWithLog(),
      ['/tmp/sample.log'],
      new Map([['-n', '-5']]),
    );

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(2);
    expect(errorLines(result)).toEqual(["head: invalid number of lines: '-5'"]);
  });

  it('reports the invalid-number error before the missing-file-operand error', async () => {
    // Lock down argument-validation order: -n is parsed first, so a bad N
    // wins over the missing-positional error path.
    const env = mockCommandEnv();
    const result = await head.execute(env, [], new Map([['-n', 'foo']]));

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(2);
    expect(errorLines(result)).toEqual(["head: invalid number of lines: 'foo'"]);
  });

  it('errors with usage hint when called with no positional', async () => {
    const env = mockCommandEnv();
    const result = await head.execute(env, [], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(1);
    expect(errorLines(result)).toEqual(['head: missing file operand']);
  });

  it('reports "No such file or directory" for missing files', async () => {
    const env = mockCommandEnv({
      fs: mockFsViewFromTree(buildDirectory({}), { userType: 'user' }),
    });
    const result = await head.execute(env, ['/nope'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(1);
    expect(errorLines(result)).toEqual(['head: /nope: No such file or directory']);
  });

  it('reports "Permission denied" when the user tier cannot read the file', async () => {
    // /root/secret.txt — root-owned and root-only readable. Mirrors cat's
    // permission_denied test; locks the third ERROR_MESSAGE handler.
    const tree = buildDirectory({
      root: buildDirectory(
        { 'secret.txt': buildFile('classified', { owner: 'root' }) },
        { owner: 'root' },
      ),
    });
    const env = mockCommandEnv({
      fs: mockFsViewFromTree(tree, { userType: 'user' }),
    });
    const result = await head.execute(env, ['/root/secret.txt'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(1);
    expect(errorLines(result)).toEqual(['head: /root/secret.txt: Permission denied']);
  });

  it('reports "Is a directory" when the target is a directory', async () => {
    const tree = buildDirectory({
      etc: buildDirectory({}, { owner: 'root' }),
    });
    const env = mockCommandEnv({
      fs: mockFsViewFromTree(tree, { userType: 'user' }),
    });
    const result = await head.execute(env, ['/etc'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(1);
    expect(errorLines(result)).toEqual(['head: /etc: Is a directory']);
  });

  it('prints a file with no trailing newline without dropping its last line', async () => {
    // Mirrors cat's no-trailing-newline test — proves the "strip empty
    // trailing split-segment" branch only fires when there IS one.
    const tree = buildDirectory({
      tmp: buildDirectory(
        { 'partial.txt': buildFile('first\nsecond', { owner: 'alice' }) },
        { owner: 'alice' },
      ),
    });
    const env = mockCommandEnv({
      fs: mockFsViewFromTree(tree, { userType: 'user' }),
    });
    const result = await head.execute(env, ['/tmp/partial.txt'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(0);
    expect(textLines(result)).toEqual(['first', 'second']);
  });

  it('reports invalid number for an empty -n value', async () => {
    // Not reachable today (the tokenizer drops empty whitespace runs), but
    // becomes reachable via quoted `head -n "" file` after Slice 3.
    // Locks the regex boundary so a `/^\d*$/` mutation can't sneak through.
    const result = await head.execute(
      envWithLog(),
      ['/tmp/sample.log'],
      new Map([['-n', '']]),
    );

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(2);
    expect(errorLines(result)).toEqual(["head: invalid number of lines: ''"]);
  });

  it('reports invalid number for partially-digit -n values like "5abc"', async () => {
    // Locks the `$` anchor in `/^\d+$/` — a mutation that drops it would
    // accept the leading-digit prefix and parseInt would silently truncate.
    const result = await head.execute(
      envWithLog(),
      ['/tmp/sample.log'],
      new Map([['-n', '5abc']]),
    );

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(2);
    expect(errorLines(result)).toEqual(["head: invalid number of lines: '5abc'"]);
  });
});
