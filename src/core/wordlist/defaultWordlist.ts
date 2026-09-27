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
 * What it covers is exactly the CRACKABLE pool, and never the uncrackable one
 * (`generation/passwordPools.ts`). Those two relations are the difficulty curve:
 * a door that drew crackable must fall, and one that drew uncrackable must hold
 * until its password is harvested and appended by hand. A single word leaking
 * across softens the curve with nothing to see — no error, no wrong output, just
 * a game that is easier than its knobs claim.
 *
 * "Door", not "account": gateways draw from the same two pools at their own
 * rate, so this one file decides what falls everywhere in the game.
 */

import { asAbsPath, type AbsPath } from '../types';
import type { FilePermissions } from '../filesystem/types';
import { CRACKABLE_PASSWORDS } from '../generation/passwordPools';

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
 *  crack nothing; they are what an attacker would actually try first.
 *
 *  `admin` used to live here and did NOT crack nothing — it is a router factory
 *  default, so the padding was quietly opening gateways. It now sits in the
 *  crackable router pool, where that job is stated. */
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

/** Every password the default install can crack: the crackable pool (what
 *  actually opens a door), then the common-list padding. Deduped — a repeated
 *  word is wasted work on every run. The uncrackable pool is absent by
 *  construction: it is not imported here, so it cannot leak in by accident. */
export const DEFAULT_WORDLIST: readonly string[] = [
  ...new Set([...CRACKABLE_PASSWORDS, ...COMMON_PASSWORDS]),
];

/** Render a wordlist as file content: one password per line, no trailing blank —
 *  a blank line would match an empty password. */
export const formatWordlist = (words: readonly string[]): string => words.join('\n');

/** Read file content back into candidate passwords. Blank lines are dropped: an
 *  editor leaves a trailing newline behind, and "the empty password" is not
 *  something the player typed into their list. */
export const parseWordlist = (content: string): readonly string[] =>
  content.split('\n').filter((word) => word.length > 0);
