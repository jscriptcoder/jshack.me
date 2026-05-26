import { describe, expect, it } from 'vitest';
import { cat } from './cat';
import { buildDirectory, buildFile } from '../../test/factories/filesystem';
import {
  mockCommandEnv,
  mockFsViewFromTree,
  mockSession,
} from '../../test/factories/commandEnv';
import { asAbsPath } from '../types';
import type { TerminalLine } from './types';

const NO_FLAGS = new Map<string, string | true>();

const textLines = (result: { readonly lines: readonly TerminalLine[] }): string[] =>
  result.lines.filter((line) => line.kind === 'text').map((line) => line.content);

const errorLines = (result: { readonly lines: readonly TerminalLine[] }): string[] =>
  result.lines.filter((line) => line.kind === 'error').map((line) => line.content);

describe('cat', () => {
  it('prints the contents of a single file', async () => {
    const tree = buildDirectory({
      home: buildDirectory({
        alice: buildDirectory(
          {
            'notes.txt': buildFile('first line\nsecond line\n', { owner: 'alice' }),
          },
          { owner: 'alice' },
        ),
      }),
    });

    const env = mockCommandEnv({
      fs: mockFsViewFromTree(tree, { userType: 'user', cwd: asAbsPath('/home/alice') }),
      session: mockSession({ username: 'alice', userType: 'user' }),
    });

    const result = await cat.execute(env, ['notes.txt'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(0);
    expect(textLines(result)).toEqual(['first line', 'second line']);
  });

  it('resolves absolute paths', async () => {
    // /etc/hosts is world-readable in the default factory perms (root-owned
    // file gets read: ['root'] by default — override here for the test).
    const tree = buildDirectory({
      etc: buildDirectory({
        hosts: buildFile('127.0.0.1 localhost\n', {
          owner: 'root',
          perms: { read: ['root', 'user', 'guest'] },
        }),
      }),
    });

    const env = mockCommandEnv({
      fs: mockFsViewFromTree(tree, { userType: 'user', cwd: asAbsPath('/tmp') }),
    });

    const result = await cat.execute(env, ['/etc/hosts'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(0);
    expect(textLines(result)).toEqual(['127.0.0.1 localhost']);
  });

  it('concatenates multiple files in order', async () => {
    const tree = buildDirectory({
      tmp: buildDirectory(
        {
          'a.txt': buildFile('alpha\n', { owner: 'alice' }),
          'b.txt': buildFile('beta\n', { owner: 'alice' }),
        },
        { owner: 'alice' },
      ),
    });

    const env = mockCommandEnv({
      fs: mockFsViewFromTree(tree, { userType: 'user', cwd: asAbsPath('/tmp') }),
    });

    const result = await cat.execute(env, ['a.txt', 'b.txt'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(0);
    expect(textLines(result)).toEqual(['alpha', 'beta']);
  });

  it('reports "No such file or directory" for missing files', async () => {
    const env = mockCommandEnv({
      fs: mockFsViewFromTree(buildDirectory({}), { userType: 'user' }),
    });

    const result = await cat.execute(env, ['/nope'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(1);
    expect(errorLines(result)).toEqual(['cat: /nope: No such file or directory']);
  });

  it('reports "Is a directory" for directory targets', async () => {
    const tree = buildDirectory({
      etc: buildDirectory({}, { owner: 'root' }),
    });

    const env = mockCommandEnv({
      fs: mockFsViewFromTree(tree, { userType: 'user' }),
    });

    const result = await cat.execute(env, ['/etc'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(1);
    expect(errorLines(result)).toEqual(['cat: /etc: Is a directory']);
  });

  it('reports "Permission denied" when walker denies the read', async () => {
    // /root/secret.txt — root-owned, default perms give read: ['root'] only.
    // (jshack has no /etc/shadow; passwords live inline in /etc/passwd.)
    const tree = buildDirectory({
      root: buildDirectory(
        {
          'secret.txt': buildFile('classified', { owner: 'root' }),
        },
        { owner: 'root' },
      ),
    });

    const env = mockCommandEnv({
      fs: mockFsViewFromTree(tree, { userType: 'user' }),
    });

    const result = await cat.execute(env, ['/root/secret.txt'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(1);
    expect(errorLines(result)).toEqual(['cat: /root/secret.txt: Permission denied']);
  });

  it('keeps reading subsequent args after one fails', async () => {
    const tree = buildDirectory({
      tmp: buildDirectory(
        {
          'good.txt': buildFile('survivor\n', { owner: 'alice' }),
        },
        { owner: 'alice' },
      ),
    });

    const env = mockCommandEnv({
      fs: mockFsViewFromTree(tree, { userType: 'user', cwd: asAbsPath('/tmp') }),
    });

    const result = await cat.execute(env, ['missing.txt', 'good.txt'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(1);
    expect(errorLines(result)).toEqual(['cat: missing.txt: No such file or directory']);
    expect(textLines(result)).toEqual(['survivor']);
  });

  it('echoes stdin when called with no args', async () => {
    const stdin = (async function* () {
      yield 'piped line 1';
      yield 'piped line 2';
    })();

    const env = mockCommandEnv({ stdin });
    const result = await cat.execute(env, [], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(0);
    expect(textLines(result)).toEqual(['piped line 1', 'piped line 2']);
  });

  it('errors with usage hint when called with no args and no stdin', async () => {
    const env = mockCommandEnv();
    const result = await cat.execute(env, [], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(1);
    expect(errorLines(result)).toEqual(['cat: missing file operand']);
  });
});
