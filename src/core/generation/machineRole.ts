/**
 * machineRole — what a generated NPC box is FOR, as against what it is in the
 * topology. `LanHostKind` already answers the second question (does this thing
 * route?); this answers the first, and the two together are what let a player read
 * a scan before probing it.
 *
 * DERIVED, NOT STORED — computed from the same coordinates a host's services and
 * its backdoor are, and for the same reason: two occupants scanning one box must
 * agree about it, and neither of them carries the answer. Nothing about a role
 * travels; it is recomputed wherever it is wanted.
 *
 * Its stream is its OWN (`role-…`), never a continuation of a caller's PRNG.
 * Appending a draw to the LAN generator's sequence would move every value picked
 * after it — including the octets the lease allocator excludes when it issues an
 * occupant an address, which would put a player on top of an NPC.
 *
 * The vocabulary is legacy's, adopted rather than coined: these are the same roles
 * `MachineRole` named in the app this one replaces.
 */

import { createPrng } from './prng';
import type { Ipv4 } from '../network/interfaces';

/** The roles a generated MACHINE is drawn from. `router` and `switch` are roles too,
 *  but a host's `kind` already knows which hosts hold them, so they are never
 *  drawn — see `MachineRole`. */
export const DRAWN_ROLES = [
  'workstation',
  'iot',
  'webserver',
  'fileserver',
  'database',
  'mailserver',
  'dns',
] as const;

export type DrawnRole = (typeof DRAWN_ROLES)[number];

/** Every role in the world: the seven a machine is drawn from, plus the two that
 *  are read off a host's `kind` rather than rolled for. */
export type MachineRole = DrawnRole | 'router' | 'switch';

/**
 * Draw weights, out of 100. These are HOME networks — the player finds them by
 * wardriving, and the boxes on them are somebody's flat, not somebody's rack. So
 * personal devices and cameras make up most of a LAN, a box that publishes or
 * serves files is an occasional find, and a database, mail or DNS box is a genuine
 * one. The three rarest are also, for now, the three whose door has not shipped:
 * a `db-11` cannot run mysql until D6, so meeting one seldom is the point.
 */
const WEIGHTS: Readonly<Record<DrawnRole, number>> = {
  workstation: 32,
  iot: 26,
  webserver: 16,
  fileserver: 12,
  database: 7,
  mailserver: 4,
  dns: 3,
};

/**
 * The weights expanded into one entry per point, so drawing a role is the SAME
 * uniform `pick` every other generated choice already uses. A cumulative-threshold
 * walk would need a fallback branch for a draw past the last threshold — a branch
 * `next()`'s [0, 1) range makes unreachable, and therefore one no test could ever
 * kill.
 */
const WEIGHTED_ROLES: readonly DrawnRole[] = DRAWN_ROLES.flatMap((role) =>
  Array.from({ length: WEIGHTS[role] }, () => role),
);

/** The role of the machine at `ip` on the network `seed` identifies. */
export const machineRole = (seed: string, ip: Ipv4): DrawnRole =>
  createPrng(`role-${seed}-${ip}`).pick(WEIGHTED_ROLES);
