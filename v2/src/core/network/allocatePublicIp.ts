/**
 * allocatePublicIp — pure server-side public-IP allocation for a network.
 *
 * A network's WAN address belongs to the AP (one per ESSID, shared by every
 * occupant) and must be globally unique across ESSIDs. This is the pure
 * orchestration of that: read any existing allocation first (a re-join returns
 * the same address with no wasted write), else draw a candidate and claim it
 * against a UNIQUE-constrained store, retrying past collisions until one sticks.
 * The store effects are injected so this stays framework-agnostic core/ — the
 * Supabase wiring (an `INSERT … ON CONFLICT (essid) DO UPDATE … RETURNING`) lives
 * in the api/ adapter.
 */

export type AllocatePublicIpDeps = {
  /** The IP already allocated to this ESSID, or null if none yet. */
  readonly readByEssid: (essid: string) => Promise<string | null>;
  /** Draw a candidate public IP (server randomness in production). */
  readonly drawIp: () => string;
  /**
   * Atomically bind (essid → ip). Returns the IP now bound to the ESSID — the
   * drawn one if it stuck, or a concurrent first-joiner's if they won the (essid)
   * race — or null if the drawn IP already belongs to ANOTHER ESSID (redraw).
   */
  readonly claim: (essid: string, ip: string) => Promise<string | null>;
  /** Safety bound on collision redraws. Exhaustion is astronomically unlikely
   *  over the routable address space, so this only guards against a pathological
   *  loop, never a real allocation path. */
  readonly maxAttempts?: number;
};

const DEFAULT_MAX_ATTEMPTS = 8;

export const allocatePublicIp = async (
  essid: string,
  deps: AllocatePublicIpDeps,
): Promise<string> => {
  const existing = await deps.readByEssid(essid);
  if (existing !== null) return existing;

  const maxAttempts = deps.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const bound = await deps.claim(essid, deps.drawIp());
    if (bound !== null) return bound;
  }
  throw new Error(`public IP allocation exhausted after ${maxAttempts} attempts`);
};
