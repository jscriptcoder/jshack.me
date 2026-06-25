import { describe, expect, it } from 'vitest';
import { allocatePublicIp } from './allocatePublicIp';

/**
 * `allocatePublicIp` is the pure orchestration of server-side public-IP
 * allocation. A network's WAN address belongs to the AP — one per ESSID, shared
 * by every occupant — and must be globally unique across ESSIDs. So the allocator
 * reads any existing allocation first (a re-join returns the SAME address with no
 * wasted write), else draws a candidate and claims it against a UNIQUE-constrained
 * store, retrying past collisions until one sticks. The store effects (read / draw
 * / claim) are injected, so these tests pin the contract the allocator fulfils
 * through them — no DB. `claim` returns the IP now bound to the ESSID (the drawn
 * one if it stuck, or a concurrent first-joiner's), or null if the drawn IP
 * already belongs to ANOTHER ESSID (redraw).
 */

const ESSID = 'ACME-CORP';

// Yields the queued candidates in order, repeating the last once exhausted so an
// accidental over-draw surfaces a real address rather than undefined.
const drawSequence = (candidates: readonly string[]): (() => string) => {
  let index = 0;
  return () => {
    const candidate = candidates[Math.min(index, candidates.length - 1)]!;
    index += 1;
    return candidate;
  };
};

// Yields the queued claim outcomes in order (null = the drawn IP collided with
// another ESSID → redraw; string = the IP now bound to the ESSID) and records
// every (essid, ip) it was asked to bind — the allocator's observable effect.
const claimSequence = (
  outcomes: readonly (string | null)[],
): {
  readonly claim: (essid: string, ip: string) => Promise<string | null>;
  readonly calls: ReadonlyArray<{ readonly essid: string; readonly ip: string }>;
} => {
  const calls: Array<{ essid: string; ip: string }> = [];
  let index = 0;
  const claim = async (essid: string, ip: string): Promise<string | null> => {
    calls.push({ essid, ip });
    const outcome = outcomes[Math.min(index, outcomes.length - 1)];
    index += 1;
    return outcome ?? null;
  };
  return { claim, calls };
};

const storedIp =
  (value: string | null) =>
  async (): Promise<string | null> =>
    value;

const failDraw = (): string => {
  throw new Error('drawIp must not run on the fast path');
};

const failClaim = async (): Promise<string | null> => {
  throw new Error('claim must not run on the fast path');
};

describe('allocatePublicIp', () => {
  it('claims a freshly drawn IP for an unknown ESSID and returns it', async () => {
    const { claim, calls } = claimSequence(['45.10.20.30']);

    const result = await allocatePublicIp(ESSID, {
      readByEssid: storedIp(null),
      drawIp: drawSequence(['45.10.20.30']),
      claim,
    });

    expect(result).toBe('45.10.20.30');
    // The observable effect: it bound the drawn IP to THIS ESSID, exactly once.
    expect(calls).toEqual([{ essid: ESSID, ip: '45.10.20.30' }]);
  });

  it('returns the stored IP for a known ESSID without drawing or claiming', async () => {
    const result = await allocatePublicIp(ESSID, {
      readByEssid: storedIp('203.0.55.7'),
      drawIp: failDraw,
      claim: failClaim,
    });

    // The IP belongs to the AP — a re-join returns the SAME address and never
    // wastes a draw or claim (failDraw/failClaim throw if the fast path is gone).
    expect(result).toBe('203.0.55.7');
  });

  it('redraws past an IP collision and returns the next claimable IP', async () => {
    const { claim, calls } = claimSequence([null, '62.40.50.60']);

    const result = await allocatePublicIp(ESSID, {
      readByEssid: storedIp(null),
      drawIp: drawSequence(['45.10.20.30', '62.40.50.60']),
      claim,
    });

    expect(result).toBe('62.40.50.60');
    // It tried the first (collided) draw, then the second — in order.
    expect(calls).toEqual([
      { essid: ESSID, ip: '45.10.20.30' },
      { essid: ESSID, ip: '62.40.50.60' },
    ]);
  });

  it('adopts a concurrent first-joiner’s IP rather than the one it drew', async () => {
    const { claim } = claimSequence(['198.51.100.9']);

    const result = await allocatePublicIp(ESSID, {
      readByEssid: storedIp(null),
      drawIp: drawSequence(['45.10.20.30']),
      claim,
    });

    // The (essid) row already existed (a joiner won the race), so claim binds to —
    // and returns — THEIR address, never the 45.10.20.30 we just drew.
    expect(result).toBe('198.51.100.9');
  });

  it('throws an exhaustion error after exactly maxAttempts collisions', async () => {
    // A claimable IP waits at the FOURTH outcome: a correct `< maxAttempts` loop
    // (maxAttempts = 3) never reaches it and throws, while an off-by-one `<=` would
    // try a 4th time, bind it, and wrongly return — so the throw pins the upper
    // bound. The message must name the exhaustion, not just throw something.
    const { claim } = claimSequence([null, null, null, '9.9.9.9']);

    await expect(
      allocatePublicIp(ESSID, {
        readByEssid: storedIp(null),
        drawIp: drawSequence(['45.1.1.1', '45.2.2.2', '45.3.3.3', '9.9.9.9']),
        claim,
        maxAttempts: 3,
      }),
    ).rejects.toThrow('exhausted');
  });

  it('still allocates when the final allowed attempt succeeds', async () => {
    const { claim } = claimSequence([null, null, '45.3.3.3']);

    const result = await allocatePublicIp(ESSID, {
      readByEssid: storedIp(null),
      drawIp: drawSequence(['45.1.1.1', '45.2.2.2', '45.3.3.3']),
      claim,
      maxAttempts: 3,
    });

    // The bound is exactly maxAttempts: the 3rd attempt must still run (this fails
    // if the loop stops one short) yet a 4th must not be needed.
    expect(result).toBe('45.3.3.3');
  });
});
