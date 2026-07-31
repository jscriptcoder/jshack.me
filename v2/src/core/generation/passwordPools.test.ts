import { describe, expect, it } from 'vitest';
import { CRACKABLE_PASSWORDS, UNCRACKABLE_PASSWORDS } from './passwordPools';

/**
 * The two pools every generated account draws from. Which pool an account draws
 * decides whether it can ever be cracked with the wordlist a player starts with
 * — so these invariants are the difficulty curve's foundation, and a break here
 * silently hands over accounts that were meant to hold.
 *
 * The pools are DATA, and their contract is a set relation. Testing that
 * relation directly is not testing an implementation detail: what a player can
 * crack IS "which pool did this account draw, and is that pool in my file".
 */

describe('the password pools', () => {
  it('shares no password between them — a word in both would betray the pool it was meant to protect', () => {
    // The one invariant that cannot be allowed to slip. An account that drew
    // "uncrackable" but landed on a word the crackable pool also holds ships in
    // the starter wordlist, and the account falls despite the roll saying it
    // should not. The failure is silent: nothing looks wrong, the curve is just
    // wrong.
    const shared = CRACKABLE_PASSWORDS.filter((password) =>
      UNCRACKABLE_PASSWORDS.includes(password),
    );

    expect(shared).toEqual([]);
  });

  it('holds no duplicates within either pool — a repeat is a silently doubled draw weight', () => {
    expect([...new Set(CRACKABLE_PASSWORDS)]).toEqual([...CRACKABLE_PASSWORDS]);
    expect([...new Set(UNCRACKABLE_PASSWORDS)]).toEqual([...UNCRACKABLE_PASSWORDS]);
  });

  it('holds no blank entries — an empty password is not a password', () => {
    const blanks = [...CRACKABLE_PASSWORDS, ...UNCRACKABLE_PASSWORDS].filter(
      (password) => password.trim() === '',
    );

    expect(blanks).toEqual([]);
  });

  it('keeps the uncrackable pool large enough that harvesting cannot exhaust it', () => {
    // Wordlist growth is the progression: harvest a plaintext, append it, and
    // your coverage widens across every machine that drew the same word. That
    // only stays a progression if the pool is big enough for the gain to be
    // incremental. A short pool means a handful of finds unlocks everything, and
    // the mechanic collapses into a brief chore.
    expect(UNCRACKABLE_PASSWORDS.length).toBeGreaterThanOrEqual(40);
    expect(UNCRACKABLE_PASSWORDS.length).toBeGreaterThan(CRACKABLE_PASSWORDS.length);
  });

  it('keeps both pools non-empty, so neither branch of the roll is dead', () => {
    expect(CRACKABLE_PASSWORDS.length).toBeGreaterThan(0);
    expect(UNCRACKABLE_PASSWORDS.length).toBeGreaterThan(0);
  });
});
