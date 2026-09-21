/**
 * accountIn — read one account's `{ hash, userType }` from a regenerated host's
 * `/etc/passwd`, or null when the account does not exist.
 *
 * Shared by both ssh auth gates — the LAN `authCreateSession` and the cross-player
 * `authCreateSessionPublic` — so a credential check reads `/etc/passwd` exactly one
 * way and the two can't drift. Row shape: `name:hash:uid:gid:gecos:home:shell`.
 */

import { userTypeFromPasswdFields } from '../generation/passwdTier';
import { asAbsPath, type UserType } from '../types';
import type { Directory, FileEntry } from '../filesystem/types';

/** Where a box keeps its accounts, and who owns that file. Named beside the parser so a
 *  writer and a reader cannot end up pointing at two different paths for one fact. */
export const PASSWD_PATH = asAbsPath('/etc/passwd');
export const PASSWD_OWNER = 'root';

export type PasswdAccount = { readonly hash: string; readonly userType: UserType };

/** A named account — what a reader that does not already know the username needs.
 *  A credential sweep has no username to look up: the box's own passwd is what
 *  tells it which accounts exist. */
export type NamedPasswdAccount = PasswdAccount & { readonly username: string };

/** The parsed rows of a regenerated host's `/etc/passwd`, or empty when the file
 *  is missing or is not a file. Blank lines are skipped — the file is written with
 *  a trailing newline, and an empty row would otherwise read as a nameless
 *  account with an empty password hash. */
/** The credential file itself, or null when the box carries none — a rooted owner can
 *  delete it, or `mkdir` straight over it, and either is a box with nothing to say about
 *  who lives on it rather than a crash. */
const passwdFile = (fs: Directory): FileEntry | null => {
  const etc = fs.entries.get('etc');
  if (etc === undefined || etc.kind !== 'directory') return null;
  const passwd = etc.entries.get('passwd');
  return passwd !== undefined && passwd.kind === 'file' ? passwd : null;
};

const passwdFields = (fs: Directory): readonly (readonly string[])[] => {
  const passwd = passwdFile(fs);
  if (passwd === null) return [];
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

/** The tiers from least to most privileged. */
const TIER_ORDER: readonly UserType[] = ['guest', 'user', 'root'];

/** The account a hole granting `tier` lands on: the least privileged one at or above it,
 *  or undefined when the box holds nobody that high.
 *
 *  The tier is a FLOOR. A router's passwd holds root and nothing else, so reading it as an
 *  exact match would refuse most of the holes a router has, in words indistinguishable
 *  from a patched daemon. The cost is deliberate: deleting the `user` account does not
 *  close a user-tier hole, it promotes that hole to root. */
export const accountAtOrAbove = (fs: Directory, tier: UserType): NamedPasswdAccount | undefined => {
  const accounts = accountsIn(fs);
  return TIER_ORDER.slice(TIER_ORDER.indexOf(tier))
    .map((candidateTier) => accounts.find((account) => account.userType === candidateTier))
    .find((account) => account !== undefined);
};

/** The box's passwd with ONE account's hash replaced and every other byte left where it
 *  was: the other accounts, any field this parser does not read, the blank line a
 *  hand-edited file may carry.
 *
 *  It lives beside the reader above because it is the same knowledge: a writer that
 *  assembled a row its own way could put the hash in a field the reader never looks at,
 *  and the credential would silently stop being the one that opens the door.
 *
 *  A box carrying no passwd file has no accounts to name, so every caller has already
 *  had to refuse before reaching this — and the empty text it falls back on rewrites to
 *  itself rather than inventing a file the box never had. */
export const withAccountHash = (fs: Directory, username: string, hash: string): string =>
  (passwdFile(fs)?.content ?? '')
    .split('\n')
    .map((line) => {
      const fields = line.split(':');
      if (fields.length < 2 || fields[0] !== username) return line;
      return [fields[0], hash, ...fields.slice(2)].join(':');
    })
    .join('\n');
