/**
 * traceProvenance — the one rule deciding WHOSE row a cross-player trace is filed under,
 * and WHICH address it names. Shared by every endpoint that writes a line into a machine
 * the caller may not own (`recordFtpTransfer`, `recordPackageDowngrade`), for the same
 * reason `authorizeMachineAccess` is shared by the three patch handlers: one rule in one
 * place, so they cannot drift.
 *
 * Drift here is not cosmetic. Both answers below are security-relevant — a line filed
 * under the visitor's key instead of the owner's lands in a different row from the login
 * that preceded it, the journal replays with the latest write to a path winning, and the
 * defender reads half a visit while a second visitor quietly erases the first. Two copies
 * of that logic is two chances to get it wrong in one of them and never notice.
 *
 * On a generated host the row is the NETWORK's own key: nobody owns the box, and every
 * occupant of its network reaches the identical one, so a row per visitor would let each
 * line erase the last. The LAN address they report is what that box saw. On a box
 * somebody OWNS both answers change: the row belongs to the machine's owner, and the
 * address comes from the verified key, because it is the owner's only evidence of who
 * reached them.
 *
 * Pivot-aware — an action run from a box the visitor merely holds a session on is traced
 * to THAT network, which is the one the target actually saw.
 *
 * Pure/framework-agnostic (core/): every lookup is injected.
 */

import { standingVantage, type FindActiveSession } from './authorizeMachineAccess.js';
import {
  resolveVantageSourceIp,
  type FindHomeNetworkByOwnerKey,
  type FindPublicIpByEssid,
} from '../logging/crossPlayerSourceIp.js';
import type { OccupantWorkstation } from './remoteWritePermission.js';
import { apGatewayLogWriterKey } from '../logging/apGatewayLogWriter.js';

/** The three lookups the rule needs. Declared structurally rather than as one handler's
 *  deps type, so each endpoint passes its own full deps block unchanged. */
export type TraceProvenanceDeps = {
  readonly findActiveSession: FindActiveSession;
  readonly findHomeNetworkByOwnerKey: FindHomeNetworkByOwnerKey;
  readonly findPublicIpByEssid: FindPublicIpByEssid;
};

/** Who the actor is, where they claim to be acting from, and whose box they reached. */
export type TraceVisit = {
  readonly actorKey: string;
  readonly callerMachineId: string | undefined;
  readonly claimedIp: string | null;
  /** `null` for a generated host nobody owns. */
  readonly owner: OccupantWorkstation | null;
  /** The network the box is regenerated from, off the caller's session row on it — or
   *  `null` with no session, which only the caller's own workstation is reached by. */
  readonly boxEssid: string | null;
};

export type Provenance =
  | { readonly ok: true; readonly writerKey: string; readonly fromIp: string }
  | { readonly ok: false; readonly status: number; readonly error: string };

export const resolveTraceProvenance = async (
  deps: TraceProvenanceDeps,
  visit: TraceVisit,
): Promise<Provenance> => {
  if (visit.owner === null) {
    // An ownerless box with no session is the caller's own, outside any WiFi: theirs alone.
    const writerKey =
      visit.boxEssid === null ? visit.actorKey : apGatewayLogWriterKey(visit.boxEssid);
    return { ok: true, writerKey, fromIp: visit.claimedIp ?? 'unknown' };
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
