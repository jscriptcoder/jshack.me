/**
 * handleAuthCreateSessionPublic — the server-side gate for a CROSS-PLAYER ssh login
 * (Story 2, slice 2b). Where `authCreateSession` resolves a host on the CALLER's own
 * regenerated LAN, this resolves a DIFFERENT identity's network by its PUBLIC IP via
 * the registry (Story 1), then RECONSTRUCTS the owner's workstation from the
 * registry-persisted identity (slice 2a: owner_key + username + md5(rootPassword))
 * and validates the supplied password against its REAL `/etc/passwd`.
 *
 * On success it inserts the caller's session on the owner's REAL
 * `workstation_machine_id` — the seam slice 2c's tier-2 read lookup needs. It does
 * NOT write to the owner's box: the auth.log trace on a foreign workstation is a
 * cross-player WRITE, deferred to Story 6. The own-workstation bypass does not
 * apply — a public target is foreign by design, so the passwd check IS the
 * authorization boundary. Unknown-user and wrong-password collapse to one 401.
 */

import { z } from 'zod';
import { verifySignedRequest } from '../signedRequest/verify';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus';
import { buildWorkstationBaseFsFromIdentity } from '../generation/workstationFs';
import { md5 } from '../generation/md5';
import { accountIn } from './passwdAccount';
import { materializeWorkstationFs, type OwnerPatchRow } from '../network/materializeWorkstationFs';
import { canBoot } from '../boot/bootFiles';
import type { AuthSessionRow, HandlerResponse } from './authCreateSession';
import type { NonceStore } from '../signedRequest/nonceStore';

/** The registry fields a cross-player login needs: who owns the box (to rebuild
 *  its FS + recover the guest password), the box's real machine id (the session
 *  target), the network the session lives on, and the persisted identity to
 *  reconstruct `/etc/passwd`. */
export type RegistryWorkstation = {
  readonly owner_key: string;
  readonly workstation_machine_id: string;
  readonly essid: string;
  readonly workstation_username: string;
  readonly workstation_root_hash: string;
};

export type AuthCreateSessionPublicDeps = {
  readonly nonceStore: NonceStore;
  readonly findRegistryByPublicIp: (
    publicIp: string,
  ) => Promise<{ readonly data: RegistryWorkstation | null; readonly error: unknown }>;
  /** The target's FULL patch journal (scoped to `machine_id`, server order) so the
   *  gate can replay it over the regenerated base and ask `canBoot`: a bricked box
   *  (a `/boot` tombstone) is unreachable, so the login is refused before the
   *  password is ever checked. */
  readonly findPatches: (query: {
    readonly machine_id: string;
  }) => Promise<{ readonly data: readonly OwnerPatchRow[] | null; readonly error: unknown }>;
  readonly insertSession: (row: AuthSessionRow) => Promise<{ readonly error: unknown }>;
};

// Loose so the envelope fields pass through; the refine rejects a client-supplied
// player_key (the server stamps it from the verified pubkey). No `userType` field —
// the server derives it from the reconstructed passwd.
const authCreateSessionPublicSchema = z
  .looseObject({
    action: z.literal('authCreateSessionPublic'),
    session_id: z.string().min(1),
    target: z.string().min(1),
    username: z.string().min(1),
    password: z.string(),
    parent_session_id: z.string().min(1).nullable().optional(),
    source_ip: z.string().min(1).nullable().optional(),
  })
  .refine((payload) => !('player_key' in payload));

export const handleAuthCreateSessionPublic = async (
  body: unknown,
  deps: AuthCreateSessionPublicDeps,
): Promise<HandlerResponse> => {
  const verified = await verifySignedRequest(body, authCreateSessionPublicSchema, {
    nonceStore: deps.nonceStore,
  });
  if (!verified.ok) {
    return { status: STATUS_BY_VERIFY_REASON[verified.reason], body: { error: verified.reason } };
  }
  const { publicKey, payload } = verified;

  const { data, error } = await deps.findRegistryByPublicIp(payload.target);
  if (error) {
    return { status: 500, body: { error: 'registry_lookup_failed' } };
  }
  if (data === null) {
    return { status: 404, body: { error: 'host_unreachable' } };
  }

  // A bricked box is off the network: replay the machine's journal over its
  // regenerated base and ask `canBoot`. A root `rm /boot/vmlinuz` (tombstone) makes
  // it unbootable, so the login is refused as host_unreachable BEFORE the password
  // is checked — a dead box can't be logged into no matter the credentials.
  const patches = await deps.findPatches({ machine_id: data.workstation_machine_id });
  if (patches.error) {
    return { status: 500, body: { error: 'patches_lookup_failed' } };
  }
  if (!canBoot(materializeWorkstationFs(data, patches.data)).ok) {
    return { status: 404, body: { error: 'host_unreachable' } };
  }

  // Rebuild the owner's box from the persisted identity and validate against its
  // real /etc/passwd. An empty-hash account (the owner's own user) can never match
  // — md5(password) is never '' — so a cross-player caller can't ride it.
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
    kind: 'ssh',
    essid: data.essid,
  });
  if (insertError) {
    return { status: 500, body: { error: 'insert_failed' } };
  }

  return {
    status: 200,
    body: { ok: true, userType: account.userType, machine_id: data.workstation_machine_id },
  };
};
