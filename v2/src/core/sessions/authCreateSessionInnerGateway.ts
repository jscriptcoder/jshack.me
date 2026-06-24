/**
 * handleAuthCreateSessionInnerGateway — the server gate for `ssh user@<inner>:<fwd
 * port>`, the multi-layer payoff: logging into a hidden Layer-2 machine THROUGH a NAT
 * forward the player configured on their own inner gateway.
 *
 * The forward lives in the gateway's `/etc/iptables/rules.v4` on its SERVER-side
 * journal (the player added it with `nano` after rooting the gateway), so — like the
 * inner-gateway scan — this can't be resolved from the client's static world. The
 * server regenerates the gateway from the VERIFIED pubkey + essid, replays its
 * journal, asks `canBoot` (a bricked gateway takes the deep entrance dark), then
 * routes by destination port through `machineServing`:
 *
 *   - a NAT-forwarded port → the ONE deep host behind the gateway: regenerate the
 *     deep layer, refuse a forward that points at no deep host or a port it isn't
 *     serving (a dark DNAT target), validate the password against the DEEP HOST's
 *     `/etc/passwd`, and land the session on the DEEP HOST's machine id — so reads/
 *     writes downstream land on the Layer-2 box, not the gateway.
 *   - the gateway's own `:22` → log in ON the gateway (validated against its seeded
 *     admin password). The session lands on the gateway's machine id.
 *   - any other port → host_unreachable.
 *
 * Mirrors `authCreateSessionPublic` (port-routed via `machineServing`) but own-keyed
 * + octet-targeted, with the internal target an NPC on the deep layer instead of the
 * owner's workstation. The deep layer stays PRIVATE: the gateway is the caller's own
 * box (regenerated from their key), nothing here touches the cross-player registry.
 * Unknown-user and wrong-password collapse to one 401.
 */

import { z } from 'zod';
import { verifySignedRequest } from '../signedRequest/verify';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus';
import { md5 } from '../generation/md5';
import {
  buildDeepHostFs,
  generateDeepLayer,
  type FrontingGateway,
} from '../generation/generateDeepLayer';
import {
  innerGatewayAt,
  resolveDeepGatewayIdentity,
  resolveLanHostIdentity,
} from '../generation/lanHostIdentity';
import { hostMachineId } from '../generation/remoteHostId';
import { accountIn } from './passwdAccount';
import { materializeMachineFs, type OwnerPatchRow } from '../network/materializeMachineFs';
import { machineServing } from '../network/machineServing';
import { readOpenPorts } from '../services/pidfile';
import { canBoot } from '../boot/bootFiles';
import type { Directory } from '../filesystem/types';
import type { AuthSessionRow, HandlerResponse } from './authCreateSession';
import type { NonceStore } from '../signedRequest/nonceStore';

export type AuthCreateSessionInnerGatewayDeps = {
  readonly nonceStore: NonceStore;
  /** The inner gateway's FULL patch journal (scoped to its `machine_id`, server
   *  order) so the gate can replay it over the seeded gateway base — both to ask
   *  `canBoot` and to read the live `rules.v4` forward off the materialized tree. */
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
const authCreateSessionInnerGatewaySchema = z
  .looseObject({
    action: z.literal('authCreateSessionInnerGateway'),
    session_id: z.string().min(1),
    essid: z.string().min(1),
    target: z.string().min(1),
    username: z.string().min(1),
    password: z.string(),
    port: z.number().int().positive().optional(),
    parent_session_id: z.string().min(1).nullable().optional(),
    source_ip: z.string().min(1).nullable().optional(),
  })
  .refine((payload) => !('player_key' in payload));

/** The resolved auth target behind the gateway: which tree to validate the password
 *  against, and the machine id the session lands on. */
type AuthTarget = { readonly fs: Directory; readonly machineId: string };

/** Does this materialized tree run a daemon on `port`? A forward whose internal port
 *  no box behind the gateway serves is a dark DNAT target (→ host_unreachable). */
const servesInternalPort = (fs: Directory, port: number): boolean =>
  readOpenPorts(fs).some((openPort) => openPort.port === port);

/**
 * Resolve `ssh <inner>:<port>` to its auth target by destination port. The gateway
 * serves its own ports directly (its seeded `:22` → log in on the gateway); a
 * NAT-forwarded port reaches one of the two boxes behind it — the terminal deep NPC,
 * or the CHILD GATEWAY that fronts the next layer down (the chain door). Regenerate
 * the deep layer, route the forward's internal IP to whichever box it names, and
 * refuse a forward that points at neither (a stray internal IP) or a port that box
 * isn't serving (a dark DNAT target). Returns the target, or null for an unserved/dark
 * port (→ host_unreachable). Pure: the deep boxes are regenerated deterministically,
 * so no journal fetch — neither an NPC nor a deep gateway has persisted state here.
 */
const resolveAuthTarget = (
  publicKey: string,
  essid: string,
  gatewayFs: Directory,
  frontingGateway: FrontingGateway,
  port: number,
): AuthTarget | null => {
  const served = machineServing({ routerFs: gatewayFs, port });
  if (served.kind === 'router') {
    return { fs: gatewayFs, machineId: frontingGateway.machineId };
  }
  if (served.kind === 'none') {
    return null;
  }
  const deep = generateDeepLayer(publicKey, essid, frontingGateway);
  // The forward reaches the terminal NPC — auth against ITS /etc/passwd, land the
  // session on the NPC's coordinate-seeded id.
  if (served.internalIp === deep.host.ip) {
    const deepFs = buildDeepHostFs(publicKey, essid, deep.host);
    return servesInternalPort(deepFs, served.internalPort)
      ? { fs: deepFs, machineId: hostMachineId(deep.host, essid) }
      : null;
  }
  // The forward reaches the CHILD GATEWAY — auth against ITS admin pw, land the session
  // on its deep-gateway id (keyed off this gateway as parent so it stays unique across
  // the chain). From there the player pivots one layer deeper.
  if (deep.childGateway !== null && served.internalIp === deep.childGateway.ip) {
    const child = resolveDeepGatewayIdentity(publicKey, frontingGateway.machineId, deep.childGateway.ip);
    return servesInternalPort(child.baseFs, served.internalPort)
      ? { fs: child.baseFs, machineId: child.machineId }
      : null;
  }
  // The forward points at no box on the layer — a stray internal IP, a dark DNAT target.
  return null;
};

export const handleAuthCreateSessionInnerGateway = async (
  body: unknown,
  deps: AuthCreateSessionInnerGatewayDeps,
): Promise<HandlerResponse> => {
  const verified = await verifySignedRequest(body, authCreateSessionInnerGatewaySchema, {
    nonceStore: deps.nonceStore,
  });
  if (!verified.ok) {
    return { status: STATUS_BY_VERIFY_REASON[verified.reason], body: { error: verified.reason } };
  }
  const { publicKey, payload } = verified;

  // The target must be a genuine inner gateway on the caller's OWN regenerated LAN —
  // the edge `.1`, a sibling, or an off-LAN address finds nothing (no journal read).
  const gateway = innerGatewayAt(publicKey, payload.essid, payload.target);
  if (gateway === null) {
    return { status: 404, body: { error: 'host_unreachable' } };
  }

  // The shared resolver maps the gateway to the SAME machine id + seeded base the
  // scan gate and the client use, so the journal it replays is the box everyone
  // agrees on.
  const { machineId: gatewayMachineId, baseFs } = resolveLanHostIdentity(
    gateway,
    publicKey,
    payload.essid,
  );
  const patches = await deps.findPatches({ machine_id: gatewayMachineId });
  if (patches.error) {
    return { status: 500, body: { error: 'patches_lookup_failed' } };
  }

  // Replay the gateway's journal, then ask `canBoot`. A root `rm /boot/vmlinuz`
  // tombstone bricks the gateway, so it stops answering — the deep entrance goes
  // dark, refused before any password is checked.
  const gatewayFs = materializeMachineFs(baseFs, patches.data);
  if (!canBoot(gatewayFs).ok) {
    return { status: 404, body: { error: 'host_unreachable' } };
  }

  const target = resolveAuthTarget(
    publicKey,
    payload.essid,
    gatewayFs,
    { machineId: gatewayMachineId, kind: gateway.kind },
    payload.port ?? DEFAULT_SSH_PORT,
  );
  if (target === null) {
    return { status: 404, body: { error: 'host_unreachable' } };
  }

  // Validate against the TARGET's own /etc/passwd (the deep NPC, or the gateway for
  // its own port). An unknown user OR a wrong password is one 401 — the response
  // never reveals which accounts exist.
  const account = accountIn(target.fs, payload.username);
  const passwordOk = account !== null && md5(payload.password) === account.hash;
  if (account === null || !passwordOk) {
    return { status: 401, body: { error: 'invalid_credentials' } };
  }

  const { error: insertError } = await deps.insertSession({
    session_id: payload.session_id,
    player_key: publicKey,
    machine_id: target.machineId,
    credentials: { username: payload.username, userType: account.userType },
    parent_session_id: payload.parent_session_id ?? null,
    source_ip: payload.source_ip ?? null,
    kind: 'ssh',
    essid: payload.essid,
  });
  if (insertError) {
    return { status: 500, body: { error: 'insert_failed' } };
  }

  return {
    status: 200,
    body: { ok: true, userType: account.userType, machine_id: target.machineId },
  };
};
