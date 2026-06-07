import { describe, expect, it } from 'vitest';
import { md5 } from '../generation/md5';
import { buildDirectory, buildFile } from '../../test/factories/filesystem';
import {
  mockCommandEnv,
  mockFsViewFromTree,
  mockSession,
} from '../../test/factories/commandEnv';
import {
  asAbsPath,
  asEpochMs,
  asMachineId,
  asPlayerKeyHex,
  type UserType,
} from '../types';
import type { AuthLogEvent, CommandResult, Session } from './types';
import { su } from './su';

/**
 * `su` switches to a target user (defaulting to `root`). It reads the target's
 * `/etc/passwd` row at ROOT privilege (setuid-root: `stat` bypasses the caller's
 * read perms), derives the tier (uid 0 ⇒ root, `guest` ⇒ guest, else user), and:
 *   - prompts (masked) + validates md5 when the target has a password and the
 *     caller is NOT root;
 *   - switches with NO prompt when the caller is already root, or the target is
 *     a password-less account (empty hash).
 * On success it pushes a session for the target + moves to their home dir.
 * The tests drive the password through a mocked `env.prompt` and spy
 * `pushSession`/`setCwd`.
 */

const NO_FLAGS = new Map<string, string | true>();
const PUBKEY = asPlayerKeyHex('a'.repeat(64));
const MACHINE = asMachineId('rig-deadbeef');

type PromptCall = { readonly message: string; readonly masked: boolean };

type SuEnvOpts = {
  readonly rootPassword?: string;
  readonly guestPassword?: string;
  readonly userName?: string;
  readonly typed?: string;
  /** The tier of the session running `su` (the caller). Defaults to user. */
  readonly callerType?: UserType;
};

/** Build an env around a realistic `/etc/passwd` (root with a password, the
 *  player's own user with an EMPTY hash, guest with a password), a mocked masked
 *  prompt returning `typed`, and spies for the switch side effects. `/etc/passwd`
 *  is root+user-readable (guest excluded) — but `su`'s setuid-root `stat` read
 *  resolves rows regardless of the caller's tier. */
const suEnv = (opts: SuEnvOpts = {}) => {
  const rootPassword = opts.rootPassword ?? 'toor1234';
  const guestPassword = opts.guestPassword ?? 'guestpw';
  const userName = opts.userName ?? 'neo';
  const callerType = opts.callerType ?? 'user';
  const pushed: Session[] = [];
  const cwds: string[] = [];
  const promptCalls: PromptCall[] = [];
  const authLogs: AuthLogEvent[] = [];

  const tree = buildDirectory({
    etc: buildDirectory({
      passwd: buildFile(
        `root:${md5(rootPassword)}:0:0:root:/root:/bin/bash\n` +
          `${userName}::1000:1000::/home/${userName}:/bin/bash\n` +
          `guest:${md5(guestPassword)}:1001:1001:guest:/home/guest:/bin/bash\n`,
        { owner: 'root', perms: { read: ['root', 'user'] } },
      ),
    }),
  });

  const env = mockCommandEnv({
    session: mockSession({
      machineId: MACHINE,
      playerKey: PUBKEY,
      username: userName,
      userType: callerType,
    }),
    fs: mockFsViewFromTree(tree, { userType: callerType, cwd: () => asAbsPath('/') }),
    now: () => asEpochMs(123),
    prompt: async (promptOpts) => {
      promptCalls.push(promptOpts);
      return opts.typed ?? '';
    },
    pushSession: (pushedSession) => pushed.push(pushedSession),
    setCwd: (path) => cwds.push(path),
    log: {
      appendAuthLog: async (event) => {
        authLogs.push(event);
      },
      appendAccessLog: async () => undefined,
    },
  });

  return { env, pushed, cwds, promptCalls, authLogs };
};

const syncResult = (
  result: CommandResult,
): { readonly text: string; readonly exitCode: number; readonly lineCount: number } => {
  if (result.kind !== 'sync') throw new Error('sync expected');
  return {
    text: result.lines.map((line) => line.content).join('\n'),
    exitCode: result.exitCode,
    lineCount: result.lines.length,
  };
};

describe('su', () => {
  it('defaults to root: elevates to a root session and moves to /root on the correct password', async () => {
    const { env, pushed, cwds } = suEnv({ rootPassword: 'hunter2', typed: 'hunter2' });

    const { text, exitCode, lineCount } = syncResult(await su.execute(env, [], NO_FLAGS));

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
    // su is silent on success — the new prompt is the only feedback. Assert the
    // output array is genuinely empty (not just that its joined text is blank).
    expect(text).toBe('');
    expect(lineCount).toBe(0);
  });

  it('requests the password through a MASKED prompt', async () => {
    const { env, promptCalls } = suEnv({ rootPassword: 'hunter2', typed: 'hunter2' });

    await su.execute(env, [], NO_FLAGS);

    expect(promptCalls).toHaveLength(1);
    expect(promptCalls[0].masked).toBe(true);
    expect(promptCalls[0].message.toLowerCase()).toContain('password');
  });

  it('rejects a wrong password without switching or moving', async () => {
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

  it('does not switch when the prompt is cancelled (Ctrl-C)', async () => {
    const pushed: Session[] = [];
    const tree = buildDirectory({
      etc: buildDirectory({
        passwd: buildFile(`root:${md5('toor')}:0:0:root:/root:/bin/bash\n`, {
          owner: 'root',
          perms: { read: ['root', 'user'] },
        }),
      }),
    });
    const env = mockCommandEnv({
      session: mockSession({ machineId: MACHINE, playerKey: PUBKEY, userType: 'user' }),
      fs: mockFsViewFromTree(tree, { userType: 'user', cwd: () => asAbsPath('/') }),
      prompt: async () => {
        throw new DOMException('aborted', 'AbortError');
      },
      pushSession: (pushedSession) => pushed.push(pushedSession),
    });

    const { text, exitCode, lineCount } = syncResult(await su.execute(env, [], NO_FLAGS));

    expect(exitCode).toBe(130);
    expect(text).toBe('');
    expect(lineCount).toBe(0);
    expect(pushed).toEqual([]);
  });

  it('keys on the named row specifically, not just the first passwd row', async () => {
    // The first row is NOT root; typing root's password with `su` (default root)
    // must still elevate — proving the lookup matches the `root` field, not the
    // first line.
    const { env, pushed } = suEnv({ rootPassword: 'rootpw', typed: 'rootpw' });

    const { exitCode } = syncResult(await su.execute(env, [], NO_FLAGS));

    expect(exitCode).toBe(0);
    expect(pushed).toHaveLength(1);
    expect(pushed[0]).toMatchObject({ username: 'root', userType: 'root' });
  });

  it('su <user>: switches to another user (guest), pushing a guest session and moving to their home', async () => {
    const { env, pushed, cwds } = suEnv({ guestPassword: 'letmein', typed: 'letmein' });

    const { exitCode } = syncResult(await su.execute(env, ['guest'], NO_FLAGS));

    expect(exitCode).toBe(0);
    expect(pushed).toHaveLength(1);
    expect(pushed[0]).toMatchObject({ username: 'guest', userType: 'guest', kind: 'su' });
    expect(cwds).toEqual(['/home/guest']);
  });

  it('switches passwordless (no prompt) to a user with an empty password hash', async () => {
    // A guest climbing back to the password-less player account: empty hash ⇒
    // no password is required, so su must NOT prompt.
    const { env, pushed, cwds, promptCalls } = suEnv({ userName: 'neo', callerType: 'guest' });

    const { exitCode } = syncResult(await su.execute(env, ['neo'], NO_FLAGS));

    expect(promptCalls).toEqual([]);
    expect(exitCode).toBe(0);
    expect(pushed).toHaveLength(1);
    expect(pushed[0]).toMatchObject({ username: 'neo', userType: 'user' });
    expect(cwds).toEqual(['/home/neo']);
  });

  it('lets root switch to any user with NO password prompt', async () => {
    const { env, pushed, cwds, promptCalls } = suEnv({ callerType: 'root' });

    const { exitCode } = syncResult(await su.execute(env, ['guest'], NO_FLAGS));

    expect(promptCalls).toEqual([]);
    expect(exitCode).toBe(0);
    expect(pushed).toHaveLength(1);
    expect(pushed[0]).toMatchObject({ username: 'guest', userType: 'guest' });
    expect(cwds).toEqual(['/home/guest']);
  });

  it('lets a guest elevate to root with the correct root password (setuid-root read)', async () => {
    const { env, pushed } = suEnv({
      rootPassword: 'hunter2',
      typed: 'hunter2',
      callerType: 'guest',
    });

    const { exitCode } = syncResult(await su.execute(env, ['root'], NO_FLAGS));

    expect(exitCode).toBe(0);
    expect(pushed).toHaveLength(1);
    expect(pushed[0]).toMatchObject({ username: 'root', userType: 'root' });
  });

  it('reports a missing user without prompting or switching', async () => {
    const { env, pushed, cwds, promptCalls } = suEnv();

    const { text, exitCode } = syncResult(await su.execute(env, ['nobody'], NO_FLAGS));

    expect(text).toContain('su: user nobody does not exist');
    expect(exitCode).toBe(1);
    expect(promptCalls).toEqual([]);
    expect(pushed).toEqual([]);
    expect(cwds).toEqual([]);
  });

  it('reports "does not exist" when /etc/passwd is absent entirely', async () => {
    // No passwd file at all ⇒ setuid read yields nothing ⇒ no row matches.
    const env = mockCommandEnv({
      session: mockSession({ machineId: MACHINE, playerKey: PUBKEY, userType: 'user' }),
      fs: mockFsViewFromTree(buildDirectory({ etc: buildDirectory({}) }), {
        userType: 'user',
        cwd: () => asAbsPath('/'),
      }),
      prompt: async () => 'anything',
      pushSession: () => undefined,
    });

    const { text, exitCode } = syncResult(await su.execute(env, [], NO_FLAGS));

    expect(text).toContain('su: user root does not exist');
    expect(exitCode).toBe(1);
  });

  it('reports "does not exist" when /etc/passwd has no row for the target', async () => {
    const tree = buildDirectory({
      etc: buildDirectory({
        passwd: buildFile('neo::1000:1000::/home/neo:/bin/bash\n', {
          owner: 'root',
          perms: { read: ['root', 'user'] },
        }),
      }),
    });
    const env = mockCommandEnv({
      session: mockSession({ machineId: MACHINE, playerKey: PUBKEY, userType: 'user' }),
      fs: mockFsViewFromTree(tree, { userType: 'user', cwd: () => asAbsPath('/') }),
      prompt: async () => 'anything',
      pushSession: () => undefined,
    });

    const { text, exitCode } = syncResult(await su.execute(env, [], NO_FLAGS));

    expect(text).toContain('su: user root does not exist');
    expect(exitCode).toBe(1);
  });

  describe('auth logging (/var/log/auth.log)', () => {
    it('records a success event for the local machine on a switch (server stamps the line)', async () => {
      const { env, authLogs } = suEnv({ rootPassword: 'hunter2', typed: 'hunter2' });

      await su.execute(env, [], NO_FLAGS);

      expect(authLogs).toHaveLength(1);
      // The client sends only the EVENT — no timestamp/pid (the server stamps
      // those from its own UTC clock). It carries who switched to whom + where.
      expect(authLogs[0]).toEqual({
        machineId: MACHINE,
        targetUser: 'root',
        fromUser: 'neo',
        outcome: 'success',
        hostname: 'workstation',
      });
    });

    it('records a failure event on a wrong password', async () => {
      const { env, authLogs } = suEnv({ rootPassword: 'hunter2', typed: 'nope' });

      await su.execute(env, [], NO_FLAGS);

      expect(authLogs).toHaveLength(1);
      expect(authLogs[0]).toMatchObject({ outcome: 'failure', targetUser: 'root', fromUser: 'neo' });
    });

    it('records no-prompt switches too (root → guest)', async () => {
      const { env, authLogs } = suEnv({ callerType: 'root' });

      await su.execute(env, ['guest'], NO_FLAGS);

      expect(authLogs).toHaveLength(1);
      expect(authLogs[0]).toMatchObject({ outcome: 'success', targetUser: 'guest', fromUser: 'neo' });
    });

    it('does not log when the target user does not exist', async () => {
      const { env, authLogs } = suEnv();

      await su.execute(env, ['nobody'], NO_FLAGS);

      expect(authLogs).toEqual([]);
    });

    it('does not log when the prompt is cancelled (Ctrl-C)', async () => {
      const { authLogs } = suEnv();
      const tree = buildDirectory({
        etc: buildDirectory({
          passwd: buildFile(`root:${md5('toor')}:0:0:root:/root:/bin/bash\n`, {
            owner: 'root',
            perms: { read: ['root', 'user'] },
          }),
        }),
      });
      const env = mockCommandEnv({
        session: mockSession({ machineId: MACHINE, playerKey: PUBKEY, userType: 'user' }),
        fs: mockFsViewFromTree(tree, { userType: 'user', cwd: () => asAbsPath('/') }),
        prompt: async () => {
          throw new DOMException('aborted', 'AbortError');
        },
        pushSession: () => undefined,
        log: {
          appendAuthLog: async (event) => {
            authLogs.push(event);
          },
          appendAccessLog: async () => undefined,
        },
      });

      await su.execute(env, [], NO_FLAGS);

      expect(authLogs).toEqual([]);
    });
  });
});
