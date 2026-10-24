import { describe, expect, it } from 'vitest';
import { md5 } from '../generation/md5.js';
import { buildDirectory, buildFile } from '../../test/factories/filesystem.js';
import {
  mockCommandEnv,
  mockFsViewFromTree,
  mockIdentity,
  mockLogApi,
  mockPatchApi,
  mockSession,
} from '../../test/factories/commandEnv.js';
import type { PasswdChangeParams, PasswdChangeResult } from './types.js';
import { computeWorkstationId } from '../identity/workstation.js';
import {
  asAbsPath,
  asEpochMs,
  asMachineId,
  asPlayerKeyHex,
  type AbsPath,
  type UserType,
} from '../types.js';
import type { AuthLogEvent, CommandResult, PatchResult } from './types.js';
import type { FilePermissions } from '../filesystem/types.js';
import { passwd } from './passwd.js';

/**
 * `passwd` rewrites an account's md5 hash in `/etc/passwd` — the write-mirror of
 * `su`. On the player's own workstation a caller may change their own account at
 * any tier, but changing a NAMED account other than their own requires root. The
 * privilege check happens up front, before any prompt: the client knows its own
 * tier, so prompting a user who cannot proceed is pointless.
 */

const NO_FLAGS = new Map<string, string | true>();
const PUBKEY = asPlayerKeyHex('a'.repeat(64));
// The player's own workstation: the one box `passwd` answers for without the server.
const MACHINE = asMachineId(computeWorkstationId('rig', PUBKEY));

// The password the default caller account ("neo") is born with, so a test can type
// the right current password without re-deriving the hash.
const CALLER_PASSWORD = 'neopw';

// The three masked prompts `passwd` shows, in the order a non-root own-change hits them.
const CURRENT_PROMPT = 'Current password: ';
const NEW_PROMPT = 'New password: ';
const RETYPE_PROMPT = 'Retype new password: ';

type PromptCall = { readonly message: string; readonly masked: boolean };

type CapturedWrite = {
  readonly path: AbsPath;
  readonly content: string;
  readonly baseContent: string | undefined;
  readonly owner: string | undefined;
  readonly permissions: FilePermissions | undefined;
};

type PasswdEnvOpts = {
  /** The account the caller session is sitting as. Defaults to a user "neo". */
  readonly callerName?: string;
  /** The tier of the session running `passwd` (the caller). Defaults to user. */
  readonly callerType?: UserType;
  /** The caller account's stored hash. Defaults to `md5(CALLER_PASSWORD)`; pass ''
   *  for a password-less account (an empty-hash guest). */
  readonly callerHash?: string;
  /** The network of the box `passwd` runs on — null for the player's own workstation. */
  readonly essid?: string | null;
  /** What each masked prompt returns, keyed by its exact message. An unlisted prompt
   *  returns '' — the empty string a stray Enter would produce. */
  readonly promptResponses?: Readonly<Record<string, string>>;
  /** The message of a prompt that the player cancels (Ctrl-C): the spy throws there,
   *  as the real masked prompt rejects on abort. */
  readonly abortPromptMessage?: string;
  /** What the `/etc/passwd` write resolves to. Defaults to a clean success. */
  readonly writeResult?: PatchResult;
  /** Make the auth.log append reject, to prove the change does not hinge on it. */
  readonly authLogThrows?: boolean;
  /** The hashes the box holds when `passwd` re-reads it: somebody who rooted the box
   *  changed them after this terminal last read it. Absent, a re-read hands back the
   *  same tree — a box nobody else is writing. */
  readonly reloaded?: { readonly rootHash?: string; readonly callerHash?: string };
};

/** Build an env around a realistic `/etc/passwd` (root with a password, the
 *  caller's own account, guest with a password) on the player's OWN workstation.
 *  Returns the env plus a prompt spy and a capture of every `/etc/passwd` write, so
 *  a test can prove which prompts were shown and exactly what was (or was not) written. */
const passwdEnv = (opts: PasswdEnvOpts = {}) => {
  const callerName = opts.callerName ?? 'neo';
  const callerType = opts.callerType ?? 'user';
  const callerHash = opts.callerHash ?? md5(CALLER_PASSWORD);
  const promptResponses = opts.promptResponses ?? {};
  const promptCalls: PromptCall[] = [];
  const writes: CapturedWrite[] = [];
  const authLogEvents: AuthLogEvent[] = [];

  const treeWith = (hashes: { readonly rootHash: string; readonly callerHash: string }) =>
    buildDirectory({
      etc: buildDirectory({
        passwd: buildFile(
          `root:${hashes.rootHash}:0:0:root:/root:/bin/bash\n` +
            `${callerName}:${hashes.callerHash}:1000:1000::/home/${callerName}:/bin/bash\n` +
            `guest:${md5('guestpw')}:1001:1001:guest:/home/guest:/bin/bash\n`,
          { owner: 'root', perms: { read: ['root', 'user'] } },
        ),
      }),
    });
  const born = { rootHash: md5('toor1234'), callerHash };
  const tree = treeWith(born);
  const reloaded = opts.reloaded;

  const env = mockCommandEnv({
    identity: mockIdentity({ publicKeyHex: PUBKEY }),
    session: mockSession({
      machineId: MACHINE,
      playerKey: PUBKEY,
      username: callerName,
      userType: callerType,
      essid: opts.essid ?? null,
    }),
    fs: mockFsViewFromTree(tree, {
      userType: callerType,
      cwd: () => asAbsPath('/'),
      ...(reloaded === undefined
        ? {}
        : { onReload: async () => treeWith({ ...born, ...reloaded }) }),
    }),
    now: () => asEpochMs(123),
    prompt: async (promptOpts) => {
      promptCalls.push(promptOpts);
      if (promptOpts.message === opts.abortPromptMessage) {
        throw new Error('prompt cancelled');
      }
      return promptResponses[promptOpts.message] ?? '';
    },
    patches: mockPatchApi({
      write: async (path, content, options) => {
        writes.push({
          path,
          content,
          baseContent: options?.baseContent,
          owner: options?.owner,
          permissions: options?.permissions,
        });
        return opts.writeResult ?? { ok: true };
      },
    }),
    log: {
      ...mockLogApi(),
      appendAuthLog: async (event) => {
        if (opts.authLogThrows) throw new Error('auth.log unreachable');
        authLogEvents.push(event);
      },
    },
  });

  return { env, promptCalls, writes, authLogEvents };
};

// A box that is NOT the player's own workstation — a `passwd` here is answered by the
// server, never composed locally (the foreign box's /etc/passwd is not the browser's to
// read, exactly as `su` elsewhere is the server's to judge).
const FOREIGN = asMachineId('skylab-deadbeef');

type ChangeCall = PasswdChangeParams;

type ForeignEnvOpts = {
  /** The tier of the session running `passwd`. Defaults to root (the only tier that may). */
  readonly callerType?: UserType;
  /** The account the caller session is sitting as on the foreign box. Defaults to guest. */
  readonly callerName?: string;
  readonly promptResponses?: Readonly<Record<string, string>>;
  readonly abortPromptMessage?: string;
  /** What `env.passwd.change` resolves to. Defaults to a clean success. */
  readonly changeResult?: PasswdChangeResult;
};

/** Build an env standing on a FOREIGN box (not the player's own workstation), with a
 *  spy on the server-side `change` seam so a test can prove exactly what crossed the wire
 *  — and that nothing did when the command refused before reaching it. */
const foreignPasswdEnv = (opts: ForeignEnvOpts = {}) => {
  const promptResponses = opts.promptResponses ?? {};
  const promptCalls: PromptCall[] = [];
  const changeCalls: ChangeCall[] = [];

  const env = mockCommandEnv({
    identity: mockIdentity({ publicKeyHex: PUBKEY }),
    session: mockSession({
      machineId: FOREIGN,
      playerKey: PUBKEY,
      username: opts.callerName ?? 'guest',
      userType: opts.callerType ?? 'root',
      essid: 'BEAN-THERE-WIFI',
    }),
    now: () => asEpochMs(123),
    prompt: async (promptOpts) => {
      promptCalls.push(promptOpts);
      if (promptOpts.message === opts.abortPromptMessage) {
        throw new Error('prompt cancelled');
      }
      return promptResponses[promptOpts.message] ?? '';
    },
    passwd: {
      change: async (params) => {
        changeCalls.push(params);
        return opts.changeResult ?? { ok: true };
      },
    },
  });

  return { env, promptCalls, changeCalls };
};

const syncResult = (
  result: CommandResult,
): { readonly text: string; readonly exitCode: number } => {
  if (result.kind !== 'sync') throw new Error('sync expected');
  return {
    text: result.lines.map((line) => line.content).join('\n'),
    exitCode: result.exitCode,
  };
};

describe('passwd', () => {
  it('declares a surface that gates it to the local box, any tier, and an interactive terminal', () => {
    // These fields are the command's contract with the shell runner: a password change
    // happens only on the box you are sitting on (`localhost-only`), is reachable by any
    // tier that can open a shell (`guest`), and — depending on masked prompts — refuses in
    // a script or without a TTY rather than hanging on a prompt that can never be answered.
    expect(passwd.availability).toEqual({ kind: 'localhost-only' });
    expect(passwd.tier).toBe('guest');
    expect(passwd.withoutTty).toContain('terminal');
    expect(passwd.withoutScript).toContain('script');
  });

  it('refuses a user changing another account up front, before any prompt', async () => {
    const { env, promptCalls } = passwdEnv({ callerName: 'neo', callerType: 'user' });

    const { text, exitCode } = syncResult(await passwd.execute(env, ['root'], NO_FLAGS));

    expect(text).toContain("passwd: you may not change the password for 'root'");
    expect(exitCode).toBe(1);
    // Up-front refusal: the user is never asked for a password they cannot use.
    expect(promptCalls).toEqual([]);
  });

  it('reports an unknown account for a root caller naming a nonexistent user', async () => {
    // Root passes the privilege check, so the command reaches /etc/passwd and
    // finds no row for "ghost".
    const { env, promptCalls } = passwdEnv({ callerType: 'root' });

    const { text, exitCode } = syncResult(await passwd.execute(env, ['ghost'], NO_FLAGS));

    expect(text).toContain("passwd: user 'ghost' does not exist");
    expect(exitCode).toBe(1);
    expect(promptCalls).toEqual([]);
  });

  it('rejects a wrong current password from a non-root caller and writes nothing', async () => {
    // A user changing their OWN account is asked for the current password first and
    // must get it right — exactly as `su` compares md5(typed) to the stored hash.
    const { env, promptCalls, writes } = passwdEnv({
      callerName: 'neo',
      callerType: 'user',
      promptResponses: { [CURRENT_PROMPT]: 'not-the-password' },
    });

    const { text, exitCode } = syncResult(await passwd.execute(env, [], NO_FLAGS));

    expect(promptCalls).toEqual([{ message: CURRENT_PROMPT, masked: true }]);
    expect(text).toContain('passwd: Authentication failure');
    expect(exitCode).toBe(1);
    // A failed check must not touch /etc/passwd.
    expect(writes).toEqual([]);
  });

  it('writes the new hash and reports success when a user changes their own password', async () => {
    const { env, promptCalls, writes } = passwdEnv({
      callerName: 'neo',
      callerType: 'user',
      promptResponses: {
        [CURRENT_PROMPT]: CALLER_PASSWORD,
        [NEW_PROMPT]: 'freshpw',
        [RETYPE_PROMPT]: 'freshpw',
      },
    });

    const { text, exitCode } = syncResult(await passwd.execute(env, [], NO_FLAGS));

    // Current, then new, then retype — all masked.
    expect(promptCalls).toEqual([
      { message: CURRENT_PROMPT, masked: true },
      { message: NEW_PROMPT, masked: true },
      { message: RETYPE_PROMPT, masked: true },
    ]);
    expect(text).toContain('passwd: password updated successfully');
    expect(exitCode).toBe(0);

    expect(writes).toHaveLength(1);
    const write = writes[0];
    expect(write.path).toBe(asAbsPath('/etc/passwd'));
    // Row integrity: only neo's field 2 (the hash) changes; every other field and
    // every other row is preserved byte-for-byte.
    expect(write.content).toBe(
      `root:${md5('toor1234')}:0:0:root:/root:/bin/bash\n` +
        `neo:${md5('freshpw')}:1000:1000::/home/neo:/bin/bash\n` +
        `guest:${md5('guestpw')}:1001:1001:guest:/home/guest:/bin/bash\n`,
    );
    // baseContent is the file the rewrite was composed against — the guard against a
    // second writer having changed /etc/passwd underneath us.
    expect(write.baseContent).toBe(
      `root:${md5('toor1234')}:0:0:root:/root:/bin/bash\n` +
        `neo:${md5(CALLER_PASSWORD)}:1000:1000::/home/neo:/bin/bash\n` +
        `guest:${md5('guestpw')}:1001:1001:guest:/home/guest:/bin/bash\n`,
    );
  });

  it('aborts with a mismatch message when the two new passwords differ, writing nothing', async () => {
    const { env, writes } = passwdEnv({
      callerName: 'neo',
      callerType: 'user',
      promptResponses: {
        [CURRENT_PROMPT]: CALLER_PASSWORD,
        [NEW_PROMPT]: 'alpha',
        [RETYPE_PROMPT]: 'beta',
      },
    });

    const { text, exitCode } = syncResult(await passwd.execute(env, [], NO_FLAGS));

    expect(text).toContain('passwd: Sorry, passwords do not match');
    expect(exitCode).toBe(1);
    expect(writes).toEqual([]);
  });

  it('rejects an empty new password, writing nothing', async () => {
    // An empty hash means a password-less account in this engine, so a stray Enter
    // must not silently strip the account's password.
    const { env, writes } = passwdEnv({
      callerName: 'neo',
      callerType: 'user',
      promptResponses: {
        [CURRENT_PROMPT]: CALLER_PASSWORD,
        [NEW_PROMPT]: '',
        [RETYPE_PROMPT]: '',
      },
    });

    const { text, exitCode } = syncResult(await passwd.execute(env, [], NO_FLAGS));

    expect(text).toContain('passwd: No password supplied');
    expect(exitCode).toBe(1);
    expect(writes).toEqual([]);
  });

  it('skips the current-password prompt when the account is password-less', async () => {
    // An empty hash has no current password to prove — mirroring su, the prompt is
    // skipped, or md5(anything) could never match '' and the change would be impossible.
    const { env, promptCalls, writes } = passwdEnv({
      callerName: 'neo',
      callerType: 'user',
      callerHash: '',
      promptResponses: {
        [NEW_PROMPT]: 'firstpw',
        [RETYPE_PROMPT]: 'firstpw',
      },
    });

    const { exitCode } = syncResult(await passwd.execute(env, [], NO_FLAGS));

    // No "Current password:" — straight to setting a new one.
    expect(promptCalls).toEqual([
      { message: NEW_PROMPT, masked: true },
      { message: RETYPE_PROMPT, masked: true },
    ]);
    expect(exitCode).toBe(0);
    expect(writes).toHaveLength(1);
    expect(writes[0].content).toContain(`neo:${md5('firstpw')}:1000:1000::/home/neo:/bin/bash`);
  });

  it('reports a stale /etc/passwd when the write is refused as modified since open', async () => {
    // A second writer touched /etc/passwd between our read and our write, so the
    // typed password is discarded and the player re-runs rather than clobbering them.
    const { env } = passwdEnv({
      callerName: 'neo',
      callerType: 'user',
      promptResponses: {
        [CURRENT_PROMPT]: CALLER_PASSWORD,
        [NEW_PROMPT]: 'freshpw',
        [RETYPE_PROMPT]: 'freshpw',
      },
      writeResult: { ok: false, error: 'modified_since_open' },
    });

    const { text, exitCode } = syncResult(await passwd.execute(env, [], NO_FLAGS));

    expect(text).toContain('passwd: /etc/passwd changed underneath you — try again');
    expect(exitCode).toBe(1);
  });

  it('reports an I/O error when the write fails to reach the server', async () => {
    const { env } = passwdEnv({
      callerName: 'neo',
      callerType: 'user',
      promptResponses: {
        [CURRENT_PROMPT]: CALLER_PASSWORD,
        [NEW_PROMPT]: 'freshpw',
        [RETYPE_PROMPT]: 'freshpw',
      },
      writeResult: { ok: false, error: 'network_error' },
    });

    const { text, exitCode } = syncResult(await passwd.execute(env, [], NO_FLAGS));

    expect(text).toContain('passwd: I/O error');
    expect(exitCode).toBe(1);
  });

  it('aborts with exit 130 and writes nothing when the current-password prompt is cancelled', async () => {
    const { env, promptCalls, writes } = passwdEnv({
      callerName: 'neo',
      callerType: 'user',
      abortPromptMessage: CURRENT_PROMPT,
    });

    const result = await passwd.execute(env, [], NO_FLAGS);

    // Exit 130 (SIGINT), like a cancelled `su` prompt — nothing is written, nothing is
    // printed (not one line), and no further prompt is shown after the cancel.
    expect(result).toEqual({ kind: 'sync', lines: [], exitCode: 130 });
    expect(writes).toEqual([]);
    expect(promptCalls).toEqual([{ message: CURRENT_PROMPT, masked: true }]);
  });

  it('aborts with exit 130 and writes nothing when the RETYPE prompt is cancelled', async () => {
    // Cancelling the second new-password entry must behave exactly like cancelling the
    // first: the typed new password is discarded, nothing is written, nothing printed.
    const { env, promptCalls, writes } = passwdEnv({
      callerName: 'neo',
      callerType: 'user',
      promptResponses: {
        [CURRENT_PROMPT]: CALLER_PASSWORD,
        [NEW_PROMPT]: 'freshpw',
      },
      abortPromptMessage: RETYPE_PROMPT,
    });

    const result = await passwd.execute(env, [], NO_FLAGS);

    // Exactly as the current-password cancel: exit 130, not one line printed, nothing written.
    expect(result).toEqual({ kind: 'sync', lines: [], exitCode: 130 });
    expect(writes).toEqual([]);
    // All three prompts were reached, in order, before the cancel ended it.
    expect(promptCalls).toEqual([
      { message: CURRENT_PROMPT, masked: true },
      { message: NEW_PROMPT, masked: true },
      { message: RETYPE_PROMPT, masked: true },
    ]);
  });

  it('lets root change another account without proving a password', async () => {
    const { env, promptCalls, writes } = passwdEnv({
      callerName: 'neo',
      callerType: 'root',
      promptResponses: {
        [NEW_PROMPT]: 'rootset',
        [RETYPE_PROMPT]: 'rootset',
      },
    });

    const { exitCode } = syncResult(await passwd.execute(env, ['guest'], NO_FLAGS));

    // Root is never asked for a current password — straight to the new one.
    expect(promptCalls).toEqual([
      { message: NEW_PROMPT, masked: true },
      { message: RETYPE_PROMPT, masked: true },
    ]);
    expect(exitCode).toBe(0);
    expect(writes).toHaveLength(1);
    expect(writes[0].content).toContain(
      `guest:${md5('rootset')}:1001:1001:guest:/home/guest:/bin/bash`,
    );
  });

  // Whoever roots the player's box can change its passwords, and nothing pushes that
  // change to a terminal already open on it, so both the check and the rewrite have to
  // be made against the box as it stands.
  it('refuses a current password that was replaced since this terminal last read the box', async () => {
    const { env, writes } = passwdEnv({
      callerName: 'neo',
      callerType: 'user',
      reloaded: { callerHash: md5('lockedout') },
      promptResponses: {
        [CURRENT_PROMPT]: CALLER_PASSWORD,
        [NEW_PROMPT]: 'freshpw',
        [RETYPE_PROMPT]: 'freshpw',
      },
    });

    const { text, exitCode } = syncResult(await passwd.execute(env, [], NO_FLAGS));

    expect(text).toContain('passwd: Authentication failure');
    expect(exitCode).toBe(1);
    expect(writes).toEqual([]);
  });

  it('composes the rewrite against the box as it stands, keeping a change made since', async () => {
    const { env, writes } = passwdEnv({
      callerName: 'neo',
      callerType: 'root',
      reloaded: { rootHash: md5('lockedout') },
      promptResponses: {
        [NEW_PROMPT]: 'rootset',
        [RETYPE_PROMPT]: 'rootset',
      },
    });

    const { exitCode } = syncResult(await passwd.execute(env, ['guest'], NO_FLAGS));

    expect(exitCode).toBe(0);
    const asItStands =
      `root:${md5('lockedout')}:0:0:root:/root:/bin/bash\n` +
      `neo:${md5(CALLER_PASSWORD)}:1000:1000::/home/neo:/bin/bash\n`;
    expect(writes).toMatchObject([
      {
        path: asAbsPath('/etc/passwd'),
        content: `${asItStands}guest:${md5('rootset')}:1001:1001:guest:/home/guest:/bin/bash\n`,
        baseContent: `${asItStands}guest:${md5('guestpw')}:1001:1001:guest:/home/guest:/bin/bash\n`,
      },
    ]);
  });

  // The write would otherwise be stamped with the caller's own name and the defaults
  // of the caller's tier: a user changing their own password would leave the file
  // theirs, writable by the user tier, and anyone holding a user shell on the box
  // could then rewrite root's line.
  it.each<UserType>(['user', 'root'])(
    'leaves /etc/passwd root-owned and writable by root alone when a %s changes a password',
    async (callerType) => {
      const { env, writes } = passwdEnv({
        callerName: 'neo',
        callerType,
        promptResponses: {
          [CURRENT_PROMPT]: CALLER_PASSWORD,
          [NEW_PROMPT]: 'freshpw',
          [RETYPE_PROMPT]: 'freshpw',
        },
      });

      const { exitCode } = syncResult(await passwd.execute(env, [], NO_FLAGS));

      expect(exitCode).toBe(0);
      expect(writes.map(({ owner, permissions }) => ({ owner, permissions }))).toEqual([
        {
          owner: 'root',
          permissions: { read: ['root', 'user'], write: ['root'], execute: ['root'] },
        },
      ]);
    },
  );

  it('records a passwd auth.log line for the changed account on success', async () => {
    const { env, authLogEvents } = passwdEnv({
      callerName: 'neo',
      callerType: 'user',
      promptResponses: {
        [CURRENT_PROMPT]: CALLER_PASSWORD,
        [NEW_PROMPT]: 'freshpw',
        [RETYPE_PROMPT]: 'freshpw',
      },
    });

    await passwd.execute(env, [], NO_FLAGS);

    // The server stamps time + pid; the client names only the event.
    expect(authLogEvents).toEqual([
      { kind: 'passwdChange', machineId: MACHINE, targetUser: 'neo', hostname: 'workstation' },
    ]);
  });

  it('writes no auth.log line when the change is refused', async () => {
    const { env, authLogEvents } = passwdEnv({
      callerName: 'neo',
      callerType: 'user',
      promptResponses: { [CURRENT_PROMPT]: 'not-the-password' },
    });

    await passwd.execute(env, [], NO_FLAGS);

    // Success only: the lone failure is the owner fumbling their own password.
    expect(authLogEvents).toEqual([]);
  });

  it('still reports success when the auth.log append fails', async () => {
    const { env, writes } = passwdEnv({
      callerName: 'neo',
      callerType: 'user',
      promptResponses: {
        [CURRENT_PROMPT]: CALLER_PASSWORD,
        [NEW_PROMPT]: 'freshpw',
        [RETYPE_PROMPT]: 'freshpw',
      },
      authLogThrows: true,
    });

    const { text, exitCode } = syncResult(await passwd.execute(env, [], NO_FLAGS));

    // Best-effort, like su's logging: the password has already changed, so a logging
    // hiccup must not fail the change.
    expect(exitCode).toBe(0);
    expect(text).toContain('passwd: password updated successfully');
    expect(writes).toHaveLength(1);
  });

  describe('on a foreign box', () => {
    it('refuses any passwd from a non-root caller, before any prompt or server call', async () => {
      // A foreign box is nobody's to change but root's (decision 2): the server enforces
      // it (L2), but the client knows its own tier, so it refuses before a wasted prompt.
      const { env, promptCalls, changeCalls } = foreignPasswdEnv({
        callerType: 'user',
        callerName: 'neo',
      });

      const { text, exitCode } = syncResult(await passwd.execute(env, ['root'], NO_FLAGS));

      expect(text).toContain('passwd: you need root to change passwords on this machine');
      expect(exitCode).toBe(1);
      expect(promptCalls).toEqual([]);
      expect(changeCalls).toEqual([]);
    });

    it('lets root change an account through the server, with no current-password prompt', async () => {
      // Root is never asked for a current password — on a foreign box there is nobody's
      // old password to prove, only a new one to set. The plaintext is md5'd client-side
      // so only the hash crosses the wire.
      const { env, promptCalls, changeCalls } = foreignPasswdEnv({
        callerType: 'root',
        promptResponses: { [NEW_PROMPT]: 'lockout', [RETYPE_PROMPT]: 'lockout' },
      });

      const { text, exitCode } = syncResult(await passwd.execute(env, ['root'], NO_FLAGS));

      expect(promptCalls).toEqual([
        { message: NEW_PROMPT, masked: true },
        { message: RETYPE_PROMPT, masked: true },
      ]);
      expect(changeCalls).toEqual([
        { machineId: FOREIGN, username: 'root', newHash: md5('lockout') },
      ]);
      expect(text).toContain('passwd: password updated successfully');
      expect(exitCode).toBe(0);
    });

    it('targets the caller’s own foreign account when no username is given', async () => {
      const { env, changeCalls } = foreignPasswdEnv({
        callerType: 'root',
        callerName: 'root',
        promptResponses: { [NEW_PROMPT]: 'x', [RETYPE_PROMPT]: 'x' },
      });

      await passwd.execute(env, [], NO_FLAGS);

      expect(changeCalls[0]?.username).toBe('root');
    });

    it('rejects an empty new password without ever calling the server', async () => {
      const { env, changeCalls } = foreignPasswdEnv({
        callerType: 'root',
        promptResponses: { [NEW_PROMPT]: '', [RETYPE_PROMPT]: '' },
      });

      const { text, exitCode } = syncResult(await passwd.execute(env, ['root'], NO_FLAGS));

      expect(text).toContain('passwd: No password supplied');
      expect(exitCode).toBe(1);
      expect(changeCalls).toEqual([]);
    });

    it('aborts on a mismatch without ever calling the server', async () => {
      const { env, changeCalls } = foreignPasswdEnv({
        callerType: 'root',
        promptResponses: { [NEW_PROMPT]: 'alpha', [RETYPE_PROMPT]: 'beta' },
      });

      const { text, exitCode } = syncResult(await passwd.execute(env, ['root'], NO_FLAGS));

      expect(text).toContain('passwd: Sorry, passwords do not match');
      expect(exitCode).toBe(1);
      expect(changeCalls).toEqual([]);
    });

    it('reports an unknown account when the server has no such row', async () => {
      const { env } = foreignPasswdEnv({
        callerType: 'root',
        promptResponses: { [NEW_PROMPT]: 'x', [RETYPE_PROMPT]: 'x' },
        changeResult: { ok: false, error: 'user_not_found' },
      });

      const { text, exitCode } = syncResult(await passwd.execute(env, ['ghost'], NO_FLAGS));

      expect(text).toContain("passwd: user 'ghost' does not exist");
      expect(exitCode).toBe(1);
    });

    it('reports an I/O error when the change cannot reach the server', async () => {
      const { env } = foreignPasswdEnv({
        callerType: 'root',
        promptResponses: { [NEW_PROMPT]: 'x', [RETYPE_PROMPT]: 'x' },
        changeResult: { ok: false, error: 'network_error' },
      });

      const { text, exitCode } = syncResult(await passwd.execute(env, ['root'], NO_FLAGS));

      expect(text).toContain('passwd: I/O error');
      expect(exitCode).toBe(1);
    });

    it('reports the root requirement when the server refuses a lapsed session', async () => {
      // The up-front check already caught the common case; this is the race where the
      // session dropped below root between the check and the call, and L2 refused.
      const { env } = foreignPasswdEnv({
        callerType: 'root',
        promptResponses: { [NEW_PROMPT]: 'x', [RETYPE_PROMPT]: 'x' },
        changeResult: { ok: false, error: 'not_authorized' },
      });

      const { text, exitCode } = syncResult(await passwd.execute(env, ['root'], NO_FLAGS));

      expect(text).toContain('passwd: you need root to change passwords on this machine');
      expect(exitCode).toBe(1);
    });

    it('aborts with exit 130 on a cancelled prompt, without ever calling the server', async () => {
      const { env, changeCalls } = foreignPasswdEnv({
        callerType: 'root',
        abortPromptMessage: NEW_PROMPT,
      });

      const { exitCode } = syncResult(await passwd.execute(env, ['root'], NO_FLAGS));

      expect(exitCode).toBe(130);
      expect(changeCalls).toEqual([]);
    });
  });
});
