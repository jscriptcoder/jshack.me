import { describe, expect, it } from 'vitest';
import { nano } from './nano';
import { buildDirectory, buildFile } from '../../test/factories/filesystem';
import { mockCommandEnv, mockFsViewFromTree, mockSession } from '../../test/factories/commandEnv';
import { asAbsPath } from '../types';
import type { TerminalLine } from './types';

const NO_FLAGS = new Map<string, string | true>();

const errorLines = (result: { readonly lines: readonly TerminalLine[] }): string[] =>
  result.lines.filter((line) => line.kind === 'error').map((line) => line.content);

describe('nano', () => {
  it('opens the editor on a readable file, carrying its raw content verbatim', async () => {
    const tree = buildDirectory({
      home: buildDirectory({
        alice: buildDirectory(
          { 'notes.txt': buildFile('first line\nsecond line\n', { owner: 'alice' }) },
          { owner: 'alice' },
        ),
      }),
    });

    const env = mockCommandEnv({
      fs: mockFsViewFromTree(tree, { userType: 'user', cwd: asAbsPath('/home/alice') }),
      session: mockSession({ username: 'alice', userType: 'user' }),
    });

    const result = await nano.execute(env, ['notes.txt'], NO_FLAGS);

    expect(result.kind).toBe('mode_change');
    if (result.kind !== 'mode_change') return;
    expect(result.mode.kind).toBe('nano');
    if (result.mode.kind !== 'nano') return;
    // Raw content, NOT split into lines — the editor edits the exact bytes,
    // trailing newline included.
    expect(result.mode.content).toBe('first line\nsecond line\n');
    // The path is resolved against the cwd to an absolute path.
    expect(result.mode.path).toBe('/home/alice/notes.txt');
  });

  it('opens an empty buffer for a not-yet-existing file (new file)', async () => {
    // /tmp exists, but new.txt does not — the read is not_found, so nano opens
    // a fresh empty buffer rather than erroring. (Save-time creation is later.)
    const tree = buildDirectory({ tmp: buildDirectory({}, { owner: 'alice' }) });

    const env = mockCommandEnv({
      fs: mockFsViewFromTree(tree, { userType: 'user', cwd: asAbsPath('/tmp') }),
    });

    const result = await nano.execute(env, ['new.txt'], NO_FLAGS);

    expect(result.kind).toBe('mode_change');
    if (result.kind !== 'mode_change') return;
    expect(result.mode.kind).toBe('nano');
    if (result.mode.kind !== 'nano') return;
    expect(result.mode.content).toBe('');
    expect(result.mode.path).toBe('/tmp/new.txt');
  });

  it('refuses a directory target with an error, and does NOT enter the editor', async () => {
    const tree = buildDirectory({ etc: buildDirectory({}, { owner: 'root' }) });

    const env = mockCommandEnv({
      fs: mockFsViewFromTree(tree, { userType: 'user' }),
    });

    const result = await nano.execute(env, ['/etc'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(1);
    expect(errorLines(result)).toEqual(['nano: /etc: Is a directory']);
  });

  it('refuses an unreadable file with an error, and does NOT enter the editor', async () => {
    // /root/secret.txt — root-owned, default perms give read: ['root'] only, so a
    // user-tier session is denied. (jshack has no /etc/shadow; passwords are inline.)
    const tree = buildDirectory({
      root: buildDirectory(
        { 'secret.txt': buildFile('classified', { owner: 'root' }) },
        { owner: 'root' },
      ),
    });

    const env = mockCommandEnv({
      fs: mockFsViewFromTree(tree, { userType: 'user' }),
    });

    const result = await nano.execute(env, ['/root/secret.txt'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(1);
    expect(errorLines(result)).toEqual(['nano: /root/secret.txt: Permission denied']);
  });

  it('errors with a usage hint when called with no file operand', async () => {
    const env = mockCommandEnv();

    const result = await nano.execute(env, [], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(1);
    expect(errorLines(result)).toEqual(['nano: missing file operand']);
  });
});
