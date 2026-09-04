/**
 * Name resolution for the network the player is standing on.
 *
 * Every target in this game is typed as an address: a scan prints `web-04` and the
 * player types `192.168.188.37`. This is what makes the printed name usable —
 * the same question a real `nslookup` asks, answered from the same place a real
 * home network answers it.
 *
 * The ACCESS POINT's gateway is the resolver, which is why this needs no DNS box
 * on the LAN: a home router hands out the leases and therefore knows the names,
 * and every occupant of an ESSID gets that for free on the first network they
 * crack. `generateHomeLan` is the whole data source — deterministic from the ESSID,
 * so resolution is client-side with no round-trip.
 *
 * A network resolves ITS OWN names and nothing else. There is no world DNS here:
 * a name qualified with another network's domain is somebody else's business, and
 * the answer is the same `NXDOMAIN` an unknown name gets.
 */

import { generateHomeLan } from '../generation/generateHomeLan';
import type { Ipv4 } from './interfaces';
import type { OccupantProjection } from './resolveOccupants';

/** A name that resolved: what it is fully called, and where it is. */
export type ResolvedName = {
  /** The fully qualified form, `<host>.<essid-slug>.lan` — what a real resolver
   *  echoes back, and what `nslookup` prints on its `Name:` line. */
  readonly fqdn: string;
  readonly ip: Ipv4;
};

/** The DNS zone every network's names live under. Not a real TLD, deliberately:
 *  `.lan` is what home routers actually use for the names they invent, and it
 *  says at a glance that the name is local rather than out on the internet. */
const LOCAL_ZONE = 'lan';

/** An ESSID as a DNS label: lowercased, with every run of characters a hostname
 *  cannot carry collapsed to a single hyphen. `HOME-WIFI-2.4G` is a real name a
 *  real access point broadcasts, and `home-wifi-2-4g` is what it can be called
 *  inside a name. */
const essidSlug = (essid: string): string =>
  essid.toLowerCase().replace(/[^a-z0-9]+/g, '-');

/** The name as this network knows it: its own domain stripped off, so the bare and
 *  fully qualified forms are one question. A name carrying ANY other domain is left
 *  whole on purpose — it then matches no hostname and resolves to nothing, which is
 *  the honest answer to a question about somebody else's network. */
const localLabel = (essid: string, name: string): string => {
  const domain = `.${essidSlug(essid)}.${LOCAL_ZONE}`;
  return name.endsWith(domain) ? name.slice(0, -domain.length) : name;
};

/**
 * Resolve `name` against the LAN behind `essid`, or `null` when that network has
 * no such name.
 *
 * Pure and synchronous: the LAN is a function of the ESSID, so the answer is too.
 */
export const resolveLanName = (essid: string, name: string): ResolvedName | null => {
  const label = localLabel(essid, name);
  const host = generateHomeLan(essid).hosts.find((candidate) => candidate.hostname === label);
  if (host === undefined) return null;
  return { fqdn: `${host.hostname}.${essidSlug(essid)}.${LOCAL_ZONE}`, ip: host.ip };
};

/**
 * Resolve `name` against the whole network: its generated population first, then
 * the other PLAYERS standing on it.
 *
 * Fellow occupants need the second step because their boxes are not in the seed —
 * their addresses are leases issued server-side — so the only way a real player's
 * machine can answer to its name is to ask who else is here. The generated
 * population wins a tie: it is the network's own record of itself, and letting an
 * occupant claim a name already on it would let a player move somebody else's.
 *
 * `resolveOccupants` degrades to an empty list when it cannot reach the server, so
 * an outage costs a lookup its fallback and nothing else — the name simply does not
 * resolve, which is already an answer this command knows how to give.
 */
export const resolveName = async ({
  essid,
  name,
  resolveOccupants,
}: {
  readonly essid: string;
  readonly name: string;
  readonly resolveOccupants: (essid: string) => Promise<readonly OccupantProjection[]>;
}): Promise<ResolvedName | null> => {
  const generated = resolveLanName(essid, name);
  if (generated !== null) return generated;

  const label = localLabel(essid, name);
  const occupant = (await resolveOccupants(essid)).find(
    (candidate) => candidate.machineName === label,
  );
  if (occupant === undefined) return null;
  return { fqdn: `${label}.${essidSlug(essid)}.${LOCAL_ZONE}`, ip: occupant.localIp };
};

/** Whether `target` could be a name at all. An address, an octet range and a CIDR
 *  block are digits and separators; a name has a letter in it. Cheap, and the point
 *  is not the parse — it keeps every command that was already typed an ADDRESS off
 *  the occupant round-trip it would otherwise pay on every single run. */
const couldBeName = (target: string): boolean => /[a-z]/i.test(target);

/**
 * The address to actually use for `target` — resolved when it is a name this
 * network knows, and the caller's own string otherwise.
 *
 * Unchanged rather than an error on a miss, deliberately: the command then reaches
 * its existing unknown-target path and answers in its own voice, so `ssh` still
 * says `No route to host` and `curl` still says what `curl` says. One resolution
 * step in front of six commands, and not one new error message among them.
 */
export const addressForTarget = async ({
  essid,
  target,
  resolveOccupants,
}: {
  readonly essid: string;
  readonly target: string;
  readonly resolveOccupants: (essid: string) => Promise<readonly OccupantProjection[]>;
}): Promise<string> => {
  if (!couldBeName(target)) return target;
  const resolved = await resolveName({ essid, name: target, resolveOccupants });
  return resolved === null ? target : resolved.ip;
};
