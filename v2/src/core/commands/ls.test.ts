import { describe, expect, it } from 'vitest';
import { ls } from './ls';
import { buildDirectory, buildFile } from '../../test/factories/filesystem';
import {
  mockCommandEnv,
  mockFsViewFromTree,
} from '../../test/factories/commandEnv';
import { asAbsPath } from '../types';
import type { TerminalLine } from './types';

const NO_FLAGS = new Map<string, string | true>();

const textLines = (result: { readonly lines: readonly TerminalLine[] }): string[] =>
  result.lines.filter((line) => line.kind === 'text').map((line) => line.content);

const errorLines = (result: { readonly lines: readonly TerminalLine[] }): string[] =>
  result.lines.filter((line) => line.kind === 'error').map((line) => line.content);

describe('ls', () => {
  it('lists entries of the current working directory when called with no args', async () => {
    const tree = buildDirectory({
      home: buildDirectory({
        alice: buildDirectory(
          {
            'apple.txt': buildFile('a', { owner: 'alice' }),
            'banana.txt': buildFile('b', { owner: 'alice' }),
          },
          { owner: 'alice' },
        ),
      }),
    });

    const env = mockCommandEnv({
      fs: mockFsViewFromTree(tree, { userType: 'user', cwd: asAbsPath('/home/alice') }),
    });

    const result = await ls.execute(env, [], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(0);
    expect(textLines(result)).toEqual(['apple.txt', 'banana.txt']);
  });

  it('lists the entries of an absolute path argument', async () => {
    const tree = buildDirectory({
      tmp: buildDirectory(
        {
          'alpha.txt': buildFile('a', { owner: 'alice' }),
          'beta.txt': buildFile('b', { owner: 'alice' }),
        },
        { owner: 'alice' },
      ),
    });

    const env = mockCommandEnv({
      fs: mockFsViewFromTree(tree, { userType: 'user', cwd: asAbsPath('/home/alice') }),
    });

    const result = await ls.execute(env, ['/tmp'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(0);
    expect(textLines(result)).toEqual(['alpha.txt', 'beta.txt']);
  });

  it('resolves a relative path argument against the current cwd', async () => {
    const tree = buildDirectory({
      tmp: buildDirectory(
        {
          sub: buildDirectory(
            { 'nested.txt': buildFile('x', { owner: 'alice' }) },
            { owner: 'alice' },
          ),
        },
        { owner: 'alice' },
      ),
    });

    const env = mockCommandEnv({
      fs: mockFsViewFromTree(tree, { userType: 'user', cwd: asAbsPath('/tmp') }),
    });

    const result = await ls.execute(env, ['sub'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(0);
    expect(textLines(result)).toEqual(['nested.txt']);
  });

  it('filters hidden entries (names starting with ".") by default', async () => {
    // Catches a BooleanLiteral flip on the hidden-filter predicate. .hidden
    // is FIRST in iteration order so a non-filtering impl would surface it.
    const tree = buildDirectory({
      tmp: buildDirectory(
        {
          '.hidden': buildFile('secret', { owner: 'alice' }),
          'visible.txt': buildFile('shown', { owner: 'alice' }),
        },
        { owner: 'alice' },
      ),
    });

    const env = mockCommandEnv({
      fs: mockFsViewFromTree(tree, { userType: 'user', cwd: asAbsPath('/tmp') }),
    });

    const result = await ls.execute(env, [], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(textLines(result)).toEqual(['visible.txt']);
  });

  it('sorts entries alphabetically regardless of insertion order', async () => {
    // Catches a MethodExpression mutator that drops `.sort()` — without
    // sorting, the result would mirror Map insertion order.
    const tree = buildDirectory({
      tmp: buildDirectory(
        {
          zebra: buildFile('z', { owner: 'alice' }),
          apple: buildFile('a', { owner: 'alice' }),
          mango: buildFile('m', { owner: 'alice' }),
        },
        { owner: 'alice' },
      ),
    });

    const env = mockCommandEnv({
      fs: mockFsViewFromTree(tree, { userType: 'user', cwd: asAbsPath('/tmp') }),
    });

    const result = await ls.execute(env, [], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(textLines(result)).toEqual(['apple', 'mango', 'zebra']);
  });

  it('emits no output for an empty directory and exits 0', async () => {
    // Catches StringLiteral / ArrayDeclaration mutants that would inject a
    // header or trailing empty line into the listing.
    const tree = buildDirectory({
      tmp: buildDirectory({}, { owner: 'alice' }),
    });

    const env = mockCommandEnv({
      fs: mockFsViewFromTree(tree, { userType: 'user', cwd: asAbsPath('/tmp') }),
    });

    const result = await ls.execute(env, [], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(0);
    expect(result.lines).toEqual([]);
  });

  it('echoes the input path when the target is a regular file', async () => {
    // Matches real `ls /etc/passwd` — file targets print the input path,
    // not the contents. Exit 0 (the file exists).
    const tree = buildDirectory({
      etc: buildDirectory(
        { passwd: buildFile('root:x:0:0::/root:/bin/bash\n', { owner: 'root' }) },
        { owner: 'root' },
      ),
    });

    const env = mockCommandEnv({
      fs: mockFsViewFromTree(tree, { userType: 'user', cwd: asAbsPath('/home/alice') }),
    });

    const result = await ls.execute(env, ['/etc/passwd'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(0);
    expect(textLines(result)).toEqual(['/etc/passwd']);
  });

  it('reports "cannot access" for a missing target and exits 2', async () => {
    const env = mockCommandEnv({
      fs: mockFsViewFromTree(buildDirectory({}), { userType: 'user' }),
    });

    const result = await ls.execute(env, ['/nope'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(2);
    expect(errorLines(result)).toEqual([
      "ls: cannot access '/nope': No such file or directory",
    ]);
  });

  it('reports "cannot open directory" when the directory is unreadable and exits 2', async () => {
    // /root with perms read: ['root']. A user-tier session gets
    // permission_denied from fs.list.
    const tree = buildDirectory({
      root: buildDirectory(
        {},
        {
          owner: 'root',
          perms: { read: ['root'], write: ['root'], execute: ['root'] },
        },
      ),
    });

    const env = mockCommandEnv({
      fs: mockFsViewFromTree(tree, { userType: 'user', cwd: asAbsPath('/') }),
    });

    const result = await ls.execute(env, ['/root'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(2);
    expect(errorLines(result)).toEqual([
      "ls: cannot open directory '/root': Permission denied",
    ]);
  });

  it('echoes the ORIGINAL arg in error messages (not the resolved abs path)', async () => {
    // Catches an "always use resolved path" bug. `ls nope` from /home/alice
    // resolves to /home/alice/nope, but the error should say 'nope'.
    const env = mockCommandEnv({
      fs: mockFsViewFromTree(buildDirectory({}), {
        userType: 'user',
        cwd: asAbsPath('/home/alice'),
      }),
    });

    const result = await ls.execute(env, ['nope'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(2);
    expect(errorLines(result)).toEqual([
      "ls: cannot access 'nope': No such file or directory",
    ]);
  });
});
