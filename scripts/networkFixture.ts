/**
 * Seeding an ESSID's public IP for a wire-check — the one spelling.
 *
 * `network_public_ips` is keyed on **essid** (PRIMARY KEY) with **public_ip** merely
 * UNIQUE. A wire-check that hardcodes its own address and cleans up with
 * `.delete().eq('public_ip', …)` therefore never clears a row that the same ESSID holds
 * under a DIFFERENT address — and a real `registerNetwork` allocates exactly such rows.
 * The seed insert then violates the essid primary key.
 *
 * That failure used to be invisible: a bare `await sr.from(…).insert(…)` swallows its
 * error, so the scenario was silently never built while every check ran on regardless
 * and reported against an unmodified world. `testRouterBrick` and `testCrossPlayerRouter`
 * both sat at a false red for exactly this reason — same ESSID, different hardcoded IPs,
 * each deleting only its own.
 *
 * So both keys are cleared, and every statement is loud: a fixture that cannot be built
 * must stop the run, never soften into a passing check.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

/** One access point's identity in a fixture: the ESSID keys the row, the address is what
 *  the scenario scans and connects to. */
export type PublicIpFixture = {
  readonly essid: string;
  readonly publicIp: string;
};

const failFast = (label: string, error: { readonly message: string } | null): void => {
  if (error === null) return;
  console.error(`FATAL: ${label} failed: ${error.message}`);
  process.exit(1);
};

/** Free both keys for each network — the ESSID's row whatever address it holds, and the
 *  address itself whatever ESSID holds it. Use for teardown, and before any seed. */
export const clearPublicIps = async (
  sr: SupabaseClient,
  networks: readonly PublicIpFixture[],
): Promise<void> => {
  for (const network of networks) {
    const byEssid = await sr.from('network_public_ips').delete().eq('essid', network.essid);
    failFast(`network_public_ips clear (essid ${network.essid})`, byEssid.error);
    const byAddress = await sr.from('network_public_ips').delete().eq('public_ip', network.publicIp);
    failFast(`network_public_ips clear (public_ip ${network.publicIp})`, byAddress.error);
  }
};

/** Clear both keys, then register each ESSID at its address — the state a real
 *  `registerNetwork` leaves behind. Exits non-zero rather than let a rejected row pass
 *  for a built scenario. */
export const seedPublicIps = async (
  sr: SupabaseClient,
  networks: readonly PublicIpFixture[],
): Promise<void> => {
  await clearPublicIps(sr, networks);
  const { error } = await sr
    .from('network_public_ips')
    .insert(networks.map(({ essid, publicIp }) => ({ essid, public_ip: publicIp })));
  failFast('network_public_ips seed', error);
};
