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
import { seedInnerGatewayHostname, seedRouterHostname } from './routerFs';
import type { Ipv4 } from '../network/interfaces';

export type LanHostKind = 'machine' | 'router' | 'switch';

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

  // The `.1` router is the viewer's OWN home router (own-LAN view), so its name
  // seeds off the viewer's key — the same owner-key the server uses to recover it
  // when stamping a cross-player log line (Story 6).
  const gateway: LanHost = {
    ip: `${subnet}.1`,
    hostname: seedRouterHostname(seedPubkeyHex),
    kind: 'router',
  };
  const self: LanHost = { ip: localIp, hostname, kind: 'machine' };

  // Seeded by identity+ESSID like the assignment (own namespace to keep the draw
  // order independent). Usable host octets are 2..254 minus the player's own;
  // .1 (gateway) is already excluded by starting at 2. A SINGLE `pickN` covers the
  // inner gateway plus every sibling, so its without-replacement guarantee makes
  // all of them distinct from each other (and from `.1`/self) with no rejection
  // loop. The first octet drawn becomes the inner gateway — a second router that
  // fronts the player's deeper layers — and the rest are ordinary machines.
  const prng = createPrng(`home-lan-${seedPubkeyHex}-${essid}`);
  const count = prng.nextInt(HOST_COUNT_MIN, HOST_COUNT_MAX);
  const usableOctets = Array.from({ length: 253 }, (_, index) => index + 2).filter(
    (octet) => octet !== selfOctet,
  );
  const [gatewayOctet, ...siblingOctets] = prng.pickN(usableOctets, count + 1);
  const innerGateway: LanHost = {
    ip: `${subnet}.${gatewayOctet}`,
    hostname: seedInnerGatewayHostname(seedPubkeyHex, gatewayOctet),
    kind: 'router',
  };
  const siblings: readonly LanHost[] = siblingOctets.map(
    (octet): LanHost => ({
      ip: `${subnet}.${octet}`,
      hostname: `${prng.pick(DEVICE_TYPES)}-${octet}`,
      kind: 'machine',
    }),
  );

  // The switch is a SECOND inner gateway. It is drawn LAST, from the octets the
  // gateway+sibling draw left behind, so it can never collide with them and — by
  // coming after the sibling hostname picks above — leaves every earlier draw (and
  // the names seeded off it) byte-stable. Adding the switch only appends a host.
  const taken = new Set([gatewayOctet, ...siblingOctets]);
  const [switchOctet] = prng.pickN(
    usableOctets.filter((octet) => !taken.has(octet)),
    1,
  );
  const innerSwitch: LanHost = {
    ip: `${subnet}.${switchOctet}`,
    hostname: seedInnerGatewayHostname(seedPubkeyHex, switchOctet),
    kind: 'switch',
  };

  const hosts = [gateway, self, innerGateway, innerSwitch, ...siblings].sort(
    (left, right) => lastOctet(left) - lastOctet(right),
  );
  return { subnet, hosts };
};
