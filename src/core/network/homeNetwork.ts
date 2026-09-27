/**
 * Home-network assignment — the player's NAME on a LAN, and the PREFERRED address
 * the server offers it there.
 *
 * `localIp` is no longer the address the player uses. That is a LEASE the server
 * allocates on join (`allocateLanLease` → `network_lan_leases`), because two players
 * on one AP whose identities happened to seed the same octet would otherwise answer
 * to the same address. What survives here is the address the allocator OFFERS FIRST:
 * seeding from this derivation means everyone whose preferred octet is free keeps it,
 * so introducing leases relocated nobody except genuinely-colliding players. It is
 * also the octet `generateHomeLan` holds vacant, so the lease has somewhere to land.
 *
 * The `hostname` is still purely derived and still the player's real name on the LAN:
 * only the ADDRESS was contested, so only the address became server-authoritative.
 * Its derivation is golden-locked in the test.
 */

import { createPrng } from '../generation/prng';
import { lanSubnetFor } from './lanAddress';
import type { Ipv4 } from './interfaces';

export type HomeNetworkAssignment = {
  readonly localIp: Ipv4;
  readonly hostname: string;
};

/** DHCP-style client names — the assigned hostname is one of these plus the
 *  host octet. Flavour only (not shown in `nmcli` output yet), but pinned by
 *  the seam's golden test. */
export const DEVICE_TYPES = [
  'desktop',
  'laptop',
  'android',
  'iphone',
  'tablet',
  'workstation',
] as const;

export const assignHomeNetwork = (seedPubkeyHex: string, essid: string): HomeNetworkAssignment => {
  // The /24 (third octet) belongs to the AP, not the player: seeded by ESSID
  // ALONE so every occupant of the same network shares the subnet (mirrors the
  // public IP below). This is the addressing precondition shared-LAN occupancy
  // stands on — two identities on one ESSID land on one reachable LAN. Shared with
  // the lease readers, which form their addresses on the same subnet.
  const subnet = lanSubnetFor(essid);

  // The host octet + device name stay per-(identity, ESSID): each occupant gets a
  // distinct address on the shared subnet (local DHCP-style draw). Draw order is
  // part of the contract (golden-locked): host, then device. The host octet
  // avoids .0/.1 (network + gateway) and .255 (broadcast).
  const prng = createPrng(`home-${seedPubkeyHex}-${essid}`);
  const host = prng.nextInt(2, 254);
  const device = prng.pick(DEVICE_TYPES);

  return { localIp: `192.168.${subnet}.${host}`, hostname: `${device}-${host}` };
};
