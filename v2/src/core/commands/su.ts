/**
 * su — switch user. Targets any account in `/etc/passwd` (defaulting to `root`
 * when no username is given, like real `su`). It reads the target's row,
 * derives the tier, and on success pushes a session for that user onto the hop
 * chain + moves to their home dir. `exit` pops back.
 *
 * `su` reads `/etc/passwd` at ROOT privilege — `env.fs.stat` resolves the raw
 * node, bypassing the CALLER's read perms — modelling a real setuid-root `su`
 * (which reads the password DB as root regardless of who invoked it). That is
 * what lets a guest, who cannot normally read passwd, still switch to another
 * account.
 *
 * Whether a password is required follows real `su`:
 *   - the caller is already root ⇒ no password (root may become anyone);
 *   - the target account has an empty hash ⇒ password-less, no prompt;
 *   - otherwise prompt (masked) via `env.prompt` — the GENERAL interactive-input
 *     primitive ssh/scp/ftp/mysql/redis reuse — and compare md5(typed) against
 *     the stored hash.
 * A wrong password is a single `Authentication failure` (never leaking which
 * check failed); an unknown username is `su: user <name> does not exist`.
 *
 * Tier derivation (uid 0 ⇒ root, the literal `guest` account ⇒ guest, everyone
 * else ⇒ user) mirrors how the workstation generator assigns tiers.
 */

import { asAbsPath, type AbsPath, type UserType } from '../types';
import { md5 } from '../generation/md5';
import { userTypeFromPasswdFields } from '../generation/passwdTier';
import { isCrossPlayerWorkstation } from '../network/crossPlayerHop';
import type { Command, CommandEnv, CommandResult, Session } from './types';

const PASSWD_PATH = asAbsPath('/etc/passwd');
const ROOT_HOME = asAbsPath('/root');
const DEFAULT_TARGET = 'root';

const failure = (): CommandResult => ({
  kind: 'sync',
  lines: [{ kind: 'error', content: 'su: Authentication failure' }],
  exitCode: 1,
});

const noSuchUser = (username: string): CommandResult => ({
  kind: 'sync',
  lines: [{ kind: 'error', content: `su: user ${username} does not exist` }],
  exitCode: 1,
});

type TargetUser = {
  readonly username: string;
  /** md5 hash from the passwd row, or '' for a password-less account. */
  readonly passwordHash: string;
  readonly userType: UserType;
  readonly home: AbsPath;
};

/** A user's home directory: `/root` for root, `/home/<name>` otherwise. Shared by
 *  the local passwd path and the cross-player elevation (which has no passwd row
 *  to read the home from — it derives it from the server-returned tier + name). */
const homeFor = (username: string, userType: UserType): AbsPath =>
  userType === 'root' ? ROOT_HOME : asAbsPath(`/home/${username}`);

/** The ESSID of the currently-associated `wlan0`, or null when not on a network —
 *  one input to the own/NPC vs cross-player-workstation routing decision. */
const currentEssid = (env: CommandEnv): string | null => {
  const wlan0 = env.network.interfaces().find((iface) => iface.name === 'wlan0');
  return wlan0 !== undefined && wlan0.kind === 'wireless' && wlan0.association !== null
    ? wlan0.association.essid
    : null;
};

/** Read `/etc/passwd` at ROOT privilege via `stat` (which resolves the raw node,
 *  bypassing the caller's read perms) — modelling a setuid-root `su`. Returns
 *  the file text, or '' when passwd is missing or not a file. */
const readPasswd = (env: CommandEnv): string => {
  const node = env.fs.stat(PASSWD_PATH);
  return node !== null && node.kind === 'file' ? node.content : '';
};

/** Parse the `/etc/passwd` row for `username` into the fields su needs, or null
 *  when no row matches. Row shape: `name:hash:uid:gid:gecos:home:shell`. */
const targetFrom = (passwd: string, username: string): TargetUser | null => {
  const row = passwd.split('\n').find((line) => line.split(':')[0] === username);
  if (row === undefined) return null;
  const fields = row.split(':');
  const passwordHash = fields[1] ?? '';
  const userType: UserType = userTypeFromPasswdFields(fields);
  return { username, passwordHash, userType, home: homeFor(username, userType) };
};

/** Record this switch to the local `/var/log/auth.log` — like real Linux /
 *  legacy `su`. Sends only the EVENT: the SERVER stamps the UTC timestamp and
 *  formats the syslog line, so a crafted request can't dictate game time (the
 *  clock the future CVE time-gating trusts). AWAITED: the append reconciles the
 *  local journal before resolving (see `wrapWithRefetch`), so an immediate
 *  `cat /var/log/auth.log` after the switch already shows the entry. Errors are
 *  swallowed — a logging hiccup must never break the switch itself. The append
 *  writes as the system (root), so even a guest's switch is recorded despite
 *  auth.log being root-owned. */
const logSwitch = async (
  env: CommandEnv,
  target: TargetUser,
  outcome: 'success' | 'failure',
): Promise<void> => {
  try {
    await env.log.appendAuthLog({
      machineId: env.session.machineId,
      targetUser: target.username,
      fromUser: env.session.username,
      outcome,
      hostname: env.hostname,
    });
  } catch {
    // best-effort: the switch has already happened; logging must not fail it.
  }
};

const sessionFor = (env: CommandEnv, target: TargetUser): Session => ({
  id: `su-${target.username}-${env.now()}`,
  playerKey: env.session.playerKey,
  machineId: env.session.machineId,
  username: target.username,
  userType: target.userType,
  kind: 'su',
  createdAt: env.now(),
});

/**
 * Cross-player `su`: B is standing on ANOTHER player's registered workstation (a
 * public-IP ssh hop). The local passwd path can't work here — the real
 * `/etc/passwd` isn't in the pruned served `env.fs`, AND a client-only switch
 * wouldn't authorize writes (the patch L2 reads the SERVER session row's tier, so
 * B would stay guest). So prompt, then let the server validate the typed password
 * against the owner's real passwd and persist the `kind:'su'` row; push the local
 * session ONLY on success, deriving the home from the server-returned tier. Any
 * rejection collapses to one `Authentication failure` (no leak of which check
 * failed). The server stamps the `su` auth.log trace on the foreign box (Story 6.3),
 * carrying `fromUser` so A's log reads "by <B's current user>"; the client never
 * writes that log itself.
 */
const elevateCrossPlayer = async (env: CommandEnv, targetName: string): Promise<CommandResult> => {
  let typed: string;
  try {
    typed = await env.prompt({ message: 'Password: ', masked: true });
  } catch {
    return { kind: 'sync', lines: [], exitCode: 130 };
  }

  const sessionId = `su-${targetName}-${env.now()}`;
  const result = await env.su.elevate({
    sessionId,
    machineId: env.session.machineId,
    username: targetName,
    password: typed,
    fromUser: env.session.username,
    parentSessionId: env.session.id,
    sourceIp: null,
  });
  if (!result.ok) return failure();

  env.pushSession({
    id: sessionId,
    playerKey: env.session.playerKey,
    machineId: env.session.machineId,
    username: targetName,
    userType: result.userType,
    kind: 'su',
    createdAt: env.now(),
  });
  env.setCwd(homeFor(targetName, result.userType));
  return { kind: 'sync', lines: [], exitCode: 0 };
};

const execute: Command['execute'] = async (env, args) => {
  const targetName = args[0] ?? DEFAULT_TARGET;

  // On another player's registered box, switch user is server-authoritative (see
  // `elevateCrossPlayer`). Own box + NPC LAN hops read the local passwd as before.
  if (
    isCrossPlayerWorkstation({
      machineId: env.session.machineId,
      publicKeyHex: env.identity.publicKeyHex,
      essid: currentEssid(env),
    })
  ) {
    return elevateCrossPlayer(env, targetName);
  }

  const target = targetFrom(readPasswd(env), targetName);
  if (target === null) return noSuchUser(targetName);

  // Root may switch to anyone without a password; a password-less account
  // (empty hash) needs none either. Otherwise prompt + validate.
  const needsPassword = env.session.userType !== 'root' && target.passwordHash !== '';
  if (needsPassword) {
    let typed: string;
    try {
      typed = await env.prompt({ message: 'Password: ', masked: true });
    } catch {
      return { kind: 'sync', lines: [], exitCode: 130 };
    }
    if (md5(typed) !== target.passwordHash) {
      await logSwitch(env, target, 'failure');
      return failure();
    }
  }

  env.pushSession(sessionFor(env, target));
  env.setCwd(target.home);
  await logSwitch(env, target, 'success');
  return { kind: 'sync', lines: [], exitCode: 0 };
};

export const su: Command = {
  name: 'su',
  description: 'Switch user',
  category: 'general',
  tier: 'guest',
  availability: { kind: 'localhost-only' },
  manual: {
    synopsis: 'su [username]',
    description:
      'Switch to another user account (defaults to root when no username is given). ' +
      'Prompts for the target account’s password unless you are already root, or the ' +
      'account has no password set. On success you get that user’s shell and home ' +
      'directory; use "exit" to drop back.',
    arguments: [
      {
        name: 'username',
        description: 'The account to switch to (e.g. "root", "guest"). Defaults to root.',
      },
    ],
    examples: [
      { command: 'su', description: 'Become root after entering the root password' },
      { command: 'su guest', description: 'Switch to the guest account' },
    ],
  },
  execute,
};
