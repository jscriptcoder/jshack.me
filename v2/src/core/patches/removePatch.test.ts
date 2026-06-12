import { describe, expect, it, vi } from 'vitest';
import { handleRemovePatch, type FindPatchResult, type RemovePatchDeps } from './removePatch';
import type {
  ActiveSessionQuery,
  FindActiveSessionResult,
} from './authorizeMachineAccess';
import type { PatchRow } from './upsertPatch';
import { signRequest } from '../signedRequest/sign';
import { generateIdentity } from '../identity/identity';
import { computeWorkstationId } from '../identity/workstation';
import type { NonceStore } from '../signedRequest/nonceStore';

const freshStore: NonceStore = async () => ({ fresh: true });

const found = (is_new: boolean): FindPatchResult => ({ data: { is_new }, error: null });

/** Keeps the spies (so call-arg assertions work) while letting each test set the
 *  values they return — overriding the spies directly would orphan the ones we
 *  assert on. */
const makeDeps = (
  over: {
    readonly nonceStore?: NonceStore;
    readonly findResult?: FindPatchResult;
    readonly deleteError?: unknown;
    readonly upsertError?: unknown;
    readonly activeSession?: FindActiveSessionResult;
  } = {},
) => {
  const findPatch = vi.fn<RemovePatchDeps['findPatch']>(
    async () => over.findResult ?? { data: null, error: null },
  );
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
  const deps: RemovePatchDeps = {
    nonceStore: over.nonceStore ?? freshStore,
    findActiveSession,
    findPatch,
    deletePatchTree,
    upsertPatch,
  };
  return { deps, findPatch, deletePatchTree, upsertPatch, findActiveSession };
};

/** Fields for a removal on the signer's OWN workstation. */
const ownFields = (publicKeyHex: string) => ({
  machine_id: computeWorkstationId('skylab', publicKeyHex),
  path: '/home/alice/notes.txt',
  owner: 'alice',
});

describe('handleRemovePatch', () => {
  it('deletes the row + descendants and records NO tombstone for an is_new node', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'removePatch', ownFields(id.publicKeyHex));
    const { deps, findPatch, deletePatchTree, upsertPatch } = makeDeps({
      findResult: found(true),
    });

    const result = await handleRemovePatch(envelope, deps);

    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(findPatch).toHaveBeenCalledWith({
      player_key: id.publicKeyHex,
      machine_id: computeWorkstationId('skylab', id.publicKeyHex),
      path: '/home/alice/notes.txt',
    });
    expect(deletePatchTree).toHaveBeenCalledTimes(1);
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('deletes descendants and records a null deletion marker for a base/modified file', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'removePatch', ownFields(id.publicKeyHex));
    const { deps, deletePatchTree, upsertPatch } = makeDeps({ findResult: found(false) });

    const result = await handleRemovePatch(envelope, deps);

    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(deletePatchTree).toHaveBeenCalledTimes(1);
    expect(upsertPatch).toHaveBeenCalledTimes(1);
    const row = upsertPatch.mock.calls[0]![0];
    expect(row.content).toBeNull();
    expect(row.is_new).toBe(false);
    expect(row.path).toBe('/home/alice/notes.txt');
    expect(row.owner).toBe('alice');
  });

  it('records a null deletion marker when no patch row exists (pure base file)', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'removePatch', ownFields(id.publicKeyHex));
    const { deps, deletePatchTree, upsertPatch } = makeDeps(); // findPatch defaults to { data: null }

    const result = await handleRemovePatch(envelope, deps);

    expect(result.status).toBe(200);
    expect(deletePatchTree).toHaveBeenCalledTimes(1);
    expect(upsertPatch).toHaveBeenCalledTimes(1);
  });

  it('server-stamps the verified player_key on the deletion marker', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'removePatch', ownFields(id.publicKeyHex));
    const { deps, upsertPatch } = makeDeps({ findResult: found(false) });

    await handleRemovePatch(envelope, deps);

    expect(upsertPatch.mock.calls[0]![0].player_key).toBe(id.publicKeyHex);
  });

  it('rejects a removal on a foreign machine when the caller has no active session there (403)', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'removePatch', {
      machine_id: 'darkstar-12345678',
      path: '/x',
      owner: 'alice',
    });
    const { deps, findPatch, deletePatchTree } = makeDeps();

    const result = await handleRemovePatch(envelope, deps);

    expect(result).toEqual({ status: 403, body: { error: 'no_session' } });
    expect(findPatch).not.toHaveBeenCalled();
    expect(deletePatchTree).not.toHaveBeenCalled();
  });

  it('removes a node on a foreign machine when an active ssh session exists there', async () => {
    const id = generateIdentity();
    const foreign = 'darkstar-12345678';
    const envelope = signRequest(id, 'removePatch', {
      machine_id: foreign,
      path: '/tmp/pwned',
      owner: 'root',
    });
    const { deps, deletePatchTree } = makeDeps({
      findResult: found(true),
      activeSession: { data: { userType: 'root', essid: 'VANDELAY' }, error: null },
    });

    const result = await handleRemovePatch(envelope, deps);

    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(deletePatchTree).toHaveBeenCalledWith({
      player_key: id.publicKeyHex,
      machine_id: foreign,
      path: '/tmp/pwned',
    });
  });

  it('does not consult the sessions table for an own-workstation removal (L1 bypass)', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'removePatch', ownFields(id.publicKeyHex));
    const { deps, findActiveSession } = makeDeps({ findResult: found(true) });

    const result = await handleRemovePatch(envelope, deps);

    expect(result.status).toBe(200);
    expect(findActiveSession).not.toHaveBeenCalled();
  });

  it('returns 500 when the active-session lookup fails (not a false 403)', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'removePatch', {
      machine_id: 'darkstar-12345678',
      path: '/x',
      owner: 'alice',
    });
    const { deps, findPatch } = makeDeps({
      activeSession: { data: null, error: { message: 'db down' } },
    });

    const result = await handleRemovePatch(envelope, deps);

    expect(result).toEqual({ status: 500, body: { error: 'session_lookup_failed' } });
    expect(findPatch).not.toHaveBeenCalled();
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
    const { deps, findPatch, deletePatchTree } = makeDeps();

    const result = await handleRemovePatch(envelope, deps);

    expect(result).toEqual({ status: 400, body: { error: 'payload_invalid' } });
    expect(findPatch).not.toHaveBeenCalled();
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

  it('returns 500 when the lookup reports an error and never deletes', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'removePatch', ownFields(id.publicKeyHex));
    const { deps, deletePatchTree } = makeDeps({
      findResult: { data: null, error: { message: 'db down' } },
    });

    const result = await handleRemovePatch(envelope, deps);

    expect(result).toEqual({ status: 500, body: { error: 'remove_failed' } });
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
    const { deps } = makeDeps({
      findResult: found(false),
      upsertError: { message: 'db down' },
    });

    const result = await handleRemovePatch(envelope, deps);

    expect(result).toEqual({ status: 500, body: { error: 'remove_failed' } });
  });
});
