import { describe, expect, it, vi } from 'vitest';
import { handleListPatches, type ListPatchesDeps, type PatchRow } from './listPatches';
import { signRequest } from '../signedRequest/sign';
import { generateIdentity } from '../identity/identity';
import { computeWorkstationId } from '../identity/workstation';
import type { NonceStore } from '../signedRequest/nonceStore';

const freshStore: NonceStore = async () => ({ fresh: true });

const sampleRow = (over: Partial<PatchRow> = {}): PatchRow => ({
  player_key: 'a'.repeat(64),
  machine_id: 'skylab-deadbeef',
  path: '/home/alice/proj',
  content: null,
  owner: 'alice',
  permissions: { read: ['root', 'user', 'guest'], write: ['root', 'user'], execute: ['root'] },
  is_new: true,
  node_type: 'directory',
  ...over,
});

const makeDeps = (over: Partial<ListPatchesDeps> = {}) => {
  const listPatches = vi.fn<ListPatchesDeps['listPatches']>(async () => ({
    data: [sampleRow()],
    error: null,
  }));
  const deps: ListPatchesDeps = { nonceStore: freshStore, listPatches, ...over };
  return { deps, listPatches };
};

describe('handleListPatches', () => {
  it('returns the caller’s own-workstation patches, querying by the verified player_key', async () => {
    const id = generateIdentity();
    const machine = computeWorkstationId('skylab', id.publicKeyHex);
    const rows = [sampleRow({ player_key: id.publicKeyHex, machine_id: machine })];
    const listPatches = vi.fn<ListPatchesDeps['listPatches']>(async () => ({
      data: rows,
      error: null,
    }));
    const { deps } = makeDeps({ listPatches });
    const envelope = signRequest(id, 'listPatches', { machine_id: machine });

    const result = await handleListPatches(envelope, deps);

    expect(result).toEqual({ status: 200, body: { ok: true, patches: rows } });
    expect(listPatches).toHaveBeenCalledWith({ player_key: id.publicKeyHex, machine_id: machine });
  });

  it('returns an empty list when the caller has no patches yet', async () => {
    const id = generateIdentity();
    const machine = computeWorkstationId('skylab', id.publicKeyHex);
    const { deps } = makeDeps({ listPatches: async () => ({ data: [], error: null }) });
    const envelope = signRequest(id, 'listPatches', { machine_id: machine });

    const result = await handleListPatches(envelope, deps);

    expect(result).toEqual({ status: 200, body: { ok: true, patches: [] } });
  });

  it('coalesces a null data result into an empty patch list', async () => {
    const id = generateIdentity();
    const machine = computeWorkstationId('skylab', id.publicKeyHex);
    const { deps } = makeDeps({ listPatches: async () => ({ data: null, error: null }) });
    const envelope = signRequest(id, 'listPatches', { machine_id: machine });

    const result = await handleListPatches(envelope, deps);

    expect(result).toEqual({ status: 200, body: { ok: true, patches: [] } });
  });

  it('rejects a read for a machine that is not the caller’s workstation with 403 no_session', async () => {
    const id = generateIdentity();
    const { deps, listPatches } = makeDeps();
    const envelope = signRequest(id, 'listPatches', {
      machine_id: computeWorkstationId('victim', 'b'.repeat(64)),
    });

    const result = await handleListPatches(envelope, deps);

    expect(result).toEqual({ status: 403, body: { error: 'no_session' } });
    expect(listPatches).not.toHaveBeenCalled();
  });

  it('rejects a tampered signature with 401 and never queries', async () => {
    const id = generateIdentity();
    const machine = computeWorkstationId('skylab', id.publicKeyHex);
    const { deps, listPatches } = makeDeps();
    const envelope = signRequest(id, 'listPatches', { machine_id: machine });

    const result = await handleListPatches({ ...envelope, payload: `${envelope.payload} ` }, deps);

    expect(result).toEqual({ status: 401, body: { error: 'signature_invalid' } });
    expect(listPatches).not.toHaveBeenCalled();
  });

  it('rejects a payload missing machine_id with 400 payload_invalid', async () => {
    const id = generateIdentity();
    const { deps, listPatches } = makeDeps();
    const envelope = signRequest(id, 'listPatches', {});

    const result = await handleListPatches(envelope, deps);

    expect(result).toEqual({ status: 400, body: { error: 'payload_invalid' } });
    expect(listPatches).not.toHaveBeenCalled();
  });

  it('returns 500 when the query adapter reports an error', async () => {
    const id = generateIdentity();
    const machine = computeWorkstationId('skylab', id.publicKeyHex);
    const { deps } = makeDeps({
      listPatches: async () => ({ data: null, error: { message: 'db down' } }),
    });
    const envelope = signRequest(id, 'listPatches', { machine_id: machine });

    const result = await handleListPatches(envelope, deps);

    expect(result.status).toBe(500);
    expect(result.body).toEqual({ error: 'list_failed' });
  });
});
