import { describe, expect, it, vi } from 'vitest';
import { handleListPatches, type ListPatchesDeps, type PersistedPatchRow } from './listPatches.js';
import { signRequest } from '../signedRequest/sign.js';
import { generateIdentity } from '../identity/identity.js';
import { computeWorkstationId } from '../identity/workstation.js';
import { computeApGatewayId } from '../identity/router.js';
import { generateHomeLan } from '../generation/generateHomeLan.js';
import { hostMachineId } from '../generation/remoteHostId.js';
import type { NonceStore } from '../signedRequest/nonceStore.js';

const freshStore: NonceStore = async () => ({ fresh: true });

const ESSID = 'BEAN-THERE-WIFI';

/** A machine the network generates, which no player owns. */
const generatedHostOn = (essid: string): string => {
  const host = generateHomeLan(essid)
    .hosts.filter((candidate) => candidate.kind === 'machine')
    .at(-1);
  if (host === undefined) throw new Error('no machine host on LAN');
  return hostMachineId(host, essid);
};

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
  const deps: ListPatchesDeps = { nonceStore: freshStore, listPatches, ...over };
  return { deps, listPatches };
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

  it.each([
    ['another player’s workstation', computeWorkstationId('skylab', 'c'.repeat(64))],
    ['the access point’s own gateway', computeApGatewayId(ESSID)],
    ['a machine the network generates', generatedHostOn(ESSID)],
  ])('refuses the journal of %s to a caller who does not own it', async (_box, machine) => {
    const visitor = generateIdentity();
    const { deps, listPatches } = makeDeps();
    const envelope = signRequest(visitor, 'listPatches', { machine_id: machine });

    const result = await handleListPatches(envelope, deps);

    // The rows are raw, so they go to the one caller entitled to all of them. Everybody
    // else reads the box as the tree the server prunes, and gets one answer here.
    expect(result).toEqual({ status: 403, body: { error: 'permission_denied' } });
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
