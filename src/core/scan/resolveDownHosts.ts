/**
 * handleResolveDownHosts — which boxes the ACCESS POINT owns can no longer boot.
 *
 * A range sweep lists hosts and builds no port table for any of them, so it needs no
 * box's ports. It does need to know which boxes are still there: whether a machine was
 * bricked is on its server-side journal, and a sweep built from the seeded world alone
 * listed a halted box as up while a single-host scan of the same address called it down.
 *
 * One answer for the whole LAN, read in one batch: the sweep asks once, however many
 * hosts its range covers.
 */

import { z } from 'zod';
import { verifySignedRequest } from '../signedRequest/verify.js';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus.js';
import { resolveLanHostIdentity } from '../generation/lanHostIdentity.js';
import { generateHomeLan } from '../generation/generateHomeLan.js';
import { materializeMachineFs } from '../network/materializeMachineFs.js';
import { canBoot } from '../boot/bootFiles.js';
import type { MachinePatchRow } from '../findit/webIndex.js';
import type { NonceStore } from '../signedRequest/nonceStore.js';
import { resolveCallerVantageOn, type CallerVantageDeps } from '../sessions/callerVantage.js';

export type ResolveDownHostsDeps = CallerVantageDeps & {
  readonly nonceStore: NonceStore;
  /** The journals of the named machines in one read, each in server order. */
  readonly findPatchesForMachines: (
    machineIds: readonly string[],
  ) => Promise<{ readonly data: readonly MachinePatchRow[] | null; readonly error: unknown }>;
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

  // The same machine id + seeded base the client, the ssh gate and the single-host scan
  // use for each box, so every tool asks about the box everyone agrees on.
  const boxes = generateHomeLan(payload.essid).hosts.map((host) => ({
    host,
    ...resolveLanHostIdentity(host, payload.essid),
  }));
  const patches = await deps.findPatchesForMachines(boxes.map((box) => box.machineId));
  if (patches.error) {
    return { status: 500, body: { error: 'patches_lookup_failed' } };
  }
  const rows = patches.data ?? [];

  const down = boxes
    .filter(({ machineId, baseFs }) => {
      const journal = rows.filter((row) => row.machine_id === machineId);
      return !canBoot(materializeMachineFs(baseFs, journal)).ok;
    })
    .map(({ host }) => host.ip);
  return { status: 200, body: { ok: true, down } };
};
