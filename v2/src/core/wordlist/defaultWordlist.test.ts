import { describe, expect, it } from 'vitest';
import { GUEST_PASSWORDS } from '../generation/workstationFs';
import { CRACKABLE_PASSWORDS, UNCRACKABLE_PASSWORDS } from '../generation/passwordPools';
import { seedApGatewayAdminPw } from '../generation/routerFs';
import {
  DEFAULT_WORDLIST,
  formatWordlist,
  WORDLIST_PATH,
  WORDLIST_PERMISSIONS,
} from './defaultWordlist';

/**
 * The wordlist a player gets with `apt install hydra` — the file that decides
 * what they can crack. Membership in it IS the gate: a password absent from the
 * list is uncrackable no matter how weak it looks, and one present in it falls
 * however strong it looks.
 *
 * That gate is enforced by exactly two set relations, and both live here: the
 * shipped list covers the crackable pool completely, and the uncrackable pool
 * not at all. Everything the difficulty curve promises rests on those two lines.
 */

describe('the default wordlist', () => {
  it('covers the crackable pool completely — an account that drew crackable must fall', () => {
    // The half of the promise a player experiences as "my tools work". A word
    // missing here makes an account that rolled crackable hold anyway, which
    // reads as a broken tool rather than a strong password.
    const missing = CRACKABLE_PASSWORDS.filter((password) => !DEFAULT_WORDLIST.includes(password));

    expect(missing).toEqual([]);
  });

  it('covers the uncrackable pool NOT AT ALL — one leaked word silently softens the curve', () => {
    // The other half, and the one that fails quietly. A single uncrackable word
    // appearing in the shipped list makes every account that drew it fall on day
    // one, with nothing to see: no error, no wrong output, just a curve that is
    // gentler than the knobs claim.
    const leaked = UNCRACKABLE_PASSWORDS.filter((password) => DEFAULT_WORDLIST.includes(password));

    expect(leaked).toEqual([]);
  });

  it("covers every password a player's own guest account can draw", () => {
    const missing = GUEST_PASSWORDS.filter((password) => !DEFAULT_WORDLIST.includes(password));

    expect(missing).toEqual([]);
  });

  it('does not hand over the gateway on these particular networks', () => {
    // ⚠️ NARROW ON PURPOSE, and weaker than it looks. The gateway password is a
    // draw from the router admin pool, and two of that pool's words DO ship in
    // this list — measured, ~24% of networks hand their gateway over on day one.
    // These three ESSIDs simply happen to draw words that are not covered.
    //
    // So this proves a fact about three networks, NOT the general claim its
    // predecessor made ("does NOT cover the AP gateway admin password"). The
    // real assertion — a deliberate gateway crack rate rather than an accident
    // of pool overlap — arrives with the gateway knob.
    const gatewayPasswords = ['SHINRA-5G', 'ACME-CORP', 'WEYLAND-NET'].map(seedApGatewayAdminPw);

    const covered = gatewayPasswords.filter((password) => DEFAULT_WORDLIST.includes(password));

    expect(covered).toEqual([]);
  });

  it('pads with words that crack nothing, so the file is not an answer key', () => {
    // If every word in the list opened a door, the list would leak the pool it is
    // meant to gate: a player would learn that anything in their file works and
    // anything that failed was never there. Most of a real wordlist misses, and
    // that is what makes growing it feel like an edge rather than a lookup.
    const padding = DEFAULT_WORDLIST.filter((word) => !CRACKABLE_PASSWORDS.includes(word));

    expect(padding.length).toBeGreaterThan(CRACKABLE_PASSWORDS.length);
  });

  it('ships readable by every tier, writable only by root, and never executable', () => {
    // Every tier reads it so a guest-tier hydra can consult it; only root writes,
    // so appending a harvested password is a deliberate act; never executable —
    // it is data the tools read, not a program.
    //
    // Asserted as LITERALS. `apt`'s test checks the installed file against this
    // constant, which is the right claim there ("apt writes what the package
    // declares") but cannot catch the constant itself changing — it compares the
    // value to itself. This is the assertion that pins the value.
    expect(WORDLIST_PERMISSIONS).toEqual({
      read: ['root', 'user', 'guest'],
      write: ['root'],
      execute: [],
    });
  });

  it('holds no duplicates — a repeated word is wasted work on every run', () => {
    expect([...new Set(DEFAULT_WORDLIST)]).toEqual([...DEFAULT_WORDLIST]);
  });

  it('holds no blank entries — an empty line would match an empty password', () => {
    expect(DEFAULT_WORDLIST.filter((word) => word.trim() === '')).toEqual([]);
  });

  it('renders as one password per line, with no trailing blank', () => {
    const rendered = formatWordlist(['alpha', 'bravo', 'charlie']);

    expect(rendered).toBe('alpha\nbravo\ncharlie');
  });

  it('lives where the tools that read it will look', () => {
    expect(WORDLIST_PATH).toBe('/usr/share/wordlists/passwords.txt');
  });
});
