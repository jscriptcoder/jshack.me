/**
 * The default password wordlist — the file `apt install hydra` puts on a player's
 * box, and the thing that decides what they can crack.
 *
 * Membership in this list IS the gate. A password absent from it is uncrackable
 * however weak it looks; one present in it falls however strong it looks. That is
 * the whole mechanic, and it is why the tools must read the FILE on the player's
 * machine rather than this constant: the player owns their copy, can edit it with
 * `nano`, and grows it by appending passwords they harvest. This module only
 * decides what they START with.
 *
 * The starting list is currently FLAT — it covers every password a generated
 * account can draw, so every generated account falls. That is deliberate and
 * temporary: it isolates the cracking machinery from the probability policy that
 * follows, so a crack that fails can only mean the machinery is broken. What it
 * does NOT cover is the AP gateway's seeded admin password, which is generated
 * per ESSID rather than drawn from a pool — taking the gateway stays a crack
 * rather than a birthright.
 */

import { asAbsPath, type AbsPath } from '../types';
import type { FilePermissions } from '../filesystem/types';
import { GUEST_PASSWORDS } from '../generation/workstationFs';
import { WEAK_PASSWORDS } from '../generation/remoteHostFs';

/** Where the wordlist lives, and where every tool that consults one looks for it.
 *  Matches the real Debian/Kali location so a player's instinct is right. */
export const WORDLIST_PATH: AbsPath = asAbsPath('/usr/share/wordlists/passwords.txt');

/** Readable by every tier so a guest-tier tool can consult it, writable only by
 *  root so appending a harvested password is a deliberate act, and NEVER
 *  executable — it is data the tools read, not a program. */
export const WORDLIST_PERMISSIONS: FilePermissions = {
  read: ['root', 'user', 'guest'],
  write: ['root'],
  execute: [],
};

/** Passwords beyond the generated pools — the common-list padding that makes the
 *  file read like a real wordlist rather than a key to this specific world. They
 *  crack nothing today; they are what an attacker would actually try first. */
const COMMON_PASSWORDS: readonly string[] = [
  '123456',
  '12345678',
  'qwerty',
  'abc123',
  'monkey',
  'dragon',
  'master',
  'football',
  'iloveyou',
  'admin',
  'welcome',
  'login',
  'passw0rd',
  'starwars',
  'whatever',
  'freedom',
  'shadow',
  'baseball',
  'superman',
  'batman',
];

/** Every password the default install can crack: the generated pools first (what
 *  actually opens a door today), then the common-list padding. Deduped — the
 *  guest and NPC pools overlap, and a repeated word is wasted work on every run. */
export const DEFAULT_WORDLIST: readonly string[] = [
  ...new Set([...GUEST_PASSWORDS, ...WEAK_PASSWORDS, ...COMMON_PASSWORDS]),
];

/** Render a wordlist as file content: one password per line, no trailing blank —
 *  a blank line would match an empty password. */
export const formatWordlist = (words: readonly string[]): string => words.join('\n');
