/**
 * handleUpsertPatch — the pure upsertPatch endpoint logic (no Vercel, no
 * Supabase). The api/ glue injects a real Supabase-backed `upsertPatch` and a
 * nonce store; tests inject mocks.
 *
 * Flow: verify the signed envelope → L1-authorize the target machine (own
 * workstation by suffix match, OR an active ssh session there) → server-stamp
 * writer_key from the VERIFIED pubkey (never a client claim) → upsert. The
 * payload schema rejects a client-supplied player_key/writer_key outright.
 *
 * Shared journal (Story 3): a row is keyed `(machine_id, path, writer_key)`, so
 * `writer_key` is the PROVENANCE of this row (who wrote it) — multiple writers'
 * edits to one file coexist and replay chronologically. The own-box read keys on
 * `machine_id` (the machine owns the journal), not on the writer.
 *
 * A write that moves a router's firmware row reboots the router, in this same request:
 * a real router flashes its new image and restarts itself, and doing it here rather than
 * leaving it to the client means a tampered client cannot patch the box and keep its
 * shell. The server cannot tell `apt` from an editor, so a root hand-editing the row
 * reboots the box too.
 */

import { z } from 'zod';
import { verifySignedRequest } from '../signedRequest/verify.js';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus.js';
import {
  authorizeMachineAccess,
  type FindActiveSession,
  type StandingSession,
} from './authorizeMachineAccess.js';
import { appendMachineLog } from './appendMachineLog.js';
import { contentHash } from './contentHash.js';
import { orderPatchesForReplay } from './orderPatchesForReplay.js';
import {
  enforceRemoteWriteL2,
  type FindOccupantWorkstationByMachineId,
  type ListMachinePatches,
} from './remoteWritePermission.js';
import {
  DPKG_LOG_OWNER,
  DPKG_LOG_PATH,
  DPKG_LOG_PERMISSIONS,
  formatPackageDowngradeLine,
} from '../logging/dpkgLog.js';
import { DPKG_STATUS_PATH, parseDpkgVersions, readDpkgStatus } from '../packages/dpkgStatus.js';
import { firmwareMoveBetween, type FirmwareMove } from '../packages/packageVersions.js';
import { movesForward } from '../cve/packageTimeline.js';
import { gameDayAt } from '../cve/worldClock.js';
import {
  boxTraceProvenance,
  rebootBox,
  type RebootSequenceDeps,
  type RebootTarget,
} from '../sessions/rebootSequence.js';
import type { Directory } from '../filesystem/types.js';
import type { NonceStore } from '../signedRequest/nonceStore.js';
import { asEpochMs, asGameTime, type UserType } from '../types.js';

export type FilePermissionsRow = {
  readonly read: readonly UserType[];
  readonly write: readonly UserType[];
  readonly execute: readonly UserType[];
};

export type PatchRow = {
  /** Provenance: the player who wrote this row (PK component with machine_id +
   *  path). Server-stamped from the verified pubkey, never a client claim. */
  readonly writer_key: string;
  readonly machine_id: string;
  readonly path: string;
  readonly content: string | null;
  readonly owner: string;
  readonly permissions?: FilePermissionsRow;
  readonly is_new?: boolean;
  readonly node_type?: 'file' | 'directory';
};

/** One persisted row for a single path: the content a reader would materialize
 *  from it, plus what the replay order is decided on. */
export type PathPatchRow = {
  readonly content: string | null;
  readonly updated_at: string;
  readonly writer_key: string;
};

export type ListPathPatchesResult = {
  readonly data: readonly PathPatchRow[] | null;
  readonly error: unknown;
};

/** The reboot's own deps ride along because a firmware flash IS one: a write that moves
 *  a router's image takes the box down exactly as `reboot` does. */
export type UpsertPatchDeps = RebootSequenceDeps & {
  readonly nonceStore: NonceStore;
  /** The writer's live row on a box that is not theirs, read with the address its login
   *  came from — which a flash's log lines name. */
  readonly findActiveSession: FindActiveSession<StandingSession>;
  readonly listMachinePatches: ListMachinePatches;
  /** Every writer's rows for the ONE path being written — how the save's claimed
   *  base is checked against what the machine actually holds. Path-scoped rather
   *  than reusing the machine-wide L2 read, which an own-workstation write never
   *  performs. */
  readonly listPathPatches: (query: {
    readonly machine_id: string;
    readonly path: string;
  }) => Promise<ListPathPatchesResult>;
  /** Reverse-look-up a registered foreign workstation by its machine_id — the L2
   *  cross-player branch (D6) rebuilds the owner's tree from this. */
  /** Same-LAN fallback for L2 when no occupancy row exists (a shared-AP occupant evicted
   *  by a later joiner) — resolves the workstation from the occupancy table. */
  readonly findOccupantWorkstationByMachineId: FindOccupantWorkstationByMachineId;
  readonly upsertPatch: (row: PatchRow) => Promise<{ readonly error: unknown }>;
};

export type HandlerResponse = {
  readonly status: number;
  readonly body: Record<string, unknown>;
};

// Loose so the always-present envelope fields (action/ts/nonce) pass through;
// the refine rejects a client-supplied player_key/writer_key (the server stamps
// the writer from the verified pubkey).
const userTypeSchema = z.enum(['root', 'user', 'guest']);
const permissionsSchema = z.object({
  read: z.array(userTypeSchema),
  write: z.array(userTypeSchema),
  execute: z.array(userTypeSchema),
});

const upsertPatchSchema = z
  .looseObject({
    action: z.literal('upsertPatch'),
    machine_id: z.string().min(1),
    path: z.string().min(1),
    content: z.string().nullable(),
    owner: z.string().min(1),
    permissions: permissionsSchema.optional(),
    is_new: z.boolean().optional(),
    node_type: z.enum(['file', 'directory']).optional(),
    /** The fingerprint of the content this save was written against. Optional:
     *  a caller that was never shown content to overwrite (a `>` redirect,
     *  `touch`) sends none and writes unconditionally. */
    base_hash: z.string().min(1).optional(),
  })
  .refine((payload) => !('player_key' in payload) && !('writer_key' in payload));

/** Refuse a save that would replace content its author was never shown — an
 *  editor holding a buffer from before another occupant wrote the same file.
 *
 *  The row compared against is the one a READER materializes (`orderPatchesForReplay`,
 *  same-instant ties broken on writer_key), because that is what the player was
 *  looking at; picking any other row would reject saves that raced nothing. No
 *  rows means nobody has written the path since the world was generated, and the
 *  generated filesystem is the same for every viewer, so there is nothing unseen.
 *  A deletion marker holds no content to compare: the save agrees with the world
 *  only if it too expects the file to be absent. */
const rejectModifiedSinceOpen = async (
  payload: {
    readonly machine_id: string;
    readonly path: string;
    readonly base_hash?: string | undefined;
    readonly is_new?: boolean | undefined;
  },
  listPathPatches: UpsertPatchDeps['listPathPatches'],
): Promise<HandlerResponse | undefined> => {
  if (payload.base_hash === undefined) return undefined;
  const { data, error } = await listPathPatches({
    machine_id: payload.machine_id,
    path: payload.path,
  });
  if (error) return { status: 500, body: { error: 'base_check_failed' } };
  const materialized = orderPatchesForReplay(data ?? []).at(-1);
  if (materialized === undefined) return undefined;
  const stillHoldsWhatTheAuthorSaw =
    materialized.content === null
      ? payload.is_new === true
      : contentHash(materialized.content) === payload.base_hash;
  if (stillHoldsWhatTheAuthorSaw) return undefined;
  return { status: 409, body: { error: 'modified_since_open' } };
};

/** The firmware image this write flashes, or undefined when it flashes none. Compared
 *  against the box as it stood before the write — the tree L2 checked it against — so
 *  only a box whose own manifest already runs an image can be flashed. An own-workstation
 *  write is never rebuilt, and a workstation runs no firmware. */
const firmwareFlashed = (
  write: { readonly path: string; readonly content: string | null },
  before: Directory | null,
): FirmwareMove | undefined => {
  if (before === null || write.path !== DPKG_STATUS_PATH || write.content === null) {
    return undefined;
  }
  return firmwareMoveBetween(
    parseDpkgVersions(readDpkgStatus(before)),
    parseDpkgVersions(write.content),
  );
};

/** Reboot a router onto the image just written to it. A rollback is recorded in its
 *  `dpkg.log` FIRST, by the server from the manifest before and after: the session that
 *  would report it is one the reboot is about to end, and the owner's only record of a
 *  box moved backwards must not depend on a shell that no longer exists. Old release
 *  then new, as every rollback line reads. */
const flashRouter = async (
  deps: UpsertPatchDeps,
  target: RebootTarget,
  flashed: FirmwareMove,
): Promise<HandlerResponse> => {
  const gameDay = gameDayAt(asEpochMs(deps.now()));
  if (movesForward(flashed.pkg, { from: flashed.to, to: flashed.from, gameDay })) {
    const provenance = await boxTraceProvenance(deps, target);
    if (provenance.writerKey !== null) {
      await appendMachineLog(
        { appendLog: deps.appendLog },
        {
          writerKey: provenance.writerKey,
          machineId: target.machineId,
          path: DPKG_LOG_PATH,
          owner: DPKG_LOG_OWNER,
          permissions: DPKG_LOG_PERMISSIONS,
        },
        formatPackageDowngradeLine({
          packageName: flashed.pkg,
          fromVersion: flashed.from,
          toVersion: flashed.to,
          fromIp: provenance.sourceIp,
          time: asGameTime(deps.now()),
        }),
      );
    }
  }

  // The row is down already and the new image is the box's, so a failure here is not a
  // failed write: it is a reboot that did not take, and the writer has to be told so.
  const rebooted = await rebootBox(deps, target);
  return rebooted.ok
    ? { status: 200, body: { ok: true } }
    : { status: 500, body: { error: 'reboot_failed' } };
};

export const handleUpsertPatch = async (
  body: unknown,
  deps: UpsertPatchDeps,
): Promise<HandlerResponse> => {
  const verified = await verifySignedRequest(body, upsertPatchSchema, {
    nonceStore: deps.nonceStore,
  });
  if (!verified.ok) {
    return { status: STATUS_BY_VERIFY_REASON[verified.reason], body: { error: verified.reason } };
  }

  const { publicKey, payload } = verified;
  const access = await authorizeMachineAccess(
    publicKey,
    payload.machine_id,
    deps.findActiveSession,
  );
  if (!access.ok) {
    return { status: access.status, body: { error: access.error } };
  }

  // L2: a remote write is further constrained to the login's tier (own-box
  // bypasses — `access.session` is null there).
  const permitted = await enforceRemoteWriteL2({
    machineId: payload.machine_id,
    path: payload.path,
    session: access.session,
    listMachinePatches: deps.listMachinePatches,
    findOccupantWorkstationByMachineId: deps.findOccupantWorkstationByMachineId,
  });
  if (!permitted.ok) {
    return { status: permitted.status, body: { error: permitted.error } };
  }

  // After the permission gates, never before: a caller who may not write this
  // path at all must not learn whether somebody else has been editing it.
  const modified = await rejectModifiedSinceOpen(payload, deps.listPathPatches);
  if (modified) {
    return modified;
  }

  const { error } = await deps.upsertPatch({
    writer_key: publicKey,
    machine_id: payload.machine_id,
    path: payload.path,
    content: payload.content,
    owner: payload.owner,
    ...(payload.permissions ? { permissions: payload.permissions } : {}),
    ...(payload.is_new !== undefined ? { is_new: payload.is_new } : {}),
    ...(payload.node_type ? { node_type: payload.node_type } : {}),
  });
  if (error) {
    return { status: 500, body: { error: 'upsert_failed' } };
  }

  // Only once the row has landed: the image the router boots into is the one its
  // manifest now names, so a write that failed flashed nothing.
  const flashed = firmwareFlashed(payload, permitted.tree);
  if (flashed !== undefined) {
    return flashRouter(
      deps,
      { machineId: payload.machine_id, actorKey: publicKey, standing: access.session },
      flashed,
    );
  }

  return { status: 200, body: { ok: true } };
};
