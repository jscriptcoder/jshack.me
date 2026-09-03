import { describe, expect, it, vi } from 'vitest';
import { mkdir } from './mkdir';
import { buildDirectory, buildFile } from '../../test/factories/filesystem';
import { mockCommandEnv, mockFsViewFromTree, mockSession } from '../../test/factories/commandEnv';
import { asAbsPath } from '../types';
import type { CommandEnv, PatchApi, PatchResult, TerminalLine } from './types';

const NO_FLAGS = new Map<string, string | true>();
const WITH_P = new Map<string, string | true>([['-p', true]]);

const errorLines = (result: { readonly lines: readonly TerminalLine[] }): string[] =>
  result.lines.filter((line) => line.kind === 'error').map((line) => line.content);

/** /home/alice is alice-owned (user-writable); /home/alice/existing already there. */
const homeTree = () =>
  buildDirectory({
    home: buildDirectory({
      alice: buildDirectory(
        {
          existing: buildDirectory({}, { owner: 'alice' }),
          'file.txt': buildFile('hi', { owner: 'alice' }),
        },
        { owner: 'alice' },
      ),
    }),
  });

const mkdirEnv = (
  options: {
    readonly tree?: ReturnType<typeof homeTree>;
    readonly cwd?: string;
    readonly mkdirResult?: PatchResult;
  } = {},
): { readonly env: CommandEnv; readonly mkdirFn: ReturnType<typeof vi.fn> } => {
  const mkdirFn = vi.fn<PatchApi['mkdir']>(async () => options.mkdirResult ?? { ok: true });
  const patches: PatchApi = {
    write: async () => ({ ok: true }),
    remove: async () => ({ ok: true }),
    mkdir: mkdirFn,
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
  return { env, mkdirFn };
};

describe('mkdir', () => {
  it('creates a directory in the cwd via a single patch', async () => {
    const { env, mkdirFn } = mkdirEnv();

    const result = await mkdir.execute(env, ['proj'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(0);
    expect(result.lines).toEqual([]);
    expect(mkdirFn).toHaveBeenCalledTimes(1);
    expect(mkdirFn).toHaveBeenCalledWith(asAbsPath('/home/alice/proj'));
  });

  it('errors with missing operand when no path is given', async () => {
    const { env, mkdirFn } = mkdirEnv();

    const result = await mkdir.execute(env, [], NO_FLAGS);

    if (result.kind !== 'sync') throw new Error('expected sync');
    expect(result.exitCode).toBe(1);
    expect(errorLines(result)).toEqual(['mkdir: missing operand']);
    expect(mkdirFn).not.toHaveBeenCalled();
  });

  it("errors 'File exists' for an existing target without -p", async () => {
    const { env, mkdirFn } = mkdirEnv();

    const result = await mkdir.execute(env, ['existing'], NO_FLAGS);

    if (result.kind !== 'sync') throw new Error('expected sync');
    expect(result.exitCode).toBe(1);
    expect(errorLines(result)).toEqual(["mkdir: cannot create directory 'existing': File exists"]);
    expect(mkdirFn).not.toHaveBeenCalled();
  });

  it('is a silent no-op for an existing target with -p', async () => {
    const { env, mkdirFn } = mkdirEnv();

    const result = await mkdir.execute(env, ['existing'], WITH_P);

    if (result.kind !== 'sync') throw new Error('expected sync');
    expect(result.exitCode).toBe(0);
    expect(result.lines).toEqual([]);
    expect(mkdirFn).not.toHaveBeenCalled();
  });

  it("errors 'No such file or directory' for a missing parent without -p", async () => {
    const { env, mkdirFn } = mkdirEnv();

    const result = await mkdir.execute(env, ['a/b'], NO_FLAGS);

    if (result.kind !== 'sync') throw new Error('expected sync');
    expect(result.exitCode).toBe(1);
    expect(errorLines(result)).toEqual([
      "mkdir: cannot create directory 'a/b': No such file or directory",
    ]);
    expect(mkdirFn).not.toHaveBeenCalled();
  });

  it('creates intermediate directories in order with -p', async () => {
    const { env, mkdirFn } = mkdirEnv();

    const result = await mkdir.execute(env, ['a/b/c'], WITH_P);

    if (result.kind !== 'sync') throw new Error('expected sync');
    expect(result.exitCode).toBe(0);
    expect(mkdirFn.mock.calls.map((call) => call[0])).toEqual([
      asAbsPath('/home/alice/a'),
      asAbsPath('/home/alice/a/b'),
      asAbsPath('/home/alice/a/b/c'),
    ]);
  });

  it("errors 'Permission denied' when the parent directory is not writable", async () => {
    // cwd is `/` (root-owned, root-only write); a user cannot create there.
    const { env, mkdirFn } = mkdirEnv({ cwd: '/' });

    const result = await mkdir.execute(env, ['newtop'], NO_FLAGS);

    if (result.kind !== 'sync') throw new Error('expected sync');
    expect(result.exitCode).toBe(1);
    expect(errorLines(result)).toEqual([
      "mkdir: cannot create directory 'newtop': Permission denied",
    ]);
    expect(mkdirFn).not.toHaveBeenCalled();
  });

  it("errors 'Not a directory' when a path segment is a file", async () => {
    const { env, mkdirFn } = mkdirEnv();

    const result = await mkdir.execute(env, ['file.txt/sub'], WITH_P);

    if (result.kind !== 'sync') throw new Error('expected sync');
    expect(result.exitCode).toBe(1);
    expect(errorLines(result)).toEqual([
      "mkdir: cannot create directory 'file.txt/sub': Not a directory",
    ]);
    expect(mkdirFn).not.toHaveBeenCalled();
  });

  it('surfaces a network failure as "service unavailable" and exits non-zero', async () => {
    const { env } = mkdirEnv({ mkdirResult: { ok: false, error: 'network_error' } });

    const result = await mkdir.execute(env, ['proj'], NO_FLAGS);

    if (result.kind !== 'sync') throw new Error('expected sync');
    expect(result.exitCode).toBe(1);
    expect(errorLines(result)).toEqual([
      "mkdir: cannot create directory 'proj': service unavailable",
    ]);
  });

  it('surfaces a server rejection (no_session / permission_denied) as "Permission denied"', async () => {
    const denied = await mkdir.execute(
      mkdirEnv({ mkdirResult: { ok: false, error: 'no_session' } }).env,
      ['proj'],
      NO_FLAGS,
    );
    const forbidden = await mkdir.execute(
      mkdirEnv({ mkdirResult: { ok: false, error: 'permission_denied' } }).env,
      ['proj'],
      NO_FLAGS,
    );

    if (denied.kind !== 'sync' || forbidden.kind !== 'sync') throw new Error('expected sync');
    expect(errorLines(denied)).toEqual([
      "mkdir: cannot create directory 'proj': Permission denied",
    ]);
    expect(errorLines(forbidden)).toEqual([
      "mkdir: cannot create directory 'proj': Permission denied",
    ]);
  });
});
