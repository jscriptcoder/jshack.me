/**
 * mergeLanOccupants — overlay the REAL same-LAN occupants (the server occupant read)
 * onto a viewer's GENERATED home-LAN topology, so an `nmap <subnet>` from inside the
 * LAN shows fellow players as real hosts.
 *
 * The generated `HomeLan` is per-viewer NPC filler (`generateHomeLan`); the occupants
 * are the authoritative cross-player state. On an octet collision the OCCUPANT wins: a
 * generated host whose last octet a real occupant claims is dropped and the occupant
 * added in its place. The caller is already excluded server-side
 * (`handleResolveOccupants` drops the requester), so the viewer's own host is never an
 * occupant here and survives the merge — except under the rare unallocated-IP clash
 * where an occupant lands on the viewer's own octet, in which case "occupant wins"
 * still applies (a noted, deferred imperfection).
 */

import type { HomeLan, LanHost } from '../generation/generateHomeLan';
import type { OccupantProjection } from './resolveOccupants';

const lastOctet = (ip: string): number => Number(ip.split('.')[3]);

export const mergeLanOccupants = (
  lan: HomeLan,
  occupants: readonly OccupantProjection[],
): HomeLan => {
  const occupantOctets = new Set(occupants.map((occupant) => lastOctet(occupant.localIp)));
  const generated = lan.hosts.filter((host) => !occupantOctets.has(lastOctet(host.ip)));
  const occupantHosts: readonly LanHost[] = occupants.map((occupant) => ({
    ip: occupant.localIp,
    hostname: occupant.machineName,
    kind: 'machine',
  }));
  const hosts = [...generated, ...occupantHosts].sort(
    (left, right) => lastOctet(left.ip) - lastOctet(right.ip),
  );
  return { subnet: lan.subnet, hosts };
};
