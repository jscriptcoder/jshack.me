import { describe, expect, it, vi } from 'vitest';
import { touch } from './touch';
import { buildDirectory, buildFile } from '../../test/factories/filesystem';
import { mockCommandEnv, mockFsViewFromTree, mockSession } from '../../test/factories/commandEnv';
import { asAbsPath } from '../types';
import type { CommandEnv, PatchApi, PatchResult, TerminalLine } from './types';

const NO_FLAGS = new Map<string, string | true>();

const errorLines = (result: { readonly lines: readonly TerminalLine[] }): string[] =>
  result.lines.filter((line) => line.kind === 'error').map((line) => line.content);

/** /home/alice is alice-owned (user-writable); it already holds a file and a
 *  directory so the "existing target is a no-op" branches can be exercised. */
const homeTree = () =>
  buildDirectory({
    home: buildDirectory({
      alice: buildDirectory(
        {
          'existing.txt': buildFile('hi', { owner: 'alice' }),
          existingdir: buildDirectory({}, { owner: 'alice' }),
        },
        { owner: 'alice' },
      ),
    }),
  });

const touchEnv = (
  options: {
    readonly tree?: ReturnType<typeof homeTree>;
    readonly cwd?: string;
    readonly writeResult?: PatchResult;
  } = {},
): { readonly env: CommandEnv; readonly writeFn: ReturnType<typeof vi.fn> } => {
  const writeFn = vi.fn<PatchApi['write']>(async () => options.writeResult ?? { ok: true });
  const patches: PatchApi = {
    write: writeFn,
    remove: async () => ({ ok: true }),
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
  return { env, writeFn };
};

describe('touch', () => {
  it('creates an empty file in the cwd via a single empty-content write', async () => {
    const { env, writeFn } = touchEnv();

    const result = await touch.execute(env, ['new.txt'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(0);
    expect(result.lines).toEqual([]);
    expect(writeFn).toHaveBeenCalledTimes(1);
    expect(writeFn).toHaveBeenCalledWith(asAbsPath('/home/alice/new.txt'), '', { isNew: true });
  });

  it('errors with missing operand when no path is given', async () => {
    const { env, writeFn } = touchEnv();

    const result = await touch.execute(env, [], NO_FLAGS);

    if (result.kind !== 'sync') throw new Error('expected sync');
    expect(result.exitCode).toBe(1);
    expect(errorLines(result)).toEqual(['touch: missing file operand']);
    expect(writeFn).not.toHaveBeenCalled();
  });

  it('is a no-op for an existing file (does not truncate)', async () => {
    const { env, writeFn } = touchEnv();

    const result = await touch.execute(env, ['existing.txt'], NO_FLAGS);

    if (result.kind !== 'sync') throw new Error('expected sync');
    expect(result.exitCode).toBe(0);
    expect(result.lines).toEqual([]);
    expect(writeFn).not.toHaveBeenCalled();
  });

  it('is a no-op for an existing directory', async () => {
    const { env, writeFn } = touchEnv();

    const result = await touch.execute(env, ['existingdir'], NO_FLAGS);

    if (result.kind !== 'sync') throw new Error('expected sync');
    expect(result.exitCode).toBe(0);
    expect(writeFn).not.toHaveBeenCalled();
  });

  it("errors 'No such file or directory' when the parent directory is missing", async () => {
    const { env, writeFn } = touchEnv();

    const result = await touch.execute(env, ['a/b.txt'], NO_FLAGS);

    if (result.kind !== 'sync') throw new Error('expected sync');
    expect(result.exitCode).toBe(1);
    expect(errorLines(result)).toEqual([
      "touch: cannot touch 'a/b.txt': No such file or directory",
    ]);
    expect(writeFn).not.toHaveBeenCalled();
  });

  it("errors 'No such file or directory' when a path segment is a file", async () => {
    const { env, writeFn } = touchEnv();

    const result = await touch.execute(env, ['existing.txt/sub'], NO_FLAGS);

    if (result.kind !== 'sync') throw new Error('expected sync');
    expect(result.exitCode).toBe(1);
    expect(errorLines(result)).toEqual([
      "touch: cannot touch 'existing.txt/sub': No such file or directory",
    ]);
    expect(writeFn).not.toHaveBeenCalled();
  });

  it("errors 'Permission denied' when the parent directory is not writable", async () => {
    // cwd is `/` (root-owned, root-only write); a user cannot create there.
    const { env, writeFn } = touchEnv({ cwd: '/' });

    const result = await touch.execute(env, ['newtop.txt'], NO_FLAGS);

    if (result.kind !== 'sync') throw new Error('expected sync');
    expect(result.exitCode).toBe(1);
    expect(errorLines(result)).toEqual(["touch: cannot touch 'newtop.txt': Permission denied"]);
    expect(writeFn).not.toHaveBeenCalled();
  });

  it('surfaces a network failure as "I/O error" and exits non-zero', async () => {
    const { env } = touchEnv({ writeResult: { ok: false, error: 'network_error' } });

    const result = await touch.execute(env, ['new.txt'], NO_FLAGS);

    if (result.kind !== 'sync') throw new Error('expected sync');
    expect(result.exitCode).toBe(1);
    expect(errorLines(result)).toEqual(["touch: cannot touch 'new.txt': I/O error"]);
  });

  it('surfaces a server rejection (no_session / permission_denied) as "Permission denied"', async () => {
    const denied = await touch.execute(
      touchEnv({ writeResult: { ok: false, error: 'no_session' } }).env,
      ['new.txt'],
      NO_FLAGS,
    );
    const forbidden = await touch.execute(
      touchEnv({ writeResult: { ok: false, error: 'permission_denied' } }).env,
      ['new.txt'],
      NO_FLAGS,
    );

    if (denied.kind !== 'sync' || forbidden.kind !== 'sync') throw new Error('expected sync');
    expect(errorLines(denied)).toEqual(["touch: cannot touch 'new.txt': Permission denied"]);
    expect(errorLines(forbidden)).toEqual(["touch: cannot touch 'new.txt': Permission denied"]);
  });

  it('creates every path argument and collects per-path errors', async () => {
    const { env, writeFn } = touchEnv();

    const result = await touch.execute(env, ['one.txt', 'a/two.txt', 'three.txt'], NO_FLAGS);

    if (result.kind !== 'sync') throw new Error('expected sync');
    expect(result.exitCode).toBe(1);
    expect(writeFn.mock.calls.map((call) => call[0])).toEqual([
      asAbsPath('/home/alice/one.txt'),
      asAbsPath('/home/alice/three.txt'),
    ]);
    expect(errorLines(result)).toEqual([
      "touch: cannot touch 'a/two.txt': No such file or directory",
    ]);
  });
});
