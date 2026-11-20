/**
 * handleResolveDownHosts — which addresses the shell reaches answer with a box that can
 * no longer boot.
 *
 * A range sweep lists hosts and builds no port table for any of them, so it needs no
 * box's ports. It does need to know which boxes are still there: whether a machine was
 * bricked is on its server-side journal, and a sweep built from the seeded world alone
 * listed a halted box as up while a single-host scan of the same address called it down.
 *
 * Every box the shell can reach is asked after: the boxes the access point owns on its
 * LAN, the fellow players on the WiFi, and the boxes on each deep layer the shell's box
 * reaches. An address a player's lease holds is the player's, so the box the network
 * rolled there says nothing about it. The caller's own box is left out: it is the one
 * they are standing on.
 *
 * One answer for everything, read in one batch: the sweep asks once, however many hosts
 * its range covers.
 */

import { z } from 'zod';
import { verifySignedRequest } from '../signedRequest/verify.js';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus.js';
import {
  networkBaseFsForMachineId,
  resolveLanHostIdentity,
} from '../generation/lanHostIdentity.js';
import { generateHomeLan } from '../generation/generateHomeLan.js';
import { segmentsReachedFrom } from '../generation/lanTopology.js';
import { resolveDeepScanHosts } from './deepScanHosts.js';
import { materializeMachineFs } from '../network/materializeMachineFs.js';
import { materializeWorkstationFs } from '../network/materializeWorkstationFs.js';
import { lanAddressesByOwner, type LanLeaseRow } from '../network/lanAddress.js';
import { canBoot } from '../boot/bootFiles.js';
import type { Directory } from '../filesystem/types.js';
import type { NatOccupantRow } from './resolvePublicScan.js';
import type { MachinePatchRow } from '../findit/webIndex.js';
import type { NonceStore } from '../signedRequest/nonceStore.js';
import { resolveCallerVantageOn, type CallerVantageDeps } from '../sessions/callerVantage.js';

export type ResolveDownHostsDeps = CallerVantageDeps & {
  readonly nonceStore: NonceStore;
  /** The journals of the named machines in one read, each in server order. */
  readonly findPatchesForMachines: (
    machineIds: readonly string[],
  ) => Promise<{ readonly data: readonly MachinePatchRow[] | null; readonly error: unknown }>;
  /** Who is on the WiFi, with the identity each one's box is rebuilt from. */
  readonly listOccupantsByEssid: (
    essid: string,
  ) => Promise<{ readonly data: readonly NatOccupantRow[] | null; readonly error: unknown }>;
  /** Every lease held on this ESSID, in one read: the addresses of record. */
  readonly listLeasesByEssid: (
    essid: string,
  ) => Promise<{ readonly data: readonly LanLeaseRow[] | null; readonly error: unknown }>;
};

/** A box the shell reaches: the address it answers at, the machine whose journal says
 *  whether it still boots, and how that journal is replayed into its tree. */
type ReachedBox = {
  readonly ip: string;
  readonly machineId: string;
  readonly build: (journal: readonly MachinePatchRow[]) => Directory;
};

/** The boxes on every deep layer a shell on `machineId` reaches. A box on the LAN alone,
 *  or a player's workstation, reaches none. */
const deepBoxesReachedFrom = (essid: string, machineId: string | undefined): ReachedBox[] => {
  const segments = machineId === undefined ? null : segmentsReachedFrom(essid, machineId);
  return (segments ?? []).flatMap((segment) => {
    if (segment.fronting === null) return [];
    // Only the hosts are read off the layer, not their ports, so the gateway's tree as
    // generated serves as well as its live one.
    const frontingFs = networkBaseFsForMachineId(essid, segment.fronting.machineId);
    if (frontingFs === null) return [];
    return resolveDeepScanHosts(essid, segment.fronting, frontingFs).hosts.map((entry) => ({
      ip: entry.host.ip,
      machineId: entry.machineId,
      build: (journal: readonly MachinePatchRow[]) => materializeMachineFs(entry.baseFs, journal),
    }));
  });
};

export type HandlerResponse = {
  readonly status: number;
  readonly body: Record<string, unknown>;
};

// Loose so the envelope fields pass through; the refine keeps the codebase-wide
// posture that a client never claims identity (the caller is the verified pubkey).
const resolveDownHostsSchema = z
  .looseObject({
    action: z.literal('resolveDownHosts'),
    essid: z.string().min(1),
    caller_machine_id: z.string().min(1).optional(),
  })
  .refine((payload) => !('player_key' in payload));

export const handleResolveDownHosts = async (
  body: unknown,
  deps: ResolveDownHostsDeps,
): Promise<HandlerResponse> => {
  const verified = await verifySignedRequest(body, resolveDownHostsSchema, {
    nonceStore: deps.nonceStore,
  });
  if (!verified.ok) {
    return { status: STATUS_BY_VERIFY_REASON[verified.reason], body: { error: verified.reason } };
  }
  // The caller's identity decides only whether they stand on this LAN: these boxes are
  // seeded from the ESSID and shared by everyone on it.
  const { publicKey, payload } = verified;
  const vantage = await resolveCallerVantageOn(
    deps,
    publicKey,
    payload.caller_machine_id,
    payload.essid,
  );
  if (!vantage.ok) return { status: vantage.status, body: { error: vantage.error } };

  const occupants = await deps.listOccupantsByEssid(payload.essid);
  if (occupants.error) {
    return { status: 500, body: { error: 'occupants_lookup_failed' } };
  }
  const leases = await deps.listLeasesByEssid(payload.essid);
  if (leases.error) {
    return { status: 500, body: { error: 'leases_lookup_failed' } };
  }
  const addresses = lanAddressesByOwner(payload.essid, leases.data ?? []);
  const leased = new Set(addresses.values());

  // The same machine id + seeded base the client, the ssh gate and the single-host scan
  // use for each box, so every tool asks about the box everyone agrees on.
  const generated: readonly ReachedBox[] = generateHomeLan(payload.essid)
    .hosts.filter((host) => !leased.has(host.ip))
    .map((host) => {
      const { machineId, baseFs } = resolveLanHostIdentity(host, payload.essid);
      return { ip: host.ip, machineId, build: (journal) => materializeMachineFs(baseFs, journal) };
    });
  const players: readonly ReachedBox[] = (occupants.data ?? [])
    .filter((occupant) => occupant.owner_key !== publicKey)
    .flatMap((occupant) => {
      const ip = addresses.get(occupant.owner_key);
      if (ip === undefined) return [];
      return [
        {
          ip,
          machineId: occupant.workstation_machine_id,
          build: (journal: readonly MachinePatchRow[]) =>
            materializeWorkstationFs(occupant, journal),
        },
      ];
    });
  const boxes = [
    ...generated,
    ...players,
    ...deepBoxesReachedFrom(payload.essid, payload.caller_machine_id),
  ];

  const patches = await deps.findPatchesForMachines(boxes.map((box) => box.machineId));
  if (patches.error) {
    return { status: 500, body: { error: 'patches_lookup_failed' } };
  }
  const rows = patches.data ?? [];

  const down = boxes
    .filter(({ machineId, build }) => {
      const journal = rows.filter((row) => row.machine_id === machineId);
      return !canBoot(build(journal)).ok;
    })
    .map((box) => box.ip);
  return { status: 200, body: { ok: true, down } };
};
