/**
 * handleRecordFtpDownload — the pure recordFtpDownload endpoint logic (no Vercel,
 * no Supabase). Itemises one file leaving a machine in that machine's own
 * `/var/log/vsftpd.log`, which is the signal `ssh` cannot give: a login says
 * somebody came in, this says what they walked out with.
 *
 * The client says only WHAT it took — the remote path and the byte count. It does
 * not get to say who it is or when: the account is read off the session row the
 * server looked up, the writer is the VERIFIED pubkey, and the clock is the
 * server's. A defender's log a visitor can author is not evidence.
 *
 * Unlike `appendAuthLog` (own workstation only) this writes to SOMEONE ELSE'S box,
 * so it runs the shared L1 gate — and then insists on the session row itself. The
 * own-workstation bypass hands back no row, and a line naming no account is one
 * this handler will not write: ftp'ing to yourself is not a transfer to record.
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
  formatVsftpdDownloadLine,
} from '../logging/vsftpdLog';
import { derivePid } from '../logging/syslog';
import { authorizeMachineAccess, type FindActiveSession } from './authorizeMachineAccess';
import {
  appendMachineLog,
  type MachineLogReadQuery,
  type MachineLogReadResult,
} from './appendMachineLog';
import type { NonceStore } from '../signedRequest/nonceStore';
import type { PatchRow } from './upsertPatch';

export type RecordFtpDownloadDeps = {
  readonly nonceStore: NonceStore;
  /** The server's wall clock, epoch-ms (UTC). Injected so the handler is pure
   *  and deterministic under test. */
  readonly now: () => number;
  readonly findActiveSession: FindActiveSession;
  readonly readLog: (query: MachineLogReadQuery) => Promise<MachineLogReadResult>;
  readonly upsertPatch: (row: PatchRow) => Promise<{ readonly error: unknown }>;
};

export type HandlerResponse = {
  readonly status: number;
  readonly body: Record<string, unknown>;
};

// Loose so the envelope fields (action/ts/nonce) pass through; the refine rejects a
// client-supplied identity. Any client `user`/`time`/`pid` is simply never read.
const recordFtpDownloadSchema = z
  .looseObject({
    action: z.literal('recordFtpDownload'),
    machine_id: z.string().min(1),
    path: z.string().min(1),
    bytes: z.number().int().nonnegative(),
    source_ip: z.string().min(1).nullable().optional(),
  })
  .refine((payload) => !('player_key' in payload) && !('writer_key' in payload));

export const handleRecordFtpDownload = async (
  body: unknown,
  deps: RecordFtpDownloadDeps,
): Promise<HandlerResponse> => {
  const verified = await verifySignedRequest(body, recordFtpDownloadSchema, {
    nonceStore: deps.nonceStore,
  });
  if (!verified.ok) {
    return { status: STATUS_BY_VERIFY_REASON[verified.reason], body: { error: verified.reason } };
  }

  const { publicKey, payload } = verified;
  const access = await authorizeMachineAccess(publicKey, payload.machine_id, deps.findActiveSession);
  if (!access.ok) return { status: access.status, body: { error: access.error } };
  if (access.session === null) return { status: 403, body: { error: 'no_session' } };

  const stamp = deps.now();
  const line = formatVsftpdDownloadLine({
    user: access.session.username,
    fromIp: payload.source_ip ?? 'unknown',
    time: asGameTime(stamp),
    pid: derivePid(stamp),
    path: asAbsPath(payload.path),
    bytes: payload.bytes,
  });

  await appendMachineLog(
    { readLog: deps.readLog, upsertPatch: deps.upsertPatch },
    {
      writerKey: publicKey,
      machineId: payload.machine_id,
      path: VSFTPD_LOG_PATH,
      owner: VSFTPD_LOG_OWNER,
      permissions: VSFTPD_LOG_PERMISSIONS,
    },
    line,
  );

  return { status: 200, body: { ok: true } };
};
