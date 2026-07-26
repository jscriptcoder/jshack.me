import { describe, expect, it } from 'vitest';
import { allocateLanLease, drawLanOctet } from './allocateLanLease';
import { createPrng } from '../generation/prng';

/**
 * `allocateLanLease` is the pure orchestration of an occupant's DHCP-style address
 * on an AP's `/24`. Unlike the AP's public IP — one per ESSID, shared by every
 * occupant — a lease is per `(essid, owner_key)`: each occupant holds its own host
 * octet, and no two occupants of one ESSID may hold the same one.
 *
 * The lease is PERMANENT. Occupancy rows are deleted on `nmcli disconnect`, so the
 * lease deliberately outlives them: reconnecting to a network you have used before
 * returns you to the address you had, which is what makes a saved connection and a
 * remembered LAN address mean the same thing.
 *
 * The first candidate is the occupant's PREFERRED octet — the address the pure
 * `assignHomeNetwork` derivation issues today. Seeding the lease from it means every
 * already-connected occupant leases the address it is already using, so switching the
 * readers over to leases later relocates nobody except genuinely-colliding players.
 * Only a collision redraws.
 *
 * Store effects (read / redraw / claim) are injected, so these tests pin the contract
 * the allocator fulfils through them — no DB. `claim` returns the octet now leased to
 * the occupant (the offered one if it stuck, or the one a concurrent write for the
 * SAME occupant already bound), or null if that octet belongs to ANOTHER occupant of
 * the ESSID (redraw).
 */

const ESSID = 'ACME-CORP';
const OWNER = 'a1b2c3';

// Yields the queued redraws in order, repeating the last once exhausted so an
// accidental over-draw surfaces a real octet rather than undefined.
const redrawSequence = (candidates: readonly number[]): (() => number) => {
  let index = 0;
  return () => {
    const candidate = candidates[Math.min(index, candidates.length - 1)]!;
    index += 1;
    return candidate;
  };
};

// Yields the queued claim outcomes in order (null = the offered octet is held by
// another occupant → redraw; number = the octet now leased) and records every
// (essid, ownerKey, octet) it was asked to bind — the allocator's observable effect.
const claimSequence = (
  outcomes: readonly (number | null)[],
): {
  readonly claim: (essid: string, ownerKey: string, octet: number) => Promise<number | null>;
  readonly calls: ReadonlyArray<{
    readonly essid: string;
    readonly ownerKey: string;
    readonly octet: number;
  }>;
} => {
  const calls: Array<{ essid: string; ownerKey: string; octet: number }> = [];
  let index = 0;
  const claim = async (
    essid: string,
    ownerKey: string,
    octet: number,
  ): Promise<number | null> => {
    calls.push({ essid, ownerKey, octet });
    const outcome = outcomes[Math.min(index, outcomes.length - 1)];
    index += 1;
    return outcome ?? null;
  };
  return { claim, calls };
};

const storedLease =
  (value: number | null) =>
  async (): Promise<number | null> =>
    value;

const failRedraw = (): number => {
  throw new Error('redrawOctet must not run when the preferred octet is available');
};

const failClaim = async (): Promise<number | null> => {
  throw new Error('claim must not run on the fast path');
};

describe('allocateLanLease', () => {
  it('leases the occupant’s preferred octet when nothing holds it', async () => {
    const { claim, calls } = claimSequence([84]);

    const result = await allocateLanLease(
      { essid: ESSID, ownerKey: OWNER, preferredOctet: 84 },
      { readLease: storedLease(null), redrawOctet: failRedraw, claim },
    );

    // Seeding the lease from the derivation is the whole reason switching the
    // readers over later moves nobody: an occupant already using .84 keeps .84,
    // and no redraw is even attempted (failRedraw throws if one is).
    expect(result).toBe(84);
    expect(calls).toEqual([{ essid: ESSID, ownerKey: OWNER, octet: 84 }]);
  });

  it('returns an existing lease without drawing or claiming', async () => {
    const result = await allocateLanLease(
      { essid: ESSID, ownerKey: OWNER, preferredOctet: 84 },
      { readLease: storedLease(37), redrawOctet: failRedraw, claim: failClaim },
    );

    // A returning occupant goes back to the address it held — .37 — NOT to the
    // octet its own key would derive today. The lease outranks the derivation, and
    // the read costs no wasted write (failRedraw/failClaim throw if the fast path
    // is gone).
    expect(result).toBe(37);
  });

  it('redraws past an octet another occupant of the ESSID already holds', async () => {
    const { claim, calls } = claimSequence([null, 112]);

    const result = await allocateLanLease(
      { essid: ESSID, ownerKey: OWNER, preferredOctet: 84 },
      { readLease: storedLease(null), redrawOctet: redrawSequence([112]), claim },
    );

    // Two identities whose derivations collide on .84 must not both get it: the
    // loser redraws. This is the defect the whole slice exists to close.
    expect(result).toBe(112);
    expect(calls).toEqual([
      { essid: ESSID, ownerKey: OWNER, octet: 84 },
      { essid: ESSID, ownerKey: OWNER, octet: 112 },
    ]);
  });

  it('adopts the octet a concurrent write for the same occupant already bound', async () => {
    const { claim } = claimSequence([201]);

    const result = await allocateLanLease(
      { essid: ESSID, ownerKey: OWNER, preferredOctet: 84 },
      { readLease: storedLease(null), redrawOctet: failRedraw, claim },
    );

    // Two simultaneous joins by the SAME identity must converge on one address:
    // the row already existed, so claim binds to — and returns — the octet already
    // there, never the .84 this call offered.
    expect(result).toBe(201);
  });

  it('throws an exhaustion error after exactly maxAttempts collisions', async () => {
    // A free octet waits at the FOURTH outcome: a correct `< maxAttempts` loop
    // (maxAttempts = 3) never reaches it and throws, while an off-by-one `<=` would
    // try a 4th time, bind it, and wrongly return — so the throw pins the upper
    // bound. The message must name the exhaustion, not just throw something.
    const { claim } = claimSequence([null, null, null, 9]);

    await expect(
      allocateLanLease(
        { essid: ESSID, ownerKey: OWNER, preferredOctet: 84 },
        {
          readLease: storedLease(null),
          redrawOctet: redrawSequence([112, 113, 9]),
          claim,
          maxAttempts: 3,
        },
      ),
    ).rejects.toThrow('exhausted');
  });

  it('still leases when the final allowed attempt succeeds', async () => {
    const { claim } = claimSequence([null, null, 113]);

    const result = await allocateLanLease(
      { essid: ESSID, ownerKey: OWNER, preferredOctet: 84 },
      {
        readLease: storedLease(null),
        redrawOctet: redrawSequence([112, 113]),
        claim,
        maxAttempts: 3,
      },
    );

    // The bound is exactly maxAttempts: the 3rd attempt must still run (this fails
    // if the loop stops one short) yet a 4th must not be needed.
    expect(result).toBe(113);
  });
});

describe('drawLanOctet', () => {
  it('only ever yields a usable host address', async () => {
    const draws = Array.from({ length: 2000 }, (_, index) =>
      drawLanOctet(createPrng(`lan-octet-${index}`)),
    );

    // A redraw must never land on the network address (.0), the AP gateway (.1),
    // or broadcast (.255) — those are not hosts, and .1 is a machine an occupant
    // would be impersonating. 2000 deterministic draws over 253 values make a
    // widened bound overwhelmingly likely to show up here.
    expect(draws.every((octet) => octet >= 2 && octet <= 254)).toBe(true);
  });

  it('spreads across the usable range rather than collapsing to one value', async () => {
    const draws = new Set(
      Array.from({ length: 2000 }, (_, index) => drawLanOctet(createPrng(`lan-octet-${index}`))),
    );

    // Guards the range test above: a constant draw would satisfy "always in
    // bounds" while making every occupant collide forever.
    expect(draws.size).toBeGreaterThan(200);
  });
});
