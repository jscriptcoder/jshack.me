/**
 * accountIn — read one account's `{ hash, userType }` from a regenerated host's
 * `/etc/passwd`, or null when the account does not exist.
 *
 * Shared by both ssh auth gates — the LAN `authCreateSession` and the cross-player
 * `authCreateSessionPublic` — so a credential check reads `/etc/passwd` exactly one
 * way and the two can't drift. Row shape: `name:hash:uid:gid:gecos:home:shell`.
 */

import { userTypeFromPasswdFields } from '../generation/passwdTier';
import type { UserType } from '../types';
import type { Directory } from '../filesystem/types';

export type PasswdAccount = { readonly hash: string; readonly userType: UserType };

/** A named account — what a reader that does not already know the username needs.
 *  A credential sweep has no username to look up: the box's own passwd is what
 *  tells it which accounts exist. */
export type NamedPasswdAccount = PasswdAccount & { readonly username: string };

/** The parsed rows of a regenerated host's `/etc/passwd`, or empty when the file
 *  is missing or is not a file. Blank lines are skipped — the file is written with
 *  a trailing newline, and an empty row would otherwise read as a nameless
 *  account with an empty password hash. */
const passwdFields = (fs: Directory): readonly (readonly string[])[] => {
  const etc = fs.entries.get('etc');
  if (etc === undefined || etc.kind !== 'directory') return [];
  const passwd = etc.entries.get('passwd');
  if (passwd === undefined || passwd.kind !== 'file') return [];
  return passwd.content
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => line.split(':'));
};

export const accountIn = (fs: Directory, username: string): PasswdAccount | null => {
  const fields = passwdFields(fs).find((row) => row[0] === username);
  if (fields === undefined) return null;
  return { hash: fields[1] ?? '', userType: userTypeFromPasswdFields(fields) };
};

/** Every account on the box, in passwd order. */
export const accountsIn = (fs: Directory): readonly NamedPasswdAccount[] =>
  passwdFields(fs).map((fields) => ({
    username: fields[0] ?? '',
    hash: fields[1] ?? '',
    userType: userTypeFromPasswdFields(fields),
  }));
