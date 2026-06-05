import { describe, expect, it } from 'vitest';
import { md5 } from '../generation/md5';
import { buildDirectory, buildFile } from '../../test/factories/filesystem';
import {
  mockCommandEnv,
  mockFsViewFromTree,
  mockSession,
} from '../../test/factories/commandEnv';
import { asAbsPath, asEpochMs, asMachineId, asPlayerKeyHex, type UserType } from '../types';
import type { CommandResult, Session } from './types';
import { su } from './su';

/**
 * `su` elevates to root: it prompts (masked) for a password, validates it
 * against the `root` row of `/etc/passwd` (md5), and on success pushes a root
 * session + moves to /root. The tests drive the password through a mocked
 * `env.prompt` and spy `pushSession`/`setCwd`, so the "wrong password ⇒ nothing
 * elevated" invariant is provable, and assert the prompt is requested MASKED.
 */

const NO_FLAGS = new Map<string, string | true>();
const PUBKEY = asPlayerKeyHex('a'.repeat(64));
const MACHINE = asMachineId('rig-deadbeef');

type PromptCall = { readonly message: string; readonly masked: boolean };

type SuEnvOpts = {
  readonly rootPassword?: string;
  readonly typed?: string;
  readonly userType?: UserType;
};

/** Build an env around an `/etc/passwd` whose root row carries `md5(rootPassword)`,
 *  with a mocked masked prompt returning `typed` and spies for the elevation
 *  side effects. `/etc/passwd` is root+user-readable (guest excluded), matching
 *  the workstation FS. */
const suEnv = (opts: SuEnvOpts = {}) => {
  const rootPassword = opts.rootPassword ?? 'toor1234';
  const userType = opts.userType ?? 'user';
  const pushed: Session[] = [];
  const cwds: string[] = [];
  const promptCalls: PromptCall[] = [];

  const tree = buildDirectory({
    etc: buildDirectory({
      passwd: buildFile(
        `root:${md5(rootPassword)}:0:0:root:/root:/bin/bash\nneo:x:1000:1000::/home/neo:/bin/bash\n`,
        { owner: 'root', perms: { read: ['root', 'user'] } },
      ),
    }),
  });

  const env = mockCommandEnv({
    session: mockSession({ machineId: MACHINE, playerKey: PUBKEY, username: 'neo', userType }),
    fs: mockFsViewFromTree(tree, { userType, cwd: () => asAbsPath('/') }),
    now: () => asEpochMs(123),
    prompt: async (promptOpts) => {
      promptCalls.push(promptOpts);
      return opts.typed ?? '';
    },
    pushSession: (pushedSession) => pushed.push(pushedSession),
    setCwd: (path) => cwds.push(path),
  });

  return { env, pushed, cwds, promptCalls };
};

const syncResult = (
  result: CommandResult,
): { readonly text: string; readonly exitCode: number } => {
  if (result.kind !== 'sync') throw new Error('sync expected');
  return { text: result.lines.map((line) => line.content).join('\n'), exitCode: result.exitCode };
};

describe('su', () => {
  it('elevates to a root session and moves to /root on the correct password', async () => {
    const { env, pushed, cwds } = suEnv({ rootPassword: 'hunter2', typed: 'hunter2' });

    const { text, exitCode } = syncResult(await su.execute(env, [], NO_FLAGS));

    expect(pushed).toHaveLength(1);
    expect(pushed[0]).toMatchObject({
      username: 'root',
      userType: 'root',
      kind: 'su',
      machineId: MACHINE,
      playerKey: PUBKEY,
    });
    expect(cwds).toEqual(['/root']);
    expect(exitCode).toBe(0);
    // su is silent on success — the new prompt is the only feedback.
    expect(text).toBe('');
  });

  it('requests the password through a MASKED prompt', async () => {
    const { env, promptCalls } = suEnv({ rootPassword: 'hunter2', typed: 'hunter2' });

    await su.execute(env, [], NO_FLAGS);

    expect(promptCalls).toHaveLength(1);
    expect(promptCalls[0].masked).toBe(true);
    expect(promptCalls[0].message.toLowerCase()).toContain('password');
  });

  it('rejects a wrong password without elevating or moving', async () => {
    const { env, pushed, cwds } = suEnv({ rootPassword: 'hunter2', typed: 'wrongpw' });

    const { text, exitCode } = syncResult(await su.execute(env, [], NO_FLAGS));

    expect(text).toContain('su: Authentication failure');
    expect(exitCode).toBe(1);
    expect(pushed).toEqual([]);
    expect(cwds).toEqual([]);
  });

  it('validates against the stored /etc/passwd hash, not a fixed value', async () => {
    // Same typed password, different stored password ⇒ must fail: proves the
    // compare is md5(typed) === the row's hash, not a constant.
    const { env, pushed } = suEnv({ rootPassword: 'somethingelse', typed: 'hunter2' });

    const { text, exitCode } = syncResult(await su.execute(env, [], NO_FLAGS));

    expect(text).toContain('su: Authentication failure');
    expect(exitCode).toBe(1);
    expect(pushed).toEqual([]);
  });

  it('does not elevate when the prompt is cancelled (Ctrl-C)', async () => {
    const pushed: Session[] = [];
    const env = mockCommandEnv({
      session: mockSession({ machineId: MACHINE, playerKey: PUBKEY, userType: 'user' }),
      prompt: async () => {
        throw new DOMException('aborted', 'AbortError');
      },
      pushSession: (pushedSession) => pushed.push(pushedSession),
    });

    const { text, exitCode } = syncResult(await su.execute(env, [], NO_FLAGS));

    expect(exitCode).toBe(130);
    expect(text).toBe('');
    expect(pushed).toEqual([]);
  });

  it('keys on the root row specifically, not just the first passwd row', async () => {
    // root is the SECOND row with a different hash; typing root's password must
    // still elevate — proving the lookup matches `root:`, not the first line.
    const pushed: Session[] = [];
    const tree = buildDirectory({
      etc: buildDirectory({
        passwd: buildFile(
          `neo:${md5('neopw')}:1000:1000::/home/neo:/bin/bash\nroot:${md5('rootpw')}:0:0:root:/root:/bin/bash\n`,
          { owner: 'root', perms: { read: ['root', 'user'] } },
        ),
      }),
    });
    const env = mockCommandEnv({
      session: mockSession({ machineId: MACHINE, playerKey: PUBKEY, userType: 'user' }),
      fs: mockFsViewFromTree(tree, { userType: 'user', cwd: () => asAbsPath('/') }),
      now: () => asEpochMs(1),
      prompt: async () => 'rootpw',
      pushSession: (pushedSession) => pushed.push(pushedSession),
    });

    const { exitCode } = syncResult(await su.execute(env, [], NO_FLAGS));

    expect(exitCode).toBe(0);
    expect(pushed).toHaveLength(1);
    expect(pushed[0]).toMatchObject({ userType: 'root' });
  });

  it('fails when /etc/passwd has no root row', async () => {
    const pushed: Session[] = [];
    const tree = buildDirectory({
      etc: buildDirectory({
        passwd: buildFile('neo:x:1000:1000::/home/neo:/bin/bash\n', {
          owner: 'root',
          perms: { read: ['root', 'user'] },
        }),
      }),
    });
    const env = mockCommandEnv({
      session: mockSession({ machineId: MACHINE, playerKey: PUBKEY, userType: 'user' }),
      fs: mockFsViewFromTree(tree, { userType: 'user', cwd: () => asAbsPath('/') }),
      prompt: async () => 'anything',
      pushSession: (pushedSession) => pushed.push(pushedSession),
    });

    const { text, exitCode } = syncResult(await su.execute(env, [], NO_FLAGS));

    expect(text).toContain('su: Authentication failure');
    expect(exitCode).toBe(1);
    expect(pushed).toEqual([]);
  });

  it('cannot elevate as guest (cannot read /etc/passwd), even with the right password', async () => {
    const { env, pushed } = suEnv({ rootPassword: 'hunter2', typed: 'hunter2', userType: 'guest' });

    const { text, exitCode } = syncResult(await su.execute(env, [], NO_FLAGS));

    expect(text).toContain('su: Authentication failure');
    expect(exitCode).toBe(1);
    expect(pushed).toEqual([]);
  });
});
