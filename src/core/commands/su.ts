/**
 * su — switch user. Targets any account in `/etc/passwd` (defaulting to `root`
 * when no username is given, like real `su`). On success it pushes a session for
 * that user onto the hop chain + moves to their home dir. `exit` pops back.
 *
 * Who answers depends on whose box it is:
 *
 * On the player's OWN workstation the command answers itself. It reads
 * `/etc/passwd` at ROOT privilege — `env.fs.stat` resolves the raw node, bypassing
 * the CALLER's read perms — modelling a real setuid-root `su` (which reads the
 * password DB as root regardless of who invoked it). That is what lets a guest,
 * who cannot normally read passwd, still switch to another account.
 *
 * On any other box the server answers (see `elevateThroughServer`): the file is not
 * the browser's to read there, and only a session row the server wrote moves the
 * tier the player's writes are judged at.
 *
 * Whether a password is required follows real `su`:
 *   - the caller is already root ⇒ no password (root may become anyone);
 *   - the target account has an empty hash ⇒ password-less, no prompt (own box
 *     only: elsewhere the server refuses such an account to anyone but root);
 *   - otherwise prompt (masked) via `env.prompt` — the GENERAL interactive-input
 *     primitive ssh/scp/ftp/mysql/redis reuse — and compare md5(typed) against
 *     the stored hash.
 * A wrong password is a single `Authentication failure` (never leaking which
 * check failed); an unknown username is `su: user <name> does not exist` on the
 * own box, and the same `Authentication failure` anywhere else.
 *
 * Tier derivation (uid 0 ⇒ root, the literal `guest` account ⇒ guest, everyone
 * else ⇒ user) mirrors how the workstation generator assigns tiers.
 */

import { asAbsPath, type AbsPath, type UserType } from '../types.js';
import { md5 } from '../generation/md5.js';
import { userTypeFromPasswdFields } from '../generation/passwdTier.js';
import { isOwnWorkstation } from '../identity/workstation.js';
import type { Command, CommandEnv, CommandResult, Session } from './types.js';
import { homeDirectory } from '../sessions/homeDirectory.js';

const PASSWD_PATH = asAbsPath('/etc/passwd');
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
  return { username, passwordHash, userType, home: homeDirectory({ username, userType }) };
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
      kind: 'suSwitch',
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
  // The user changes, not the box: an su stands exactly where the shell beneath it did.
  essid: env.session.essid,
});

/**
 * `su` on a box that is not the player's own: another player's workstation, the
 * access point's gateway, a machine the network generates. The local passwd path
 * can't work here — the box's `/etc/passwd` is not the browser's to read, AND a
 * client-only switch wouldn't authorize writes (the server judges a write at the
 * tier of the SERVER session row, so the player would stay where they were). So the
 * server validates the typed password against the box's real passwd and persists
 * the `kind:'su'` row; the local session is pushed ONLY on success, with the home
 * derived from the server-returned tier. Any rejection collapses to one
 * `Authentication failure` (no leak of which check failed). The server stamps the
 * `su` trace on the box's auth.log, naming the account off the session row; the
 * client never writes that log itself.
 *
 * A root shell is not asked for a password. Whether it IS root is the server's
 * reading of the session row, not this one's: the empty password it is sent opens
 * nothing for a shell that only claims to be.
 */
const elevateThroughServer = async (
  env: CommandEnv,
  targetName: string,
): Promise<CommandResult> => {
  let typed = '';
  if (env.session.userType !== 'root') {
    try {
      typed = await env.prompt({ message: 'Password: ', masked: true });
    } catch {
      return { kind: 'sync', lines: [], exitCode: 130 };
    }
  }

  const sessionId = `su-${targetName}-${env.now()}`;
  const result = await env.su.elevate({
    sessionId,
    machineId: env.session.machineId,
    username: targetName,
    password: typed,
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
    essid: env.session.essid,
  });
  env.setCwd(homeDirectory({ username: targetName, userType: result.userType }));
  return { kind: 'sync', lines: [], exitCode: 0 };
};

const execute: Command['execute'] = async (env, args) => {
  const targetName = args[0] ?? DEFAULT_TARGET;

  // Only the player's own workstation is theirs to judge. Everywhere else the
  // switch is the server's (see `elevateThroughServer`).
  if (!isOwnWorkstation(env.session.machineId, env.identity.publicKeyHex)) {
    return elevateThroughServer(env, targetName);
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
  // The password prompt has nowhere to appear, which is why a backdoor cannot be
  // escalated out of — the one thing that keeps a found listener worth less than
  // a cracked login.
  withoutTty: 'su: must be run from a terminal',
  withoutScript: 'su: cannot be run from a script',
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
