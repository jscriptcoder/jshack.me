/**
 * mergeLanOccupants — overlay the REAL same-LAN occupants (the server occupant read)
 * onto the ESSID's GENERATED topology, so an `nmap <subnet>` from inside the LAN shows
 * fellow players as real hosts.
 *
 * The generated `HomeLan` is the access point's NPC filler (`generateHomeLan`); the
 * occupants are the authoritative cross-player state. On an octet collision the
 * OCCUPANT wins over the generated host, whatever kind it is: a real player answering
 * at a real address is never something a scan may silently omit.
 *
 * Gateway devices used to be an exception — a colliding occupant was dropped so the
 * viewer kept its own depth entry. That rule existed because the population was drawn
 * per viewer, which put the collision beyond the allocator's reach: an occupant's octet
 * seeded off its own key, so no allocation could dodge a host only the viewer could see.
 * With one population per ESSID the allocator excludes these octets outright, so the
 * collision no longer arises from allocation and hiding an occupant would buy nothing.
 *
 * The caller is already excluded server-side (`handleResolveOccupants` drops the
 * requester), so the viewer's own host is never an occupant here and survives the merge.
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
