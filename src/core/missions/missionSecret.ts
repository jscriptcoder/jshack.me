/**
 * A contract's secret half — the key it hands out and where that key sits.
 *
 * SERVER ONLY by discipline. Nothing the client bundle imports may reach this module: the
 * key-path pool and the keyed hash must not ship, or a client could derive a key or locate
 * it from the number alone — and the number ships in the bundle precisely because, without
 * the secret, it cannot. Only `api/` and `scripts/` import it, and the budget gate checks
 * the built chunk carries neither the pool nor the key derivation.
 *
 * The key is an `ACCESS-XXXX-XXXX-XXXX` token derived by HMAC-SHA256 of the number under
 * the deployment's secret (`@noble/hashes`, the isomorphic hash the rest of the world
 * already uses — the module stays free of Node built-ins so it type-checks under the same
 * config as the shape it accompanies). The secret is what keeps the key out of reach: the
 * number is public, the key is not derivable from it without the secret, and the two
 * deployments hold different secrets, so a key read on dev never works on prod. The token
 * reads from an unambiguous uppercase alphabet (no I, L, O or U) so a contractor can copy
 * it off the screen into a mail without a mistake, and so decision 7's shape-matching is
 * fair.
 *
 * The key path is drawn from the number against a small pool of believable root-only
 * paths. It is not the path that hides the key — a root shell can list the box and find it
 * anywhere — but keeping the pool off the wire stops a client from reading the key's
 * location out of the bundle before anyone has rooted the box.
 *
 * The deployment secret itself is read from the environment at the server site that needs
 * it (as the supabase credentials are), and passed to `requireMissionSecret`, which fails
 * closed on a missing one rather than inventing a default.
 */

import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { createPrng } from '../generation/prng.js';

/** Crockford base32: ten digits and the uppercase letters, less I, L, O and U, which a
 *  reader confuses with 1, 1, 0 and V. Thirty-two symbols, so each carries five bits. */
const ACCESS_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Three groups of four: twelve symbols, sixty bits of the HMAC digest. */
const KEY_SYMBOLS = 12;

/** The twelve-symbol body of the token, read five bits at a time off the digest's bytes. */
const encodeAccessBody = (digest: Uint8Array): string => {
  let value = 0;
  let bits = 0;
  let body = '';
  for (const byte of digest) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      body += ACCESS_ALPHABET[(value >>> bits) & 31];
      if (body.length === KEY_SYMBOLS) return body;
    }
    // Keep only the bits not yet emitted, so `value` stays inside a safe 32-bit range.
    value &= (1 << bits) - 1;
  }
  return body;
};

const encodeUtf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

/** The key a contract with this number hands out, under this deployment's secret. */
export const missionKey = (missionNumber: number, secret: string): string => {
  const digest = hmac(sha256, encodeUtf8(secret), encodeUtf8(String(missionNumber)));
  const body = encodeAccessBody(digest);
  return `ACCESS-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}`;
};

/** The passphrase a gpg contract's key is sealed with, compiled into the program beside it.
 *  Hashed from a message of its own, never the key's, so the program's strings say nothing
 *  of the key; and per contract, so one job's passphrase is no help on the next. */
export const missionPassphrase = (missionNumber: number, secret: string): string => {
  const digest = hmac(sha256, encodeUtf8(secret), encodeUtf8(`passphrase:${missionNumber}`));
  const body = encodeAccessBody(digest);
  return `hv-${body.slice(0, 4)}-${body.slice(4, 8)}`;
};

/** Believable root-only paths — a system directory a non-root shell cannot read, never a
 *  user's home. The slice-one pool; templates that name the file for the target company
 *  come with the briefings (decision 15). */
const KEY_PATH_POOL: readonly string[] = [
  '/root/.config/vault/key',
  '/root/.ssh/contract.key',
  '/root/.credentials/access.key',
  '/etc/contract/access.key',
  '/etc/credentials/api.key',
  '/etc/secrets/records.key',
  '/var/lib/records/access.key',
  '/var/backups/vault.key',
  '/opt/archive/access.key',
  '/opt/vault/records.key',
];

/** Where the key sits on the key box, drawn from the number. */
export const missionKeyPath = (missionNumber: number): string =>
  createPrng(`mission-keypath-${missionNumber}`).pick(KEY_PATH_POOL);

/** Thrown when a door that needs the deployment secret finds none set. The handler turns
 *  it into a 500 `mission_secret_missing`; there is deliberately no default. */
export class MissionSecretMissingError extends Error {
  constructor() {
    super('MISSION_KEY_SECRET is not set');
    this.name = 'MissionSecretMissingError';
  }
}

/** The deployment secret, or a thrown `MissionSecretMissingError` when the environment
 *  held none — failing closed rather than guessing a default. The caller reads the raw
 *  value from `process.env` at the server boundary and passes it here. */
export const requireMissionSecret = (secret: string | undefined): string => {
  if (secret === undefined || secret === '') throw new MissionSecretMissingError();
  return secret;
};
