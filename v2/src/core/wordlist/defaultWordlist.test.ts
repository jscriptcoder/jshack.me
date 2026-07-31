import { describe, expect, it } from 'vitest';
import { GUEST_PASSWORDS } from '../generation/workstationFs';
import { WEAK_PASSWORDS } from '../generation/remoteHostFs';
import { seedApGatewayAdminPw } from '../generation/routerFs';
import { DEFAULT_WORDLIST, formatWordlist, WORDLIST_PATH } from './defaultWordlist';

/**
 * The wordlist a player gets with `apt install hydra` — the file that decides
 * what they can crack. Membership in it IS the gate: a password absent from the
 * list is uncrackable no matter how weak it looks, and one present in it falls
 * however strong it looks.
 *
 * At this stage the pool is FLAT: every password a generated account can draw
 * ships in the default list, so every generated account falls. That is a
 * deliberate, temporary state — it isolates the cracking machinery from the
 * probability policy that arrives later, so a failed crack can only mean the
 * machinery is broken.
 */

describe('the default wordlist', () => {
  it('covers every password an NPC host account can draw', () => {
    // Flat pool: whatever `buildRemoteHostFs` can stamp on root, the seeded user
    // or guest must be crackable, or the machinery cannot be exercised end to end.
    const missing = WEAK_PASSWORDS.filter((password) => !DEFAULT_WORDLIST.includes(password));

    expect(missing).toEqual([]);
  });

  it("covers every password a player's own guest account can draw", () => {
    const missing = GUEST_PASSWORDS.filter((password) => !DEFAULT_WORDLIST.includes(password));

    expect(missing).toEqual([]);
  });

  it('does NOT cover the AP gateway admin password', () => {
    // The gateway is the pre-CVE root prize and is seeded per ESSID from a
    // generator, not drawn from a pool — so it must not be handed over by the
    // starter wordlist. If this ever passes, taking the gateway stopped being a
    // crack and became a birthright.
    const gatewayPasswords = ['SHINRA-5G', 'ACME-CORP', 'WEYLAND-NET'].map(seedApGatewayAdminPw);

    const covered = gatewayPasswords.filter((password) => DEFAULT_WORDLIST.includes(password));

    expect(covered).toEqual([]);
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
