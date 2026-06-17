/**
 * handleAuthCreateSessionPublic — the server-side gate for a CROSS-PLAYER ssh login
 * (Story 2 → reshaped for Story 5.1.2: routing by DESTINATION PORT). A different
 * identity's `ssh [-p port] <user>@<A.publicIp>` resolves A's public IP in the
 * registry (Story 1), then materializes A's ROUTER — the distinct, seeded box that
 * bears the public IP — and decides which machine the requested port reaches:
 *
 *   - a port the ROUTER itself serves (its seeded `sshd:22`) → log in ON the router,
 *     validated against its `/etc/passwd` (root-only; the admin password is recovered
 *     from the owner key). The session lands on the ROUTER's machine id.
 *   - a NAT-forwarded port → the internal target (the forward → workstation path is
 *     Story 5.1.3); until then a forwarded (or unmatched) port is host_unreachable.
 *
 * The boot gate keys on the ROUTER: a `/boot` tombstone takes the whole public IP
 * dark, refused before any password is checked. It does NOT write to A's box (the
 * auth.log trace is Story 6). The own-workstation bypass does not apply — a public
 * target is foreign by design, so the passwd check IS the authorization boundary.
 * Unknown-user and wrong-password collapse to one 401.
 */

import { z } from 'zod';
import { verifySignedRequest } from '../signedRequest/verify';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus';
import { md5 } from '../generation/md5';
import { accountIn } from './passwdAccount';
import { materializeRouterFs } from '../network/materializeRouterFs';
import type { OwnerPatchRow } from '../network/materializeWorkstationFs';
import { machineServing } from '../network/machineServing';
import { canBoot } from '../boot/bootFiles';
import type { AuthSessionRow, HandlerResponse } from './authCreateSession';
import type { NonceStore } from '../signedRequest/nonceStore';

/** The registry fields a router-routed cross-player login needs: who owns the box
 *  (to reconstruct the router FS + recover its seeded admin password), the router's
 *  machine id (the journal scope AND the session target), and the network the
 *  session lives on. The workstation-behind-NAT fields arrive when the forward →
 *  workstation auth path lands (Story 5.1.3). */
export type RegistryTarget = {
  readonly owner_key: string;
  readonly router_machine_id: string;
  readonly essid: string;
};

export type AuthCreateSessionPublicDeps = {
  readonly nonceStore: NonceStore;
  readonly findRegistryByPublicIp: (
    publicIp: string,
  ) => Promise<{ readonly data: RegistryTarget | null; readonly error: unknown }>;
  /** The ROUTER's FULL patch journal (scoped to `machine_id`, server order) so the
   *  gate can replay it over the seeded router base and ask `canBoot`: a bricked
   *  router (a `/boot` tombstone) takes the public IP dark, so the login is refused
   *  before the password is ever checked. */
  readonly findPatches: (query: {
    readonly machine_id: string;
  }) => Promise<{ readonly data: readonly OwnerPatchRow[] | null; readonly error: unknown }>;
  readonly insertSession: (row: AuthSessionRow) => Promise<{ readonly error: unknown }>;
};

// The destination ssh port when the client sends none — a bare `ssh user@host` is
// port 22. The client always carries the resolved port, but defaulting here keeps
// the server correct for any envelope that omits it.
const DEFAULT_SSH_PORT = 22;

// Loose so the envelope fields pass through; the refine keeps the codebase-wide
// posture that a client never claims identity (the caller is the verified pubkey).
const authCreateSessionPublicSchema = z
  .looseObject({
    action: z.literal('authCreateSessionPublic'),
    session_id: z.string().min(1),
    target: z.string().min(1),
    username: z.string().min(1),
    password: z.string(),
    port: z.number().int().positive().optional(),
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

  // Materialize the ROUTER once: it drives the boot gate, the port routing, and —
  // for a router-served port — the password check, all off one consistent tree.
  const patches = await deps.findPatches({ machine_id: data.router_machine_id });
  if (patches.error) {
    return { status: 500, body: { error: 'patches_lookup_failed' } };
  }
  const routerFs = materializeRouterFs(data, patches.data);

  // A bricked router (a `/boot` tombstone) takes the whole public IP dark: refuse
  // before the password is checked — no credentials reach a dead box.
  if (!canBoot(routerFs).ok) {
    return { status: 404, body: { error: 'host_unreachable' } };
  }

  // Route by destination port. Only a port the router itself serves is handled here;
  // a NAT forward to an internal host lands in Story 5.1.3, so for now a forwarded
  // (or unmatched) port is host_unreachable — before any password check.
  const served = machineServing({ routerFs, port: payload.port ?? DEFAULT_SSH_PORT });
  if (served.kind !== 'router') {
    return { status: 404, body: { error: 'host_unreachable' } };
  }

  // Validate against the router's own /etc/passwd (root-only; the root hash is
  // md5(seedRouterAdminPw(owner_key))). An unknown user OR a wrong password is one
  // 401 — a non-root username is simply not an account on the router.
  const account = accountIn(routerFs, payload.username);
  const passwordOk = account !== null && md5(payload.password) === account.hash;
  if (account === null || !passwordOk) {
    return { status: 401, body: { error: 'invalid_credentials' } };
  }

  const { error: insertError } = await deps.insertSession({
    session_id: payload.session_id,
    player_key: publicKey,
    machine_id: data.router_machine_id,
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
    body: { ok: true, userType: account.userType, machine_id: data.router_machine_id },
  };
};
