import { describe, expect, it, vi } from 'vitest';
import { handleListPatches, type ListPatchesDeps, type PersistedPatchRow } from './listPatches';
import type { ActiveSessionQuery, FindActiveSessionResult } from './authorizeMachineAccess';
import { signRequest } from '../signedRequest/sign';
import { generateIdentity } from '../identity/identity';
import { computeWorkstationId } from '../identity/workstation';
import type { NonceStore } from '../signedRequest/nonceStore';

const freshStore: NonceStore = async () => ({ fresh: true });

const sampleRow = (over: Partial<PersistedPatchRow> = {}): PersistedPatchRow => ({
  writer_key: 'a'.repeat(64),
  machine_id: 'skylab-deadbeef',
  path: '/home/alice/proj',
  content: null,
  owner: 'alice',
  permissions: { read: ['root', 'user', 'guest'], write: ['root', 'user'], execute: ['root'] },
  is_new: true,
  node_type: 'directory',
  updated_at: '2026-06-14T12:00:00.000000+00:00',
  ...over,
});

const makeDeps = (over: Partial<ListPatchesDeps> = {}) => {
  const listPatches = vi.fn<ListPatchesDeps['listPatches']>(async () => ({
    data: [sampleRow()],
    error: null,
  }));
  // Default: no active session on the queried machine; foreign-machine reads
  // override to simulate an ssh hop being present.
  const findActiveSession = vi.fn<(query: ActiveSessionQuery) => Promise<FindActiveSessionResult>>(
    async () => ({ data: null, error: null }),
  );
  const deps: ListPatchesDeps = { nonceStore: freshStore, listPatches, findActiveSession, ...over };
  return { deps, listPatches, findActiveSession };
};

describe('handleListPatches', () => {
  it('returns the machine’s patches, querying the shared journal by machine_id', async () => {
    const id = generateIdentity();
    const machine = computeWorkstationId('skylab', id.publicKeyHex);
    const rows = [sampleRow({ writer_key: id.publicKeyHex, machine_id: machine })];
    const listPatches = vi.fn<ListPatchesDeps['listPatches']>(async () => ({
      data: rows,
      error: null,
    }));
    const { deps } = makeDeps({ listPatches });
    const envelope = signRequest(id, 'listPatches', { machine_id: machine });

    const result = await handleListPatches(envelope, deps);

    expect(result).toEqual({ status: 200, body: { ok: true, patches: rows } });
    expect(listPatches).toHaveBeenCalledWith({ machine_id: machine });
  });

  it('returns the machine’s rows in chronological replay order (oldest first, latest wins)', async () => {
    const id = generateIdentity();
    const machine = computeWorkstationId('skylab', id.publicKeyHex);
    const path = '/tmp/shared';
    // Two writers edited the same path; the server handed them back out of order.
    const newer = sampleRow({
      writer_key: 'b'.repeat(64),
      machine_id: machine,
      path,
      content: 'newer',
      updated_at: '2026-06-14T13:00:00.000000+00:00',
    });
    const older = sampleRow({
      writer_key: id.publicKeyHex,
      machine_id: machine,
      path,
      content: 'older',
      updated_at: '2026-06-14T12:00:00.000000+00:00',
    });
    const { deps } = makeDeps({ listPatches: async () => ({ data: [newer, older], error: null }) });
    const envelope = signRequest(id, 'listPatches', { machine_id: machine });

    const result = await handleListPatches(envelope, deps);

    // Replayed oldest-first so applyPatches' last-write-wins lands the newer edit.
    expect((result.body.patches as readonly PersistedPatchRow[]).map((row) => row.content)).toEqual(
      ['older', 'newer'],
    );
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

  it('rejects a read for a foreign machine when the caller has no active session there (403 no_session)', async () => {
    const id = generateIdentity();
    const { deps, listPatches } = makeDeps();
    const envelope = signRequest(id, 'listPatches', {
      machine_id: 'darkstar-12345678',
    });

    const result = await handleListPatches(envelope, deps);

    expect(result).toEqual({ status: 403, body: { error: 'no_session' } });
    expect(listPatches).not.toHaveBeenCalled();
  });

  it('returns a foreign machine’s patches when an active ssh session exists there', async () => {
    const id = generateIdentity();
    const foreign = 'darkstar-12345678';
    const rows = [
      sampleRow({ writer_key: id.publicKeyHex, machine_id: foreign, path: '/tmp/pwned' }),
    ];
    const { deps } = makeDeps({
      listPatches: async () => ({ data: rows, error: null }),
      findActiveSession: async () => ({
        data: { username: 'root', userType: 'root', essid: 'VANDELAY' },
        error: null,
      }),
    });
    const envelope = signRequest(id, 'listPatches', { machine_id: foreign });

    const result = await handleListPatches(envelope, deps);

    expect(result).toEqual({ status: 200, body: { ok: true, patches: rows } });
  });

  it('does not consult the sessions table for an own-workstation read (L1 bypass)', async () => {
    const id = generateIdentity();
    const machine = computeWorkstationId('skylab', id.publicKeyHex);
    const { deps, findActiveSession } = makeDeps();
    const envelope = signRequest(id, 'listPatches', { machine_id: machine });

    const result = await handleListPatches(envelope, deps);

    expect(result.status).toBe(200);
    expect(findActiveSession).not.toHaveBeenCalled();
  });

  it('returns 500 when the active-session lookup fails (not a false 403)', async () => {
    const id = generateIdentity();
    const { deps, listPatches } = makeDeps({
      findActiveSession: async () => ({ data: null, error: { message: 'db down' } }),
    });
    const envelope = signRequest(id, 'listPatches', { machine_id: 'darkstar-12345678' });

    const result = await handleListPatches(envelope, deps);

    expect(result).toEqual({ status: 500, body: { error: 'session_lookup_failed' } });
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
