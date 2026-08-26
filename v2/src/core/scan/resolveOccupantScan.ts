/**
 * handleResolveOccupantScan — server-side resolution of an own-LAN `nmap` of a FELLOW
 * OCCUPANT, the one host on a player's own WiFi whose ports they cannot read for
 * themselves.
 *
 * Every other host on the LAN is the client's to resolve: a generated sibling's
 * filesystem keys on the host IP, so scanning it is arithmetic the viewer can do
 * offline. A real player's box cannot be reached that way — it is built from THEIR
 * identity and THEIR journal — and falling through to the generator would report the
 * NPC this viewer's dice would have rolled at that octet: somebody else's machine
 * described by somebody else's world. That fabrication is why the scan reported a
 * neighbour with no port table at all until this handler existed.
 *
 * It resolves ONE address, and only when that address is actually scanned. Putting
 * ports on the occupant LIST instead would make `ssh`, `nc`, and both data doors each
 * read a journal per occupant to learn a name and an address they were already given.
 *
 * The LAN boundary is the one `handleResolveOccupants` already draws: you learn what
 * runs on a WiFi by being on it, checked against the verified pubkey rather than any
 * client claim. Without it, one signed request per address would enumerate the running
 * services of every player in the game.
 *
 * Three answers stay apart, because the client turns them into three different
 * sentences. A box that will not boot is DOWN — the boot gate is what stops a bricked
 * machine advertising doors it no longer holds. An address no occupant answers to is
 * down too, which is what a neighbour who has just left the WiFi looks like. A lookup
 * that FAILS is a 500 and neither of those: reported as "no ports" it would be the scan
 * asserting a fact it does not have, and reported as "down" it would blame a live
 * neighbour for our own outage.
 */

import { z } from 'zod';
import { verifySignedRequest } from '../signedRequest/verify';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus';
import { lanAddressesByOwner, type LanLeaseRow } from '../network/lanAddress';
import { bootableOccupantFs } from '../network/natHosts';
import { readOpenPorts } from '../services/pidfile';
import type { OwnerPatchRow } from '../network/materializeWorkstationFs';
import type { NatOccupantRow } from './resolvePublicScan';
import type { NonceStore } from '../signedRequest/nonceStore';

export type ResolveOccupantScanDeps = {
  readonly nonceStore: NonceStore;
  /** Who is currently ON the ESSID. Both halves of the reach: the caller's own row is
   *  the LAN boundary, and the target's row carries the identity their tree rebuilds
   *  from. Occupancy is the reachability test, so a player who ran `nmcli disconnect`
   *  is simply not here. */
  readonly listOccupantsByEssid: (
    essid: string,
  ) => Promise<{ readonly data: readonly NatOccupantRow[] | null; readonly error: unknown }>;
  /** Every lease held on this ESSID, in ONE read — the addresses of record. The same
   *  read the same-LAN doors resolve addresses from, so a scan and a connection can
   *  never disagree about which box answers where. */
  readonly listLeasesByEssid: (
    essid: string,
  ) => Promise<{ readonly data: readonly LanLeaseRow[] | null; readonly error: unknown }>;
  /** The target's FULL patch journal, replayed over their generated base so the scan
   *  reads the box as it IS: a daemon they started, one they stopped, a `/boot`
   *  tombstone that took the whole machine dark. */
  readonly findPatches: (query: {
    readonly machine_id: string;
  }) => Promise<{ readonly data: readonly OwnerPatchRow[] | null; readonly error: unknown }>;
};

export type HandlerResponse = {
  readonly status: number;
  readonly body: Record<string, unknown>;
};

// Loose so the envelope fields pass through; the refine keeps the codebase-wide
// posture that a client never claims identity (the caller is the verified pubkey).
const resolveOccupantScanSchema = z
  .looseObject({
    action: z.literal('resolveOccupantScan'),
    essid: z.string().min(1),
    target: z.string().min(1),
  })
  .refine((payload) => !('player_key' in payload));

const HOST_DOWN: HandlerResponse = { status: 200, body: { ok: true, found: false, ports: [] } };

export const handleResolveOccupantScan = async (
  body: unknown,
  deps: ResolveOccupantScanDeps,
): Promise<HandlerResponse> => {
  const verified = await verifySignedRequest(body, resolveOccupantScanSchema, {
    nonceStore: deps.nonceStore,
  });
  if (!verified.ok) {
    return { status: STATUS_BY_VERIFY_REASON[verified.reason], body: { error: verified.reason } };
  }
  const { publicKey, payload } = verified;

  const occupants = await deps.listOccupantsByEssid(payload.essid);
  if (occupants.error) {
    return { status: 500, body: { error: 'occupants_lookup_failed' } };
  }
  const rows = occupants.data ?? [];

  // LAN boundary first, so no address and no service list reaches a caller who is not
  // standing on this network.
  if (!rows.some((row) => row.owner_key === publicKey)) {
    return { status: 403, body: { error: 'not_an_occupant' } };
  }

  const leases = await deps.listLeasesByEssid(payload.essid);
  if (leases.error) {
    return { status: 500, body: { error: 'leases_lookup_failed' } };
  }
  const addresses = lanAddressesByOwner(payload.essid, leases.data ?? []);

  // Self is excluded deliberately rather than incidentally: a player's own ports come
  // off the live filesystem their shell is standing on, which shows a daemon started
  // this second — something a round-trip through the journal cannot promise.
  const occupant = rows.find(
    (row) => row.owner_key !== publicKey && addresses.get(row.owner_key) === payload.target,
  );
  if (occupant === undefined) {
    return HOST_DOWN;
  }

  const patches = await deps.findPatches({ machine_id: occupant.workstation_machine_id });
  if (patches.error) {
    return { status: 500, body: { error: 'patches_lookup_failed' } };
  }

  const occupantFs = bootableOccupantFs(occupant, patches.data);
  return occupantFs === null
    ? HOST_DOWN
    : { status: 200, body: { ok: true, found: true, ports: readOpenPorts(occupantFs) } };
};
