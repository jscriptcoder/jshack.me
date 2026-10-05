// Shared wire-check setup: put a signing identity ON a network so the server can place
// it. The own-LAN login doors (`authCreateSession` and the data doors that reuse it)
// derive the caller's network and source address from their occupancy + lease rows, and
// refuse a caller they cannot place — so a wire-check whose signer logs in from home must
// seat them here first. This is the live-stack twin of `callerVantage`'s `findHomeVantage`
// input, kept in one place because every own-LAN check needs the identical two rows.

import type { SupabaseClient } from '@supabase/supabase-js';
import { computeWorkstationId } from '../src/core/identity/workstation.js';
import { md5 } from '../src/core/generation/md5.js';

type Identity = { readonly publicKeyHex: string };

/** Seat `owner` on `essid` as a leased occupant at `octet`. `upsert` so a crashed earlier
 *  run's row is overwritten rather than colliding on the `(essid, owner_key)` key. */
export const standOnNetwork = async (
  sr: SupabaseClient,
  essid: string,
  owner: Identity,
  octet: number,
  wsName = 'rig',
): Promise<void> => {
  await sr.from('home_network_occupants').upsert({
    essid,
    owner_key: owner.publicKeyHex,
    workstation_machine_id: computeWorkstationId(wsName, owner.publicKeyHex),
    workstation_username: 'player',
    workstation_machine_name: wsName,
    workstation_root_hash: md5('root-secret'),
  });
  await sr.from('network_lan_leases').upsert({ essid, owner_key: owner.publicKeyHex, octet });
};

/** Tear down every occupant and lease on `essid` — the teardown half, run at setup and
 *  teardown so an ESSID-seeded run never reads a crashed earlier run's rows as its own. */
export const leaveNetwork = async (sr: SupabaseClient, essid: string): Promise<void> => {
  await sr.from('home_network_occupants').delete().eq('essid', essid);
  await sr.from('network_lan_leases').delete().eq('essid', essid);
};
