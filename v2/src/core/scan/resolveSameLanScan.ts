/**
 * handleResolveSameLanScan — server-side resolution of the player's OWN-LAN `nmap` of a
 * box the ACCESS POINT owns: its seeded base with its own journal replayed over it.
 *
 * Two kinds of box arrive here, and the ESSID seeds both, so every occupant of a network
 * scans one machine rather than each rebuilding a private copy: an NPC SIBLING, and the
 * `.1` GATEWAY the whole network shares. `resolveLanHostIdentity` already maps either to
 * the tree it is seeded from, which is why one action answers for both.
 *
 * Every host on a home LAN except a fellow player used to be the client's own
 * arithmetic — `buildRemoteHostFs` keys on the ESSID and the host, so any occupant can
 * rebuild it offline. That is true of the box the world SHIPPED, and false of the box
 * anyone has since touched: the journal holding a patched manifest, a planted listener,
 * a stopped daemon or a `/boot` tombstone lives server-side, so a client-resolved scan
 * described a machine that had not existed since the first write to it.
 *
 * It answers ONE address, and only when that address is actually scanned. A range scan
 * prints no port table at all, so nothing about a range needs a journal — and putting
 * ports on the host LIST instead would read a journal per host to answer a question the
 * list does not ask.
 */

import { z } from 'zod';
import { verifySignedRequest } from '../signedRequest/verify';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus';
import { resolveLanHostIdentity } from '../generation/lanHostIdentity';
import { generateHomeLan } from '../generation/generateHomeLan';
import { materializeMachineFs, type OwnerPatchRow } from '../network/materializeMachineFs';
import { canBoot } from '../boot/bootFiles';
import { readOpenPorts } from '../services/pidfile';
import type { NonceStore } from '../signedRequest/nonceStore';

export type ResolveSameLanScanDeps = {
  readonly nonceStore: NonceStore;
  /** The day the world stands on, computed once from the server's own clock at the
   *  endpoint. Absent for a caller asking only what is open — the scan then reports
   *  ports and versions with no vulnerability against them. */
  readonly gameDay?: number | undefined;

  /** The target's FULL patch journal (scoped to its `machine_id`, server order), so the
   *  scan reads the box as it IS rather than as it shipped. */
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
const resolveSameLanScanSchema = z
  .looseObject({
    action: z.literal('resolveSameLanScan'),
    essid: z.string().min(1),
    target: z.string().min(1),
  })
  .refine((payload) => !('player_key' in payload));

const HOST_DOWN: HandlerResponse = { status: 200, body: { ok: true, found: false, ports: [] } };

export const handleResolveSameLanScan = async (
  body: unknown,
  deps: ResolveSameLanScanDeps,
): Promise<HandlerResponse> => {
  const verified = await verifySignedRequest(body, resolveSameLanScanSchema, {
    nonceStore: deps.nonceStore,
  });
  if (!verified.ok) {
    return { status: STATUS_BY_VERIFY_REASON[verified.reason], body: { error: verified.reason } };
  }
  // The verified signature is the whole of what the caller's identity decides here, as
  // it is for the inner gateway beside it: these boxes are seeded from the ESSID and
  // shared by every occupant, so everyone scanning this address is scanning one box.
  const { payload } = verified;

  const host = generateHomeLan(payload.essid).hosts.find(
    (candidate) => candidate.ip === payload.target,
  );
  if (host === undefined) {
    return HOST_DOWN;
  }

  // The shared resolver maps the host to the SAME machine id + seeded base FS the
  // client and the ssh gate use, so the scan reads the box everyone agrees on.
  const { machineId, baseFs } = resolveLanHostIdentity(host, payload.essid);
  const patches = await deps.findPatches({ machine_id: machineId });
  if (patches.error) {
    return { status: 500, body: { error: 'patches_lookup_failed' } };
  }

  // Replay the journal over the seeded base, then ask `canBoot`. A root
  // `rm /boot/vmlinuz` tombstone bricks the box, and a machine that cannot start holds
  // no doors — reported down rather than as a box that is up and running nothing.
  const hostFs = materializeMachineFs(baseFs, patches.data);
  if (!canBoot(hostFs).ok) {
    return HOST_DOWN;
  }

  return {
    status: 200,
    body: { ok: true, found: true, ports: readOpenPorts(hostFs, { gameDay: deps.gameDay }) },
  };
};
