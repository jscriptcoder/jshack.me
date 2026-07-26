/**
 * mergeLanOccupants — overlay the REAL same-LAN occupants (the server occupant read)
 * onto a viewer's GENERATED home-LAN topology, so an `nmap <subnet>` from inside the
 * LAN shows fellow players as real hosts.
 *
 * The generated `HomeLan` is per-viewer NPC filler (`generateHomeLan`); the occupants
 * are the authoritative cross-player state. On an octet collision the OCCUPANT wins
 * over a generated MACHINE sibling: that NPC is dropped and the occupant added in its
 * place. The exception is a generated gateway device — the inner router/switch that
 * fronts the viewer's private deeper layers (`kind !== 'machine'`). Those octets are
 * RESERVED: an occupant that lands on one is omitted from this viewer's LAN (it is still
 * in `home_network_occupants` and attackable via its public IP), because the viewer's
 * own depth entry must outrank one fellow player's same-LAN visibility. The collision is
 * structural — an occupant's octet seeds off the OCCUPANT's own key, so it is
 * viewer-independent and can't be dodged at allocation; a collision-free unique-IP
 * allocator is the deferred proper fix.
 *
 * The caller is already excluded server-side (`handleResolveOccupants` drops the
 * requester), so the viewer's own host is never an occupant here and survives the merge
 * — except under the rare unallocated-IP clash where an occupant lands on the viewer's
 * own octet, in which case "occupant wins" still applies (a noted, deferred imperfection).
 */

import type { HomeLan, LanHost } from '../generation/generateHomeLan';
import type { Ipv4 } from './interfaces';
import type { OccupantProjection } from './resolveOccupants';

const lastOctet = (ip: string): number => Number(ip.split('.')[3]);

/**
 * Place the VIEWER's own host on the generated filler, at the address `wlan0` holds
 * — the lease the join issued. `generateHomeLan` deliberately does not place the
 * player: it is a pure identity+ESSID derivation with no view of the lease store,
 * and the two disagree for a player the server relocated off a contested octet.
 *
 * A generated host on that octet is DROPPED rather than reserved — the opposite of
 * the occupant rule below, and deliberately so. A fellow occupant is one of many and
 * can be omitted from this viewer's LAN; the viewer cannot be omitted from its own.
 * The lease is the authority on who answers at that address. This only ever bites a
 * relocated player, since the allocator offers the derived octet — the one the
 * generator holds vacant — first.
 */
export const withSelfHost = (lan: HomeLan, localIp: Ipv4, hostname: string): HomeLan => {
  const selfOctet = lastOctet(localIp);
  const self: LanHost = { ip: localIp, hostname, kind: 'machine' };
  const hosts = [...lan.hosts.filter((host) => lastOctet(host.ip) !== selfOctet), self].sort(
    (left, right) => lastOctet(left.ip) - lastOctet(right.ip),
  );
  return { subnet: lan.subnet, hosts };
};

export const mergeLanOccupants = (
  lan: HomeLan,
  occupants: readonly OccupantProjection[],
): HomeLan => {
  // Gateway devices (router/switch) hold their octet against a colliding occupant.
  const reservedOctets = new Set(
    lan.hosts.filter((host) => host.kind !== 'machine').map((host) => lastOctet(host.ip)),
  );
  const visibleOccupants = occupants.filter(
    (occupant) => !reservedOctets.has(lastOctet(occupant.localIp)),
  );
  const occupantOctets = new Set(visibleOccupants.map((occupant) => lastOctet(occupant.localIp)));
  const generated = lan.hosts.filter((host) => !occupantOctets.has(lastOctet(host.ip)));
  const occupantHosts: readonly LanHost[] = visibleOccupants.map((occupant) => ({
    ip: occupant.localIp,
    hostname: occupant.machineName,
    kind: 'machine',
  }));
  const hosts = [...generated, ...occupantHosts].sort(
    (left, right) => lastOctet(left.ip) - lastOctet(right.ip),
  );
  return { subnet: lan.subnet, hosts };
};
