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
import type { OccupantProjection } from './resolveOccupants';

const lastOctet = (ip: string): number => Number(ip.split('.')[3]);

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
