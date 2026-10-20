/**
 * The login a box keeps for emailit.io: the current user's `~/.mailrc`.
 *
 * `mail` reads it to open the inbox, and a form posted to talkit.io carries it as a
 * browser carries a cookie. Both read it here, so a login that opens the inbox signs a
 * post too, and a file the user cannot read is no login for either: who you are on the
 * box decides whose login you hold.
 */

import type { FsView, MailLogin } from '../commands/types.js';
import { homeDirectory, type HomeAccount } from '../sessions/homeDirectory.js';
import { EMAILIT_DOMAIN } from '../generation/fixedSites.js';
import { asAbsPath, type AbsPath } from '../types.js';

/** The file that is the login: `account`'s `~/.mailrc`. */
export const mailrcPath = (account: HomeAccount): AbsPath =>
  asAbsPath(`${homeDirectory(account)}/.mailrc`);

/** The handle of an address at emailit.io, or null for an address anywhere else. Callers
 *  fold the address to lowercase first: one address whatever case it was written in, as
 *  a sign-up folds a handle. */
export const handleOf = (address: string): string | null => {
  const at = address.lastIndexOf('@');
  return at === -1 || address.slice(at + 1) !== EMAILIT_DOMAIN ? null : address.slice(0, at);
};

/** An address as a player typed it, in full: trimmed, lowercased, and a bare handle taken
 *  to be at emailit.io. `mail` reads a recipient this way, and hireme.io an applicant, so
 *  the two cannot read one typed address differently. */
export const typedAddress = (typed: string): string => {
  const lowered = typed.trim().toLowerCase();
  return lowered.includes('@') ? lowered : `${lowered}@${EMAILIT_DOMAIN}`;
};

/** The address and password a `~/.mailrc` holds, or null when it is missing either. Each
 *  is a `set` line whose value runs to the end of the line, as in a real one; blank lines
 *  and `#` comments are skipped. */
const loginIn = (
  content: string,
): { readonly address: string; readonly password: string } | null => {
  const settings = new Map<string, string>();
  for (const line of content.split('\n')) {
    const setting = /^\s*set (from|password)=(.*)$/.exec(line);
    if (setting !== null) settings.set(setting[1] as string, setting[2] as string);
  }
  const address = settings.get('from');
  const password = settings.get('password');
  return address === undefined || password === undefined ? null : { address, password };
};

/** The login `~/.mailrc` holds and the file as it was read, or why there is none to use:
 *  no file, one the user may not read, one without a whole login, or a login for an
 *  address somewhere other than emailit.io. */
export type SavedLogin =
  | {
      readonly ok: true;
      readonly address: string;
      readonly login: MailLogin;
      readonly content: string;
    }
  | { readonly ok: false; readonly reason: 'not_found' | 'permission_denied' | 'no_login' }
  | { readonly ok: false; readonly reason: 'unknown_domain'; readonly address: string };

/** The login saved in `account`'s `~/.mailrc`, read through `fs` as that account. */
export const savedLogin = (fs: Pick<FsView, 'read'>, account: HomeAccount): SavedLogin => {
  const stored = fs.read(mailrcPath(account));
  if (!stored.ok && stored.error === 'not_found') return { ok: false, reason: 'not_found' };
  if (!stored.ok && stored.error === 'permission_denied') {
    return { ok: false, reason: 'permission_denied' };
  }
  const saved = stored.ok ? loginIn(stored.content) : null;
  if (!stored.ok || saved === null) return { ok: false, reason: 'no_login' };

  const address = saved.address.toLowerCase();
  const handle = handleOf(address);
  if (handle === null) return { ok: false, reason: 'unknown_domain', address };
  return {
    ok: true,
    address,
    login: { handle, password: saved.password },
    content: stored.content,
  };
};

/** The login `account` holds, or null when whatever stops it is no matter to the asker. */
export const loginOn = (fs: Pick<FsView, 'read'>, account: HomeAccount): MailLogin | null => {
  const saved = savedLogin(fs, account);
  return saved.ok ? saved.login : null;
};
