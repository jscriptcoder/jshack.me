/**
 * handleResolveCrossPlayerFs — the read of any box that is not the caller's own to rebuild.
 *
 * The server is the only party that can build such a box as it is: another player's
 * workstation needs that player's persisted identity, and every box needs the journal,
 * whose rows are raw and go to nobody but an owner. So the tree is built here, pruned to
 * what the caller may read, and only then sent. A path the caller may not read is dropped
 * before the response leaves, because the wire is the threat surface.
 *
 * Which box it is:
 *   - a player's workstation, found by `workstation_machine_id` in the occupancy table.
 *     Occupancy means "this machine is on that WiFi", so a box whose owner ran
 *     `nmcli disconnect` resolves to nothing and the read fails closed;
 *   - otherwise a box the network makes (its own gateway, or a machine it generates),
 *     found from the network on the caller's own session row. Nothing owns such a box,
 *     and the only way to hold a row on one is to have got in.
 *
 * What the caller is served is derived on the server, never claimed:
 *   - the owner of a workstation: the full tree. The session table is not consulted;
 *   - an open session: everything its tier may read, together with the
 *     externally-observable list, so a session never shows less than none;
 *   - no open session: the externally-observable list only. On a box the network makes
 *     this takes a row the caller once held there, which is what tells a shell whose
 *     session a reboot closed that the box went down under it.
 *
 * emailit.io keeps everybody's mail in the server's tables, not in its files, and a root
 * session there is shown it at the real paths (`core/emailit/spool.ts`). The view is laid
 * into the box before the journal is replayed, so what a root wrote or removed there is
 * what the next root sees. Below root it is never built, so no table is read and nothing
 * of it reaches the wire.
 *
 * The journal is replayed whole, every writer's rows in the order the server stamped them.
 */

import { z } from 'zod';
import { verifySignedRequest } from '../signedRequest/verify.js';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus.js';
import { materializeMachineFs, type OwnerPatchRow } from './materializeMachineFs.js';
import {
  buildOccupantWorkstationFs,
  type FindOccupantWorkstationByMachineId,
} from '../patches/remoteWritePermission.js';
import { networkBaseFsForMachineId } from '../generation/lanHostIdentity.js';
import { computeApGatewayId } from '../identity/router.js';
import { EMAILIT_NETWORK } from '../generation/fixedSites.js';
import { withMailSpool, type SpoolAccount } from '../emailit/spool.js';
import { filterTreeForSession, filterTreeToAllowlist } from '../patches/readFilter.js';
import { serializeTree } from '../filesystem/treeCodec.js';
import type { Directory } from '../filesystem/types.js';
import type { UserType } from '../types.js';
import type { NonceStore } from '../signedRequest/nonceStore.js';

export type { OwnerPatchRow } from './materializeMachineFs.js';
export type { OccupantWorkstation } from '../patches/remoteWritePermission.js';

/** The caller's open session on the target: the tier the read filter runs at, and the
 *  network the session was opened on. That network is what finds a box nobody owns, since
 *  occupancy has no row for one. `null` on a row that carries none. */
export type ActiveSession = { readonly userType: UserType; readonly essid: string | null };

type SessionQuery = { readonly player_key: string; readonly machine_id: string };

type Lookup<Value> = { readonly data: Value | null; readonly error: unknown };

export type ResolveCrossPlayerFsDeps = {
  readonly nonceStore: NonceStore;
  /** Whose workstation this is, from `home_network_occupants` (PK `(essid, owner_key)`).
   *  Occupancy means "this machine is on that WiFi", which is exactly what makes a box
   *  reachable: a player who ran `nmcli disconnect` has taken their machine off the
   *  network and must resolve to nothing here, so the read fails closed. Only ever a
   *  workstation. A box the network makes has no occupant and is found from the session. */
  readonly findOccupantWorkstationByMachineId: FindOccupantWorkstationByMachineId;
  readonly findActiveSession: (query: SessionQuery) => Promise<Lookup<ActiveSession>>;
  /** The network on the caller's newest row on the machine, open or ended. Asked only of a
   *  box nobody owns once no row is open, because that row is the one thing left that says
   *  which network the box is on. */
  readonly findLastSessionEssid: (query: SessionQuery) => Promise<Lookup<string>>;
  /** The machine's patch rows on the target. Scoped to `machine_id` only — after
   *  the shared-journal flip the machine OWNS its journal (the workstation id
   *  already encodes the owner), so this serves the real box including every
   *  writer's rows, never the caller's separate per-viewer rows. */
  readonly findPatches: (query: {
    readonly machine_id: string;
  }) => Promise<Lookup<readonly OwnerPatchRow[]>>;
  /** Every emailit.io account with everything in its inbox. Asked only for a root
   *  session on emailit.io's box. */
  readonly findMailSpool: () => Promise<Lookup<readonly SpoolAccount[]>>;
};

const EMAILIT_MACHINE = computeApGatewayId(EMAILIT_NETWORK);

export type HandlerResponse = {
  readonly status: number;
  readonly body: Record<string, unknown>;
};

/** The tree, as generated, of a box the caller's own rows say its network makes: that
 *  network's gateway or a machine it generates. The network is never taken from the
 *  request, and an id it does not make resolves to nothing, so no box on another network
 *  can be reached by naming it.
 *
 *  An open row is the whole answer. With none, the caller's newest ended row still says
 *  where the box is. */
const networkBoxBaseFs = async (
  deps: ResolveCrossPlayerFsDeps,
  caller: SessionQuery,
  activeSession: ActiveSession | null,
): Promise<Lookup<Directory>> => {
  const network =
    activeSession === null
      ? await deps.findLastSessionEssid(caller)
      : { data: activeSession.essid, error: null };
  if (network.error || network.data === null) return { data: null, error: network.error };
  return { data: networkBaseFsForMachineId(network.data, caller.machine_id), error: null };
};

// Loose so the envelope fields pass through; the refine keeps the codebase-wide
// posture that a client never claims identity (the caller is the verified pubkey).
const resolveCrossPlayerFsSchema = z
  .looseObject({
    action: z.literal('resolveCrossPlayerFs'),
    machine_id: z.string().min(1),
  })
  .refine((payload) => !('player_key' in payload));

export const handleResolveCrossPlayerFs = async (
  body: unknown,
  deps: ResolveCrossPlayerFsDeps,
): Promise<HandlerResponse> => {
  const verified = await verifySignedRequest(body, resolveCrossPlayerFsSchema, {
    nonceStore: deps.nonceStore,
  });
  if (!verified.ok) {
    return { status: STATUS_BY_VERIFY_REASON[verified.reason], body: { error: verified.reason } };
  }
  const { publicKey, payload } = verified;
  const caller = { player_key: publicKey, machine_id: payload.machine_id };

  const occupant = await deps.findOccupantWorkstationByMachineId(payload.machine_id);
  if (occupant.error) {
    return { status: 500, body: { error: 'occupant_lookup_failed' } };
  }

  // Tier 1 — the owner reads its own box in full; ownership trumps any session tier,
  // so we never consult the session table for the owner. A box the network makes has no
  // owner, so every caller on it falls through to the session tiers.
  const isOwner = occupant.data !== null && publicKey === occupant.data.owner_key;

  const session = isOwner ? null : await deps.findActiveSession(caller);
  if (session !== null && session.error) {
    return { status: 500, body: { error: 'session_lookup_failed' } };
  }
  const activeSession = session?.data ?? null;

  const base: Lookup<Directory> =
    occupant.data === null
      ? await networkBoxBaseFs(deps, caller, activeSession)
      : { data: buildOccupantWorkstationFs(occupant.data), error: null };
  if (base.error) {
    return { status: 500, body: { error: 'session_lookup_failed' } };
  }
  if (base.data === null) {
    return { status: 404, body: { error: 'host_unreachable' } };
  }

  // A failed read is an error, never an empty spool: a root would take that for the truth.
  const showsMail = payload.machine_id === EMAILIT_MACHINE && activeSession?.userType === 'root';
  const spool = showsMail ? await deps.findMailSpool() : null;
  if (spool !== null && spool.error) {
    return { status: 500, body: { error: 'mail_spool_lookup_failed' } };
  }
  const box = spool === null ? base.data : withMailSpool(base.data, spool.data ?? []);

  const patches = await deps.findPatches({
    machine_id: payload.machine_id,
  });
  if (patches.error) {
    return { status: 500, body: { error: 'patches_lookup_failed' } };
  }

  const tree = materializeMachineFs(box, patches.data);
  // Tier dispatch: owner → full tree; active session → walker at the session tier plus
  // the externally-observable allowlist; no session → that allowlist only.
  const filtered = isOwner
    ? tree
    : activeSession === null
      ? filterTreeToAllowlist(tree)
      : filterTreeForSession(tree, activeSession.userType);
  return { status: 200, body: { ok: true, tree: serializeTree(filtered) } };
};
