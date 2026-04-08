import type { Prng } from './prng';
import type { RemoteUser } from '../network/types';
import { wordlistPasswords } from './pools';
import { md5 } from '../utils/md5';

// Virtual FTP user credentials — separate passwords from system users.
// Passwords come from WORDLIST_PASSWORDS (in hydra's wordlist, crackable).
// Format in /etc/vsftpd/virtual_users.conf: "username:md5hash" per line.

export type FtpVirtualUser = {
  readonly username: string;
  readonly passwordHash: string;
  readonly userType: 'root' | 'user' | 'guest';
};

export const generateFtpVirtualUsers = (
  prng: Prng,
  systemUsers: readonly RemoteUser[],
): readonly FtpVirtualUser[] =>
  systemUsers.map((user) => ({
    username: user.username,
    passwordHash: md5(prng.pick(wordlistPasswords)),
    userType: user.userType,
  }));

export const formatVirtualUsersConf = (users: readonly FtpVirtualUser[]): string =>
  users.map((u) => `${u.username}:${u.passwordHash}`).join('\n');

export const parseVirtualUsersConf = (content: string): readonly FtpVirtualUser[] =>
  content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line.includes(':'))
    .map((line) => {
      const [username, passwordHash] = line.split(':');
      return {
        username: username as string,
        passwordHash: passwordHash as string,
        // Virtual users don't carry userType in the file — default to 'user'
        userType: 'user' as const,
      };
    });
