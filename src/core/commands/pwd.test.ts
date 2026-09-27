import { describe, expect, it } from 'vitest';
import { pwd } from './pwd';
import { buildDirectory } from '../../test/factories/filesystem';
import { mockCommandEnv, mockFsViewFromTree } from '../../test/factories/commandEnv';
import { asAbsPath } from '../types';

const NO_FLAGS = new Map<string, string | true>();

describe('pwd', () => {
  it('prints the current working directory as a single text line', async () => {
    const env = mockCommandEnv({
      fs: mockFsViewFromTree(buildDirectory({}), {
        userType: 'user',
        cwd: asAbsPath('/home/alice'),
      }),
    });

    const result = await pwd.execute(env, [], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(0);
    expect(result.lines).toEqual([{ kind: 'text', content: '/home/alice' }]);
  });

  it('prints `/` when the working directory is the filesystem root', async () => {
    // Catches StringLiteral mutators that hardcode the cwd or swap to empty.
    const env = mockCommandEnv({
      fs: mockFsViewFromTree(buildDirectory({}), {
        userType: 'user',
        cwd: asAbsPath('/'),
      }),
    });

    const result = await pwd.execute(env, [], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(0);
    expect(result.lines).toEqual([{ kind: 'text', content: '/' }]);
  });

  it('reflects a different cwd verbatim (deep path)', async () => {
    const env = mockCommandEnv({
      fs: mockFsViewFromTree(buildDirectory({}), {
        userType: 'user',
        cwd: asAbsPath('/tmp/sub/deeper'),
      }),
    });

    const result = await pwd.execute(env, [], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.lines).toEqual([{ kind: 'text', content: '/tmp/sub/deeper' }]);
  });

  it('reads cwd from the env on every call (catches captured-once mutants)', async () => {
    // Use a getter to prove pwd doesn't snapshot cwd at construction time.
    let current = asAbsPath('/first');
    const env = mockCommandEnv({
      fs: mockFsViewFromTree(buildDirectory({}), {
        userType: 'user',
        cwd: () => current,
      }),
    });

    const first = await pwd.execute(env, [], NO_FLAGS);
    current = asAbsPath('/second');
    const second = await pwd.execute(env, [], NO_FLAGS);

    expect(first.kind).toBe('sync');
    if (first.kind !== 'sync') return;
    expect(second.kind).toBe('sync');
    if (second.kind !== 'sync') return;
    expect(first.lines).toEqual([{ kind: 'text', content: '/first' }]);
    expect(second.lines).toEqual([{ kind: 'text', content: '/second' }]);
  });

  it('ignores positional args (matches real bash behavior)', async () => {
    const env = mockCommandEnv({
      fs: mockFsViewFromTree(buildDirectory({}), {
        userType: 'user',
        cwd: asAbsPath('/home/alice'),
      }),
    });

    const result = await pwd.execute(env, ['ignored-arg', 'also-ignored'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(0);
    expect(result.lines).toEqual([{ kind: 'text', content: '/home/alice' }]);
  });
});
