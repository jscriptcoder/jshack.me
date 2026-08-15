/**
 * authorizeMachineAccess — the shared L1 gate for the patch endpoints
 * (`upsertPatch`, `listPatches`, `removePatch`). One rule, one place, so the
 * three handlers can't drift:
 *
 *   - The target is the caller's OWN workstation (server-side suffix match) →
 *     BYPASS. Own-box reads/writes are unconditional here; the client enforces
 *     own-box L2.
 *   - Otherwise → require an ACTIVE `sessions` row for `(player_key, machine_id)`
 *     (an ssh hop the caller is currently present on). No row → 403 `no_session`.
 *     A lookup failure → 500 (never a false 403 that masks a DB outage).
 *
 * The returned `session` is the active row's projection (or `null` for the
 * own-workstation bypass). Today only its presence matters; the remote-write L2
 * pass (next PR) reads `userType`/`essid` from it to reconstruct the target's
 * permissions, which is why the shape carries them now.
 */

import { isOwnWorkstation } from '../identity/workstation';
import type { UserType } from '../types';

export type ActiveSession = {
  /** The account the session was opened as. Read off the row rather than taken
   *  from the caller, so a log line naming an account names the real one. */
  readonly username: string;
  readonly userType: UserType;
  readonly essid: string;
};

export type ActiveSessionQuery = {
  readonly player_key: string;
  readonly machine_id: string;
};

export type FindActiveSessionResult = {
  readonly data: ActiveSession | null;
  readonly error: unknown;
};

export type FindActiveSession = (query: ActiveSessionQuery) => Promise<FindActiveSessionResult>;

export type AccessResult =
  | { readonly ok: true; readonly session: ActiveSession | null }
  | { readonly ok: false; readonly status: number; readonly error: string };

export const authorizeMachineAccess = async (
  publicKey: string,
  machineId: string,
  findActiveSession: FindActiveSession,
): Promise<AccessResult> => {
  if (isOwnWorkstation(machineId, publicKey)) {
    return { ok: true, session: null };
  }

  const { data, error } = await findActiveSession({ player_key: publicKey, machine_id: machineId });
  if (error) {
    return { ok: false, status: 500, error: 'session_lookup_failed' };
  }
  if (data === null) {
    return { ok: false, status: 403, error: 'no_session' };
  }
  return { ok: true, session: data };
};

/**
 * The network a caller is ESTABLISHED to be standing on — the thing a cross-player
 * trace is addressed FROM.
 *
 * A caller who names the box they are operating from must actually hold it, or an
 * attack is written up as somebody else's network: the whole point of deriving the
 * address server-side is defeated by believing a claim about where it came from. The
 * ESSID then comes off the session row, where it was stamped when the hop was made.
 *
 * Naming no box means the caller's own workstation — no row, no network being borrowed,
 * so `null` and the address they own. The own-box bypass lands in the same place for the
 * same reason.
 */
export type StandingVantage =
  | { readonly ok: true; readonly standingEssid: string | null }
  | { readonly ok: false; readonly status: number; readonly error: string };

export const standingVantage = async (
  publicKey: string,
  callerMachineId: string | undefined,
  findActiveSession: FindActiveSession,
): Promise<StandingVantage> => {
  if (callerMachineId === undefined) return { ok: true, standingEssid: null };
  const access = await authorizeMachineAccess(publicKey, callerMachineId, findActiveSession);
  if (!access.ok) return { ok: false, status: access.status, error: access.error };
  return { ok: true, standingEssid: access.session === null ? null : access.session.essid };
};
