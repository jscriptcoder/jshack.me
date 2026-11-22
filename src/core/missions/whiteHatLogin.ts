/**
 * The words a white-hat client hands over: the root logins of the boxes it lets a contractor
 * into. SERVER ONLY by discipline: the bundle holds only their hashes (`WHITE_HAT_HASHES`), and
 * the words reach a briefing only through this module, read from the same `JSHACK_SECRETS` the
 * build encodes the hashes from, so the words a deployment hands out cannot drift from the hashes
 * it ships.
 *
 * Only a white-hat hash can come out. Any other is refused however it got here, so no bug in a
 * caller can turn this into a lookup for the words meant to stay shut.
 */

import { md5 } from '../generation/md5.js';
import { WHITE_HAT_HASHES } from '../generation/passwordPools.js';
import { parseSecrets } from '../secrets/parseSecrets.js';

/** The word behind a white-hat hash, or null when the hash is not one, the deployment holds no
 *  valid pools, or those pools no longer hold the word. The caller reads the raw value from
 *  `process.env` at the server boundary. */
export const whiteHatWord = (hash: string, rawSecrets: string | undefined): string | null => {
  if (!WHITE_HAT_HASHES.includes(hash)) return null;
  const parsed = parseSecrets(rawSecrets);
  if (!parsed.ok) return null;
  return parsed.secrets.WHITE_HAT_PASSWORDS.find((candidate) => md5(candidate) === hash) ?? null;
};
