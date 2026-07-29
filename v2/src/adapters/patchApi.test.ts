import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  createPatchApi,
  fetchOwnPatches,
  postAuthLog,
  recordScan,
  type PatchClientDeps,
} from './patchApi';
import { generateIdentity } from '../core/identity/identity';
import { computeWorkstationId } from '../core/identity/workstation';
import { verifySignedRequest } from '../core/signedRequest/verify';
import {
  defaultDirectoryPermissions,
  defaultFilePermissions,
} from '../core/filesystem/defaultPermissions';
import { contentHash } from '../core/patches/contentHash';
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

  it('write sends caller-provided permissions instead of the tier default', async () => {
    // `apt install` installs world-executable binaries; the default file perms
    // are root-only-executable, so the caller must be able to override them.
    const fetchSpy = vi.fn(async () => jsonResponse(200, { ok: true }));
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);
    const worldExecutable = {
      read: ['root', 'user', 'guest'] as const,
      write: ['root'] as const,
      execute: ['root', 'user', 'guest'] as const,
    };

    await createPatchApi(deps).write(asAbsPath('/usr/bin/nmap'), 'stub', {
      isNew: true,
      permissions: worldExecutable,
    });

    const verified = await verifyPayload(sentEnvelope(fetchSpy));
    if (!verified.ok) throw new Error('expected verified envelope');
    expect(verified.payload).toMatchObject({ permissions: worldExecutable });
  });

  it('write stamps is_new: true for a genuinely-new file', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(200, { ok: true }));
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    await createPatchApi(deps).write(asAbsPath('/home/alice/new.txt'), '', { isNew: true });

    const verified = await verifyPayload(sentEnvelope(fetchSpy));
    if (!verified.ok) throw new Error('expected verified envelope');
    expect(verified.payload).toMatchObject({ action: 'upsertPatch', content: '', is_new: true });
  });

  it('write fingerprints the content the caller was written against', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(200, { ok: true }));
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    await createPatchApi(deps).write(asAbsPath('/etc/iptables/rules.v4'), 'edited', {
      baseContent: 'what the editor opened',
    });

    const verified = await verifyPayload(sentEnvelope(fetchSpy));
    if (!verified.ok) throw new Error('expected verified envelope');
    expect(verified.payload).toMatchObject({ base_hash: contentHash('what the editor opened') });
  });

  it('write omits the fingerprint when the caller was shown nothing to overwrite', async () => {
    // A `>` redirect, `touch`, `apt` or the sshd pidfile: an absent base_hash is
    // what makes those writes unconditional.
    const fetchSpy = vi.fn(async () => jsonResponse(200, { ok: true }));
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    await createPatchApi(deps).write(asAbsPath('/home/alice/notes.txt'), 'hello');

    const verified = await verifyPayload(sentEnvelope(fetchSpy));
    if (!verified.ok) throw new Error('expected verified envelope');
    expect(Object.keys(verified.payload as object)).not.toContain('base_hash');
  });

  it('maps a 409 to a modified_since_open PatchResult', async () => {
    // Distinct from the 500-and-anything-else network_error below: the editor has
    // to tell "the file changed underneath you" apart from "the write failed".
    const fetchSpy = vi.fn(async () => jsonResponse(409, { error: 'modified_since_open' }));
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    const result = await createPatchApi(deps).write(asAbsPath('/etc/iptables/rules.v4'), 'edited', {
      baseContent: 'stale',
    });

    expect(result).toEqual({ ok: false, error: 'modified_since_open' });
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

describe('postAuthLog', () => {
  const event = (machineId: string) => ({
    machineId: asMachineId(machineId),
    targetUser: 'root',
    fromUser: 'neo',
    outcome: 'success' as const,
    hostname: 'rig',
  });

  it('signs an appendAuthLog request carrying the event fields and no client time', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(200, { ok: true }));
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    const result = await postAuthLog(deps, event(deps.machineId));

    expect(result).toEqual({ ok: true });
    const verified = await verifyPayload(sentEnvelope(fetchSpy));
    if (!verified.ok) throw new Error('expected verified envelope');
    expect(verified.payload).toMatchObject({
      action: 'appendAuthLog',
      machine_id: deps.machineId,
      target_user: 'root',
      from_user: 'neo',
      outcome: 'success',
      hostname: 'rig',
    });
    // The client must NOT send a timestamp/pid — the server owns the clock.
    expect(Object.keys(verified.payload as object)).not.toContain('time');
    expect(Object.keys(verified.payload as object)).not.toContain('pid');
  });

  it('maps a 403 to no_session and a thrown fetch to network_error', async () => {
    const forbidden = await postAuthLog(
      makeDeps(
        vi.fn(async () => jsonResponse(403, { error: 'no_session' })) as unknown as typeof fetch,
      ),
      event(computeWorkstationId('skylab', 'a'.repeat(64))),
    );
    const offline = await postAuthLog(
      makeDeps(
        vi.fn(async () => {
          throw new Error('offline');
        }) as unknown as typeof fetch,
      ),
      event(computeWorkstationId('skylab', 'a'.repeat(64))),
    );

    expect(forbidden).toEqual({ ok: false, error: 'no_session' });
    expect(offline).toEqual({ ok: false, error: 'network_error' });
  });
});

describe('recordScan', () => {
  it('signs an nmapScan request carrying the essid, target, and source ip', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(200, { ok: true, hostsLogged: 2 }));
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    await recordScan(deps, {
      essid: 'BEAN-THERE-WIFI',
      target: '192.168.1.1-254',
      sourceIp: '192.168.1.50',
    });

    const verified = await verifyPayload(sentEnvelope(fetchSpy));
    if (!verified.ok) throw new Error('expected verified envelope');
    expect(verified.payload).toMatchObject({
      action: 'nmapScan',
      essid: 'BEAN-THERE-WIFI',
      target: '192.168.1.1-254',
      source_ip: '192.168.1.50',
    });
  });

  it('swallows a thrown fetch — best-effort logging never throws', async () => {
    const deps = makeDeps(
      vi.fn(async () => {
        throw new Error('offline');
      }) as unknown as typeof fetch,
    );

    await expect(
      recordScan(deps, { essid: 'E', target: '192.168.1.1', sourceIp: null }),
    ).resolves.toBeUndefined();
  });
});

describe('fetchOwnPatches', () => {
  it('signs a listPatches request and maps server rows to client Patches', async () => {
    const rows = [
      {
        writer_key: 'x',
        machine_id: 'm',
        path: '/home/alice/proj',
        content: null,
        owner: 'alice',
        permissions: { read: ['root', 'user'], write: ['root', 'user'], execute: ['root'] },
        is_new: true,
        node_type: 'directory',
        updated_at: '2026-06-14T12:00:00.000000+00:00',
      },
      {
        writer_key: 'x',
        machine_id: 'm',
        path: '/home/alice/notes.txt',
        content: 'hi',
        owner: 'alice',
        permissions: null,
        node_type: 'file',
        updated_at: '2026-06-14T12:00:01.000000+00:00',
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
