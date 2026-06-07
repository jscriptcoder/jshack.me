/**
 * generateHomeLan — pure topology for the player's connected home LAN, behind
 * `nmap <subnet>` (generator epic, Story 2).
 *
 * It reuses `assignHomeNetwork` so the subnet it reports is exactly the one the
 * player was issued (same identity + ESSID ⇒ same LAN, every reload). Slice 1
 * returns the minimum observable topology: the gateway at `.1` (a router) and
 * the player's own host. Sibling hosts are seeded in Slice 2.
 */

import { assignHomeNetwork } from '../network/homeNetwork';
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

export const generateHomeLan = (seedPubkeyHex: string, essid: string): HomeLan => {
  const { localIp, hostname } = assignHomeNetwork(seedPubkeyHex, essid);
  const subnet = localIp.split('.').slice(0, 3).join('.');

  const gateway: LanHost = { ip: `${subnet}.1`, hostname: 'gateway', kind: 'router' };
  const self: LanHost = { ip: localIp, hostname, kind: 'machine' };

  return { subnet, hosts: [gateway, self] };
};
