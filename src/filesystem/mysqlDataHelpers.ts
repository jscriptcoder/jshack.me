import { parseMysqlDatabase, type MysqlCredential } from '../commands/mysql/types';

// Server-side parser for /var/lib/mysql/data.json — returns the
// passwordHash + userType for a given username, or undefined when
// the user is absent / file is missing / JSON is malformed.
//
// MySQL is multi-user with userType per credential entry (unlike
// virtual_users.conf which only carries password hashes). userType
// derives from the JSON entry directly, NOT from /etc/passwd —
// MySQL users may not have system accounts.
//
// PR 4 of plans/cross-player-base-fs-replication.md.

export const findMysqlCredential = (
  content: string | null,
  username: string,
): Pick<MysqlCredential, 'passwordHash' | 'userType'> | undefined => {
  if (!content) return undefined;

  let db;
  try {
    db = parseMysqlDatabase(content);
  } catch {
    return undefined;
  }
  if (!db?.credentials) return undefined;

  const cred = db.credentials.find((c) => c.username === username);
  if (!cred) return undefined;
  return { passwordHash: cred.passwordHash, userType: cred.userType };
};
