/**
 * generateHomeLan — pure NPC topology for an ACCESS POINT's LAN, behind
 * `nmap <subnet>`: the AP gateway at `.1`, an inner gateway, a switch, and sibling
 * machines. Seeded by the ESSID ALONE, so every occupant of a network sees one
 * population: the same machines, at the same addresses, under the same names.
 *
 * The LAN belongs to the access point, not to whoever is looking at it. Seeding it
 * per viewer made each occupant's `nmap` a private illusion — two players standing
 * on one `/24` disagreed about what was on it, and a file one of them wrote to an
 * NPC was invisible to the other because their "same" host was a different machine.
 *
 * It does NOT place the player. A player's own address is the one it holds a LEASE
 * on — server-issued at join, carried on `wlan0` — while this module is a pure
 * function of the ESSID with no view of the lease store. So the own-view caller
 * appends its own host at the address the interface actually holds, the same way
 * `mergeLanOccupants` overlays fellow occupants. Every other consumer (the server
 * scan, the ssh reach gates, the inner-gateway lookups) only ever wanted the NPC
 * filler, so none of them needs a lease read to agree with the client.
 *
 * Nothing here is held vacant for the player. The allocator excludes these octets
 * when it issues a lease, so an occupant can never be placed on top of an NPC —
 * which is the only reason a reservation existed while the population was private.
 */

import { createPrng } from './prng';
import { machineRole } from './machineRole';
import { HOSTNAME_PREFIXES } from './pools/hostnames';
import { lanSubnetPrefix } from '../network/lanAddress';
import { seedApGatewayHostname, seedInnerGatewayHostname } from './routerFs';
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

export const generateHomeLan = (essid: string): HomeLan => {
  const subnet = lanSubnetPrefix(essid);

  // The `.1` is the ACCESS POINT's gateway, not the viewer's own box, so its name
  // seeds off the ESSID — every occupant sees the same gateway under the same name,
  // and the server recovers that name from the ESSID alone when stamping a
  // cross-player log line.
  const gateway: LanHost = {
    ip: `${subnet}.1`,
    hostname: seedApGatewayHostname(essid),
    kind: 'router',
  };

  // Seeded by the ESSID alone (own namespace to keep the draw order independent of
  // the subnet's). Usable host octets are 2..254; .1 (the gateway) is excluded by
  // starting at 2. A SINGLE `pickN` covers the inner gateway plus every sibling, so
  // its without-replacement guarantee makes all of them distinct from each other and
  // from `.1` with no rejection loop. The first octet drawn becomes the inner gateway
  // — a second router that fronts the deeper layers — and the rest are ordinary
  // machines.
  const prng = createPrng(`home-lan-${essid}`);
  const count = prng.nextInt(HOST_COUNT_MIN, HOST_COUNT_MAX);
  const usableOctets = Array.from({ length: 253 }, (_, index) => index + 2);
  const [gatewayOctet, ...siblingOctets] = prng.pickN(usableOctets, count + 1);
  const innerGateway: LanHost = {
    ip: `${subnet}.${gatewayOctet}`,
    hostname: seedInnerGatewayHostname(essid, gatewayOctet),
    kind: 'router',
  };
  // The name says what the box is for as well as where it is. The ROLE comes off its
  // own stream — appending a draw here would move every value picked after it,
  // including the switch's octet below, and the lease allocator excludes these octets
  // when it issues an occupant an address. Naming is still exactly ONE `pick` per
  // sibling, whatever the chosen pool's size, so the addresses do not move.
  const siblings: readonly LanHost[] = siblingOctets.map((octet): LanHost => {
    const ip = `${subnet}.${octet}`;
    return {
      ip,
      hostname: `${prng.pick(HOSTNAME_PREFIXES[machineRole(essid, ip)])}-${octet}`,
      kind: 'machine',
    };
  });

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
    hostname: seedInnerGatewayHostname(essid, switchOctet),
    kind: 'switch',
  };

  const hosts = [gateway, innerGateway, innerSwitch, ...siblings].sort(
    (left, right) => lastOctet(left) - lastOctet(right),
  );
  return { subnet, hosts };
};
