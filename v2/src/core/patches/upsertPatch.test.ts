import { describe, expect, it, vi } from 'vitest';
import { handleUpsertPatch, type PatchRow, type UpsertPatchDeps } from './upsertPatch';
import type {
  ActiveSessionQuery,
  FindActiveSessionResult,
} from './authorizeMachineAccess';
import type { ListMachinePatchesResult } from './remoteWritePermission';
import { signRequest } from '../signedRequest/sign';
import { generateIdentity } from '../identity/identity';
import { computeWorkstationId } from '../identity/workstation';
import { generateHomeLan } from '../generation/generateHomeLan';
import { hostMachineId } from '../generation/remoteHostId';
import type { UserType } from '../types';
import type { NonceStore } from '../signedRequest/nonceStore';

const freshStore: NonceStore = async () => ({ fresh: true });
const ESSID = 'BEAN-THERE-WIFI';

/** A REAL remote host on the signer's deterministic LAN — so the L2 regeneration
 *  (`hostForMachineId` → `buildRemoteHostFs`) resolves the same FS the perms are
 *  walked over. Returns the coordinate machine_id the ssh session would carry. */
const remoteTarget = (publicKeyHex: string) => {
  const host = generateHomeLan(publicKeyHex, ESSID).hosts.filter((candidate) => candidate.kind === 'machine').at(-1);
  if (host === undefined) throw new Error('no machine host on LAN');
  return { machineId: hostMachineId(host, ESSID), essid: ESSID };
};

const remoteSession = (userType: UserType, essid = ESSID) =>
  async (): Promise<FindActiveSessionResult> => ({ data: { userType, essid }, error: null });

const makeDeps = (over: Partial<UpsertPatchDeps> = {}) => {
  const upsertPatch = vi.fn<(row: PatchRow) => Promise<{ error: unknown }>>(async () => ({
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
  const deps: UpsertPatchDeps = {
    nonceStore: freshStore,
    upsertPatch,
    findActiveSession,
    listMachinePatches,
    ...over,
  };
  return { deps, upsertPatch, findActiveSession, listMachinePatches };
};

// Fields for a write to the signer's OWN workstation.
const ownFields = (publicKeyHex: string) => ({
  machine_id: computeWorkstationId('skylab', publicKeyHex),
  path: '/home/alice/notes.txt',
  content: 'hello',
  owner: 'alice',
});

describe('handleUpsertPatch', () => {
  it('persists an own-workstation write and server-stamps the verified player_key', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'upsertPatch', ownFields(id.publicKeyHex));
    const { deps, upsertPatch } = makeDeps();

    const result = await handleUpsertPatch(envelope, deps);

    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(upsertPatch).toHaveBeenCalledTimes(1);
    const row = upsertPatch.mock.calls[0]![0];
    expect(row.player_key).toBe(id.publicKeyHex);
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
    const { machineId } = remoteTarget(id.publicKeyHex);
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
    expect(row.player_key).toBe(id.publicKeyHex);
    expect(row.machine_id).toBe(machineId);
    expect(row.path).toBe('/etc/secret');
  });

  // ---- L2: a remote write is further constrained to the login's tier. ----

  it('rejects a user ssh session overwriting a root-owned file (/etc/passwd) with 403 permission_denied', async () => {
    const id = generateIdentity();
    const { machineId } = remoteTarget(id.publicKeyHex);
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
    // L2 regenerates the host from THIS machine's journal, scoped to the verified
    // pubkey + the target machine.
    expect(listMachinePatches).toHaveBeenCalledWith({
      player_key: id.publicKeyHex,
      machine_id: machineId,
    });
  });

  it('treats a null prior-patch journal as an empty one (root write over the base FS proceeds)', async () => {
    const id = generateIdentity();
    const { machineId } = remoteTarget(id.publicKeyHex);
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
    const { machineId } = remoteTarget(id.publicKeyHex);
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
    const { machineId } = remoteTarget(id.publicKeyHex);
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
    const { machineId } = remoteTarget(id.publicKeyHex);
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
    const { machineId } = remoteTarget(id.publicKeyHex);
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

  it('rejects the write when the host no longer resolves on the LAN (can’t verify perms → 403)', async () => {
    const id = generateIdentity();
    // A coordinate machine_id that no host on the regenerated LAN matches.
    const envelope = signRequest(id, 'upsertPatch', {
      machine_id: 'ghost-00000000',
      path: '/tmp/x',
      content: 'y',
      owner: 'user',
    });
    const { deps, upsertPatch } = makeDeps({ findActiveSession: remoteSession('user') });

    const result = await handleUpsertPatch(envelope, deps);

    expect(result).toEqual({ status: 403, body: { error: 'permission_denied' } });
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
