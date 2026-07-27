import { describe, expect, it, vi } from 'vitest';
import { handleRemovePatch, type RemovePatchDeps } from './removePatch';
import type { ActiveSessionQuery, FindActiveSessionResult } from './authorizeMachineAccess';
import type {
  FindOccupantWorkstationByMachineId,
  ListMachinePatchesResult,
  OccupantWorkstation,
} from './remoteWritePermission';
import type { PatchRow } from './upsertPatch';
import { signRequest } from '../signedRequest/sign';
import { generateIdentity } from '../identity/identity';
import { computeWorkstationId } from '../identity/workstation';
import { generateHomeLan } from '../generation/generateHomeLan';
import { hostMachineId } from '../generation/remoteHostId';
import { md5 } from '../generation/md5';
import type { UserType } from '../types';
import type { NonceStore } from '../signedRequest/nonceStore';

const freshStore: NonceStore = async () => ({ fresh: true });
const ESSID = 'BEAN-THERE-WIFI';

/** A REAL remote host on the signer's LAN — so L2 regeneration resolves the same
 *  FS the perms are walked over. Returns the coordinate machine_id + essid. */
const remoteTarget = () => {
  const host = generateHomeLan(ESSID)
    .hosts.filter((candidate) => candidate.kind === 'machine')
    .at(-1);
  if (host === undefined) throw new Error('no machine host on LAN');
  return { machineId: hostMachineId(host, ESSID), essid: ESSID };
};

const remoteSession = (userType: UserType): FindActiveSessionResult => ({
  data: { userType, essid: ESSID },
  error: null,
});

/** A registered FOREIGN player workstation (A's box): A's identity → A's
 *  workstation machine_id, plus the occupancy row the L2 reverse-lookup returns so
 *  a cross-player rm walks A's tree rebuilt from the OWNER's identity (D6). Its
 *  machine_id is an `ed25519:`-suffixed workstation id, so it never matches an NPC
 *  host on the caller's LAN — `hostForMachineId` misses and L2 falls to the
 *  occupancy lookup. */
const occupantWorkstation = () => {
  const owner = generateIdentity();
  const machineId = computeWorkstationId('skylab', owner.publicKeyHex);
  const occupant: { kind: 'workstation' } & OccupantWorkstation = {
    kind: 'workstation',
    owner_key: owner.publicKeyHex,
    workstation_username: 'alice',
    workstation_root_hash: md5('hunter2'),
  };
  return { owner, machineId, occupant };
};

/** Keeps the spies (so call-arg assertions work) while letting each test set the
 *  values they return — overriding the spies directly would orphan the ones we
 *  assert on. */
const makeDeps = (
  over: {
    readonly nonceStore?: NonceStore;
    readonly deleteError?: unknown;
    readonly upsertError?: unknown;
    readonly activeSession?: FindActiveSessionResult;
    readonly machinePatches?: ListMachinePatchesResult;
    readonly occupant?: OccupantWorkstation | null;
  } = {},
) => {
  const deletePatchTree = vi.fn<RemovePatchDeps['deletePatchTree']>(async () => ({
    error: over.deleteError ?? null,
  }));
  const upsertPatch = vi.fn<(row: PatchRow) => Promise<{ error: unknown }>>(async () => ({
    error: over.upsertError ?? null,
  }));
  // Default: no active session on the queried machine; foreign-machine removals
  // override to simulate an ssh hop being present.
  const findActiveSession = vi.fn<(query: ActiveSessionQuery) => Promise<FindActiveSessionResult>>(
    async () => over.activeSession ?? { data: null, error: null },
  );
  // Default: the remote machine has no prior patches (its base FS).
  const listMachinePatches = vi.fn<() => Promise<ListMachinePatchesResult>>(
    async () => over.machinePatches ?? { data: [], error: null },
  );
  // Default: not an occupant's workstation (an NPC host, an unknown id, or a machine
  // whose owner has left the WiFi); cross-player rm tests override this with A's row.
  const findOccupantWorkstationByMachineId = vi.fn<FindOccupantWorkstationByMachineId>(
    async () => ({
      data: over.occupant ?? null,
      error: null,
    }),
  );
  const deps: RemovePatchDeps = {
    nonceStore: over.nonceStore ?? freshStore,
    findActiveSession,
    listMachinePatches,
    findOccupantWorkstationByMachineId,
    deletePatchTree,
    upsertPatch,
  };
  return {
    deps,
    deletePatchTree,
    upsertPatch,
    findActiveSession,
    listMachinePatches,
    findOccupantWorkstationByMachineId,
  };
};

/** Fields for a removal on the signer's OWN workstation. */
const ownFields = (publicKeyHex: string) => ({
  machine_id: computeWorkstationId('skylab', publicKeyHex),
  path: '/home/alice/notes.txt',
  owner: 'alice',
});

describe('handleRemovePatch', () => {
  it('clears the caller’s row + descendants and tombstones the path on an own-box rm', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'removePatch', ownFields(id.publicKeyHex));
    const { deps, deletePatchTree, upsertPatch } = makeDeps();

    const result = await handleRemovePatch(envelope, deps);

    expect(result).toEqual({ status: 200, body: { ok: true } });
    // The caller's own (machine_id, path, writer_key) row + every descendant row
    // are deleted first (so a stale child can't resurrect part of the subtree)...
    expect(deletePatchTree).toHaveBeenCalledTimes(1);
    expect(deletePatchTree).toHaveBeenCalledWith({
      writer_key: id.publicKeyHex,
      machine_id: computeWorkstationId('skylab', id.publicKeyHex),
      path: '/home/alice/notes.txt',
    });
    // ...then a content:null tombstone is ALWAYS recorded — a timestamped deletion
    // event keyed to the verified writer_key (never a client claim) — so a
    // concurrent writer's row for the path can't keep the file alive on replay.
    expect(upsertPatch).toHaveBeenCalledTimes(1);
    const row = upsertPatch.mock.calls[0]![0];
    expect(row.content).toBeNull();
    expect(row.is_new).toBe(false);
    expect(row.writer_key).toBe(id.publicKeyHex);
    expect(row.machine_id).toBe(computeWorkstationId('skylab', id.publicKeyHex));
    expect(row.path).toBe('/home/alice/notes.txt');
    expect(row.owner).toBe('alice');
  });

  it('rejects a removal on a foreign machine when the caller has no active session there (403)', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'removePatch', {
      machine_id: 'darkstar-12345678',
      path: '/x',
      owner: 'alice',
    });
    const { deps, deletePatchTree } = makeDeps();

    const result = await handleRemovePatch(envelope, deps);

    expect(result).toEqual({ status: 403, body: { error: 'no_session' } });
    expect(deletePatchTree).not.toHaveBeenCalled();
  });

  it('removes a node on a foreign machine when a root ssh session exists there', async () => {
    const id = generateIdentity();
    const { machineId } = remoteTarget();
    const envelope = signRequest(id, 'removePatch', {
      machine_id: machineId,
      path: '/etc/passwd',
      owner: 'root',
    });
    const { deps, deletePatchTree } = makeDeps({
      activeSession: remoteSession('root'),
    });

    const result = await handleRemovePatch(envelope, deps);

    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(deletePatchTree).toHaveBeenCalledWith({
      writer_key: id.publicKeyHex,
      machine_id: machineId,
      path: '/etc/passwd',
    });
  });

  it('rejects a user ssh session removing a root-owned file on a foreign machine (403, L2)', async () => {
    const id = generateIdentity();
    const { machineId } = remoteTarget();
    const envelope = signRequest(id, 'removePatch', {
      machine_id: machineId,
      path: '/etc/passwd',
      owner: 'user',
    });
    const { deps, deletePatchTree } = makeDeps({
      activeSession: remoteSession('user'),
    });

    const result = await handleRemovePatch(envelope, deps);

    expect(result).toEqual({ status: 403, body: { error: 'permission_denied' } });
    // L2 denies BEFORE the delete/tombstone work runs.
    expect(deletePatchTree).not.toHaveBeenCalled();
  });

  it('returns 500 when the prior-patch fetch for the L2 check fails', async () => {
    const id = generateIdentity();
    const { machineId } = remoteTarget();
    const envelope = signRequest(id, 'removePatch', {
      machine_id: machineId,
      path: '/etc/passwd',
      owner: 'user',
    });
    const { deps, deletePatchTree } = makeDeps({
      activeSession: remoteSession('user'),
      machinePatches: { data: null, error: { message: 'db down' } },
    });

    const result = await handleRemovePatch(envelope, deps);

    expect(result).toEqual({ status: 500, body: { error: 'permission_check_failed' } });
    expect(deletePatchTree).not.toHaveBeenCalled();
  });

  it('does not consult the sessions table for an own-workstation removal (L1 bypass)', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'removePatch', ownFields(id.publicKeyHex));
    const { deps, findActiveSession, listMachinePatches } = makeDeps();

    const result = await handleRemovePatch(envelope, deps);

    expect(result.status).toBe(200);
    expect(findActiveSession).not.toHaveBeenCalled();
    // Own-box removals bypass L2 too — no regeneration journal fetch.
    expect(listMachinePatches).not.toHaveBeenCalled();
  });

  it('returns 500 when the active-session lookup fails (not a false 403)', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'removePatch', {
      machine_id: 'darkstar-12345678',
      path: '/x',
      owner: 'alice',
    });
    const { deps, deletePatchTree } = makeDeps({
      activeSession: { data: null, error: { message: 'db down' } },
    });

    const result = await handleRemovePatch(envelope, deps);

    expect(result).toEqual({ status: 500, body: { error: 'session_lookup_failed' } });
    expect(deletePatchTree).not.toHaveBeenCalled();
  });

  it('rejects a tampered signature with 401 and never touches the table', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'removePatch', ownFields(id.publicKeyHex));
    const { deps, deletePatchTree } = makeDeps();

    const result = await handleRemovePatch({ ...envelope, payload: `${envelope.payload} ` }, deps);

    expect(result).toEqual({ status: 401, body: { error: 'signature_invalid' } });
    expect(deletePatchTree).not.toHaveBeenCalled();
  });

  it('rejects a replayed nonce with 401', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'removePatch', ownFields(id.publicKeyHex));
    const { deps } = makeDeps({ nonceStore: async () => ({ fresh: false }) });

    const result = await handleRemovePatch(envelope, deps);

    expect(result).toEqual({ status: 401, body: { error: 'replay' } });
  });

  it('rejects a payload missing a required field with 400 payload_invalid', async () => {
    const id = generateIdentity();
    // No `path` — the schema requires it. Catches a mutant that loosens the
    // required-field validation (turning the schema permissive).
    const envelope = signRequest(id, 'removePatch', {
      machine_id: computeWorkstationId('skylab', id.publicKeyHex),
      owner: 'alice',
    });
    const { deps, deletePatchTree } = makeDeps();

    const result = await handleRemovePatch(envelope, deps);

    expect(result).toEqual({ status: 400, body: { error: 'payload_invalid' } });
    expect(deletePatchTree).not.toHaveBeenCalled();
  });

  it('rejects a client-supplied player_key with 400 and never touches the table', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'removePatch', {
      ...ownFields(id.publicKeyHex),
      player_key: 'forged-key',
    });
    const { deps, deletePatchTree } = makeDeps();

    const result = await handleRemovePatch(envelope, deps);

    expect(result).toEqual({ status: 400, body: { error: 'payload_invalid' } });
    expect(deletePatchTree).not.toHaveBeenCalled();
  });

  it('rejects a client-supplied writer_key (forged provenance) with 400 and never touches the table', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'removePatch', {
      ...ownFields(id.publicKeyHex),
      writer_key: 'forged-provenance',
    });
    const { deps, deletePatchTree } = makeDeps();

    const result = await handleRemovePatch(envelope, deps);

    expect(result).toEqual({ status: 400, body: { error: 'payload_invalid' } });
    expect(deletePatchTree).not.toHaveBeenCalled();
  });

  it('returns 500 when the delete reports an error', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'removePatch', ownFields(id.publicKeyHex));
    const { deps } = makeDeps({ deleteError: { message: 'db down' } });

    const result = await handleRemovePatch(envelope, deps);

    expect(result).toEqual({ status: 500, body: { error: 'remove_failed' } });
  });

  it('returns 500 when the marker upsert reports an error', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'removePatch', ownFields(id.publicKeyHex));
    const { deps } = makeDeps({ upsertError: { message: 'db down' } });

    const result = await handleRemovePatch(envelope, deps);

    expect(result).toEqual({ status: 500, body: { error: 'remove_failed' } });
  });

  // ---- Cross-player rm: B deletes on A's REGISTERED workstation (decision D6). ----

  it('tombstones a guest-writable file on a foreign player workstation (resolved from occupancy)', async () => {
    const visitor = generateIdentity();
    const { machineId, occupant } = occupantWorkstation();
    const envelope = signRequest(visitor, 'removePatch', {
      machine_id: machineId,
      path: '/tmp/pwned',
      owner: 'guest',
    });
    const { deps, deletePatchTree, upsertPatch, findOccupantWorkstationByMachineId, findActiveSession } =
      makeDeps({ activeSession: remoteSession('guest'), occupant });

    const result = await handleRemovePatch(envelope, deps);

    expect(result).toEqual({ status: 200, body: { ok: true } });
    // The descendant clear + tombstone are keyed to the VISITOR's writer_key on A's
    // machine — the deletion lands on A's shared journal, attributed to B.
    const query = { writer_key: visitor.publicKeyHex, machine_id: machineId, path: '/tmp/pwned' };
    expect(deletePatchTree).toHaveBeenCalledWith(query);
    const row = upsertPatch.mock.calls[0]![0];
    expect(row.content).toBeNull();
    expect(row.writer_key).toBe(visitor.publicKeyHex);
    expect(row.machine_id).toBe(machineId);
    expect(row.path).toBe('/tmp/pwned');
    // The foreign workstation is resolved by the occupancy reverse-lookup, and the
    // tier comes from the visitor's SERVER session — never a client claim.
    expect(findOccupantWorkstationByMachineId).toHaveBeenCalledWith(machineId);
    expect(findActiveSession).toHaveBeenCalledWith({
      player_key: visitor.publicKeyHex,
      machine_id: machineId,
    });
  });

  it("tombstones a root rm of a fellow occupant's /boot — bricking A from inside the shared LAN", async () => {
    const visitor = generateIdentity();
    const { machineId, occupant } = occupantWorkstation();
    // B is root on A (same-LAN su) and deletes A's kernel. The write path resolves A's
    // box from A's occupancy row, which exists for every occupant of the ESSID no matter
    // who joined when — without that resolution the brick would falsely 403.
    const envelope = signRequest(visitor, 'removePatch', {
      machine_id: machineId,
      path: '/boot/vmlinuz',
      owner: 'root',
    });
    const { deps, upsertPatch, findOccupantWorkstationByMachineId } = makeDeps({
      activeSession: remoteSession('root'),
      occupant,
    });

    const result = await handleRemovePatch(envelope, deps);

    expect(result).toEqual({ status: 200, body: { ok: true } });
    const row = upsertPatch.mock.calls[0]![0];
    expect(row.content).toBeNull();
    expect(row.path).toBe('/boot/vmlinuz');
    expect(findOccupantWorkstationByMachineId).toHaveBeenCalledWith(machineId);
  });

  it('denies a guest cross-player rm of a root-owned file on a foreign workstation (403, no tombstone)', async () => {
    const visitor = generateIdentity();
    const { machineId, occupant } = occupantWorkstation();
    const envelope = signRequest(visitor, 'removePatch', {
      machine_id: machineId,
      path: '/etc/passwd',
      owner: 'root',
    });
    const { deps, deletePatchTree, upsertPatch } = makeDeps({
      activeSession: remoteSession('guest'),
      occupant,
    });

    const result = await handleRemovePatch(envelope, deps);

    // /etc/passwd is not guest-writable on A's occupancy-built tree → L2 denies the
    // unlink before any delete/tombstone runs; nothing lands on A's journal.
    expect(result).toEqual({ status: 403, body: { error: 'permission_denied' } });
    expect(deletePatchTree).not.toHaveBeenCalled();
    expect(upsertPatch).not.toHaveBeenCalled();
    // The wire leaks nothing about the denied path beyond the error.
    expect(Object.keys(result.body)).toEqual(['error']);
  });
});
