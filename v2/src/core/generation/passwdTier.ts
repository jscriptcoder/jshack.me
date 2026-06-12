/**
 * passwdTier — the account tier for a parsed `/etc/passwd` row, the inverse of
 * how the generators assign tiers in `generatePasswd`. Shared by every reader of
 * a passwd row (`su` switching locally, the ssh server-auth deriving a remote
 * login's tier) so the rule lives in exactly one place.
 *
 * Row shape: `name:hash:uid:gid:gecos:home:shell`. Rule: uid 0 → root, the
 * literal `guest` account → guest, everyone else → user.
 */

import type { UserType } from '../types';

export const userTypeFromPasswdFields = (fields: readonly string[]): UserType =>
  Number(fields[2]) === 0 ? 'root' : fields[0] === 'guest' ? 'guest' : 'user';
