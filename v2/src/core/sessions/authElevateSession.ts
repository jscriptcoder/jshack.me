/**
 * handleAuthElevateSession — the server-side gate for a CROSS-PLAYER `su` to root
 * (Story 4, slice 1). Where `authCreateSessionPublic` resolves a foreign box by its
 * PUBLIC IP for the INITIAL ssh login, this elevates a session B ALREADY holds on
 * A's box: B (ssh'd in as guest) runs `su`, and this resolves A's registered
 * workstation by its `machine_id`, RECONSTRUCTS A's box from the registry-persisted
 * identity (owner_key + username + md5(rootPassword)), and validates the typed
 * password against A's REAL `/etc/passwd`.
 *
 * Why server-authoritative (not a client-side `su`): the patch write path (L2)
 * authorizes at the ACTIVE session row's tier. A client-only `su` pushes a local
 * session but writes NO row, so L2 would still see B as guest. Only a real root-tier
 * `kind:'su'` session row makes B's subsequent writes to A authorize at root — and
 * `findActiveSession` returns the latest active row, so the su row outranks the
 * guest ssh row beneath it with no L1 change.
 *
 * The own-workstation bypass does not apply — A is foreign by design, so the passwd
 * check IS the authorization boundary. Unknown-user and wrong-password collapse to
 * one 401. Writing the `su` trace to A's `auth.log` is a cross-player trace, deferred
 * to Story 6 (same posture as `authCreateSessionPublic`) — this handler touches only
 * B's own session row.
 */

import { z } from 'zod';
import { verifySignedRequest } from '../signedRequest/verify';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus';
import { buildWorkstationBaseFsFromIdentity } from '../generation/workstationFs';
import { md5 } from '../generation/md5';
import { accountIn } from './passwdAccount';
import type { HandlerResponse } from './authCreateSession';
import type { UserType } from '../types';
import type { NonceStore } from '../signedRequest/nonceStore';

/** The registry fields a cross-player `su` elevation needs: who owns the box (to
 *  reconstruct its FS), the workstation's real machine id (the session target +
 *  the lookup key), the network the session lives on, and the persisted identity to
 *  rebuild `/etc/passwd`. (Where `authCreateSessionPublic` now resolves the ROUTER
 *  by port, `su` always targets the workstation B already stands on.) */
export type RegistryWorkstation = {
  readonly owner_key: string;
  readonly workstation_machine_id: string;
  readonly essid: string;
  readonly workstation_username: string;
  readonly workstation_root_hash: string;
};

/** The `sessions` row a cross-player `su` elevation inserts. Mirrors the ssh
 *  `AuthSessionRow` but `kind:'su'` — the credential is server-derived, the
 *  player_key server-stamped, and `essid` carried from the registry for parity
 *  with the parent ssh row. */
export type SuSessionRow = {
  readonly session_id: string;
  readonly player_key: string;
  readonly machine_id: string;
  readonly credentials: { readonly username: string; readonly userType: UserType };
  readonly parent_session_id: string | null;
  readonly source_ip: string | null;
  readonly kind: 'su';
  readonly essid: string;
};

export type AuthElevateSessionDeps = {
  readonly nonceStore: NonceStore;
  readonly findRegistryByMachineId: (
    machineId: string,
  ) => Promise<{ readonly data: RegistryWorkstation | null; readonly error: unknown }>;
  readonly insertSession: (row: SuSessionRow) => Promise<{ readonly error: unknown }>;
};

// Loose so the envelope fields pass through; the refine rejects a client-supplied
// player_key OR userType (the server stamps the player_key from the verified pubkey
// and DERIVES the userType from the reconstructed passwd — neither is a client claim).
const authElevateSessionSchema = z
  .looseObject({
    action: z.literal('suElevate'),
    session_id: z.string().min(1),
    machine_id: z.string().min(1),
    username: z.string().min(1),
    password: z.string(),
    parent_session_id: z.string().min(1).nullable().optional(),
    source_ip: z.string().min(1).nullable().optional(),
  })
  .refine((payload) => !('player_key' in payload) && !('userType' in payload));

export const handleAuthElevateSession = async (
  body: unknown,
  deps: AuthElevateSessionDeps,
): Promise<HandlerResponse> => {
  const verified = await verifySignedRequest(body, authElevateSessionSchema, {
    nonceStore: deps.nonceStore,
  });
  if (!verified.ok) {
    return { status: STATUS_BY_VERIFY_REASON[verified.reason], body: { error: verified.reason } };
  }
  const { publicKey, payload } = verified;

  const { data, error } = await deps.findRegistryByMachineId(payload.machine_id);
  if (error) {
    return { status: 500, body: { error: 'registry_lookup_failed' } };
  }
  if (data === null) {
    return { status: 404, body: { error: 'host_unreachable' } };
  }

  // Rebuild the owner's box from the persisted identity and validate against its
  // real /etc/passwd. An empty-hash account (the owner's own user) can never match
  // — md5(password) is never '' — so a cross-player caller can't ride it to root.
  const fs = buildWorkstationBaseFsFromIdentity({
    ownerKeyHex: data.owner_key,
    username: data.workstation_username,
    rootPasswordHash: data.workstation_root_hash,
  });
  const account = accountIn(fs, payload.username);
  const passwordOk = account !== null && md5(payload.password) === account.hash;
  if (account === null || !passwordOk) {
    return { status: 401, body: { error: 'invalid_credentials' } };
  }

  const { error: insertError } = await deps.insertSession({
    session_id: payload.session_id,
    player_key: publicKey,
    machine_id: data.workstation_machine_id,
    credentials: { username: payload.username, userType: account.userType },
    parent_session_id: payload.parent_session_id ?? null,
    source_ip: payload.source_ip ?? null,
    kind: 'su',
    essid: data.essid,
  });
  if (insertError) {
    return { status: 500, body: { error: 'insert_failed' } };
  }

  return { status: 200, body: { ok: true, userType: account.userType } };
};
