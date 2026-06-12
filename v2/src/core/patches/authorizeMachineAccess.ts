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
