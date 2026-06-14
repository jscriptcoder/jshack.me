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
import { buildWorkstationBaseFsFromIdentity } from '../generation/workstationFs';
import { applyPatches, type Patch } from '../filesystem/applyPatches';
import { orderPatchesForReplay } from '../patches/orderPatchesForReplay';
import { filterTreeForRead, filterTreeToAllowlist } from '../patches/readFilter';
import { serializeTree } from '../filesystem/treeCodec';
import type { Directory, FilePermissions } from '../filesystem/types';
import type { UserType } from '../types';
import type { NonceStore } from '../signedRequest/nonceStore';

/** The registry fields needed to reconstruct the owner's box (decision D2): whose
 *  box it is (guest-password + world seed) and the player-chosen identity the FS
 *  generator stamps into `/etc/passwd`. */
export type RegistryWorkstation = {
  readonly owner_key: string;
  readonly workstation_username: string;
  readonly workstation_root_hash: string;
};

/** One of the machine's persisted patch rows on the target — the same shape
 *  `/api/patches` reads, mapped into a client `Patch` for replay. After the
 *  shared-journal flip these are the MACHINE's rows (every writer's), carrying
 *  the SERVER `updated_at` + `writer_key` so they replay in chronological order. */
export type OwnerPatchRow = {
  readonly path: string;
  readonly content: string | null;
  readonly owner: string;
  readonly permissions: FilePermissions | null;
  readonly node_type: 'file' | 'directory' | null;
  readonly updated_at: string;
  readonly writer_key: string;
};

/** The caller's active session on the target — the SERVER-authoritative tier the
 *  read filter runs at. */
export type ActiveSession = { readonly userType: UserType };

export type ResolveCrossPlayerFsDeps = {
  readonly nonceStore: NonceStore;
  readonly findRegistryByMachineId: (
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

const rowToPatch = (row: OwnerPatchRow): Patch => ({
  path: row.path,
  content: row.content,
  owner: row.owner,
  ...(row.permissions ? { permissions: row.permissions } : {}),
  ...(row.node_type ? { nodeType: row.node_type } : {}),
});

/** Rebuild A's REAL box: the shared generator's baseline (decision D6) with the
 *  machine's persisted patch journal replayed over it — every writer's rows,
 *  ordered chronologically (D1–D3) so the latest write to each path wins. */
const materialize = (
  registry: RegistryWorkstation,
  patches: readonly OwnerPatchRow[] | null,
): Directory => {
  const base = buildWorkstationBaseFsFromIdentity({
    ownerKeyHex: registry.owner_key,
    username: registry.workstation_username,
    rootPasswordHash: registry.workstation_root_hash,
  });
  return applyPatches(base, orderPatchesForReplay(patches ?? []).map(rowToPatch));
};

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
  if (registry.data === null) {
    return { status: 404, body: { error: 'host_unreachable' } };
  }

  // Tier 1 — the owner reads its own box in full; ownership trumps any session tier,
  // so we never consult the session table for the owner.
  const isOwner = publicKey === registry.data.owner_key;

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

  const tree = materialize(registry.data, patches.data);
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
