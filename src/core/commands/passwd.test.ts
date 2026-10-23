import { describe, expect, it } from 'vitest';
import { md5 } from '../generation/md5.js';
import { buildDirectory, buildFile } from '../../test/factories/filesystem.js';
import {
  mockCommandEnv,
  mockFsViewFromTree,
  mockIdentity,
  mockSession,
} from '../../test/factories/commandEnv.js';
import { computeWorkstationId } from '../identity/workstation.js';
import { asAbsPath, asEpochMs, asMachineId, asPlayerKeyHex, type UserType } from '../types.js';
import type { CommandResult } from './types.js';
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

type PromptCall = { readonly message: string; readonly masked: boolean };

type PasswdEnvOpts = {
  /** The account the caller session is sitting as. Defaults to a user "neo". */
  readonly callerName?: string;
  /** The tier of the session running `passwd` (the caller). Defaults to user. */
  readonly callerType?: UserType;
  /** The network of the box `passwd` runs on — null for the player's own workstation. */
  readonly essid?: string | null;
};

/** Build an env around a realistic `/etc/passwd` (root with a password, the
 *  caller's own user, guest with a password) on the player's OWN workstation,
 *  with a prompt spy so a test can prove no prompt was shown. */
const passwdEnv = (opts: PasswdEnvOpts = {}) => {
  const callerName = opts.callerName ?? 'neo';
  const callerType = opts.callerType ?? 'user';
  const promptCalls: PromptCall[] = [];

  const tree = buildDirectory({
    etc: buildDirectory({
      passwd: buildFile(
        `root:${md5('toor1234')}:0:0:root:/root:/bin/bash\n` +
          `${callerName}:${md5('neopw')}:1000:1000::/home/${callerName}:/bin/bash\n` +
          `guest:${md5('guestpw')}:1001:1001:guest:/home/guest:/bin/bash\n`,
        { owner: 'root', perms: { read: ['root', 'user'] } },
      ),
    }),
  });

  const env = mockCommandEnv({
    identity: mockIdentity({ publicKeyHex: PUBKEY }),
    session: mockSession({
      machineId: MACHINE,
      playerKey: PUBKEY,
      username: callerName,
      userType: callerType,
      essid: opts.essid ?? null,
    }),
    fs: mockFsViewFromTree(tree, { userType: callerType, cwd: () => asAbsPath('/') }),
    now: () => asEpochMs(123),
    prompt: async (promptOpts) => {
      promptCalls.push(promptOpts);
      return '';
    },
  });

  return { env, promptCalls };
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
});
