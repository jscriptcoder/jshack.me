import { describe, expect, it, vi } from 'vitest';
import {
  handleResolvePublicScan,
  type RegistryLookup,
  type ResolvePublicScanDeps,
} from './resolvePublicScan';
import { signRequest } from '../signedRequest/sign';
import { generateIdentity } from '../identity/identity';
import { computeRouterId } from '../identity/router';
import type { OwnerPatchRow } from '../network/materializeWorkstationFs';
import type { NonceStore } from '../signedRequest/nonceStore';

/**
 * `handleResolvePublicScan` is the server-side resolution of one identity's
 * `nmap <public IP>` against ANOTHER identity's registered network. Story 5.1.1b
 * flips the resolved machine from the workstation to the ROUTER: a public IP maps
 * to the owner's router (its own seeded `sshd:22`), and the workstation is dark
 * behind NAT until a forward is configured (Story 5.1.3). The handler verifies the
 * caller's envelope, looks the target up in the registry, replays the ROUTER's
 * journal over its seeded base to ask `canBoot` (a bricked router goes dark), and
 * reports the router's open ports via the single `scanResult` total function.
 */

const freshStore: NonceStore = async () => ({ fresh: true });
const TARGET = '203.0.113.7';
// A real identity so the router's seeded admin password / sshd presence recover
// from the owner key; the registry now carries only what the router scan needs.
const OWNER = generateIdentity();
const REGISTERED: RegistryLookup = {
  router_machine_id: computeRouterId(OWNER.publicKeyHex),
  owner_key: OWNER.publicKeyHex,
};

/** A root `rm /boot/vmlinuz` on the ROUTER's journal — replayed, it deletes the
 *  kernel so `canBoot` reports the router bricked (the whole public IP goes dark). */
const routerBootTombstone: OwnerPatchRow = {
  path: '/boot/vmlinuz',
  content: null,
  owner: 'root',
  permissions: null,
  node_type: null,
  updated_at: '2026-06-17T00:00:00.000Z',
  writer_key: OWNER.publicKeyHex,
};

type LookupResult = { data: RegistryLookup | null; error: unknown };
type PatchesResult = { data: readonly OwnerPatchRow[] | null; error: unknown };

const makeDeps = (
  lookup: () => Promise<LookupResult> = async () => ({ data: null, error: null }),
  patches: () => Promise<PatchesResult> = async () => ({ data: [], error: null }),
) => {
  const findRegistryByPublicIp = vi.fn<(publicIp: string) => Promise<LookupResult>>(lookup);
  const findPatches = vi.fn<(query: { machine_id: string }) => Promise<PatchesResult>>(patches);
  const deps: ResolvePublicScanDeps = {
    nonceStore: freshStore,
    findRegistryByPublicIp,
    findPatches,
  };
  return { deps, findRegistryByPublicIp, findPatches };
};

const envelope = (
  id: ReturnType<typeof generateIdentity>,
  target: string,
  over: Record<string, unknown> = {},
) => signRequest(id, 'resolvePublicScan', { target, ...over });

describe('handleResolvePublicScan', () => {
  it("resolves a registered public IP to the ROUTER's own sshd:22 (workstation dark behind NAT)", async () => {
    const id = generateIdentity();
    const { deps, findRegistryByPublicIp, findPatches } = makeDeps(async () => ({
      data: REGISTERED,
      error: null,
    }));

    const result = await handleResolvePublicScan(envelope(id, TARGET), deps);

    // Exactly the router's own port — nothing from behind the NAT.
    expect(result).toEqual({
      status: 200,
      body: { ok: true, found: true, ports: [{ port: 22, service: 'ssh' }] },
    });
    expect(findRegistryByPublicIp).toHaveBeenCalledWith(TARGET);
    // The journal is read off the ROUTER machine, not the workstation.
    expect(findPatches).toHaveBeenCalledWith({ machine_id: REGISTERED.router_machine_id });
  });

  it('reports a bricked router (a /boot tombstone on its journal) as host down, with no ports', async () => {
    const id = generateIdentity();
    const { deps, findPatches } = makeDeps(
      async () => ({ data: REGISTERED, error: null }),
      async () => ({ data: [routerBootTombstone], error: null }),
    );

    const result = await handleResolvePublicScan(envelope(id, TARGET), deps);

    // Host-down shape — indistinguishable from an unregistered IP (the client maps
    // `found: false` to "Host seems down").
    expect(result).toEqual({ status: 200, body: { ok: true, found: false, ports: [] } });
    expect(findPatches).toHaveBeenCalledWith({ machine_id: REGISTERED.router_machine_id });
  });

  it('reports a server error when the boot-state patch lookup fails', async () => {
    const id = generateIdentity();
    const { deps } = makeDeps(
      async () => ({ data: REGISTERED, error: null }),
      async () => ({ data: null, error: new Error('db down') }),
    );

    const result = await handleResolvePublicScan(envelope(id, TARGET), deps);

    expect(result).toEqual({ status: 500, body: { error: 'patches_lookup_failed' } });
  });

  it('reports an unregistered public IP as not found, with no ports', async () => {
    const id = generateIdentity();
    const { deps, findPatches } = makeDeps(async () => ({ data: null, error: null }));

    const result = await handleResolvePublicScan(envelope(id, '203.0.113.99'), deps);

    expect(result).toEqual({ status: 200, body: { ok: true, found: false, ports: [] } });
    // No registry row → no router to check; the journal read is skipped.
    expect(findPatches).not.toHaveBeenCalled();
  });

  it('reports a server error when the registry lookup fails', async () => {
    const id = generateIdentity();
    const { deps } = makeDeps(async () => ({ data: null, error: new Error('db down') }));

    const result = await handleResolvePublicScan(envelope(id, TARGET), deps);

    expect(result).toEqual({ status: 500, body: { error: 'registry_lookup_failed' } });
  });

  it('rejects a tampered envelope without looking up the registry', async () => {
    const id = generateIdentity();
    const { deps, findRegistryByPublicIp } = makeDeps();
    const signed = envelope(id, TARGET);
    const tampered = { ...signed, payload: `${signed.payload} ` };

    const result = await handleResolvePublicScan(tampered, deps);

    expect(result).toEqual({ status: 401, body: { error: 'signature_invalid' } });
    expect(findRegistryByPublicIp).not.toHaveBeenCalled();
  });

  it('rejects an envelope that smuggles a client-supplied player_key', async () => {
    const id = generateIdentity();
    const { deps, findRegistryByPublicIp } = makeDeps();

    const result = await handleResolvePublicScan(envelope(id, TARGET, { player_key: 'attacker' }), deps);

    expect(result.status).toBe(400);
    expect(findRegistryByPublicIp).not.toHaveBeenCalled();
  });

  it('rejects an envelope missing the target', async () => {
    const id = generateIdentity();
    const { deps, findRegistryByPublicIp } = makeDeps();

    const result = await handleResolvePublicScan(signRequest(id, 'resolvePublicScan', {}), deps);

    expect(result.status).toBe(400);
    expect(findRegistryByPublicIp).not.toHaveBeenCalled();
  });
});
