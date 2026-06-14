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

export const accountIn = (fs: Directory, username: string): PasswdAccount | null => {
  const etc = fs.entries.get('etc');
  if (etc === undefined || etc.kind !== 'directory') return null;
  const passwd = etc.entries.get('passwd');
  if (passwd === undefined || passwd.kind !== 'file') return null;
  const fields = passwd.content
    .split('\n')
    .map((line) => line.split(':'))
    .find((row) => row[0] === username);
  if (fields === undefined) return null;
  return { hash: fields[1] ?? '', userType: userTypeFromPasswdFields(fields) };
};
