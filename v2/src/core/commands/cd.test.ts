import { describe, expect, it } from 'vitest';
import { cd } from './cd';
import { buildDirectory, buildFile } from '../../test/factories/filesystem';
import { mockCommandEnv, mockFsViewFromTree, mockSession } from '../../test/factories/commandEnv';
import { asAbsPath, type AbsPath } from '../types';
import type { CommandEnv } from './types';
import type { TerminalLine } from './types';

const NO_FLAGS = new Map<string, string | true>();

/** Closure-based call recorder — the project's existing pattern for capturing
 *  side effects on mocks (no `vi.fn` anywhere else in v2). */
const makeSetCwdRecorder = (): {
  readonly setCwd: (path: AbsPath) => void;
  readonly calls: readonly AbsPath[];
} => {
  const calls: AbsPath[] = [];
  return {
    setCwd: (path) => {
      calls.push(path);
    },
    get calls() {
      return calls;
    },
  };
};

const errorLines = (result: { readonly lines: readonly TerminalLine[] }): string[] =>
  result.lines.filter((line) => line.kind === 'error').map((line) => line.content);

/** Build a seed FS with predictable traversal + permission shapes.
 *  - `/tmp` (traversable to all)
 *  - `/tmp/sub` (traversable to all)
 *  - `/etc/passwd` (a regular file — for the not-a-directory case)
 *  - `/root` (perm: read by root only — for permission-denied as user) */
const buildNavFs = () =>
  buildDirectory({
    tmp: buildDirectory({ sub: buildDirectory({}, { owner: 'root' }) }, { owner: 'root' }),
    etc: buildDirectory(
      { passwd: buildFile('root:x:0:0:root:/root:/bin/bash\n', { owner: 'root' }) },
      { owner: 'root' },
    ),
    root: buildDirectory(
      {},
      {
        owner: 'root',
        perms: { read: ['root'], write: ['root'], execute: ['root'] },
      },
    ),
    home: buildDirectory({ alice: buildDirectory({}, { owner: 'alice' }) }, { owner: 'root' }),
  });

const buildCdEnv = (
  options: {
    readonly cwd?: AbsPath;
    readonly userType?: 'root' | 'user' | 'guest';
    readonly username?: string;
    readonly setCwd?: (path: AbsPath) => void;
  } = {},
): CommandEnv =>
  mockCommandEnv({
    fs: mockFsViewFromTree(buildNavFs(), {
      userType: options.userType ?? 'user',
      cwd: options.cwd ?? asAbsPath('/home/alice'),
    }),
    session: mockSession({
      username: options.username ?? 'alice',
      userType: options.userType ?? 'user',
    }),
    setCwd: options.setCwd ?? (() => undefined),
  });

describe('cd', () => {
  it('changes cwd to an absolute path', async () => {
    const recorder = makeSetCwdRecorder();
    const env = buildCdEnv({ setCwd: recorder.setCwd });

    const result = await cd.execute(env, ['/tmp'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(0);
    expect(result.lines).toEqual([]);
    expect(recorder.calls).toEqual([asAbsPath('/tmp')]);
  });

  it('resolves a relative path against the current cwd', async () => {
    const recorder = makeSetCwdRecorder();
    const env = buildCdEnv({ cwd: asAbsPath('/tmp'), setCwd: recorder.setCwd });

    const result = await cd.execute(env, ['sub'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(0);
    expect(recorder.calls).toEqual([asAbsPath('/tmp/sub')]);
  });

  it('resolves `..` to the parent directory', async () => {
    const recorder = makeSetCwdRecorder();
    const env = buildCdEnv({ cwd: asAbsPath('/tmp/sub'), setCwd: recorder.setCwd });

    const result = await cd.execute(env, ['..'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(0);
    expect(recorder.calls).toEqual([asAbsPath('/tmp')]);
  });

  it('resolves `.` to the current directory (cwd unchanged-in-value but setCwd still called)', async () => {
    // `cd .` is a real no-op shell idiom; the call still passes validation
    // and re-asserts the cwd. setCwd receives the SAME absolute path.
    const recorder = makeSetCwdRecorder();
    const env = buildCdEnv({ cwd: asAbsPath('/tmp'), setCwd: recorder.setCwd });

    const result = await cd.execute(env, ['.'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(0);
    expect(recorder.calls).toEqual([asAbsPath('/tmp')]);
  });

  it('with no arg, jumps to /home/${username} for a user-tier session', async () => {
    const recorder = makeSetCwdRecorder();
    const env = buildCdEnv({
      cwd: asAbsPath('/tmp'),
      username: 'alice',
      userType: 'user',
      setCwd: recorder.setCwd,
    });

    const result = await cd.execute(env, [], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(0);
    expect(recorder.calls).toEqual([asAbsPath('/home/alice')]);
  });

  it('with no arg, jumps to /root for a root-tier session', async () => {
    // Catches a hardcoded /home/* derivation that ignores userType.
    const recorder = makeSetCwdRecorder();
    const env = buildCdEnv({
      cwd: asAbsPath('/tmp'),
      userType: 'root',
      username: 'root',
      setCwd: recorder.setCwd,
    });

    const result = await cd.execute(env, [], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(0);
    expect(recorder.calls).toEqual([asAbsPath('/root')]);
  });

  it('derives /home/${username} verbatim from the session (catches hardcoded alice)', async () => {
    const recorder = makeSetCwdRecorder();
    const env = buildCdEnv({
      cwd: asAbsPath('/tmp'),
      username: 'bob',
      userType: 'user',
      setCwd: recorder.setCwd,
    });
    // Need a /home/bob in the tree for the no-arg case to succeed.
    // Replace the FS to include /home/bob.
    const customEnv = mockCommandEnv({
      ...env,
      fs: mockFsViewFromTree(
        buildDirectory({
          home: buildDirectory({ bob: buildDirectory({}, { owner: 'bob' }) }, { owner: 'root' }),
        }),
        { userType: 'user', cwd: asAbsPath('/tmp') },
      ),
      session: mockSession({ username: 'bob', userType: 'user' }),
      setCwd: recorder.setCwd,
    });

    const result = await cd.execute(customEnv, [], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(0);
    expect(recorder.calls).toEqual([asAbsPath('/home/bob')]);
  });

  it('reports "No such file or directory" for a missing target', async () => {
    const recorder = makeSetCwdRecorder();
    const env = buildCdEnv({ setCwd: recorder.setCwd });

    const result = await cd.execute(env, ['/nope'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(1);
    expect(errorLines(result)).toEqual(['cd: /nope: No such file or directory']);
    // Failure MUST NOT mutate cwd.
    expect(recorder.calls).toEqual([]);
  });

  it('reports "Not a directory" when target is a regular file', async () => {
    const recorder = makeSetCwdRecorder();
    const env = buildCdEnv({ setCwd: recorder.setCwd });

    const result = await cd.execute(env, ['/etc/passwd'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(1);
    expect(errorLines(result)).toEqual(['cd: /etc/passwd: Not a directory']);
    expect(recorder.calls).toEqual([]);
  });

  it('reports "Permission denied" when the directory is unreadable for this user', async () => {
    // /root in the fixture has perms read:['root'] only; a user-tier session
    // gets permission_denied from fs.list.
    const recorder = makeSetCwdRecorder();
    const env = buildCdEnv({ setCwd: recorder.setCwd });

    const result = await cd.execute(env, ['/root'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(1);
    expect(errorLines(result)).toEqual(['cd: /root: Permission denied']);
    expect(recorder.calls).toEqual([]);
  });

  it('echoes the ORIGINAL arg in error messages (not the resolved abs path)', async () => {
    // Catches an "always use resolved path" bug. `cd nope` from /home/alice
    // resolves to /home/alice/nope, but the error message should preserve `nope`.
    const recorder = makeSetCwdRecorder();
    const env = buildCdEnv({ cwd: asAbsPath('/home/alice'), setCwd: recorder.setCwd });

    const result = await cd.execute(env, ['nope'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(1);
    expect(errorLines(result)).toEqual(['cd: nope: No such file or directory']);
    expect(recorder.calls).toEqual([]);
  });

  it('rejects calls with two or more positional args', async () => {
    // Matches real bash: `bash: cd: too many arguments`.
    const recorder = makeSetCwdRecorder();
    const env = buildCdEnv({ setCwd: recorder.setCwd });

    const result = await cd.execute(env, ['/tmp', '/etc'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(1);
    expect(errorLines(result)).toEqual(['cd: too many arguments']);
    expect(recorder.calls).toEqual([]);
  });

  it('on success, returns zero text lines (cd is silent)', async () => {
    // Catches a "spuriously echo new cwd" mutant that would behave like pwd.
    const recorder = makeSetCwdRecorder();
    const env = buildCdEnv({ setCwd: recorder.setCwd });

    const result = await cd.execute(env, ['/tmp'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.lines).toEqual([]);
  });
});
