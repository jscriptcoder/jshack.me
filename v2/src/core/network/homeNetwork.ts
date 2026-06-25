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
  // stands on — two identities on one ESSID land on one reachable LAN.
  const subnet = createPrng(`home-subnet-${essid}`).nextInt(0, 255);

  // The host octet + device name stay per-(identity, ESSID): each occupant gets a
  // distinct address on the shared subnet (local DHCP-style draw). Draw order is
  // part of the contract (golden-locked): host, then device. The host octet
  // avoids .0/.1 (network + gateway) and .255 (broadcast).
  const prng = createPrng(`home-${seedPubkeyHex}-${essid}`);
  const host = prng.nextInt(2, 254);
  const device = prng.pick(DEVICE_TYPES);

  return { localIp: `192.168.${subnet}.${host}`, hostname: `${device}-${host}` };
};
