/**
 * handleResolveCrossPlayerFs — the cross-player READ (Story 2, slice 2c, tier 2).
 *
 * One identity (B) holding an active session on ANOTHER identity's (A's) workstation
 * fetches A's filesystem. Where `resolvePublicScan` reads only A's open ports (the
 * `/var/run` allowlist), this serves A's whole readable tree. D1 forces it
 * server-side: B has neither A's seed nor A's patch rows, so the server is the only
 * party that can materialize A's box.
 *
 * Flow: verify B's envelope → reverse-look-up the registry by `workstation_machine_id`
 * (B holds A's id from the 2b login) for A's persisted identity → require B to hold an
 * active session on that machine (the TIER comes from the SERVER session, never the
 * client — tier 1 owner + tier 3 no-session allowlist are slice 2d) → rebuild A's
 * baseline from the identity (shared generator, decision D6) + replay A's OWN patch
 * rows (scoped to `owner_key`, never the caller's per-viewer rows) → prune to the
 * caller's tier with the shared read walker → ship the serialized tree.
 *
 * The pruned tree is what crosses the wire: a path the tier may not read is dropped
 * BEFORE the response leaves (`project_read_path_privacy_gap` — the wire is the
 * threat surface), so neither A's passwd hashes nor any non-readable file can leak.
 */

import { z } from 'zod';
import { verifySignedRequest } from '../signedRequest/verify';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus';
import { buildWorkstationBaseFsFromIdentity } from '../generation/workstationFs';
import { applyPatches, type Patch } from '../filesystem/applyPatches';
import { filterTreeForRead } from '../patches/readFilter';
import { serializeTree } from '../filesystem/treeCodec';
import type { FilePermissions } from '../filesystem/types';
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

/** One of the owner's persisted patch rows on the target machine — the same shape
 *  `/api/patches` reads, mapped into a client `Patch` for replay. */
export type OwnerPatchRow = {
  readonly path: string;
  readonly content: string | null;
  readonly owner: string;
  readonly permissions: FilePermissions | null;
  readonly node_type: 'file' | 'directory' | null;
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
  /** The OWNER's patch rows on the target. Scoped to `owner_key` + `machine_id` so
   *  the read serves the owner's REAL box, never the caller's per-viewer rows. */
  readonly findPatches: (query: {
    readonly player_key: string;
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

  const session = await deps.findActiveSession({
    player_key: publicKey,
    machine_id: payload.machine_id,
  });
  if (session.error) {
    return { status: 500, body: { error: 'session_lookup_failed' } };
  }
  if (session.data === null) {
    return { status: 403, body: { error: 'no_session' } };
  }

  const patches = await deps.findPatches({
    player_key: registry.data.owner_key,
    machine_id: payload.machine_id,
  });
  if (patches.error) {
    return { status: 500, body: { error: 'patches_lookup_failed' } };
  }

  const base = buildWorkstationBaseFsFromIdentity({
    ownerKeyHex: registry.data.owner_key,
    username: registry.data.workstation_username,
    rootPasswordHash: registry.data.workstation_root_hash,
  });
  const tree = applyPatches(base, (patches.data ?? []).map(rowToPatch));
  const filtered = filterTreeForRead(tree, session.data.userType);
  return { status: 200, body: { ok: true, tree: serializeTree(filtered) } };
};
