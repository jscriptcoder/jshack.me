import { describe, expect, it, vi } from 'vitest';
import {
  handleUpsertPatch,
  type ListPathPatchesResult,
  type PatchRow,
  type UpsertPatchDeps,
} from './upsertPatch';
import { contentHash } from './contentHash';
import type { ActiveSessionQuery, FindActiveSessionResult } from './authorizeMachineAccess';
import type {
  FindOccupantWorkstationByMachineId,
  ListMachinePatchesResult,
  OccupantWorkstation,
} from './remoteWritePermission';
import { signRequest } from '../signedRequest/sign';
import { generateIdentity } from '../identity/identity';
import { computeWorkstationId } from '../identity/workstation';
import { generateHomeLan } from '../generation/generateHomeLan';
import { crackableEssidPool } from '../generation/generateWifi';
import { generateDeepLayer, seedNetworkDepth } from '../generation/generateDeepLayer';
import { computeDeepGatewayId, computeInnerGatewayId } from '../identity/router';
import { hostMachineId } from '../generation/remoteHostId';
import { md5 } from '../generation/md5';
import type { UserType } from '../types';
import type { NonceStore } from '../signedRequest/nonceStore';

const freshStore: NonceStore = async () => ({ fresh: true });
const ESSID = 'BEAN-THERE-WIFI';

/** A REAL remote host on the signer's deterministic LAN — so the L2 regeneration
 *  (`hostForMachineId` → `buildRemoteHostFs`) resolves the same FS the perms are
 *  walked over. Returns the coordinate machine_id the ssh session would carry. */
const remoteTarget = () => {
  const host = generateHomeLan(ESSID)
    .hosts.filter((candidate) => candidate.kind === 'machine')
    .at(-1);
  if (host === undefined) throw new Error('no machine host on LAN');
  return { machineId: hostMachineId(host, ESSID), essid: ESSID };
};

const remoteSession =
  (userType: UserType, essid = ESSID) =>
  async (): Promise<FindActiveSessionResult> => ({ data: { username: 'someone', userType, essid }, error: null });

/** A registered FOREIGN player workstation (A's box): A's identity → A's
 *  workstation machine_id, plus the occupancy row the L2 reverse-lookup returns so
 *  the cross-player write rebuilds A's tree from the OWNER's identity (decision D6).
 *  Its machine_id is an `ed25519:`-suffixed workstation id, so it never matches an
 *  NPC host on the caller's LAN — `hostForMachineId` misses and L2 falls to the
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

/** A persisted row for one path, as the base-content check reads it: the content
 *  a reader would materialize plus what `orderPatchesForReplay` orders on. */
const pathRow = (
  content: string | null,
  over: Partial<{ updated_at: string; writer_key: string }> = {},
) => ({
  content,
  updated_at: '2026-07-28T16:08:37.000000+00:00',
  writer_key: 'writer-1',
  ...over,
});

const makeDeps = (over: Partial<UpsertPatchDeps> = {}) => {
  const upsertPatch = vi.fn<(row: PatchRow) => Promise<{ error: unknown }>>(async () => ({
    error: null,
  }));
  // Default: nobody has written this path, so a save can never be overwriting
  // content its author was not shown.
  const listPathPatches = vi.fn<() => Promise<ListPathPatchesResult>>(async () => ({
    data: [],
    error: null,
  }));
  // Default: no active session on the queried machine. Foreign-machine tests
  // override this to simulate an ssh session being present.
  const findActiveSession = vi.fn<(query: ActiveSessionQuery) => Promise<FindActiveSessionResult>>(
    async () => ({ data: null, error: null }),
  );
  // Default: the remote machine has no prior patches (its base FS). L2 regenerates
  // the host and walks the base perms.
  const listMachinePatches = vi.fn<() => Promise<ListMachinePatchesResult>>(async () => ({
    data: [],
    error: null,
  }));
  // Default: the target is not an occupant's workstation (an NPC host, an unknown id,
  // or a machine whose owner has left the WiFi). Cross-player-write tests override this
  // with A's occupancy row.
  const findOccupantWorkstationByMachineId = vi.fn<FindOccupantWorkstationByMachineId>(
    async () => ({
      data: null,
      error: null,
    }),
  );
  const deps: UpsertPatchDeps = {
    nonceStore: freshStore,
    upsertPatch,
    findActiveSession,
    listMachinePatches,
    listPathPatches,
    findOccupantWorkstationByMachineId,
    ...over,
  };
  return {
    deps,
    upsertPatch,
    findActiveSession,
    listMachinePatches,
    listPathPatches,
    findOccupantWorkstationByMachineId,
  };
};

// Fields for a write to the signer's OWN workstation.
const ownFields = (publicKeyHex: string) => ({
  machine_id: computeWorkstationId('skylab', publicKeyHex),
  path: '/home/alice/notes.txt',
  content: 'hello',
  owner: 'alice',
});

/** The chain door hanging behind an ESSID's inner router, and the network it belongs to.
 *  Not a `generateHomeLan` host, so a write there exercises the deep-chain resolution
 *  rather than the LAN lookup. */
const chainDoor = (): { essid: string; machineId: string } => {
  for (const essid of crackableEssidPool) {
    if (seedNetworkDepth(essid) < 2) continue;
    const inner = generateHomeLan(essid).hosts.find(
      (host) => host.kind === 'router' && Number(host.ip.split('.')[3]) !== 1,
    );
    if (inner === undefined) continue;
    const innerId = computeInnerGatewayId(essid, Number(inner.ip.split('.')[3]));
    const child = generateDeepLayer(
      essid,
      { machineId: innerId, kind: 'router' },
      { hangsChild: true },
    ).childGateway;
    if (child !== null && child.kind === 'router') {
      return { essid, machineId: computeDeepGatewayId(innerId, Number(child.ip.split('.')[3])) };
    }
  }
  throw new Error('no network seeds a deep router chain door');
};

describe('handleUpsertPatch — a chain door is the network’s, not its finder’s', () => {
  it('accepts a rooted chain door’s forward from either occupant of the network', async () => {
    // Two DIFFERENT verified signers, one rooted door, one machine id. Both writes must
    // land, because both are configuring the same box: the chain descends from a gateway
    // the access point owns, so whoever roots the door is configuring shared
    // infrastructure. If the door resolved per player, the second signer would be walking
    // a tree the first cannot see and the write would fail closed at 403.
    const door = chainDoor();
    const fields = {
      machine_id: door.machineId,
      path: '/etc/iptables/rules.v4',
      content: '# NAT port-forward table\nforward 2224 to 10.0.0.9:22\n',
      owner: 'root',
      permissions: { read: ['root'], write: ['root'], execute: [] },
      node_type: 'file',
    };
    const rootedDoor = makeDeps({ findActiveSession: remoteSession('root', door.essid) });
    const rootedBySomeoneElse = makeDeps({
      findActiveSession: remoteSession('root', door.essid),
    });

    const first = await handleUpsertPatch(signRequest(generateIdentity(), 'upsertPatch', fields), rootedDoor.deps);
    const second = await handleUpsertPatch(
      signRequest(generateIdentity(), 'upsertPatch', fields),
      rootedBySomeoneElse.deps,
    );

    expect(first).toEqual({ status: 200, body: { ok: true } });
    expect(second).toEqual({ status: 200, body: { ok: true } });
    // And onto ONE machine record, so the second occupant's forward replays over the
    // first's rather than into a private journal.
    expect(rootedDoor.upsertPatch.mock.calls[0]?.[0].machine_id).toBe(
      rootedBySomeoneElse.upsertPatch.mock.calls[0]?.[0].machine_id,
    );
  });
});

describe('handleUpsertPatch', () => {
  it('persists an own-workstation write and server-stamps the verified writer_key', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'upsertPatch', ownFields(id.publicKeyHex));
    const { deps, upsertPatch } = makeDeps();

    const result = await handleUpsertPatch(envelope, deps);

    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(upsertPatch).toHaveBeenCalledTimes(1);
    const row = upsertPatch.mock.calls[0]![0];
    expect(row.writer_key).toBe(id.publicKeyHex);
    expect(row.machine_id).toBe(computeWorkstationId('skylab', id.publicKeyHex));
    expect(row.path).toBe('/home/alice/notes.txt');
    expect(row.content).toBe('hello');
    expect(row.owner).toBe('alice');
  });

  it('rejects a write to a foreign machine when the caller has no active session there (403 no_session)', async () => {
    const id = generateIdentity();
    const foreign = 'darkstar-12345678';
    const envelope = signRequest(id, 'upsertPatch', {
      machine_id: foreign,
      path: '/x',
      content: 'y',
      owner: 'alice',
    });
    const { deps, upsertPatch, findActiveSession } = makeDeps();

    const result = await handleUpsertPatch(envelope, deps);

    expect(result).toEqual({ status: 403, body: { error: 'no_session' } });
    expect(upsertPatch).not.toHaveBeenCalled();
    // The L1 gate consults the sessions table scoped to the VERIFIED pubkey and
    // the target machine — never a client claim.
    expect(findActiveSession).toHaveBeenCalledWith({
      player_key: id.publicKeyHex,
      machine_id: foreign,
    });
  });

  it('permits a root ssh session to write anywhere on a foreign machine', async () => {
    const id = generateIdentity();
    const { machineId } = remoteTarget();
    const envelope = signRequest(id, 'upsertPatch', {
      machine_id: machineId,
      path: '/etc/secret',
      content: 'owned',
      owner: 'root',
    });
    const { deps, upsertPatch } = makeDeps({ findActiveSession: remoteSession('root') });

    const result = await handleUpsertPatch(envelope, deps);

    expect(result).toEqual({ status: 200, body: { ok: true } });
    const row = upsertPatch.mock.calls[0]![0];
    expect(row.writer_key).toBe(id.publicKeyHex);
    expect(row.machine_id).toBe(machineId);
    expect(row.path).toBe('/etc/secret');
  });

  // ---- L2: a remote write is further constrained to the login's tier. ----

  it('rejects a user ssh session overwriting a root-owned file (/etc/passwd) with 403 permission_denied', async () => {
    const id = generateIdentity();
    const { machineId } = remoteTarget();
    const envelope = signRequest(id, 'upsertPatch', {
      machine_id: machineId,
      path: '/etc/passwd',
      content: 'root::0:0::/root:/bin/bash',
      owner: 'user',
    });
    const { deps, upsertPatch, listMachinePatches } = makeDeps({
      findActiveSession: remoteSession('user'),
    });

    const result = await handleUpsertPatch(envelope, deps);

    expect(result).toEqual({ status: 403, body: { error: 'permission_denied' } });
    expect(upsertPatch).not.toHaveBeenCalled();
    // L2 regenerates the host from the MACHINE's shared journal (every writer's
    // rows) — keyed on machine_id only after the PK flip.
    expect(listMachinePatches).toHaveBeenCalledWith({ machine_id: machineId });
  });

  it('treats a null prior-patch journal as an empty one (root write over the base FS proceeds)', async () => {
    const id = generateIdentity();
    const { machineId } = remoteTarget();
    const envelope = signRequest(id, 'upsertPatch', {
      machine_id: machineId,
      path: '/tmp/x',
      content: 'y',
      owner: 'root',
    });
    const { deps, upsertPatch } = makeDeps({
      findActiveSession: remoteSession('root'),
      listMachinePatches: async () => ({ data: null, error: null }),
    });

    const result = await handleUpsertPatch(envelope, deps);

    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(upsertPatch).toHaveBeenCalledTimes(1);
  });

  it('permits a user ssh session to write the world-writable /tmp on a foreign machine', async () => {
    const id = generateIdentity();
    const { machineId } = remoteTarget();
    const envelope = signRequest(id, 'upsertPatch', {
      machine_id: machineId,
      path: '/tmp/scratch',
      content: 'mine',
      owner: 'user',
    });
    const { deps, upsertPatch } = makeDeps({ findActiveSession: remoteSession('user') });

    const result = await handleUpsertPatch(envelope, deps);

    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(upsertPatch).toHaveBeenCalledTimes(1);
  });

  it('rejects a guest ssh session overwriting a root-owned file (403 permission_denied)', async () => {
    const id = generateIdentity();
    const { machineId } = remoteTarget();
    const envelope = signRequest(id, 'upsertPatch', {
      machine_id: machineId,
      path: '/etc/passwd',
      content: 'guest::0:0::/root:/bin/bash',
      owner: 'guest',
    });
    const { deps, upsertPatch } = makeDeps({ findActiveSession: remoteSession('guest') });

    const result = await handleUpsertPatch(envelope, deps);

    expect(result).toEqual({ status: 403, body: { error: 'permission_denied' } });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('walks the machine’s PRIOR patches when checking perms (a root-only file added later blocks a user)', async () => {
    const id = generateIdentity();
    const { machineId } = remoteTarget();
    // A root session earlier dropped a private key into the root-only /root dir.
    // Replaying that patch over the regenerated base is what makes /root traversed
    // (its ROOT_DIR perms enter the parent chain) — without it the path wouldn't
    // exist and the leaf-fallback would wrongly permit the write.
    const priorPatches = [
      {
        path: '/root/id_rsa',
        content: 'PRIVATE KEY',
        owner: 'root',
        permissions: { read: ['root'], write: ['root'], execute: ['root'] },
      } as const,
    ];
    const envelope = signRequest(id, 'upsertPatch', {
      machine_id: machineId,
      path: '/root/id_rsa',
      content: 'stolen',
      owner: 'user',
    });
    const { deps, upsertPatch } = makeDeps({
      findActiveSession: remoteSession('user'),
      listMachinePatches: async () => ({ data: priorPatches, error: null }),
    });

    const result = await handleUpsertPatch(envelope, deps);

    expect(result).toEqual({ status: 403, body: { error: 'permission_denied' } });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('does not consult the prior-patch journal for an own-workstation write (L2 bypass)', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'upsertPatch', ownFields(id.publicKeyHex));
    const { deps, listMachinePatches } = makeDeps();

    const result = await handleUpsertPatch(envelope, deps);

    expect(result.status).toBe(200);
    expect(listMachinePatches).not.toHaveBeenCalled();
  });

  it('returns 500 when the prior-patch fetch for the L2 check fails', async () => {
    const id = generateIdentity();
    const { machineId } = remoteTarget();
    const envelope = signRequest(id, 'upsertPatch', {
      machine_id: machineId,
      path: '/tmp/x',
      content: 'y',
      owner: 'user',
    });
    const { deps, upsertPatch } = makeDeps({
      findActiveSession: remoteSession('user'),
      listMachinePatches: async () => ({ data: null, error: { message: 'db down' } }),
    });

    const result = await handleUpsertPatch(envelope, deps);

    expect(result).toEqual({ status: 500, body: { error: 'permission_check_failed' } });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('denies the write when the target resolves as neither an NPC host nor a registered workstation (fail closed)', async () => {
    const id = generateIdentity();
    // A coordinate machine_id that no host on the regenerated LAN matches, and the
    // occupancy lookup (default) returns null too — so neither resolution recovers a tree.
    const envelope = signRequest(id, 'upsertPatch', {
      machine_id: 'ghost-00000000',
      path: '/tmp/x',
      content: 'y',
      owner: 'user',
    });
    const { deps, upsertPatch, findOccupantWorkstationByMachineId } = makeDeps({
      findActiveSession: remoteSession('user'),
    });

    const result = await handleUpsertPatch(envelope, deps);

    expect(result).toEqual({ status: 403, body: { error: 'permission_denied' } });
    expect(upsertPatch).not.toHaveBeenCalled();
    // The occupancy resolution IS attempted before failing closed, proving an NPC miss
    // doesn't short-circuit the cross-player branch and the dep is threaded through.
    expect(findOccupantWorkstationByMachineId).toHaveBeenCalledWith('ghost-00000000');
  });

  // ---- Cross-player WRITE: B writes A's workstation (decision D6). ----

  it("permits a guest cross-player session to write /tmp on a foreign player's workstation", async () => {
    const visitor = generateIdentity();
    const { machineId, occupant } = occupantWorkstation();
    const envelope = signRequest(visitor, 'upsertPatch', {
      machine_id: machineId,
      path: '/tmp/pwned',
      content: 'owned by a visitor',
      owner: 'guest',
    });
    // Explicit spies for the overridden deps so the call-arg assertions hit the
    // functions actually wired into `deps` (an `over` replaces the default spy).
    const findActiveSession = vi.fn(remoteSession('guest'));
    const findOccupantWorkstationByMachineId = vi.fn<FindOccupantWorkstationByMachineId>(
      async () => ({ data: occupant, error: null }),
    );
    const { deps, upsertPatch } = makeDeps({ findActiveSession, findOccupantWorkstationByMachineId });

    const result = await handleUpsertPatch(envelope, deps);

    expect(result).toEqual({ status: 200, body: { ok: true } });
    const row = upsertPatch.mock.calls[0]![0];
    expect(row.writer_key).toBe(visitor.publicKeyHex);
    expect(row.machine_id).toBe(machineId);
    expect(row.path).toBe('/tmp/pwned');
    // The foreign workstation is resolved from occupancy...
    expect(findOccupantWorkstationByMachineId).toHaveBeenCalledWith(machineId);
    // ...and the tier is taken from the visitor's SERVER session, scoped to the
    // verified pubkey + target machine — never a client claim.
    expect(findActiveSession).toHaveBeenCalledWith({
      player_key: visitor.publicKeyHex,
      machine_id: machineId,
    });
  });

  it('does not consult occupancy for an NPC-host write (resolved on the caller’s own LAN)', async () => {
    const id = generateIdentity();
    const { machineId } = remoteTarget();
    const envelope = signRequest(id, 'upsertPatch', {
      machine_id: machineId,
      path: '/tmp/scratch',
      content: 'mine',
      owner: 'user',
    });
    const { deps, upsertPatch, findOccupantWorkstationByMachineId } = makeDeps({
      findActiveSession: remoteSession('user'),
    });

    const result = await handleUpsertPatch(envelope, deps);

    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(upsertPatch).toHaveBeenCalledTimes(1);
    // An NPC host resolves on the caller's own LAN — occupancy is never consulted.
    expect(findOccupantWorkstationByMachineId).not.toHaveBeenCalled();
  });

  it('denies a guest cross-player session writing a root-owned path on a foreign workstation (walked against A’s tree)', async () => {
    const visitor = generateIdentity();
    const { machineId, occupant } = occupantWorkstation();
    const envelope = signRequest(visitor, 'upsertPatch', {
      machine_id: machineId,
      path: '/etc/passwd',
      content: 'guest::0:0::/root:/bin/bash',
      owner: 'guest',
    });
    const { deps, upsertPatch } = makeDeps({
      findActiveSession: remoteSession('guest'),
      findOccupantWorkstationByMachineId: async () => ({ data: occupant, error: null }),
    });

    const result = await handleUpsertPatch(envelope, deps);

    // The occupancy-resolved tree is walked at the GUEST tier — /etc/passwd is not
    // guest-writable, so the gate denies (kills a mutant that skips the walk).
    expect(result).toEqual({ status: 403, body: { error: 'permission_denied' } });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('walks the occupancy-resolved tree at the SESSION tier, not a hardcoded guest (a root session may write /etc)', async () => {
    const visitor = generateIdentity();
    const { machineId, occupant } = occupantWorkstation();
    const envelope = signRequest(visitor, 'upsertPatch', {
      machine_id: machineId,
      path: '/etc/passwd',
      content: 'rewritten by root',
      owner: 'root',
    });
    const { deps, upsertPatch } = makeDeps({
      findActiveSession: remoteSession('root'),
      findOccupantWorkstationByMachineId: async () => ({ data: occupant, error: null }),
    });

    const result = await handleUpsertPatch(envelope, deps);

    // Same path, different session tier → different verdict: proves the tier flows
    // from the session row (kills a mutant hardcoding 'guest').
    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(upsertPatch.mock.calls[0]![0].writer_key).toBe(visitor.publicKeyHex);
  });

  it('denies a guest cross-player session creating a file UNDER a root-only dir on a foreign workstation (parent not traversable)', async () => {
    const visitor = generateIdentity();
    const { machineId, occupant } = occupantWorkstation();
    const envelope = signRequest(visitor, 'upsertPatch', {
      machine_id: machineId,
      path: '/root/implant',
      content: 'persistence',
      owner: 'guest',
    });
    const { deps, upsertPatch } = makeDeps({
      findActiveSession: remoteSession('guest'),
      findOccupantWorkstationByMachineId: async () => ({ data: occupant, error: null }),
    });

    const result = await handleUpsertPatch(envelope, deps);

    // /root is root-only execute on A's tree — a guest can't traverse in to
    // CREATE there. (A distinct walker branch from /etc/passwd's unwritable leaf:
    // the deny comes from the CONTAINING dir, closing the create-anywhere gap.)
    expect(result).toEqual({ status: 403, body: { error: 'permission_denied' } });
    expect(upsertPatch).not.toHaveBeenCalled();
    // The wire leaks nothing about the denied path beyond the error — no path
    // echo, no walker reason, no tree content.
    expect(Object.keys(result.body)).toEqual(['error']);
  });

  it("denies a guest cross-player session creating a file inside A's OWN home dir", async () => {
    const visitor = generateIdentity();
    const { machineId, occupant } = occupantWorkstation();
    const envelope = signRequest(visitor, 'upsertPatch', {
      machine_id: machineId,
      path: `/home/${occupant.workstation_username}/secret`,
      content: 'in your home',
      owner: 'guest',
    });
    const { deps, upsertPatch } = makeDeps({
      findActiveSession: remoteSession('guest'),
      findOccupantWorkstationByMachineId: async () => ({ data: occupant, error: null }),
    });

    const result = await handleUpsertPatch(envelope, deps);

    // /home/alice is HOME_DIR (guest excluded from execute + write) → a guest
    // can't create inside the owner's home.
    expect(result).toEqual({ status: 403, body: { error: 'permission_denied' } });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it("walks A's OCCUPANCY-built tree, not a caller regeneration: a session may create under A's home dir (which exists only because the tree is A's)", async () => {
    const visitor = generateIdentity();
    const { machineId, occupant } = occupantWorkstation();
    const envelope = signRequest(visitor, 'upsertPatch', {
      machine_id: machineId,
      path: `/home/${occupant.workstation_username}/notes.txt`,
      content: 'created under A home',
      owner: 'user',
    });
    const { deps, upsertPatch } = makeDeps({
      findActiveSession: remoteSession('user'),
      findOccupantWorkstationByMachineId: async () => ({ data: occupant, error: null }),
    });

    const result = await handleUpsertPatch(envelope, deps);

    // `/home/alice` exists ONLY because the tree is materialized from A's occupancy row
    // identity (username 'alice'). A user-tier session can create inside it
    // (HOME_DIR is user-writable). Had L2 regenerated from the CALLER's identity,
    // `/home/alice` wouldn't exist and the create would be DENIED (no container) —
    // so an ALLOW here proves A's tree is walked, not the caller's.
    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(upsertPatch.mock.calls[0]![0].path).toBe(
      `/home/${occupant.workstation_username}/notes.txt`,
    );
  });

  it('returns 500 when the occupancy reverse-lookup fails (not a false allow or deny)', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'upsertPatch', {
      machine_id: 'darkstar-12345678',
      path: '/tmp/x',
      content: 'y',
      owner: 'guest',
    });
    const { deps, upsertPatch } = makeDeps({
      findActiveSession: remoteSession('guest'),
      findOccupantWorkstationByMachineId: async () => ({ data: null, error: { message: 'db down' } }),
    });

    const result = await handleUpsertPatch(envelope, deps);

    expect(result).toEqual({ status: 500, body: { error: 'permission_check_failed' } });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('does not consult the sessions table for an own-workstation write (L1 bypass)', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'upsertPatch', ownFields(id.publicKeyHex));
    const { deps, upsertPatch, findActiveSession } = makeDeps();

    const result = await handleUpsertPatch(envelope, deps);

    expect(result.status).toBe(200);
    expect(upsertPatch).toHaveBeenCalledTimes(1);
    expect(findActiveSession).not.toHaveBeenCalled();
  });

  it('returns 500 when the active-session lookup fails (not a false 403)', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'upsertPatch', {
      machine_id: 'darkstar-12345678',
      path: '/x',
      content: 'y',
      owner: 'alice',
    });
    const { deps, upsertPatch } = makeDeps({
      findActiveSession: async () => ({ data: null, error: { message: 'db down' } }),
    });

    const result = await handleUpsertPatch(envelope, deps);

    expect(result).toEqual({ status: 500, body: { error: 'session_lookup_failed' } });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('rejects a tampered signature with 401 and never writes', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'upsertPatch', ownFields(id.publicKeyHex));
    const { deps, upsertPatch } = makeDeps();

    const result = await handleUpsertPatch({ ...envelope, payload: `${envelope.payload} ` }, deps);

    expect(result).toEqual({ status: 401, body: { error: 'signature_invalid' } });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('rejects a structurally invalid envelope with 400', async () => {
    const { deps } = makeDeps();

    const result = await handleUpsertPatch(
      { payload: 'x', publicKey: 'bad', signature: 'bad' },
      deps,
    );

    expect(result.status).toBe(400);
    expect(result.body).toEqual({ error: 'envelope_invalid' });
  });

  it('rejects a payload missing a required field with 400 payload_invalid', async () => {
    const id = generateIdentity();
    // No machine_id — the schema requires it. Catches a mutant that drops the
    // required-field validation (turning the object schema permissive).
    const envelope = signRequest(id, 'upsertPatch', { path: '/x', content: 'y', owner: 'alice' });
    const { deps, upsertPatch } = makeDeps();

    const result = await handleUpsertPatch(envelope, deps);

    expect(result).toEqual({ status: 400, body: { error: 'payload_invalid' } });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('rejects a replayed nonce with 401', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'upsertPatch', ownFields(id.publicKeyHex));
    const { deps } = makeDeps({ nonceStore: async () => ({ fresh: false }) });

    const result = await handleUpsertPatch(envelope, deps);

    expect(result).toEqual({ status: 401, body: { error: 'replay' } });
  });

  it('rejects a client-supplied player_key with 400 and never writes', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'upsertPatch', {
      ...ownFields(id.publicKeyHex),
      player_key: 'forged-key',
    });
    const { deps, upsertPatch } = makeDeps();

    const result = await handleUpsertPatch(envelope, deps);

    expect(result).toEqual({ status: 400, body: { error: 'payload_invalid' } });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('rejects a client-supplied writer_key (forged provenance) with 400 and never writes', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'upsertPatch', {
      ...ownFields(id.publicKeyHex),
      writer_key: 'forged-provenance',
    });
    const { deps, upsertPatch } = makeDeps();

    const result = await handleUpsertPatch(envelope, deps);

    expect(result).toEqual({ status: 400, body: { error: 'payload_invalid' } });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('passes permissions, is_new and node_type through for a directory patch', async () => {
    const id = generateIdentity();
    const perms = {
      read: ['root', 'user', 'guest'],
      write: ['root', 'user'],
      execute: ['root', 'user', 'guest'],
    };
    const envelope = signRequest(id, 'upsertPatch', {
      machine_id: computeWorkstationId('skylab', id.publicKeyHex),
      path: '/home/alice/proj',
      content: null,
      owner: 'alice',
      permissions: perms,
      is_new: true,
      node_type: 'directory',
    });
    const { deps, upsertPatch } = makeDeps();

    const result = await handleUpsertPatch(envelope, deps);

    expect(result.status).toBe(200);
    const row = upsertPatch.mock.calls[0]![0];
    expect(row.permissions).toEqual(perms);
    expect(row.is_new).toBe(true);
    expect(row.node_type).toBe('directory');
    expect(row.content).toBeNull();
  });

  it('rejects a patch with malformed permissions (unknown tier) with 400 payload_invalid', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'upsertPatch', {
      ...ownFields(id.publicKeyHex),
      permissions: { read: ['superuser'], write: [], execute: [] },
    });
    const { deps, upsertPatch } = makeDeps();

    const result = await handleUpsertPatch(envelope, deps);

    expect(result).toEqual({ status: 400, body: { error: 'payload_invalid' } });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('omits permissions/is_new/node_type from the row when the patch does not send them', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'upsertPatch', ownFields(id.publicKeyHex));
    const { deps, upsertPatch } = makeDeps();

    await handleUpsertPatch(envelope, deps);

    const row = upsertPatch.mock.calls[0]![0];
    // Assert the keys are ABSENT, not merely undefined — a patch with no
    // is_new/node_type must not stamp those columns at all.
    expect(Object.keys(row)).not.toContain('permissions');
    expect(Object.keys(row)).not.toContain('is_new');
    expect(Object.keys(row)).not.toContain('node_type');
  });

  it("accepts and passes through an explicit node_type of 'file'", async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'upsertPatch', {
      ...ownFields(id.publicKeyHex),
      node_type: 'file',
    });
    const { deps, upsertPatch } = makeDeps();

    const result = await handleUpsertPatch(envelope, deps);

    expect(result.status).toBe(200);
    expect(upsertPatch.mock.calls[0]![0].node_type).toBe('file');
  });

  it('returns 500 when the upsert adapter reports an error', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'upsertPatch', ownFields(id.publicKeyHex));
    const { deps } = makeDeps({ upsertPatch: async () => ({ error: { message: 'db down' } }) });

    const result = await handleUpsertPatch(envelope, deps);

    expect(result.status).toBe(500);
    expect(result.body).toEqual({ error: 'upsert_failed' });
  });
});

describe('handleUpsertPatch — a save never overwrites content its author was not shown', () => {
  const RULES = '/etc/iptables/rules.v4';
  const TWO_FORWARDS = '# NAT port-forward table\nforward 2222 to 192.168.1.20:22\n';
  const THREE_FORWARDS = `${TWO_FORWARDS}forward 4444 to 192.168.1.31:22\n`;

  it('rejects a save whose opened content is no longer what the machine holds', async () => {
    // Two occupants root on one shared gateway: the other appended a third forward
    // after this editor opened, so writing the whole buffer back would delete it.
    const id = generateIdentity();
    const door = chainDoor();
    const envelope = signRequest(id, 'upsertPatch', {
      machine_id: door.machineId,
      path: RULES,
      content: `${TWO_FORWARDS}# alice was here\n`,
      owner: 'root',
      base_hash: contentHash(TWO_FORWARDS),
    });
    const { deps, upsertPatch } = makeDeps({
      findActiveSession: remoteSession('root', door.essid),
      // Answers only for the file actually being written: a guard that asked about
      // some other path — or machine — would see no rows here and wave the save
      // through, so the refusal proves it consulted the right coordinates.
      listPathPatches: async ({ machine_id, path }) =>
        machine_id === door.machineId && path === RULES
          ? { data: [pathRow(THREE_FORWARDS)], error: null }
          : { data: [], error: null },
    });

    const result = await handleUpsertPatch(envelope, deps);

    expect(result).toEqual({ status: 409, body: { error: 'modified_since_open' } });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('persists that same save once its base is what the machine holds', async () => {
    // Identical to the rejection above but for the base the editor opened against,
    // so that 409 cannot be passing because the guard was never reached or because
    // something else blocked the write.
    const id = generateIdentity();
    const door = chainDoor();
    const envelope = signRequest(id, 'upsertPatch', {
      machine_id: door.machineId,
      path: RULES,
      content: `${THREE_FORWARDS}# alice was here\n`,
      owner: 'root',
      base_hash: contentHash(THREE_FORWARDS),
    });
    const { deps, upsertPatch } = makeDeps({
      findActiveSession: remoteSession('root', door.essid),
      listPathPatches: async () => ({ data: [pathRow(THREE_FORWARDS)], error: null }),
    });

    const result = await handleUpsertPatch(envelope, deps);

    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(upsertPatch.mock.calls[0]![0].content).toBe(`${THREE_FORWARDS}# alice was here\n`);
  });

  it('guards the writer’s own workstation on the same terms', async () => {
    // A cross-player attacker writing your box is exactly the case worth guarding,
    // so the rule knows nothing about whose machine this is.
    const id = generateIdentity();
    const envelope = signRequest(id, 'upsertPatch', {
      ...ownFields(id.publicKeyHex),
      base_hash: contentHash('what the editor opened'),
    });
    const { deps, upsertPatch } = makeDeps({
      listPathPatches: async () => ({ data: [pathRow('what someone else wrote since')], error: null }),
    });

    const result = await handleUpsertPatch(envelope, deps);

    expect(result).toEqual({ status: 409, body: { error: 'modified_since_open' } });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('persists a save that names no base, whatever the machine holds', async () => {
    // A redirect, `touch`, `apt` or the sshd pidfile never showed the player any
    // content to overwrite — `>` means truncate-and-replace — so they carry no base
    // and are never rejected.
    const id = generateIdentity();
    const envelope = signRequest(id, 'upsertPatch', ownFields(id.publicKeyHex));
    const { deps, upsertPatch } = makeDeps({
      listPathPatches: async () => ({ data: [pathRow('written by somebody else')], error: null }),
    });

    const result = await handleUpsertPatch(envelope, deps);

    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(upsertPatch).toHaveBeenCalledTimes(1);
  });

  it('persists a save to a path nobody has written yet', async () => {
    // No rows means nothing has been written since the world was generated, so
    // there is no unseen write — the base filesystem is the same for every viewer.
    const id = generateIdentity();
    const envelope = signRequest(id, 'upsertPatch', {
      ...ownFields(id.publicKeyHex),
      base_hash: contentHash('the generated content'),
    });
    const { deps, upsertPatch } = makeDeps();

    const result = await handleUpsertPatch(envelope, deps);

    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(upsertPatch).toHaveBeenCalledTimes(1);
  });

  it('treats a null base lookup as a path nobody has written', async () => {
    // An empty match comes back as null data with NO error. That is "no rows",
    // not a failure, and must not become a refusal.
    const id = generateIdentity();
    const envelope = signRequest(id, 'upsertPatch', {
      ...ownFields(id.publicKeyHex),
      base_hash: contentHash('the generated content'),
    });
    const { deps, upsertPatch } = makeDeps({
      listPathPatches: async () => ({ data: null, error: null }),
    });

    const result = await handleUpsertPatch(envelope, deps);

    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(upsertPatch).toHaveBeenCalledTimes(1);
  });

  it('persists a save that expects an absent file when the file is indeed deleted', async () => {
    // A deletion marker means the path is gone. An editor opened on a file that
    // does not exist saves it as new, and agrees with the world.
    const id = generateIdentity();
    const envelope = signRequest(id, 'upsertPatch', {
      ...ownFields(id.publicKeyHex),
      is_new: true,
      base_hash: contentHash(''),
    });
    const { deps, upsertPatch } = makeDeps({
      listPathPatches: async () => ({ data: [pathRow(null)], error: null }),
    });

    const result = await handleUpsertPatch(envelope, deps);

    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(upsertPatch).toHaveBeenCalledTimes(1);
  });

  it('rejects a save that expects an existing file when it was deleted underneath', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'upsertPatch', {
      ...ownFields(id.publicKeyHex),
      base_hash: contentHash('the content the editor opened'),
    });
    const { deps, upsertPatch } = makeDeps({
      listPathPatches: async () => ({ data: [pathRow(null)], error: null }),
    });

    const result = await handleUpsertPatch(envelope, deps);

    expect(result).toEqual({ status: 409, body: { error: 'modified_since_open' } });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('compares against the row a reader materializes when two writers share a timestamp', async () => {
    // The read path breaks a same-instant tie on writer_key, so the guard must ask
    // the same question — otherwise it compares against a row the player was never
    // shown and rejects a save that raced nothing.
    const id = generateIdentity();
    const rows = [
      pathRow('the older writer’s content', { writer_key: 'aaa' }),
      pathRow('what a reader actually sees', { writer_key: 'bbb' }),
    ];
    const against = (base: string) =>
      signRequest(id, 'upsertPatch', {
        ...ownFields(id.publicKeyHex),
        base_hash: contentHash(base),
      });
    const listPathPatches = async () => ({ data: rows, error: null });

    const materialized = await handleUpsertPatch(
      against('what a reader actually sees'),
      makeDeps({ listPathPatches }).deps,
    );
    const shadowed = await handleUpsertPatch(
      against('the older writer’s content'),
      makeDeps({ listPathPatches }).deps,
    );

    expect(materialized).toEqual({ status: 200, body: { ok: true } });
    expect(shadowed).toEqual({ status: 409, body: { error: 'modified_since_open' } });
  });

  it('denies an unauthorized write before it can learn the file changed', async () => {
    // Ordering matters: a caller who may not write the path at all must not be told
    // whether somebody else has been editing it.
    const visitor = generateIdentity();
    const { machineId, essid } = remoteTarget();
    const envelope = signRequest(visitor, 'upsertPatch', {
      machine_id: machineId,
      path: '/etc/passwd',
      content: 'guest::0:0::/root:/bin/bash',
      owner: 'guest',
      base_hash: contentHash('whatever the editor opened'),
    });
    const { deps, upsertPatch } = makeDeps({
      findActiveSession: remoteSession('guest', essid),
      listPathPatches: async () => ({ data: [pathRow('changed since')], error: null }),
    });

    const result = await handleUpsertPatch(envelope, deps);

    expect(result).toEqual({ status: 403, body: { error: 'permission_denied' } });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('returns 500 when the base lookup fails, rather than writing over unseen content', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'upsertPatch', {
      ...ownFields(id.publicKeyHex),
      base_hash: contentHash('the content the editor opened'),
    });
    const { deps, upsertPatch } = makeDeps({
      listPathPatches: async () => ({ data: null, error: { message: 'db down' } }),
    });

    const result = await handleUpsertPatch(envelope, deps);

    expect(result).toEqual({ status: 500, body: { error: 'base_check_failed' } });
    expect(upsertPatch).not.toHaveBeenCalled();
  });
});
