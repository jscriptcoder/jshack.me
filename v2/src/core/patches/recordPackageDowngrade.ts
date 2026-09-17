/**
 * handleRecordPackageDowngrade — the pure recordPackageDowngrade endpoint logic (no
 * Vercel, no Supabase). Records one package being rolled BACKWARDS in the machine's own
 * `/var/log/dpkg.log`.
 *
 * Pinning is the one apt verb that leaves a box MORE exposed than it found it, and after
 * an ssh hop it can be run by somebody who does not own the box. `apt` reads and writes
 * `/var/lib/dpkg/status` through the ordinary patch path, so the rollback itself is
 * already gated exactly as any remote write is — but nothing about it is announced, and
 * a manifest quietly moved backwards looks identical to one that was always there. This
 * endpoint is the owner's only way to learn it happened, and from where.
 *
 * The client says only WHICH package moved and between which releases. It does not get
 * to say who it is or when: the address is derived from the verified key on every path
 * that lands in a stranger's log, and the clock is the server's. A defender's log a
 * visitor can author is not evidence.
 *
 * WHOSE row the line lands in, and which address it names, depend on whose box this is —
 * see `resolveProvenance` below. On a generated host both answers are the caller's own;
 * on another player's box neither is.
 *
 * Unlike `recordFtpTransfer`, an own-workstation target is NOT refused. That handler
 * rejects one because its line must name an ACCOUNT and the own-box L1 bypass hands back
 * no session row to read it from. This line names no account, so the bypass costs it
 * nothing — and a rollback you ran on your own box is a true entry in its history, with
 * the address resolving to the one you own. That is also what makes a FOREIGN address
 * legible later: it is the field that does not look like the others.
 *
 * The append is the shared `appendMachineLog` primitive, as the system rather than the
 * player: dpkg is what writes this file, and it is root-write-only so a visitor can
 * never edit away the record of what they did.
 */

import { z } from 'zod';
import { verifySignedRequest } from '../signedRequest/verify';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus';
import { asGameTime } from '../types';
import {
  DPKG_LOG_OWNER,
  DPKG_LOG_PATH,
  DPKG_LOG_PERMISSIONS,
  formatPackageDowngradeLine,
} from '../logging/dpkgLog';
import { authorizeMachineAccess, type FindActiveSession } from './authorizeMachineAccess';
import type {
  FindHomeNetworkByOwnerKey,
  FindPublicIpByEssid,
} from '../logging/crossPlayerSourceIp';
import { resolveTraceProvenance } from './traceProvenance';
import {
  appendMachineLog,
  type MachineLogReadQuery,
  type MachineLogReadResult,
} from './appendMachineLog';
import type { FindOccupantWorkstationByMachineId } from './remoteWritePermission';
import type { NonceStore } from '../signedRequest/nonceStore';
import type { PatchRow } from './upsertPatch';

export type RecordPackageDowngradeDeps = {
  readonly nonceStore: NonceStore;
  /** The server's wall clock, epoch-ms (UTC). Injected so the handler is pure and
   *  deterministic under test. */
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
// client-supplied identity. Any client `time` is simply never read.
const recordPackageDowngradeSchema = z
  .looseObject({
    action: z.literal('recordPackageDowngrade'),
    machine_id: z.string().min(1),
    package_name: z.string().min(1),
    // Both ends non-empty: a blank renders `downgrade redis 7.9.7  Client "…"`, which
    // reads as a corrupt log rather than as the rollback it was.
    from_version: z.string().min(1),
    to_version: z.string().min(1),
    source_ip: z.string().min(1).nullable().optional(),
    // The box the downgrade was run FROM. Read only on a foreign target, where the
    // address is derived rather than reported.
    caller_machine_id: z.string().min(1).optional(),
  })
  .refine((payload) => !('player_key' in payload) && !('writer_key' in payload));

export const handleRecordPackageDowngrade = async (
  body: unknown,
  deps: RecordPackageDowngradeDeps,
): Promise<HandlerResponse> => {
  const verified = await verifySignedRequest(body, recordPackageDowngradeSchema, {
    nonceStore: deps.nonceStore,
  });
  if (!verified.ok) {
    return { status: STATUS_BY_VERIFY_REASON[verified.reason], body: { error: verified.reason } };
  }

  const { publicKey, payload } = verified;
  // The shared L1 gate, and nothing beyond it: a caller must hold a session on a box
  // that is not their own. The own-box bypass returns no session row, which this
  // handler — unlike the ftp one — has no need of.
  const access = await authorizeMachineAccess(publicKey, payload.machine_id, deps.findActiveSession);
  if (!access.ok) return { status: access.status, body: { error: access.error } };

  // A box nobody owns and a box somebody does are recorded differently, and this is the
  // only thing that tells them apart. Guessing would file a stranger's evidence under
  // the wrong row, so an unreadable answer writes nothing at all.
  const owner = await deps.findOccupantWorkstationByMachineId(payload.machine_id);
  if (owner.error) {
    return { status: 500, body: { error: 'occupant_lookup_failed' } };
  }
  const provenance = await resolveTraceProvenance(deps, {
    actorKey: publicKey,
    callerMachineId: payload.caller_machine_id,
    claimedIp: payload.source_ip ?? null,
    owner: owner.data,
  });
  if (!provenance.ok) {
    return { status: provenance.status, body: { error: provenance.error } };
  }

  const line = formatPackageDowngradeLine({
    packageName: payload.package_name,
    fromVersion: payload.from_version,
    toVersion: payload.to_version,
    fromIp: provenance.fromIp,
    time: asGameTime(deps.now()),
  });

  await appendMachineLog(
    { readLog: deps.readLog, upsertPatch: deps.upsertPatch },
    {
      writerKey: provenance.writerKey,
      machineId: payload.machine_id,
      path: DPKG_LOG_PATH,
      owner: DPKG_LOG_OWNER,
      permissions: DPKG_LOG_PERMISSIONS,
    },
    line,
  );

  return { status: 200, body: { ok: true } };
};
