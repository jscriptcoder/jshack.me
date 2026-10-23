/**
 * passwd — change an account's password by rewriting its md5 hash in
 * `/etc/passwd`. The write-mirror of `su`.
 *
 * On the player's own workstation a caller may change their OWN account at any
 * tier (a setuid-root `passwd`), but changing a NAMED account other than their
 * own requires root. The privilege check is made up front, before any prompt:
 * the client already knows its own tier, so prompting a caller who cannot
 * proceed would only waste a masked prompt on a refusal.
 */

import type { Command, CommandEnv, CommandResult } from './types.js';
import { PASSWD_PATH } from '../sessions/passwdAccount.js';

const refusal = (content: string): CommandResult => ({
  kind: 'sync',
  lines: [{ kind: 'error', content }],
  exitCode: 1,
});

/** Read `/etc/passwd` at ROOT privilege via `stat` (which resolves the raw node,
 *  bypassing the caller's read perms) — the setuid-root read `su` also makes.
 *  Returns the file text, or '' when passwd is missing or not a file. */
const readPasswd = (env: CommandEnv): string => {
  const node = env.fs.stat(PASSWD_PATH);
  return node !== null && node.kind === 'file' ? node.content : '';
};

/** Whether `/etc/passwd` holds a row for this account. Row shape:
 *  `name:hash:uid:gid:gecos:home:shell`. */
const accountExists = (passwd: string, username: string): boolean =>
  passwd.split('\n').some((line) => line.split(':')[0] === username);

const execute: Command['execute'] = async (env, args) => {
  const target = args[0] ?? env.session.username;
  const isOwnAccount = target === env.session.username;

  // Changing someone else's account needs root; the caller's tier is known here,
  // so refuse before any prompt rather than after.
  if (!isOwnAccount && env.session.userType !== 'root') {
    return refusal(`passwd: you may not change the password for '${target}'`);
  }

  if (!accountExists(readPasswd(env), target)) {
    return refusal(`passwd: user '${target}' does not exist`);
  }

  // Remaining behaviour is driven in by the next tests.
  return { kind: 'sync', lines: [], exitCode: 0 };
};

export const passwd: Command = {
  name: 'passwd',
  description: 'Change an account password',
  category: 'general',
  tier: 'guest',
  availability: { kind: 'localhost-only' },
  withoutTty: 'passwd: must be run from a terminal',
  withoutScript: 'passwd: cannot be run from a script',
  manual: {
    synopsis: 'passwd [username]',
    description:
      'Change an account password by rewriting its hash in /etc/passwd. With no ' +
      'argument, changes your own account; a non-root caller is first asked for the ' +
      'current password. Naming another account changes that account and requires root.',
    arguments: [
      {
        name: 'username',
        description: 'The account to change (e.g. "root"). Defaults to your own account.',
      },
    ],
    examples: [
      { command: 'passwd', description: 'Change your own password' },
      { command: 'passwd root', description: 'Change root’s password (requires root)' },
    ],
  },
  execute,
};
