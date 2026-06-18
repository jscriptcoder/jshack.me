/**
 * generateHomeLan — pure topology for the player's connected home LAN, behind
 * `nmap <subnet>` (generator epic, Story 2).
 *
 * It reuses `assignHomeNetwork` so the subnet it reports is exactly the one the
 * player was issued (same identity + ESSID ⇒ same LAN, every reload). Slice 1
 * returns the minimum observable topology: the gateway at `.1` (a router) and
 * the player's own host. Sibling hosts are seeded in Slice 2.
 */

import { createPrng } from './prng';
import { assignHomeNetwork, DEVICE_TYPES } from '../network/homeNetwork';
import type { Ipv4 } from '../network/interfaces';

export type LanHostKind = 'machine' | 'router';

export type LanHost = {
  readonly ip: Ipv4;
  readonly hostname: string;
  readonly kind: LanHostKind;
};

export type HomeLan = {
  /** The `/24` prefix the player sits on, e.g. `192.168.188`. */
  readonly subnet: string;
  /** Hosts in ascending-octet order; `.1` gateway first. */
  readonly hosts: readonly LanHost[];
};

/** Sibling-machine count drawn per LAN (excludes the gateway and the player). */
const HOST_COUNT_MIN = 3;
const HOST_COUNT_MAX = 8;

const lastOctet = (host: LanHost): number => Number(host.ip.split('.')[3]);

export const generateHomeLan = (seedPubkeyHex: string, essid: string): HomeLan => {
  const { localIp, hostname } = assignHomeNetwork(seedPubkeyHex, essid);
  const subnet = localIp.split('.').slice(0, 3).join('.');
  const selfOctet = Number(localIp.split('.')[3]);

  const gateway: LanHost = { ip: `${subnet}.1`, hostname: 'gateway', kind: 'router' };
  const self: LanHost = { ip: localIp, hostname, kind: 'machine' };

  // Seeded by identity+ESSID like the assignment (own namespace to keep the draw
  // order independent). Usable host octets are 2..254 minus the player's own;
  // .1 (gateway) is already excluded by starting at 2. `pickN` gives distinct
  // octets without a rejection loop.
  const prng = createPrng(`home-lan-${seedPubkeyHex}-${essid}`);
  const count = prng.nextInt(HOST_COUNT_MIN, HOST_COUNT_MAX);
  const usableOctets = Array.from({ length: 253 }, (_, index) => index + 2).filter(
    (octet) => octet !== selfOctet,
  );
  const siblings: readonly LanHost[] = prng.pickN(usableOctets, count).map(
    (octet): LanHost => ({
      ip: `${subnet}.${octet}`,
      hostname: `${prng.pick(DEVICE_TYPES)}-${octet}`,
      kind: 'machine',
    }),
  );

  const hosts = [gateway, self, ...siblings].sort(
    (left, right) => lastOctet(left) - lastOctet(right),
  );
  return { subnet, hosts };
};
