/**
 * handleResolveCrossPlayerFs — the cross-player READ (Story 2, slices 2c+2d).
 *
 * One identity (the caller) fetches ANOTHER identity's (A's) workstation filesystem.
 * Where `resolvePublicScan` reads only A's open ports (the `/var/run` allowlist),
 * this serves A's readable tree. D1 forces it server-side: the caller has neither
 * A's seed nor A's patch rows, so the server is the only party that can materialize
 * A's box.
 *
 * Flow: verify the envelope → reverse-look-up the registry by `workstation_machine_id`
 * (the caller holds A's id from the 2b login) for A's persisted identity → rebuild A's
 * baseline from the identity (shared generator, decision D6) + replay A's OWN patch
 * rows (scoped to `owner_key`, never the caller's per-viewer rows) → prune to the
 * caller's TIER → ship the serialized tree. The tier is SERVER-derived, never a
 * client claim:
 *   - tier 1 (owner): caller's verified pubkey == owner_key → the FULL tree
 *     (ownership trumps any session; the session table is not consulted);
 *   - tier 2 (active session): pruned by the shared read walker at the session tier;
 *   - tier 3 (no session): pruned to the externally-observable allowlist only.
 *
 * The pruned tree is what crosses the wire: a path the tier may not read is dropped
 * BEFORE the response leaves (`project_read_path_privacy_gap` — the wire is the
 * threat surface), so neither A's passwd hashes nor any non-observable file can leak.
 */

import { z } from 'zod';
import { verifySignedRequest } from '../signedRequest/verify';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus';
import { materializeWorkstationFs, type OwnerPatchRow } from './materializeWorkstationFs';
import { materializeApGatewayFs } from './materializeRouterFs';
import { filterTreeForRead, filterTreeToAllowlist } from '../patches/readFilter';
import { serializeTree } from '../filesystem/treeCodec';
import type { UserType } from '../types';
import type { NonceStore } from '../signedRequest/nonceStore';

export type { OwnerPatchRow } from './materializeWorkstationFs';

/** The registry fields needed to reconstruct the owner's WORKSTATION (decision D2):
 *  whose box it is (guest-password + world seed) and the player-chosen identity the
 *  FS generator stamps into `/etc/passwd`. */
export type RegistryWorkstation = {
  readonly kind: 'workstation';
  readonly owner_key: string;
  readonly workstation_username: string;
  readonly workstation_root_hash: string;
};

/** The registry fields needed to reconstruct the access point's GATEWAY. Its base
 *  is seeded from the ESSID ALONE (admin password + sshd presence derive from it),
 *  because the gateway belongs to the AP and not to any occupant, so this carries
 *  only that. */
export type RegistryRouter = {
  readonly kind: 'router';
  readonly essid: string;
};

/** A registered machine behind a public IP — the owner's workstation OR its router.
 *  The caller (B) holds only a `machine_id` from the login and can't know which it
 *  is, so the reverse-lookup discriminates and the handler materializes the matching
 *  base (Story 5.2). */
export type RegistryMachine = RegistryWorkstation | RegistryRouter;

/** The caller's active session on the target — the SERVER-authoritative tier the
 *  read filter runs at. */
export type ActiveSession = { readonly userType: UserType };

export type ResolveCrossPlayerFsDeps = {
  readonly nonceStore: NonceStore;
  readonly findRegistryByMachineId: (
    machineId: string,
  ) => Promise<{ readonly data: RegistryMachine | null; readonly error: unknown }>;
  /** Same-LAN fallback when the WAN registry has no row for the machine. The registry's
   *  PK is the ESSID-shared `public_ip` (last-writer-wins), so a fellow occupant who
   *  joined a shared AP before a later joiner has been evicted from it — but never from
   *  `home_network_occupants` (PK `(essid, owner_key)`, every occupant coexists). That
   *  table is the never-overwritten "this `workstation_machine_id` is owner X" record and
   *  its row is a structural superset of `RegistryWorkstation`, so it materializes the
   *  box identically. Only ever a WORKSTATION — routers live solely in the registry. */
  readonly findOccupantWorkstationByMachineId: (
    machineId: string,
  ) => Promise<{ readonly data: RegistryWorkstation | null; readonly error: unknown }>;
  readonly findActiveSession: (query: {
    readonly player_key: string;
    readonly machine_id: string;
  }) => Promise<{ readonly data: ActiveSession | null; readonly error: unknown }>;
  /** The machine's patch rows on the target. Scoped to `machine_id` only — after
   *  the shared-journal flip the machine OWNS its journal (the workstation id
   *  already encodes the owner), so this serves the real box including every
   *  writer's rows, never the caller's separate per-viewer rows. */
  readonly findPatches: (query: {
    readonly machine_id: string;
  }) => Promise<{ readonly data: readonly OwnerPatchRow[] | null; readonly error: unknown }>;
};

export type HandlerResponse = {
  readonly status: number;
  readonly body: Record<string, unknown>;
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

  const registry = await deps.findRegistryByMachineId(payload.machine_id);
  if (registry.error) {
    return { status: 500, body: { error: 'registry_lookup_failed' } };
  }

  // Resolve the target box: the WAN registry first (workstation or router), then the
  // same-LAN occupancy fallback (a shared-AP occupant evicted from the registry by a
  // later joiner — see the dep doc). Only a true miss in BOTH is unreachable.
  let machine: RegistryMachine | null = registry.data;
  if (machine === null) {
    const occupant = await deps.findOccupantWorkstationByMachineId(payload.machine_id);
    if (occupant.error) {
      return { status: 500, body: { error: 'occupant_lookup_failed' } };
    }
    machine = occupant.data;
  }
  if (machine === null) {
    return { status: 404, body: { error: 'host_unreachable' } };
  }

  // Tier 1 — the owner reads its own box in full; ownership trumps any session tier,
  // so we never consult the session table for the owner. The AP gateway has NO owner
  // (it belongs to the access point, not to an occupant), so every caller on it —
  // including occupants of its own ESSID — falls through to the session tiers.
  const isOwner = machine.kind !== 'router' && publicKey === machine.owner_key;

  const session = isOwner
    ? null
    : await deps.findActiveSession({ player_key: publicKey, machine_id: payload.machine_id });
  if (session !== null && session.error) {
    return { status: 500, body: { error: 'session_lookup_failed' } };
  }

  const patches = await deps.findPatches({
    machine_id: payload.machine_id,
  });
  if (patches.error) {
    return { status: 500, body: { error: 'patches_lookup_failed' } };
  }

  // Materialize the matching base for the registered machine: a router is rebuilt
  // from the owner key alone; a workstation from its persisted identity (Story 5.2).
  const tree =
    machine.kind === 'router'
      ? materializeApGatewayFs(machine, patches.data)
      : materializeWorkstationFs(machine, patches.data);
  // Tier dispatch: owner → full tree; active session → walker at the session tier;
  // no session → externally-observable allowlist only.
  const activeSession = session?.data ?? null;
  const filtered = isOwner
    ? tree
    : activeSession === null
      ? filterTreeToAllowlist(tree)
      : filterTreeForRead(tree, activeSession.userType);
  return { status: 200, body: { ok: true, tree: serializeTree(filtered) } };
};
