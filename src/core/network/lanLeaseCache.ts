/**
 * lanLeaseCache — the client's copy of the LAN address the server leased it.
 *
 * A player's own address stopped being derivable the moment it became a lease: the
 * server allocates it, and a relocated player's address is one no local computation
 * can reproduce. That would make every reconnect a mandatory round-trip, which the
 * offline-first posture of the rest of the client refuses — `restoreConnection` is
 * synchronous and runs before anything is fetched.
 *
 * So each successful join writes the issued address here, keyed by ESSID, and a
 * reconnect to a network the player already holds a lease on reads it back. The
 * cache is only ever a COPY of a real lease — never an allocator. A first-ever join
 * to a new ESSID with the server unreachable therefore fails rather than falling
 * back to the derivation: an address nobody issued could collide with a real
 * occupant and would change under the player on the next successful join.
 *
 * `Storage` is injected rather than reaching for `localStorage`, so the round-trip
 * is pure and unit-testable with a fake map (the same seam `connectionPersistence`
 * uses; the UI supplies the real one).
 */

import type { Ipv4 } from './interfaces';

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** One key per ESSID: a player holds a separate lease on every network it joins,
 *  and reconnecting to any of them must return the address that network issued. */
const keyFor = (essid: string): string => `jshack:lan-lease:${essid}`;

export type LanLeaseCache = {
  readonly remember: (essid: string, localIp: Ipv4) => void;
  readonly recall: (essid: string) => Ipv4 | null;
};

export const lanLeaseCacheIn = (storage: StorageLike): LanLeaseCache => ({
  remember: (essid, localIp) => {
    storage.setItem(keyFor(essid), localIp);
  },
  recall: (essid) => storage.getItem(keyFor(essid)),
});

/** A cache that remembers nothing — the posture before storage is wired, where every
 *  join must reach the server. Recall always misses, so a failed join fails cleanly
 *  instead of silently addressing the player. */
export const noLanLeaseCache: LanLeaseCache = {
  remember: () => undefined,
  recall: () => null,
};
