/**
 * generateHomeLan — pure NPC topology for an ACCESS POINT's LAN, behind
 * `nmap <subnet>`: the AP gateway at `.1`, an inner gateway, a switch, and sibling
 * machines, or for a network declared `lone` or `flat`, the gateway and its machines
 * alone. Seeded by the ESSID ALONE, so every occupant of a network sees one
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

import { createPrng, type Prng } from './prng.js';
import { machineRole, type DrawnRole } from './machineRole.js';
import { publisherSite } from './publisher.js';
import { declaredNetwork } from './world.js';
import { HOSTNAME_PREFIXES } from './pools/hostnames.js';
import { lanSubnetPrefix } from '../network/lanAddress.js';
import { seedApGatewayHostname, seedInnerGatewayHostname } from './gatewayHostname.js';
import type { Ipv4 } from '../network/interfaces.js';

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
/** How many machines stand behind the gateway of a `flat` network. */
const FLAT_COUNT_MIN = 2;
const FLAT_COUNT_MAX = 5;

const lastOctet = (host: LanHost): number => Number(host.ip.split('.')[3]);

/** A LAN's hosts in ascending-octet order, the order `HomeLan` promises. */
const byOctet = (hosts: readonly LanHost[]): readonly LanHost[] =>
  [...hosts].sort((left, right) => lastOctet(left) - lastOctet(right));

/**
 * The machines at `octets` on `essid`'s LAN, each named for what it is for.
 *
 * The ROLE comes off its own stream: appending a draw to the LAN's would move every value
 * picked after it, including a switch's octet, and the lease allocator excludes these
 * octets when it issues an occupant an address. Naming is exactly ONE `pick` per machine,
 * whatever the chosen pool's size, so the addresses do not move.
 *
 * An institution that publishes a website needs a box to serve it from. When none of its
 * machines drew that role, the lowest-addressed one takes it instead: an override rather
 * than a draw, for the same reason.
 */
const machinesAt = (
  essid: string,
  subnet: string,
  octets: readonly number[],
  prng: Prng,
): readonly LanHost[] => {
  const drawn = octets.map((octet) => ({ octet, role: machineRole(essid, `${subnet}.${octet}`) }));
  const needsWebserver =
    publisherSite(essid) !== undefined && !drawn.some(({ role }) => role === 'webserver');
  const lowest = Math.min(...octets);
  return drawn.map(({ octet, role }): LanHost => {
    const servedRole: DrawnRole = needsWebserver && octet === lowest ? 'webserver' : role;
    return {
      ip: `${subnet}.${octet}`,
      hostname: `${prng.pick(HOSTNAME_PREFIXES[servedRole])}-${octet}`,
      kind: 'machine',
    };
  });
};

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
  const usableOctets = Array.from({ length: 253 }, (_, index) => index + 2);

  // A `lone` or `flat` network is its gateway and the machines behind it: no inner
  // gateway, no switch, and so no deeper layer. A landmark declares no profile and keeps
  // the shape it was authored with.
  const profile = declaredNetwork(essid)?.profile ?? 'deep';
  if (profile !== 'deep') {
    const count = profile === 'lone' ? 1 : prng.nextInt(FLAT_COUNT_MIN, FLAT_COUNT_MAX);
    return {
      subnet,
      hosts: byOctet([
        gateway,
        ...machinesAt(essid, subnet, prng.pickN(usableOctets, count), prng),
      ]),
    };
  }

  const count = prng.nextInt(HOST_COUNT_MIN, HOST_COUNT_MAX);
  const [gatewayOctet, ...siblingOctets] = prng.pickN(usableOctets, count + 1);
  const innerGateway: LanHost = {
    ip: `${subnet}.${gatewayOctet}`,
    hostname: seedInnerGatewayHostname(essid, gatewayOctet),
    kind: 'router',
  };
  const siblings = machinesAt(essid, subnet, siblingOctets, prng);

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

  return { subnet, hosts: byOctet([gateway, innerGateway, innerSwitch, ...siblings]) };
};

/** Whether `host` is one of the machines on `essid`'s home LAN, rather than a box on a
 *  deeper layer. Matched on address AND name: a deep layer's subnet never overlaps the
 *  home LAN's, but asking both keeps the answer honest if one ever did. A deep box cannot
 *  know what its own layer holds, so content that names neighbours asks this first. */
export const isOnHomeLan = (essid: string, host: LanHost): boolean =>
  generateHomeLan(essid).hosts.some(
    (candidate) => candidate.ip === host.ip && candidate.hostname === host.hostname,
  );
