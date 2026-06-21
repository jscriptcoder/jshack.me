import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  joinHomeNetwork,
  leaveHomeNetwork,
  resolveCrossPlayerFs,
  resolvePublic,
  type NetworkClientDeps,
} from './networkApi';
import { generateIdentity } from '../core/identity/identity';
import { computeWorkstationId } from '../core/identity/workstation';
import { verifySignedRequest } from '../core/signedRequest/verify';
import { assignHomeNetwork } from '../core/network/homeNetwork';
import { md5 } from '../core/generation/md5';
import { serializeTree } from '../core/filesystem/treeCodec';
import { dir, file, TRAVERSABLE_DIR } from '../core/generation/baseFs';
import { asMachineId } from '../core/types';

/**
 * networkApi — the signed-`/api/network` client backing the cross-player walking
 * skeleton. `joinHomeNetwork` registers the player's network on connect (so a
 * different identity can later resolve it by public IP) and returns the local
 * deterministic assignment; `resolvePublic` resolves an `nmap <public IP>` against
 * that registry, degrading to host-down on any failure so a hiccup reads as "down"
 * rather than crashing the scan.
 */

const ENDPOINT = 'http://test.local/api/network';
const ESSID = 'BEAN-THERE-WIFI';

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const GAME_CONFIG = { machineName: 'skylab', username: 'neo', rootPassword: 'matrix1999' };

const makeDeps = (
  fetchImpl: typeof fetch,
  over: Partial<NetworkClientDeps> = {},
): NetworkClientDeps => {
  const identity = generateIdentity();
  return {
    identity,
    machineId: asMachineId(computeWorkstationId('skylab', identity.publicKeyHex)),
    gameConfig: GAME_CONFIG,
    endpoint: ENDPOINT,
    fetchImpl,
    ...over,
  };
};

const sentEnvelope = (fetchSpy: ReturnType<typeof vi.fn>): unknown =>
  JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);

const verifyPayload = (envelope: unknown) =>
  verifySignedRequest(envelope, z.looseObject({ action: z.string() }), {
    nonceStore: async () => ({ fresh: true }),
  });

describe('joinHomeNetwork', () => {
  it('signs a registerNetwork request carrying the essid and own workstation id, returning the local assignment', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(200, { ok: true }));
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    const result = await joinHomeNetwork(deps, ESSID);

    expect(result).toEqual(assignHomeNetwork(deps.identity.publicKeyHex, ESSID));
    expect(fetchSpy).toHaveBeenCalledWith(
      ENDPOINT,
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const verified = await verifyPayload(sentEnvelope(fetchSpy));
    if (!verified.ok) throw new Error('expected verified envelope');
    expect(verified.payload).toMatchObject({
      action: 'registerNetwork',
      essid: ESSID,
      workstation_machine_id: deps.machineId,
    });
  });

  it('still returns the assignment (connecting succeeds) when registration throws offline', async () => {
    const deps = makeDeps(
      vi.fn(async () => {
        throw new Error('offline');
      }) as unknown as typeof fetch,
    );

    const result = await joinHomeNetwork(deps, ESSID);

    expect(result).toEqual(assignHomeNetwork(deps.identity.publicKeyHex, ESSID));
  });

  it('posts to /api/network by default when no endpoint is configured', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(200, { ok: true }));
    const identity = generateIdentity();
    // `endpoint` OMITTED (not undefined) so the adapter falls back to its default —
    // exactOptionalPropertyTypes forbids an explicit `endpoint: undefined`.
    const deps: NetworkClientDeps = {
      identity,
      machineId: asMachineId(computeWorkstationId('skylab', identity.publicKeyHex)),
      gameConfig: GAME_CONFIG,
      fetchImpl: fetchSpy as unknown as typeof fetch,
    };

    await joinHomeNetwork(deps, ESSID);

    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/network',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('carries the workstation identity (hashed root password, never plaintext) in the register payload', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(200, { ok: true }));
    const deps = makeDeps(fetchSpy as unknown as typeof fetch, {
      gameConfig: {
        machineName: 'nebuchadnezzar',
        username: 'trinity',
        rootPassword: 'zion-secret',
      },
    });

    await joinHomeNetwork(deps, ESSID);

    const verified = await verifyPayload(sentEnvelope(fetchSpy));
    if (!verified.ok) throw new Error('expected verified envelope');
    expect(verified.payload).toMatchObject({
      workstation_username: 'trinity',
      workstation_machine_name: 'nebuchadnezzar',
      workstation_root_hash: md5('zion-secret'),
    });
    expect(JSON.stringify(verified.payload)).not.toContain('zion-secret');
  });
});

describe('leaveHomeNetwork', () => {
  it('signs an unregisterOccupant request carrying the essid (fire-and-forget)', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(200, { ok: true }));
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    leaveHomeNetwork(deps, ESSID);

    expect(fetchSpy).toHaveBeenCalledWith(
      ENDPOINT,
      expect.objectContaining({ method: 'POST', headers: { 'Content-Type': 'application/json' } }),
    );
    const verified = await verifyPayload(sentEnvelope(fetchSpy));
    if (!verified.ok) throw new Error('expected verified envelope');
    expect(verified.payload).toMatchObject({ action: 'unregisterOccupant', essid: ESSID });
  });

  it('swallows a thrown fetch (offline) — disconnect never fails on cleanup', async () => {
    const deps = makeDeps(
      vi.fn(async () => {
        throw new Error('offline');
      }) as unknown as typeof fetch,
    );

    expect(() => leaveHomeNetwork(deps, ESSID)).not.toThrow();
    await Promise.resolve(); // flush the swallowed rejection so it can't leak between tests
  });
});

describe('resolvePublic', () => {
  it('signs a resolvePublicScan request and reports the host found from the server', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(200, { ok: true, found: true }));
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    const result = await resolvePublic(deps, '203.0.113.7');

    expect(result).toEqual({ found: true, ports: [] });
    const verified = await verifyPayload(sentEnvelope(fetchSpy));
    if (!verified.ok) throw new Error('expected verified envelope');
    expect(verified.payload).toMatchObject({ action: 'resolvePublicScan', target: '203.0.113.7' });
  });

  it("parses the open ports the server resolved from the owner's record", async () => {
    const ports = [
      { port: 2222, service: 'ssh' },
      { port: 80, service: 'http' },
    ];
    const deps = makeDeps(
      vi.fn(async () =>
        jsonResponse(200, { ok: true, found: true, ports }),
      ) as unknown as typeof fetch,
    );

    expect(await resolvePublic(deps, '203.0.113.7')).toEqual({ found: true, ports });
  });

  it('reports the host not found when the server resolves no registry row', async () => {
    const deps = makeDeps(
      vi.fn(async () =>
        jsonResponse(200, { ok: true, found: false, ports: [] }),
      ) as unknown as typeof fetch,
    );

    expect(await resolvePublic(deps, '203.0.113.7')).toEqual({ found: false, ports: [] });
  });

  it('treats a non-ok response as host down even when its body claims found', async () => {
    // Adversarial body: a 500 must short-circuit to host-down BEFORE the body is
    // read, so a `found: true` payload on an error status is never trusted.
    const deps = makeDeps(
      vi.fn(async () =>
        jsonResponse(500, { found: true, ports: [{ port: 22, service: 'ssh' }] }),
      ) as unknown as typeof fetch,
    );

    expect(await resolvePublic(deps, '203.0.113.7')).toEqual({ found: false, ports: [] });
  });

  it('treats a null / malformed JSON body as host down', async () => {
    const deps = makeDeps(vi.fn(async () => jsonResponse(200, null)) as unknown as typeof fetch);

    expect(await resolvePublic(deps, '203.0.113.7')).toEqual({ found: false, ports: [] });
  });

  it('treats a thrown fetch (offline) as host down', async () => {
    const deps = makeDeps(
      vi.fn(async () => {
        throw new Error('offline');
      }) as unknown as typeof fetch,
    );

    expect(await resolvePublic(deps, '203.0.113.7')).toEqual({ found: false, ports: [] });
  });
});

describe('resolveCrossPlayerFs', () => {
  const A_TREE = dir(
    { srv: dir({ 'loot.txt': file('OWNED_BY_A', TRAVERSABLE_DIR) }, TRAVERSABLE_DIR) },
    TRAVERSABLE_DIR,
  );
  const MACHINE_ID = 'skylab-deadbeef';

  it('signs a resolveCrossPlayerFs request and deserializes the served tree', async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse(200, { ok: true, tree: serializeTree(A_TREE) }),
    );
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    const result = await resolveCrossPlayerFs(deps, MACHINE_ID);

    expect(result).toEqual(A_TREE);
    const verified = await verifyPayload(sentEnvelope(fetchSpy));
    if (!verified.ok) throw new Error('expected verified envelope');
    expect(verified.payload).toMatchObject({
      action: 'resolveCrossPlayerFs',
      machine_id: MACHINE_ID,
    });
  });

  it('returns null on a non-ok response (so the caller can fall back)', async () => {
    const deps = makeDeps(
      vi.fn(async () => jsonResponse(403, { error: 'no_session' })) as unknown as typeof fetch,
    );

    expect(await resolveCrossPlayerFs(deps, MACHINE_ID)).toBeNull();
  });

  it('returns null on a non-ok response even when its body carries a valid tree', async () => {
    // Adversarial: a 500 must short-circuit BEFORE the body is trusted, so a forged
    // {ok:true, tree} on an error status is never deserialized into a usable FS.
    const deps = makeDeps(
      vi.fn(async () =>
        jsonResponse(500, { ok: true, tree: serializeTree(A_TREE) }),
      ) as unknown as typeof fetch,
    );

    expect(await resolveCrossPlayerFs(deps, MACHINE_ID)).toBeNull();
  });

  it('returns null when the body does not confirm ok', async () => {
    const deps = makeDeps(
      vi.fn(async () =>
        jsonResponse(200, { ok: false, tree: serializeTree(A_TREE) }),
      ) as unknown as typeof fetch,
    );

    expect(await resolveCrossPlayerFs(deps, MACHINE_ID)).toBeNull();
  });

  it('returns null when the response omits the tree', async () => {
    const deps = makeDeps(
      vi.fn(async () => jsonResponse(200, { ok: true })) as unknown as typeof fetch,
    );

    expect(await resolveCrossPlayerFs(deps, MACHINE_ID)).toBeNull();
  });

  it('returns null on a malformed tree rather than throwing', async () => {
    const deps = makeDeps(
      vi.fn(async () => jsonResponse(200, { ok: true, tree: 42 })) as unknown as typeof fetch,
    );

    expect(await resolveCrossPlayerFs(deps, MACHINE_ID)).toBeNull();
  });

  it('returns null on a thrown fetch (offline)', async () => {
    const deps = makeDeps(
      vi.fn(async () => {
        throw new Error('offline');
      }) as unknown as typeof fetch,
    );

    expect(await resolveCrossPlayerFs(deps, MACHINE_ID)).toBeNull();
  });
});
