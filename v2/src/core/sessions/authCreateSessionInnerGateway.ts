/**
 * handleAuthCreateSessionInnerGateway — the server gate for `ssh user@<inner>:<fwd
 * port>`, the multi-layer payoff: logging into a hidden Layer-2 machine THROUGH a NAT
 * forward the player configured on their own inner gateway.
 *
 * Each forward lives in a gateway's `/etc/iptables/rules.v4` on its SERVER-side journal
 * (the player added it with `nano` after rooting the gateway), so — like the
 * inner-gateway scan — this can't be resolved from the client's static world. The
 * server regenerates the inner gateway from the VERIFIED pubkey + essid, replays its
 * journal, asks `canBoot` (a bricked gateway takes the deep entrance dark), then walks
 * the forward chain by destination port through `machineServing`:
 *
 *   - a NAT-forwarded port → a box on this gateway's deep layer: the terminal NPC (auth
 *     against its `/etc/passwd`, land the session on the NPC's id) or the CHILD GATEWAY
 *     that fronts the next layer down. A forward to a child gateway replays ITS journal,
 *     re-checks `canBoot` (a bricked intermediate darkens everything below), and follows
 *     the forward one layer deeper — so a chain of forwards reaches an arbitrarily deep
 *     box. A forward to a stray address, or to a port the target isn't serving, is dark.
 *   - a gateway's own `:22` → log in ON that gateway (validated against its seeded admin
 *     password); the session lands on that gateway's machine id.
 *   - any other port → host_unreachable.
 *
 * Mirrors `authCreateSessionPublic` (port-routed via `machineServing`) but own-keyed
 * + octet-targeted, with the internal target a box on the deep chain instead of the
 * owner's workstation. The deep layers stay PRIVATE: every gateway is the caller's own
 * box (regenerated from their key), nothing here touches the cross-player registry.
 * Unknown-user and wrong-password collapse to one 401; a child-journal fetch failure
 * mid-walk is a 500, kept distinct from a port that simply leads nowhere.
 */

import { z } from 'zod';
import { verifySignedRequest } from '../signedRequest/verify';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus';
import { md5 } from '../generation/md5';
import {
  buildDeepHostFs,
  generateDeepLayer,
  seedNetworkDepth,
  type FrontingGateway,
} from '../generation/generateDeepLayer';
import { innerGatewayAt, resolveLanHostIdentity } from '../generation/lanHostIdentity';
import { hostMachineId } from '../generation/remoteHostId';
import { accountIn } from './passwdAccount';
import { materializeMachineFs, type OwnerPatchRow } from '../network/materializeMachineFs';
import { resolveChildGatewayHop } from '../network/childGatewayHop';
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

/** The outcome of resolving `ssh <inner>:<port>` down the gateway chain: a target to
 *  authenticate against (the tree + the machine id the session lands on), an
 *  unreachable port (→ 404 host_unreachable), or a child-gateway journal fetch that
 *  failed mid-walk (→ 500, distinct from a port that simply leads nowhere). */
type AuthResolution =
  | { readonly kind: 'target'; readonly fs: Directory; readonly machineId: string }
  | { readonly kind: 'unreachable' }
  | { readonly kind: 'lookup_failed' };

const UNREACHABLE: AuthResolution = { kind: 'unreachable' };

/** The invariants every hop of the chain walk shares: the verified owner key + essid the
 *  deep layers regenerate from, the home's seeded chain depth (the bound that makes the
 *  walk finite), and the journal fetch that replays each child gateway. */
type ChainContext = {
  readonly publicKey: string;
  readonly essid: string;
  readonly depth: number;
  readonly findPatches: AuthCreateSessionInnerGatewayDeps['findPatches'];
};

/** Does this materialized tree run a daemon on `port`? A forward whose internal port
 *  no box behind the gateway serves is a dark DNAT target (→ host_unreachable). */
const servesInternalPort = (fs: Directory, port: number): boolean =>
  readOpenPorts(fs).some((openPort) => openPort.port === port);

/**
 * Resolve `ssh <inner>:<port>` to its auth target by walking the forward chain from the
 * gateway at `position` (1-based; the inner gateway is position 1). `machineServing`
 * routes the destination port:
 *
 *   - the gateway's OWN port (its seeded `:22`) → land HERE, validated against this
 *     gateway's `/etc/passwd`/admin password;
 *   - a NAT forward to the terminal deep NPC → land on the NPC (its coordinate-seeded
 *     id), validated against ITS `/etc/passwd`;
 *   - a NAT forward to the CHILD GATEWAY that fronts the next layer down → replay that
 *     child's OWN journal over its seeded base, take it dark when `canBoot` fails (a
 *     bricked intermediate darkens everything below it), and RECURSE on the forward's
 *     internal port one layer deeper — which may be the child's own `:22` (land on the
 *     child) or another forward (continue the chain);
 *   - anything else (a port no one serves, a forward to a stray address, an internal
 *     port the target doesn't run) → unreachable.
 *
 * The walk is bounded by `depth`: a gateway at `position` fronts a child only while
 * `position < depth`, and the position strictly increases each hop, so the recursion
 * terminates. Regenerating a child needs its journal, so a fetch failure surfaces as
 * `lookup_failed` (→ 500) rather than a false `unreachable`.
 */
const resolveAuthTarget = async (
  context: ChainContext,
  gatewayFs: Directory,
  frontingGateway: FrontingGateway,
  port: number,
  position: number,
): Promise<AuthResolution> => {
  const served = machineServing({ routerFs: gatewayFs, port });
  if (served.kind === 'router') {
    return { kind: 'target', fs: gatewayFs, machineId: frontingGateway.machineId };
  }
  if (served.kind === 'none') {
    return UNREACHABLE;
  }
  // The gateway forwards `port` onto its deep layer. Regenerate the layer; it hangs a
  // child gateway only while this gateway sits above the home's seeded depth.
  const deep = generateDeepLayer(context.publicKey, context.essid, frontingGateway, {
    hangsChild: position < context.depth,
  });
  // The forward reaches the terminal NPC — auth against ITS /etc/passwd, land the
  // session on the NPC's coordinate-seeded id.
  if (served.internalIp === deep.host.ip) {
    const deepFs = buildDeepHostFs(context.publicKey, context.essid, deep.host);
    return servesInternalPort(deepFs, served.internalPort)
      ? { kind: 'target', fs: deepFs, machineId: hostMachineId(deep.host, context.essid) }
      : UNREACHABLE;
  }
  // The forward reaches the CHILD GATEWAY that fronts the next layer down. Resolve it
  // (replay its own journal, boot-gate it), refuse it when a brick takes the deeper chain
  // dark, then walk one layer deeper on the forward's internal port — which may be the
  // child's own `:22` (land on the child) or another forward (continue the chain).
  if (deep.childGateway !== null && served.internalIp === deep.childGateway.ip) {
    const hop = await resolveChildGatewayHop({
      ownerKeyHex: context.publicKey,
      parentMachineId: frontingGateway.machineId,
      childIp: deep.childGateway.ip,
      childKind: deep.childGateway.kind,
      findPatches: context.findPatches,
    });
    if (hop.kind === 'lookup_failed') {
      return { kind: 'lookup_failed' };
    }
    if (hop.kind === 'bricked') {
      return UNREACHABLE;
    }
    return resolveAuthTarget(
      context,
      hop.fs,
      { machineId: hop.machineId, kind: deep.childGateway.kind },
      served.internalPort,
      position + 1,
    );
  }
  // The forward points at no box on the layer — a stray internal IP, a dark DNAT target.
  return UNREACHABLE;
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

  const resolution = await resolveAuthTarget(
    {
      publicKey,
      essid: payload.essid,
      depth: seedNetworkDepth(publicKey, payload.essid),
      findPatches: deps.findPatches,
    },
    gatewayFs,
    { machineId: gatewayMachineId, kind: gateway.kind },
    payload.port ?? DEFAULT_SSH_PORT,
    1,
  );
  // A child journal fetch that failed mid-walk is a server error, not a dead port — keep
  // it distinct from the host-unreachable a port leading nowhere produces.
  if (resolution.kind === 'lookup_failed') {
    return { status: 500, body: { error: 'patches_lookup_failed' } };
  }
  if (resolution.kind === 'unreachable') {
    return { status: 404, body: { error: 'host_unreachable' } };
  }

  // Validate against the TARGET's own /etc/passwd (the deep NPC, or the gateway for
  // its own port). An unknown user OR a wrong password is one 401 — the response
  // never reveals which accounts exist.
  const account = accountIn(resolution.fs, payload.username);
  const passwordOk = account !== null && md5(payload.password) === account.hash;
  if (account === null || !passwordOk) {
    return { status: 401, body: { error: 'invalid_credentials' } };
  }

  const { error: insertError } = await deps.insertSession({
    session_id: payload.session_id,
    player_key: publicKey,
    machine_id: resolution.machineId,
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
    body: { ok: true, userType: account.userType, machine_id: resolution.machineId },
  };
};
