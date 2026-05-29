import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createPatchApi, fetchOwnPatches, type PatchClientDeps } from './patchApi';
import { generateIdentity } from '../core/identity/identity';
import { computeWorkstationId } from '../core/identity/workstation';
import { verifySignedRequest } from '../core/signedRequest/verify';
import {
  defaultDirectoryPermissions,
  defaultFilePermissions,
} from '../core/filesystem/defaultPermissions';
import { asAbsPath, asMachineId, type UserType } from '../core/types';

const ENDPOINT = 'http://test.local/api/patches';

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const makeDeps = (
  fetchImpl: typeof fetch,
  over: Partial<PatchClientDeps> = {},
): PatchClientDeps => {
  const identity = generateIdentity();
  return {
    identity,
    machineId: asMachineId(computeWorkstationId('skylab', identity.publicKeyHex)),
    owner: 'alice',
    tier: 'user' as UserType,
    endpoint: ENDPOINT,
    fetchImpl,
    ...over,
  };
};

/** Parse the JSON body the adapter passed to fetch on its first call. */
const sentEnvelope = (fetchSpy: ReturnType<typeof vi.fn>): unknown =>
  JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);

const verifyPayload = async (envelope: unknown) => {
  const result = await verifySignedRequest(envelope, z.looseObject({ action: z.string() }), {
    nonceStore: async () => ({ fresh: true }),
  });
  return result;
};

describe('createPatchApi.mkdir', () => {
  it('POSTs a real signed upsertPatch directory envelope and returns ok on 200', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(200, { ok: true }));
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    const result = await createPatchApi(deps).mkdir(asAbsPath('/home/alice/proj'));

    expect(result).toEqual({ ok: true });
    expect(fetchSpy).toHaveBeenCalledWith(ENDPOINT, expect.objectContaining({ method: 'POST' }));

    const verified = await verifyPayload(sentEnvelope(fetchSpy));
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.payload).toMatchObject({
      action: 'upsertPatch',
      machine_id: deps.machineId,
      path: '/home/alice/proj',
      content: null,
      owner: 'alice',
      node_type: 'directory',
      is_new: true,
      permissions: defaultDirectoryPermissions('user'),
    });
  });

  it('maps a 403 to a no_session PatchResult', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(403, { error: 'no_session' }));
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    const result = await createPatchApi(deps).mkdir(asAbsPath('/home/alice/proj'));

    expect(result).toEqual({ ok: false, error: 'no_session' });
  });

  it('maps a non-ok non-403 response to network_error', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(500, { error: 'boom' }));
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    const result = await createPatchApi(deps).mkdir(asAbsPath('/home/alice/proj'));

    expect(result).toEqual({ ok: false, error: 'network_error' });
  });

  it('maps a thrown fetch (offline) to network_error', async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error('offline');
    });
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    const result = await createPatchApi(deps).mkdir(asAbsPath('/home/alice/proj'));

    expect(result).toEqual({ ok: false, error: 'network_error' });
  });
});

describe('createPatchApi.write and remove', () => {
  it('write (overwrite) sends file content with file-default permissions and NO is_new', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(200, { ok: true }));
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    const result = await createPatchApi(deps).write(asAbsPath('/home/alice/notes.txt'), 'hello');

    expect(result).toEqual({ ok: true });
    const verified = await verifyPayload(sentEnvelope(fetchSpy));
    if (!verified.ok) throw new Error('expected verified envelope');
    expect(verified.payload).toMatchObject({
      action: 'upsertPatch',
      path: '/home/alice/notes.txt',
      content: 'hello',
      owner: 'alice',
      node_type: 'file',
      permissions: defaultFilePermissions('user'),
    });
    // Overwrite must omit is_new so the server preserves the row's stored flag.
    expect(Object.keys(verified.payload as object)).not.toContain('is_new');
  });

  it('write stamps is_new: true for a genuinely-new file', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(200, { ok: true }));
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    await createPatchApi(deps).write(asAbsPath('/home/alice/new.txt'), '', { isNew: true });

    const verified = await verifyPayload(sentEnvelope(fetchSpy));
    if (!verified.ok) throw new Error('expected verified envelope');
    expect(verified.payload).toMatchObject({ action: 'upsertPatch', content: '', is_new: true });
  });

  it('remove sends a removePatch request (server decides delete vs tombstone)', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(200, { ok: true }));
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    const result = await createPatchApi(deps).remove(asAbsPath('/home/alice/notes.txt'));

    expect(result).toEqual({ ok: true });
    const verified = await verifyPayload(sentEnvelope(fetchSpy));
    if (!verified.ok) throw new Error('expected verified envelope');
    expect(verified.payload).toMatchObject({
      action: 'removePatch',
      machine_id: deps.machineId,
      path: '/home/alice/notes.txt',
      owner: 'alice',
    });
  });

  it('maps a remove 403 to no_session and a thrown fetch to network_error', async () => {
    const forbidden = await createPatchApi(
      makeDeps(
        vi.fn(async () => jsonResponse(403, { error: 'no_session' })) as unknown as typeof fetch,
      ),
    ).remove(asAbsPath('/home/alice/notes.txt'));
    const offline = await createPatchApi(
      makeDeps(
        vi.fn(async () => {
          throw new Error('offline');
        }) as unknown as typeof fetch,
      ),
    ).remove(asAbsPath('/home/alice/notes.txt'));

    expect(forbidden).toEqual({ ok: false, error: 'no_session' });
    expect(offline).toEqual({ ok: false, error: 'network_error' });
  });
});

describe('fetchOwnPatches', () => {
  it('signs a listPatches request and maps server rows to client Patches', async () => {
    const rows = [
      {
        player_key: 'x',
        machine_id: 'm',
        path: '/home/alice/proj',
        content: null,
        owner: 'alice',
        permissions: { read: ['root', 'user'], write: ['root', 'user'], execute: ['root'] },
        is_new: true,
        node_type: 'directory',
      },
      {
        player_key: 'x',
        machine_id: 'm',
        path: '/home/alice/notes.txt',
        content: 'hi',
        owner: 'alice',
        permissions: null,
        node_type: 'file',
      },
    ];
    const fetchSpy = vi.fn(async () => jsonResponse(200, { ok: true, patches: rows }));
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    const patches = await fetchOwnPatches(deps);

    const verified = await verifyPayload(sentEnvelope(fetchSpy));
    if (!verified.ok) throw new Error('expected verified envelope');
    expect(verified.payload).toMatchObject({ action: 'listPatches', machine_id: deps.machineId });

    expect(patches).toEqual([
      {
        path: '/home/alice/proj',
        content: null,
        owner: 'alice',
        permissions: { read: ['root', 'user'], write: ['root', 'user'], execute: ['root'] },
        nodeType: 'directory',
      },
      {
        path: '/home/alice/notes.txt',
        content: 'hi',
        owner: 'alice',
        nodeType: 'file',
      },
    ]);
  });

  it('returns an empty list on a non-ok response', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(500, { error: 'boom' }));
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    expect(await fetchOwnPatches(deps)).toEqual([]);
  });

  it('returns an empty list when fetch throws (offline)', async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error('offline');
    });
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    expect(await fetchOwnPatches(deps)).toEqual([]);
  });
});
