/**
 * handleRecordFtpTransfer — the pure recordFtpTransfer endpoint logic (no Vercel,
 * no Supabase). Itemises one file moving on or off a machine in that machine's own
 * `/var/log/vsftpd.log`, which is the signal `ssh` cannot give: a login says
 * somebody came in, this says what they walked out with — or left behind.
 *
 * One handler for both directions because the daemon writes one line shape and the
 * questions are identical: who is on this box, and what moved. Only the verb differs,
 * and the client names it from a closed set — an unrecognised direction is refused
 * rather than rendered, or a caller writes their own verb into someone else's evidence.
 *
 * The client says only WHAT moved and which way — the path, the byte count, the
 * direction. It does not get to say who it is or when: the account is read off the
 * session row the server looked up, and the clock is the server's. A defender's log a
 * visitor can author is not evidence.
 *
 * WHOSE row the line lands in, and which address it names, depend on whose box this is
 * — see `resolveProvenance` below. On a generated host both answers are the caller's
 * own; on another player's box neither is.
 *
 * Unlike `appendAuthLog` (own workstation only) this writes to SOMEONE ELSE'S box,
 * so it runs the shared L1 gate — and then insists on the session row itself. The
 * own-workstation bypass hands back no row, and a line naming no account is one
 * this handler will not write: ftp'ing to yourself is not a transfer to record.
 *
 * The transfer itself is NOT this endpoint's business: an upload's bytes land through
 * the shipped `upsertPatch`, gated exactly as an ssh-session write is. This only
 * records that they did, which is why a refused transfer simply never calls it.
 *
 * The append is the shared `appendMachineLog` primitive, as the system rather than
 * the player: the daemon is what writes this file, and it is root-write-only so a
 * visitor can never edit away the record of their visit.
 */

import { z } from 'zod';
import { verifySignedRequest } from '../signedRequest/verify';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus';
import { asAbsPath, asGameTime } from '../types';
import {
  VSFTPD_LOG_OWNER,
  VSFTPD_LOG_PATH,
  VSFTPD_LOG_PERMISSIONS,
  formatVsftpdTransferLine,
} from '../logging/vsftpdLog';
import { derivePid } from '../logging/syslog';
import {
  authorizeMachineAccess,
  standingVantage,
  type FindActiveSession,
} from './authorizeMachineAccess';
import {
  resolveVantageSourceIp,
  type FindHomeNetworkByOwnerKey,
  type FindPublicIpByEssid,
} from '../logging/crossPlayerSourceIp';
import {
  appendMachineLog,
  type MachineLogReadQuery,
  type MachineLogReadResult,
} from './appendMachineLog';
import type {
  FindOccupantWorkstationByMachineId,
  OccupantWorkstation,
} from './remoteWritePermission';
import type { NonceStore } from '../signedRequest/nonceStore';
import type { PatchRow } from './upsertPatch';

export type RecordFtpTransferDeps = {
  readonly nonceStore: NonceStore;
  /** The server's wall clock, epoch-ms (UTC). Injected so the handler is pure
   *  and deterministic under test. */
  readonly now: () => number;
  readonly findActiveSession: FindActiveSession;
  readonly readLog: (query: MachineLogReadQuery) => Promise<MachineLogReadResult>;
  readonly upsertPatch: (row: PatchRow) => Promise<{ readonly error: unknown }>;
  /** Whose box this is — `null` for a generated host nobody owns. One lookup decides
   *  both halves of the provenance below. */
  readonly findOccupantWorkstationByMachineId: FindOccupantWorkstationByMachineId;
  /** The address the visitor OWNS, from their verified key. */
  readonly findHomeNetworkByOwnerKey: FindHomeNetworkByOwnerKey;
  /** The address of a network the visitor is merely standing on. */
  readonly findPublicIpByEssid: FindPublicIpByEssid;
};

export type HandlerResponse = {
  readonly status: number;
  readonly body: Record<string, unknown>;
};

// Loose so the envelope fields (action/ts/nonce) pass through; the refine rejects a
// client-supplied identity. Any client `user`/`time`/`pid` is simply never read.
const recordFtpTransferSchema = z
  .looseObject({
    action: z.literal('recordFtpTransfer'),
    // A closed set, so the verb in a stranger's log is one of the two the daemon
    // writes and never one the caller made up.
    direction: z.enum(['download', 'upload']),
    machine_id: z.string().min(1),
    path: z.string().min(1),
    bytes: z.number().int().nonnegative(),
    source_ip: z.string().min(1).nullable().optional(),
    // The box the transfer was run FROM. Read only on a foreign target, where the
    // address is derived rather than reported.
    caller_machine_id: z.string().min(1).optional(),
  })
  .refine((payload) => !('player_key' in payload) && !('writer_key' in payload));

/** Whose row the line is filed under, and which address it names.
 *
 *  On a generated host the caller's own row IS the record — nobody else writes there,
 *  and the LAN address they report is what that box saw. On another PLAYER's box both
 *  answers change: the row belongs to the machine's owner, because a shared log split
 *  across two writer keys replays with one row winning and the defender reading half a
 *  visit; and the address comes from the verified key, because it is the defender's
 *  only evidence. Pivot-aware — a transfer run from a box the visitor merely holds a
 *  session on is traced to THAT network, which is the one the target actually saw. */
type Provenance =
  | { readonly ok: true; readonly writerKey: string; readonly fromIp: string }
  | { readonly ok: false; readonly status: number; readonly error: string };

const resolveProvenance = async (
  deps: RecordFtpTransferDeps,
  visit: {
    readonly actorKey: string;
    readonly callerMachineId: string | undefined;
    readonly claimedIp: string | null;
    readonly owner: OccupantWorkstation | null;
  },
): Promise<Provenance> => {
  if (visit.owner === null) {
    return { ok: true, writerKey: visit.actorKey, fromIp: visit.claimedIp ?? 'unknown' };
  }
  const standing = await standingVantage(
    visit.actorKey,
    visit.callerMachineId,
    deps.findActiveSession,
  );
  if (!standing.ok) {
    return { ok: false, status: standing.status, error: standing.error };
  }
  return {
    ok: true,
    writerKey: visit.owner.owner_key,
    fromIp: await resolveVantageSourceIp(deps, {
      actorKey: visit.actorKey,
      standingEssid: standing.standingEssid,
    }),
  };
};

export const handleRecordFtpTransfer = async (
  body: unknown,
  deps: RecordFtpTransferDeps,
): Promise<HandlerResponse> => {
  const verified = await verifySignedRequest(body, recordFtpTransferSchema, {
    nonceStore: deps.nonceStore,
  });
  if (!verified.ok) {
    return { status: STATUS_BY_VERIFY_REASON[verified.reason], body: { error: verified.reason } };
  }

  const { publicKey, payload } = verified;
  const access = await authorizeMachineAccess(publicKey, payload.machine_id, deps.findActiveSession);
  if (!access.ok) return { status: access.status, body: { error: access.error } };
  if (access.session === null) return { status: 403, body: { error: 'no_session' } };

  // A box nobody owns and a box somebody does are recorded differently, and this is
  // the only thing that tells them apart. Guessing would file a stranger's evidence
  // under the wrong row, so an unreadable answer writes nothing at all.
  const owner = await deps.findOccupantWorkstationByMachineId(payload.machine_id);
  if (owner.error) {
    return { status: 500, body: { error: 'occupant_lookup_failed' } };
  }
  const provenance = await resolveProvenance(deps, {
    actorKey: publicKey,
    callerMachineId: payload.caller_machine_id,
    claimedIp: payload.source_ip ?? null,
    owner: owner.data,
  });
  if (!provenance.ok) {
    return { status: provenance.status, body: { error: provenance.error } };
  }

  const stamp = deps.now();
  const line = formatVsftpdTransferLine({
    direction: payload.direction,
    user: access.session.username,
    fromIp: provenance.fromIp,
    time: asGameTime(stamp),
    pid: derivePid(stamp),
    path: asAbsPath(payload.path),
    bytes: payload.bytes,
  });

  await appendMachineLog(
    { readLog: deps.readLog, upsertPatch: deps.upsertPatch },
    {
      writerKey: provenance.writerKey,
      machineId: payload.machine_id,
      path: VSFTPD_LOG_PATH,
      owner: VSFTPD_LOG_OWNER,
      permissions: VSFTPD_LOG_PERMISSIONS,
    },
    line,
  );

  return { status: 200, body: { ok: true } };
};
