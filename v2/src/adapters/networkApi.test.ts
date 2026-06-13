import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { joinHomeNetwork, resolvePublic, type NetworkClientDeps } from './networkApi';
import { generateIdentity } from '../core/identity/identity';
import { computeWorkstationId } from '../core/identity/workstation';
import { verifySignedRequest } from '../core/signedRequest/verify';
import { assignHomeNetwork } from '../core/network/homeNetwork';
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

const makeDeps = (fetchImpl: typeof fetch, over: Partial<NetworkClientDeps> = {}): NetworkClientDeps => {
  const identity = generateIdentity();
  return {
    identity,
    machineId: asMachineId(computeWorkstationId('skylab', identity.publicKeyHex)),
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
    const deps = makeDeps(fetchSpy as unknown as typeof fetch, { endpoint: undefined });

    await joinHomeNetwork(deps, ESSID);

    expect(fetchSpy).toHaveBeenCalledWith('/api/network', expect.objectContaining({ method: 'POST' }));
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
      vi.fn(async () => jsonResponse(200, { ok: true, found: true, ports })) as unknown as typeof fetch,
    );

    expect(await resolvePublic(deps, '203.0.113.7')).toEqual({ found: true, ports });
  });

  it('reports the host not found when the server resolves no registry row', async () => {
    const deps = makeDeps(
      vi.fn(async () => jsonResponse(200, { ok: true, found: false, ports: [] })) as unknown as typeof fetch,
    );

    expect(await resolvePublic(deps, '203.0.113.7')).toEqual({ found: false, ports: [] });
  });

  it('treats a non-ok response as host down even when its body claims found', async () => {
    // Adversarial body: a 500 must short-circuit to host-down BEFORE the body is
    // read, so a `found: true` payload on an error status is never trusted.
    const deps = makeDeps(
      vi.fn(async () => jsonResponse(500, { found: true, ports: [{ port: 22, service: 'ssh' }] })) as unknown as typeof fetch,
    );

    expect(await resolvePublic(deps, '203.0.113.7')).toEqual({ found: false, ports: [] });
  });

  it('treats a null / malformed JSON body as host down', async () => {
    const deps = makeDeps(
      vi.fn(async () => jsonResponse(200, null)) as unknown as typeof fetch,
    );

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
