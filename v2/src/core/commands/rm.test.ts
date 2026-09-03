import { describe, expect, it, vi } from 'vitest';
import { rm } from './rm';
import { buildDirectory, buildFile } from '../../test/factories/filesystem';
import { mockCommandEnv, mockFsViewFromTree, mockSession } from '../../test/factories/commandEnv';
import { asAbsPath } from '../types';
import type { CommandEnv, PatchApi, PatchResult, TerminalLine } from './types';

const NO_FLAGS = new Map<string, string | true>();
const RECURSIVE = new Map<string, string | true>([['-r', true]]);
const RECURSIVE_R = new Map<string, string | true>([['-R', true]]);
const FORCE = new Map<string, string | true>([['-f', true]]);
const RECURSIVE_FORCE = new Map<string, string | true>([
  ['-r', true],
  ['-f', true],
]);

const errorLines = (result: { readonly lines: readonly TerminalLine[] }): string[] =>
  result.lines.filter((line) => line.kind === 'error').map((line) => line.content);

/** /home/alice is alice-owned (user-writable) and holds a file plus a populated
 *  directory; `/secret.txt` sits under the root-owned `/` (user cannot write). */
const homeTree = () =>
  buildDirectory({
    home: buildDirectory({
      alice: buildDirectory(
        {
          'file.txt': buildFile('hi', { owner: 'alice' }),
          docs: buildDirectory({ 'a.txt': buildFile('x', { owner: 'alice' }) }, { owner: 'alice' }),
        },
        { owner: 'alice' },
      ),
    }),
    'secret.txt': buildFile('classified', { owner: 'root' }),
  });

const rmEnv = (
  options: {
    readonly tree?: ReturnType<typeof homeTree>;
    readonly cwd?: string;
    readonly removeResult?: PatchResult;
  } = {},
): { readonly env: CommandEnv; readonly removeFn: ReturnType<typeof vi.fn> } => {
  const removeFn = vi.fn<PatchApi['remove']>(async () => options.removeResult ?? { ok: true });
  const patches: PatchApi = {
    write: async () => ({ ok: true }),
    remove: removeFn,
    mkdir: async () => ({ ok: true }),
    setDirectoryPermissions: async () => ({ ok: true }),
  };
  const env = mockCommandEnv({
    fs: mockFsViewFromTree(options.tree ?? homeTree(), {
      userType: 'user',
      cwd: asAbsPath(options.cwd ?? '/home/alice'),
    }),
    session: mockSession({ username: 'alice', userType: 'user' }),
    patches,
  });
  return { env, removeFn };
};

describe('rm', () => {
  it('removes a file via a single deletion marker', async () => {
    const { env, removeFn } = rmEnv();

    const result = await rm.execute(env, ['file.txt'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(0);
    expect(result.lines).toEqual([]);
    expect(removeFn).toHaveBeenCalledTimes(1);
    expect(removeFn).toHaveBeenCalledWith(asAbsPath('/home/alice/file.txt'));
  });

  it('errors with missing operand when no path is given', async () => {
    const { env, removeFn } = rmEnv();

    const result = await rm.execute(env, [], NO_FLAGS);

    if (result.kind !== 'sync') throw new Error('expected sync');
    expect(result.exitCode).toBe(1);
    expect(errorLines(result)).toEqual(['rm: missing operand']);
    expect(removeFn).not.toHaveBeenCalled();
  });

  it("errors 'No such file or directory' for a missing target", async () => {
    const { env, removeFn } = rmEnv();

    const result = await rm.execute(env, ['ghost'], NO_FLAGS);

    if (result.kind !== 'sync') throw new Error('expected sync');
    expect(result.exitCode).toBe(1);
    expect(errorLines(result)).toEqual(["rm: cannot remove 'ghost': No such file or directory"]);
    expect(removeFn).not.toHaveBeenCalled();
  });

  it('is a silent success for a missing target with -f', async () => {
    const { env, removeFn } = rmEnv();

    const result = await rm.execute(env, ['ghost'], FORCE);

    if (result.kind !== 'sync') throw new Error('expected sync');
    expect(result.exitCode).toBe(0);
    expect(result.lines).toEqual([]);
    expect(removeFn).not.toHaveBeenCalled();
  });

  it("errors 'Is a directory' for a directory without -r", async () => {
    const { env, removeFn } = rmEnv();

    const result = await rm.execute(env, ['docs'], NO_FLAGS);

    if (result.kind !== 'sync') throw new Error('expected sync');
    expect(result.exitCode).toBe(1);
    expect(errorLines(result)).toEqual(["rm: cannot remove 'docs': Is a directory"]);
    expect(removeFn).not.toHaveBeenCalled();
  });

  it('removes a directory recursively with -r via one deletion marker on the directory', async () => {
    const { env, removeFn } = rmEnv();

    const result = await rm.execute(env, ['docs'], RECURSIVE);

    if (result.kind !== 'sync') throw new Error('expected sync');
    expect(result.exitCode).toBe(0);
    expect(removeFn).toHaveBeenCalledTimes(1);
    expect(removeFn).toHaveBeenCalledWith(asAbsPath('/home/alice/docs'));
  });

  it('accepts -R as an alias for -r', async () => {
    const { env, removeFn } = rmEnv();

    const result = await rm.execute(env, ['docs'], RECURSIVE_R);

    if (result.kind !== 'sync') throw new Error('expected sync');
    expect(result.exitCode).toBe(0);
    expect(removeFn).toHaveBeenCalledWith(asAbsPath('/home/alice/docs'));
  });

  it('removes a directory and force-skips a missing target with -r -f together', async () => {
    const { env, removeFn } = rmEnv();

    const result = await rm.execute(env, ['docs', 'ghost'], RECURSIVE_FORCE);

    if (result.kind !== 'sync') throw new Error('expected sync');
    expect(result.exitCode).toBe(0);
    expect(errorLines(result)).toEqual([]);
    expect(removeFn).toHaveBeenCalledTimes(1);
    expect(removeFn).toHaveBeenCalledWith(asAbsPath('/home/alice/docs'));
  });

  it("errors 'Permission denied' when the parent directory is not writable", async () => {
    // `/secret.txt` lives under the root-owned `/`; a user can't unlink it.
    const { env, removeFn } = rmEnv({ cwd: '/' });

    const result = await rm.execute(env, ['secret.txt'], NO_FLAGS);

    if (result.kind !== 'sync') throw new Error('expected sync');
    expect(result.exitCode).toBe(1);
    expect(errorLines(result)).toEqual(["rm: cannot remove 'secret.txt': Permission denied"]);
    expect(removeFn).not.toHaveBeenCalled();
  });

  it('refuses to remove the root directory', async () => {
    const { env, removeFn } = rmEnv();

    const result = await rm.execute(env, ['/'], RECURSIVE);

    if (result.kind !== 'sync') throw new Error('expected sync');
    expect(result.exitCode).toBe(1);
    expect(errorLines(result)).toEqual(['rm: cannot remove root directory']);
    expect(removeFn).not.toHaveBeenCalled();
  });

  it('surfaces a network failure as "I/O error" and exits non-zero', async () => {
    const { env } = rmEnv({ removeResult: { ok: false, error: 'network_error' } });

    const result = await rm.execute(env, ['file.txt'], NO_FLAGS);

    if (result.kind !== 'sync') throw new Error('expected sync');
    expect(result.exitCode).toBe(1);
    expect(errorLines(result)).toEqual(["rm: cannot remove 'file.txt': I/O error"]);
  });

  it('surfaces a server rejection (no_session / permission_denied) as "Permission denied"', async () => {
    const denied = await rm.execute(
      rmEnv({ removeResult: { ok: false, error: 'no_session' } }).env,
      ['file.txt'],
      NO_FLAGS,
    );
    const forbidden = await rm.execute(
      rmEnv({ removeResult: { ok: false, error: 'permission_denied' } }).env,
      ['file.txt'],
      NO_FLAGS,
    );

    if (denied.kind !== 'sync' || forbidden.kind !== 'sync') throw new Error('expected sync');
    expect(errorLines(denied)).toEqual(["rm: cannot remove 'file.txt': Permission denied"]);
    expect(errorLines(forbidden)).toEqual(["rm: cannot remove 'file.txt': Permission denied"]);
  });

  it('removes each path and collects per-path errors', async () => {
    const { env, removeFn } = rmEnv();

    const result = await rm.execute(env, ['file.txt', 'ghost'], NO_FLAGS);

    if (result.kind !== 'sync') throw new Error('expected sync');
    expect(result.exitCode).toBe(1);
    expect(removeFn.mock.calls.map((call) => call[0])).toEqual([asAbsPath('/home/alice/file.txt')]);
    expect(errorLines(result)).toEqual(["rm: cannot remove 'ghost': No such file or directory"]);
  });
});
