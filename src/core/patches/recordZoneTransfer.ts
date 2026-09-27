/**
 * handleRecordZoneTransfer — the pure recordZoneTransfer endpoint logic (no Vercel,
 * no Supabase). A zone transfer runs entirely client-side — `dig @<server> axfr`
 * reads generation and answers instantly — so the name server would otherwise learn
 * nothing about who mapped it. This action is how the transfer leaves its mark: one
 * line in the box's own `/var/log/named.log`, the DNS equivalent of the scan's
 * `kern.log` and the login's `auth.log` line, read back by whoever roots the box next.
 *
 * The client says only WHICH network and WHICH server it aimed at. It does not get to
 * say who it is, when, or whether the box agreed:
 *
 * - the SOURCE is derived server-side from the verified key (`resolveCrossPlayerSourceIp`),
 *   never a client-supplied address — a defender's log a visitor can author is not
 *   evidence, and a forgeable source would let one player frame another;
 * - the CLOCK is the server's;
 * - the VERDICT — handed over vs refused — is recomputed here from generation, the same
 *   authority `dig` transferred from, so the log and a rooted `cat` of the zone can
 *   never disagree. A client cannot log a transfer a box refused it.
 *
 * A target that is not a name server writes nothing: there is no daemon there to keep a
 * log. An ordinary lookup never reaches this action at all.
 *
 * The line lands under the CALLER's own key (not the box owner's), exactly as the
 * own-LAN scan trace does: a single player's repeated transfers accrete into one row
 * they read back after rooting the box. Cross-player accretion — two players into one
 * file — rides with same-wifi occupancy, and shares that path's shared-box behaviour.
 *
 * The append is the shared `appendMachineLog` primitive, as the system rather than the
 * player: `named` writes this file, and it is root-write-only so a visitor can never
 * edit away the record of their transfer.
 */

import { z } from 'zod';
import { verifySignedRequest } from '../signedRequest/verify';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus';
import { asGameTime } from '../types';
import {
  NAMED_LOG_OWNER,
  NAMED_LOG_PATH,
  NAMED_LOG_PERMISSIONS,
  formatNamedXfrLine,
} from '../logging/namedLog';
import {
  resolveCrossPlayerSourceIp,
  type FindHomeNetworkByOwnerKey,
} from '../logging/crossPlayerSourceIp';
import {
  allowsZoneTransfer,
  nameServerMachineIdAt,
  zoneRecordsFor,
} from '../generation/generateDnsZone';
import { lanZoneName } from '../network/resolveName';
import {
  appendMachineLog,
  type MachineLogReadQuery,
  type MachineLogReadResult,
} from './appendMachineLog';
import type { NonceStore } from '../signedRequest/nonceStore';
import type { PatchRow } from './upsertPatch';

export type RecordZoneTransferDeps = {
  readonly nonceStore: NonceStore;
  /** The server's wall clock, epoch-ms (UTC). Injected so the handler is pure and
   *  deterministic under test. */
  readonly now: () => number;
  readonly readLog: (query: MachineLogReadQuery) => Promise<MachineLogReadResult>;
  readonly upsertPatch: (row: PatchRow) => Promise<{ readonly error: unknown }>;
  /** The address the transferring player OWNS, from their verified key. */
  readonly findHomeNetworkByOwnerKey: FindHomeNetworkByOwnerKey;
};

export type HandlerResponse = {
  readonly status: number;
  readonly body: Record<string, unknown>;
};

// Loose so the envelope fields (action/ts/nonce) pass through; the refine rejects a
// client-supplied identity. Any client `source_ip` is simply never read — the source
// is derived from the verified key.
const recordZoneTransferSchema = z
  .looseObject({
    action: z.literal('recordZoneTransfer'),
    essid: z.string().min(1),
    server_ip: z.string().min(1),
  })
  .refine((payload) => !('player_key' in payload) && !('writer_key' in payload));

export const handleRecordZoneTransfer = async (
  body: unknown,
  deps: RecordZoneTransferDeps,
): Promise<HandlerResponse> => {
  const verified = await verifySignedRequest(body, recordZoneTransferSchema, {
    nonceStore: deps.nonceStore,
  });
  if (!verified.ok) {
    return { status: STATUS_BY_VERIFY_REASON[verified.reason], body: { error: verified.reason } };
  }

  const { publicKey, payload } = verified;

  // No name server at the target — nothing there keeps a log, so nothing is written.
  // The verdict recompute below never runs for a box that does not exist as a server.
  const machineId = nameServerMachineIdAt(payload.essid, payload.server_ip);
  if (machineId === null) {
    return { status: 200, body: { ok: true } };
  }

  const stamp = deps.now();
  const line = formatNamedXfrLine({
    time: asGameTime(stamp),
    sourceIp: await resolveCrossPlayerSourceIp(deps.findHomeNetworkByOwnerKey, publicKey),
    zone: lanZoneName(payload.essid),
    outcome: allowsZoneTransfer(payload.essid, payload.server_ip)
      ? { verdict: 'transferred', records: zoneRecordsFor(payload.essid).length }
      : { verdict: 'denied' },
  });

  await appendMachineLog(
    { readLog: deps.readLog, upsertPatch: deps.upsertPatch },
    {
      writerKey: publicKey,
      machineId,
      path: NAMED_LOG_PATH,
      owner: NAMED_LOG_OWNER,
      permissions: NAMED_LOG_PERMISSIONS,
    },
    line,
  );

  return { status: 200, body: { ok: true } };
};
