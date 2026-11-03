/**
 * Who a password door lets in, and where an ftp session lands. Every gate asks here, the
 * own box's included, so a door cannot exist at one address and not another.
 *
 * A named account is checked against the box's own `/etc/passwd`. The one exception is
 * `anonymous` at the ftp door of a box whose `/etc/vsftpd.conf` says `anonymous_enable=YES`:
 * any password opens a guest-tier session, with no account behind it. Because the door reads
 * the live config, what the file says is what the door does, so a root who sets it to `NO`
 * closes it, and a root who sets it to `YES` on any box opens it.
 */

import { md5 } from '../generation/md5.js';
import { asAbsPath, type AbsPath, type UserType } from '../types.js';
import type { Directory } from '../filesystem/types.js';
import { accountIn } from './passwdAccount.js';
import { homeDirectory, type HomeAccount } from './homeDirectory.js';
import type { DoorKind } from './authCreateSession.js';

const ANONYMOUS_USER = 'anonymous';

/** Where an anonymous login lands, and what it can see of the box's public files. */
export const ANONYMOUS_FTP_ROOT = asAbsPath('/srv/ftp');

const lettingAnonymousIn = (fs: Directory): boolean => {
  const etc = fs.entries.get('etc');
  const config = etc?.kind === 'directory' ? etc.entries.get('vsftpd.conf') : undefined;
  return config?.kind === 'file' && /^anonymous_enable=YES$/m.test(config.content);
};

/** The tier this login buys on the box, or null for a refusal. An account with no password
 *  never matches, since no typed password hashes to empty. */
export const admitToDoor = (
  door: DoorKind,
  fs: Directory,
  username: string,
  password: string,
): UserType | null => {
  if (door === 'ftp' && username === ANONYMOUS_USER && lettingAnonymousIn(fs)) return 'guest';
  const account = accountIn(fs, username);
  return account !== null && md5(password) === account.hash ? account.userType : null;
};

/** Where an ftp session starts on the box. */
export const ftpLanding = (account: HomeAccount): AbsPath =>
  account.username === ANONYMOUS_USER ? ANONYMOUS_FTP_ROOT : homeDirectory(account);
