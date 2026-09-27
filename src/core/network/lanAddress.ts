/**
 * LAN addressing on an AP's `/24` — the shared shape every server-side reader uses to
 * turn a DHCP lease into the address a player is actually reachable at.
 *
 * The `/24` still belongs to the AP and is still ESSID-seeded, so every occupant of one
 * network shares it. What stopped being derived is the HOST octet: it comes from the
 * `network_lan_leases` row, allocated server-side against a uniqueness constraint, so
 * two occupants of one ESSID can never be issued the same address. An occupant with no
 * lease has no address on this LAN — callers omit it rather than invent one, which is
 * the whole point of moving off a derivation that could always produce a plausible
 * answer for an identity that held nothing.
 */

import { createPrng } from '../generation/prng';
import type { Ipv4 } from './interfaces';

/** An occupant's lease as the store holds it: which identity, which host octet. */
export type LanLeaseRow = {
  readonly owner_key: string;
  readonly octet: number;
};

/** The AP's `/24` (third octet): seeded by ESSID ALONE, so every occupant of the same
 *  network lands on one reachable subnet. This half of the address is still derived —
 *  it belongs to the access point, not to any player, so there is nothing to allocate. */
export const lanSubnetFor = (essid: string): number =>
  createPrng(`home-subnet-${essid}`).nextInt(0, 255);

/** The AP's `/24` written as an address prefix (`192.168.29`) rather than as its third
 *  octet — what a caller needs when it is forming many addresses on one subnet, or
 *  reporting the subnet itself. One place knows how an ESSID's `/24` is spelled. */
export const lanSubnetPrefix = (essid: string): string => `192.168.${lanSubnetFor(essid)}`;

/** The address a leased octet names on an ESSID's `/24`. */
export const lanAddressFor = (essid: string, octet: number): Ipv4 =>
  `${lanSubnetPrefix(essid)}.${octet}`;

/** The address behind a single-occupant lease READ, which may find nothing: no lease is
 *  no address, so the caller falls through to "reaches no host" instead of forming a
 *  plausible-looking one. The one place that absence becomes an address, so no caller
 *  has to restate the rule. */
export const leasedAddress = (essid: string, octet: number | null): Ipv4 | null =>
  octet === null ? null : lanAddressFor(essid, octet);

/** Resolve one ESSID's leases into `owner_key → LAN address`, ready for a caller that
 *  holds occupancy rows and needs each occupant's address. Built once per request from
 *  a single lease read rather than per-occupant, and off ONE subnet computation. */
export const lanAddressesByOwner = (
  essid: string,
  leases: readonly LanLeaseRow[],
): ReadonlyMap<string, Ipv4> => {
  const subnet = lanSubnetFor(essid);
  return new Map(leases.map((lease) => [lease.owner_key, `192.168.${subnet}.${lease.octet}`]));
};
