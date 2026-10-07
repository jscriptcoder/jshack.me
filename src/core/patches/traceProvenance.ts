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
 * The ROW depends on ownership: on a generated host it is the NETWORK's own key — nobody
 * owns the box and every occupant reaches the identical one, so a row per visitor would
 * let each line erase the last — while on a box somebody OWNS it is the owner's, because
 * the log is their evidence.
 *
 * The ADDRESS does not depend on ownership. It is placed from where the caller stands
 * (`resolveCallerVantage`, the same vantage every own-LAN door draws), never from a field
 * the client sends: on the target's own network, the address the target saw on its LAN —
 * a neighbour's lease, or the deeper segment the caller stands on; off it, the public
 * address the caller's network wears crossing the NAT. So the trace line and the login
 * line above it name the one address, whichever way the box was reached.
 *
 * Pure/framework-agnostic (core/): every lookup is injected.
 */

import { resolveCallerVantage, type CallerVantageDeps } from '../sessions/callerVantage.js';
import type { FindPublicIpByEssid } from '../logging/crossPlayerSourceIp.js';
import type { OccupantWorkstation } from './remoteWritePermission.js';
import { apGatewayLogWriterKey } from '../logging/apGatewayLogWriter.js';

/** The lookups the rule needs: where the caller stands (the same placement every own-LAN
 *  door draws, `resolveCallerVantage`), plus the public address a network wears when the
 *  caller reaches the target across a NAT. */
export type TraceProvenanceDeps = CallerVantageDeps & {
  readonly findPublicIpByEssid: FindPublicIpByEssid;
};

/** Who the actor is, the box they are acting FROM, and whose box they reached. */
export type TraceVisit = {
  readonly actorKey: string;
  readonly callerMachineId: string | undefined;
  /** `null` for a generated host nobody owns. */
  readonly owner: OccupantWorkstation | null;
  /** The network the target is regenerated from, off the caller's session row on it — or
   *  `null` with no session, which only the caller's own workstation is reached by. */
  readonly boxEssid: string | null;
};

export type Provenance =
  | { readonly ok: true; readonly writerKey: string; readonly fromIp: string }
  | { readonly ok: false; readonly status: number; readonly error: string };

const publicIpOf = async (deps: TraceProvenanceDeps, essid: string): Promise<string> => {
  const { data, error } = await deps.findPublicIpByEssid(essid);
  return error || data === null ? 'unknown' : data.public_ip;
};

export const resolveTraceProvenance = async (
  deps: TraceProvenanceDeps,
  visit: TraceVisit,
): Promise<Provenance> => {
  // The caller's own box reached with no session while on no WiFi: nobody shares it, and
  // there is no network to place them on. The action still happened, so the line is
  // still written — the client named unknown rather than left blank, which reads as a
  // corrupt log.
  if (visit.owner === null && visit.boxEssid === null) {
    return { ok: true, writerKey: visit.actorKey, fromIp: 'unknown' };
  }
  // Placed from the box they act from, never a claim — their own network at home, or a
  // shell they hold. A box they hold no session on is the shared L1 refusal.
  const vantage = await resolveCallerVantage(deps, visit.actorKey, visit.callerMachineId);
  if (!vantage.ok) {
    return { ok: false, status: vantage.status, error: vantage.error };
  }
  const writerKey =
    visit.owner === null ? apGatewayLogWriterKey(visit.boxEssid as string) : visit.owner.owner_key;
  // On the target's own network the address it saw is the caller's address there — a LAN
  // lease, or the deeper segment the caller stands on. Off it, the only address the
  // target could have seen is the public one the caller's network wears crossing the NAT.
  const fromIp =
    vantage.essid === visit.boxEssid
      ? vantage.sourceIp ?? 'unknown'
      : await publicIpOf(deps, vantage.essid);
  return { ok: true, writerKey, fromIp };
};
