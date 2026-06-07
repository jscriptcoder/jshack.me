/**
 * Home-network join (connectivity arc, grill-me decision 6).
 *
 * `assignHomeNetwork` is the local-deterministic stand-in for the future
 * server-authoritative join. When the player connects to a cracked AP, `nmcli`
 * awaits this to learn the LAN address it was issued. Today it is a pure,
 * identity-seeded derivation; tomorrow it becomes the one server round-trip
 * (`/api/join-home-network`) — the `env.homeNetwork.join` seam is shaped as a
 * `Promise` precisely so swapping the impl is the only change.
 *
 * Determinism is the contract the whole persistence story leans on: storing
 * just the connected ESSID is enough to rehydrate the connection on reload,
 * because the same identity + ESSID always re-derive the same `localIp`.
 *
 * The `hostname` is the player's assigned name on the LAN (the future occupant
 * flow surfaces it). `nmcli` doesn't display it yet, but the seam returns it so
 * the server contract is fixed now — its derivation is golden-locked in the test.
 */

import { createPrng } from '../generation/prng';
import { generatePublicIp } from '../generation/ip';
import type { Ipv4 } from './interfaces';

export type HomeNetworkAssignment = {
  readonly localIp: Ipv4;
  /** The home router's WAN/public IP — shared by every occupant of the AP,
   *  so it is seeded by ESSID alone (the future `/api/join-home-network`
   *  allocates it authoritatively). Source IP for off-network traffic. */
  readonly publicIp: Ipv4;
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
  const prng = createPrng(`home-${seedPubkeyHex}-${essid}`);
  // Draw order is part of the contract (golden-locked): subnet, then host, then
  // device. The host octet avoids .0/.1 (network + gateway) and .255 (broadcast).
  const subnet = prng.nextInt(0, 255);
  const host = prng.nextInt(2, 254);
  const device = prng.pick(DEVICE_TYPES);

  // The public IP is seeded by ESSID ALONE (not the player's pubkey): the WAN
  // address belongs to the router, so all occupants of the same AP share it.
  const publicIp = generatePublicIp(createPrng(`home-public-${essid}`));

  return { localIp: `192.168.${subnet}.${host}`, publicIp, hostname: `${device}-${host}` };
};
