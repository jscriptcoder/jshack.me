import { describe, expect, it, vi } from 'vitest';
import { handleUpsertPatch, type PatchRow, type UpsertPatchDeps } from './upsertPatch';
import type {
  ActiveSessionQuery,
  FindActiveSessionResult,
} from './authorizeMachineAccess';
import { signRequest } from '../signedRequest/sign';
import { generateIdentity } from '../identity/identity';
import { computeWorkstationId } from '../identity/workstation';
import type { NonceStore } from '../signedRequest/nonceStore';

const freshStore: NonceStore = async () => ({ fresh: true });

const makeDeps = (over: Partial<UpsertPatchDeps> = {}) => {
  const upsertPatch = vi.fn<(row: PatchRow) => Promise<{ error: unknown }>>(async () => ({
    error: null,
  }));
  // Default: no active session on the queried machine. Foreign-machine tests
  // override this to simulate an ssh session being present.
  const findActiveSession = vi.fn<(query: ActiveSessionQuery) => Promise<FindActiveSessionResult>>(
    async () => ({ data: null, error: null }),
  );
  const deps: UpsertPatchDeps = { nonceStore: freshStore, upsertPatch, findActiveSession, ...over };
  return { deps, upsertPatch, findActiveSession };
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

  it('permits a write to a foreign machine when an active ssh session exists there', async () => {
    const id = generateIdentity();
    const foreign = 'darkstar-12345678';
    const envelope = signRequest(id, 'upsertPatch', {
      machine_id: foreign,
      path: '/tmp/pwned',
      content: 'owned',
      owner: 'root',
    });
    const { deps, upsertPatch } = makeDeps({
      findActiveSession: async () => ({ data: { userType: 'root', essid: 'VANDELAY' }, error: null }),
    });

    const result = await handleUpsertPatch(envelope, deps);

    expect(result).toEqual({ status: 200, body: { ok: true } });
    const row = upsertPatch.mock.calls[0]![0];
    expect(row.player_key).toBe(id.publicKeyHex);
    expect(row.machine_id).toBe(foreign);
    expect(row.path).toBe('/tmp/pwned');
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
