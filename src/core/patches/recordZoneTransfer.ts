/**
 * handleRecordZoneTransfer — the pure recordZoneTransfer endpoint logic (no Vercel,
 * no Supabase). A zone transfer runs entirely client-side — `dig @<server> axfr`
 * reads generation and answers instantly — so the name server would otherwise learn
 * nothing about who mapped it. This action is how the transfer leaves its mark: one
 * line in the box's own `/var/log/named.log`, the DNS equivalent of the scan's
 * `kern.log` and the login's `auth.log` line, read back by whoever roots the box next.
 *
 * The client says only WHICH network, WHICH server it aimed at, and the box it ran from
 * (`caller_machine_id`). It does not get to say who it is, when, or whether the box agreed:
 *
 * - the SOURCE is derived server-side from where the caller stands (`resolveCallerVantageOn`
 *   places them by the box they named, and the line records that box's address on the name
 *   server's own segment), never a client-supplied address — a defender's log a visitor can
 *   author is not evidence, and a forgeable source would let one player frame another. A
 *   caller on a network it is not standing on is refused (`wrong_network`), and a box it
 *   holds no shell on (`no_session`);
 * - the CLOCK is the server's;
 * - the VERDICT — handed over vs refused — is recomputed here from generation, the same
 *   authority `dig` transferred from, so the log and a rooted `cat` of the zone can
 *   never disagree. A client cannot log a transfer a box refused it.
 *
 * A target that is not a name server writes nothing: there is no daemon there to keep a
 * log. An ordinary lookup never reaches this action at all.
 *
 * The line lands under the NETWORK's own key (`ap:<essid>`), never the caller's, exactly
 * as the own-LAN scan trace does: nobody owns a name server and every occupant of the
 * WiFi reaches the identical one, so a row per caller would let each transfer erase the
 * lines of the last. Every transfer, whoever made it, accretes into one log.
 *
 * The append is the shared `appendMachineLog` primitive, as the system rather than the
 * player: `named` writes this file, and it is root-write-only so a visitor can never
 * edit away the record of their transfer.
 */

import { z } from 'zod';
import { verifySignedRequest } from '../signedRequest/verify.js';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus.js';
import { asGameTime } from '../types.js';
import { generateHomeLan } from '../generation/generateHomeLan.js';
import { segmentsReachedFrom, type ReachedSegment } from '../generation/lanTopology.js';
import { resolveCallerVantageOn, type CallerVantageDeps } from '../sessions/callerVantage.js';
import {
  NAMED_LOG_OWNER,
  NAMED_LOG_PATH,
  NAMED_LOG_PERMISSIONS,
  formatNamedXfrLine,
} from '../logging/namedLog.js';
import {
  allowsZoneTransfer,
  nameServerMachineIdAt,
  zoneRecordsFor,
} from '../generation/generateDnsZone.js';
import { lanZoneName } from '../network/resolveName.js';
import { apGatewayLogWriterKey } from '../logging/apGatewayLogWriter.js';
import {
  appendMachineLog,
  type MachineLogReadQuery,
  type MachineLogReadResult,
} from './appendMachineLog.js';
import type { NonceStore } from '../signedRequest/nonceStore.js';
import type { PatchRow } from './upsertPatch.js';

export type RecordZoneTransferDeps = CallerVantageDeps & {
  readonly nonceStore: NonceStore;
  /** The server's wall clock, epoch-ms (UTC). Injected so the handler is pure and
   *  deterministic under test. */
  readonly now: () => number;
  readonly readLog: (query: MachineLogReadQuery) => Promise<MachineLogReadResult>;
  readonly upsertPatch: (row: PatchRow) => Promise<{ readonly error: unknown }>;
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
    caller_machine_id: z.string().min(1).optional(),
  })
  .refine((payload) => !('player_key' in payload) && !('writer_key' in payload));

/** Every network the caller's box reaches, each with the address it is seen at there —
 *  from the box it names, or (at home, or on its own workstation) the single top LAN it
 *  stands on, addressed by the lease the vantage placed it at. Mirrors the client's
 *  `vantageOf`, so the source a trace records and the segment a transfer travelled over
 *  are the one answer. */
const reachedSegmentsFor = (
  essid: string,
  callerMachineId: string | undefined,
  homeSource: string | null,
): readonly ReachedSegment[] => {
  if (callerMachineId !== undefined) {
    const reached = segmentsReachedFrom(essid, callerMachineId);
    if (reached !== null) return reached;
  }
  return [{ subnet: generateHomeLan(essid).subnet, fronting: null, address: homeSource }];
};

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

  // Where the caller stands, placed from the box they named rather than a claim: their
  // own network at home, or a shell they hold. A network they are not on is refused, as
  // is a box they hold no session on — the same boundary every own-LAN trace draws.
  const vantage = await resolveCallerVantageOn(
    deps,
    publicKey,
    payload.caller_machine_id,
    payload.essid,
  );
  if (!vantage.ok) return { status: vantage.status, body: { error: vantage.error } };

  // The segment the transfer travelled over: the name server sits on one network the box
  // reaches, and the source the line records is the box's address on THAT segment — its
  // deep-layer address for a deep name server, its LAN address for a top-LAN one. A box
  // that reaches no segment the server is on could not have transferred from it, so
  // nothing is written.
  const sourceSegment = reachedSegmentsFor(payload.essid, payload.caller_machine_id, vantage.sourceIp).find(
    (segment) => payload.server_ip.startsWith(`${segment.subnet}.`),
  );
  if (sourceSegment === undefined) {
    return { status: 200, body: { ok: true } };
  }

  // No name server at the target — nothing there keeps a log, so nothing is written.
  // The verdict recompute below never runs for a box that does not exist as a server.
  const machineId = nameServerMachineIdAt(payload.essid, payload.server_ip);
  if (machineId === null) {
    return { status: 200, body: { ok: true } };
  }

  const stamp = deps.now();
  const line = formatNamedXfrLine({
    time: asGameTime(stamp),
    sourceIp: sourceSegment.address ?? 'unknown',
    zone: lanZoneName(payload.essid),
    outcome: allowsZoneTransfer(payload.essid, payload.server_ip)
      ? { verdict: 'transferred', records: zoneRecordsFor(payload.essid).length }
      : { verdict: 'denied' },
  });

  await appendMachineLog(
    { readLog: deps.readLog, upsertPatch: deps.upsertPatch },
    {
      writerKey: apGatewayLogWriterKey(payload.essid),
      machineId,
      path: NAMED_LOG_PATH,
      owner: NAMED_LOG_OWNER,
      permissions: NAMED_LOG_PERMISSIONS,
    },
    line,
  );

  return { status: 200, body: { ok: true } };
};
