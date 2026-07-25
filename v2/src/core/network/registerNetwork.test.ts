import { describe, expect, it, vi } from 'vitest';
import {
  handleRegisterNetwork,
  type HomeNetworkOccupantRow,
  type NetworkRegistryRow,
  type RegisterNetworkDeps,
} from './registerNetwork';
import { signRequest } from '../signedRequest/sign';
import { generateIdentity } from '../identity/identity';
import { computeApGatewayId } from '../identity/router';
import type { NonceStore } from '../signedRequest/nonceStore';

/**
 * `handleRegisterNetwork` is the server-side join action. It verifies the signed
 * envelope and upserts a public-IP registry row so a DIFFERENT identity can later
 * resolve this network by its public IP. The public IP is ALLOCATED server-side per
 * ESSID (an injected `allocatePublicIp` issues a globally-unique WAN address that
 * belongs to the AP, shared by every occupant); `owner_key` is stamped from the
 * verified pubkey, never claimed. The router is a DISTINCT machine —
 * `router_machine_id` is `computeApGatewayId(ESSID)` (its own seeded box bearing
 * the public IP), and there is no `forward_table` (the router's
 * `/etc/iptables/rules.v4` is the single source of truth for forwards).
 */

const freshStore: NonceStore = async () => ({ fresh: true });
const ESSID = 'BEAN-THERE-WIFI';
const WORKSTATION_ID = 'skylab-deadbeef';
// The player-private workstation identity the server persists so a cross-player
// reader can reconstruct the box (Story 2). The root value is already an md5 HASH
// — the client hashes it; the server stores it opaquely, never seeing plaintext.
const USERNAME = 'neo';
const MACHINE_NAME = 'skylab';
const ROOT_HASH = 'd41d8cd98f00b204e9800998ecf8427e';
// The IP the stub allocator issues for the ESSID — opaque to the handler, which
// only stamps it into the registry row (the real allocation is wire-checked).
const ALLOCATED_IP = '203.0.113.7';

const makeDeps = (over: Partial<RegisterNetworkDeps> = {}) => {
  const upsertRegistry = vi.fn<(row: NetworkRegistryRow) => Promise<{ error: unknown }>>(
    async () => ({ error: null }),
  );
  const upsertOccupant = vi.fn<(row: HomeNetworkOccupantRow) => Promise<{ error: unknown }>>(
    async () => ({ error: null }),
  );
  const allocatePublicIp = vi.fn<(essid: string) => Promise<string>>(async () => ALLOCATED_IP);
  const deps: RegisterNetworkDeps = {
    nonceStore: freshStore,
    allocatePublicIp,
    upsertRegistry,
    upsertOccupant,
    ...over,
  };
  return { deps, upsertRegistry, upsertOccupant, allocatePublicIp };
};

const envelope = (id: ReturnType<typeof generateIdentity>, over: Record<string, unknown> = {}) =>
  signRequest(id, 'registerNetwork', {
    essid: ESSID,
    workstation_machine_id: WORKSTATION_ID,
    workstation_username: USERNAME,
    workstation_machine_name: MACHINE_NAME,
    workstation_root_hash: ROOT_HASH,
    ...over,
  });

describe('handleRegisterNetwork', () => {
  it('upserts a registry row keyed by the allocated public IP, owner-stamped from the verified pubkey', async () => {
    const id = generateIdentity();
    const { deps, upsertRegistry, allocatePublicIp } = makeDeps();

    const result = await handleRegisterNetwork(envelope(id), deps);

    expect(result).toEqual({ status: 200, body: { ok: true } });
    // The public IP is the one the allocator issued for THIS ESSID — not a client
    // claim and not a local derivation.
    expect(allocatePublicIp).toHaveBeenCalledWith(ESSID);
    expect(upsertRegistry).toHaveBeenCalledTimes(1);
    expect(upsertRegistry.mock.calls[0]![0]).toEqual({
      public_ip: ALLOCATED_IP,
      owner_key: id.publicKeyHex,
      workstation_machine_id: WORKSTATION_ID,
      router_machine_id: computeApGatewayId(ESSID),
      essid: ESSID,
      workstation_username: USERNAME,
      workstation_machine_name: MACHINE_NAME,
      workstation_root_hash: ROOT_HASH,
    });
  });

  it('registers the router as a DISTINCT machine — router_machine_id = computeApGatewayId(ESSID), not the workstation', async () => {
    const id = generateIdentity();
    const { deps, upsertRegistry } = makeDeps();

    await handleRegisterNetwork(envelope(id), deps);

    const row = upsertRegistry.mock.calls[0]![0];
    expect(row.router_machine_id).toBe(computeApGatewayId(ESSID));
    expect(row.router_machine_id).not.toBe(row.workstation_machine_id);
    expect('forward_table' in row).toBe(false);
  });

  it('persists the workstation identity (username/machineName/root-hash) so a cross-player reader can reconstruct the box', async () => {
    const id = generateIdentity();
    const { deps, upsertRegistry } = makeDeps();

    await handleRegisterNetwork(
      envelope(id, {
        workstation_username: 'trinity',
        workstation_machine_name: 'nebuchadnezzar',
        workstation_root_hash: 'a'.repeat(32),
      }),
      deps,
    );

    const row = upsertRegistry.mock.calls[0]![0];
    expect(row.workstation_username).toBe('trinity');
    expect(row.workstation_machine_name).toBe('nebuchadnezzar');
    expect(row.workstation_root_hash).toBe('a'.repeat(32));
  });

  it('rejects an envelope missing the workstation_username without writing', async () => {
    const id = generateIdentity();
    const { deps, upsertRegistry } = makeDeps();

    const result = await handleRegisterNetwork(
      signRequest(id, 'registerNetwork', {
        essid: ESSID,
        workstation_machine_id: WORKSTATION_ID,
        workstation_machine_name: MACHINE_NAME,
        workstation_root_hash: ROOT_HASH,
      }),
      deps,
    );

    expect(result.status).toBe(400);
    expect(upsertRegistry).not.toHaveBeenCalled();
  });

  it('rejects an envelope missing the workstation_root_hash without writing', async () => {
    const id = generateIdentity();
    const { deps, upsertRegistry } = makeDeps();

    const result = await handleRegisterNetwork(
      signRequest(id, 'registerNetwork', {
        essid: ESSID,
        workstation_machine_id: WORKSTATION_ID,
        workstation_username: USERNAME,
        workstation_machine_name: MACHINE_NAME,
      }),
      deps,
    );

    expect(result.status).toBe(400);
    expect(upsertRegistry).not.toHaveBeenCalled();
  });

  it('stamps the allocator’s per-ESSID IP — two identities on one AP share it, each with its own owner_key', async () => {
    const idA = generateIdentity();
    const idB = generateIdentity();
    // One shared allocator keyed by ESSID (mirrors the real per-ESSID store): both
    // occupants of the same AP resolve to the SAME public IP, owner-stamped distinctly.
    const allocatePublicIp = vi.fn<(essid: string) => Promise<string>>(
      async (essid) => `198.51.100.${essid.length}`,
    );
    const { deps: depsA, upsertRegistry: upA } = makeDeps({ allocatePublicIp });
    const { deps: depsB, upsertRegistry: upB } = makeDeps({ allocatePublicIp });

    await handleRegisterNetwork(envelope(idA), depsA);
    await handleRegisterNetwork(envelope(idB), depsB);

    expect(upA.mock.calls[0]![0].public_ip).toBe(upB.mock.calls[0]![0].public_ip);
    expect(upA.mock.calls[0]![0].owner_key).toBe(idA.publicKeyHex);
    expect(upB.mock.calls[0]![0].owner_key).toBe(idB.publicKeyHex);
  });

  it('rejects an envelope that smuggles a client-supplied player_key without writing', async () => {
    const id = generateIdentity();
    const { deps, upsertRegistry } = makeDeps();

    const result = await handleRegisterNetwork(envelope(id, { player_key: 'attacker-key' }), deps);

    expect(result.status).toBe(400);
    expect(upsertRegistry).not.toHaveBeenCalled();
  });

  it('rejects an envelope that smuggles a client-supplied public_ip without writing', async () => {
    const id = generateIdentity();
    const { deps, upsertRegistry } = makeDeps();

    const result = await handleRegisterNetwork(envelope(id, { public_ip: '1.2.3.4' }), deps);

    expect(result.status).toBe(400);
    expect(upsertRegistry).not.toHaveBeenCalled();
  });

  it('rejects a tampered envelope (payload changed after signing) without writing', async () => {
    const id = generateIdentity();
    const { deps, upsertRegistry } = makeDeps();
    const signed = envelope(id);
    const tampered = { ...signed, payload: `${signed.payload} ` };

    const result = await handleRegisterNetwork(tampered, deps);

    expect(result).toEqual({ status: 401, body: { error: 'signature_invalid' } });
    expect(upsertRegistry).not.toHaveBeenCalled();
  });

  it('rejects an envelope missing the workstation_machine_id without writing', async () => {
    const id = generateIdentity();
    const { deps, upsertRegistry } = makeDeps();

    const result = await handleRegisterNetwork(
      signRequest(id, 'registerNetwork', { essid: ESSID }),
      deps,
    );

    expect(result.status).toBe(400);
    expect(upsertRegistry).not.toHaveBeenCalled();
  });

  it('reports a server error when the registry upsert fails', async () => {
    const id = generateIdentity();
    const { deps } = makeDeps({
      upsertRegistry: vi.fn(async () => ({ error: new Error('db down') })),
    });

    const result = await handleRegisterNetwork(envelope(id), deps);

    expect(result).toEqual({ status: 500, body: { error: 'registry_write_failed' } });
  });

  it('reports a server error when public-IP allocation fails, without writing', async () => {
    const id = generateIdentity();
    const { deps, upsertRegistry, upsertOccupant } = makeDeps({
      allocatePublicIp: vi.fn(async () => {
        throw new Error('allocation exhausted');
      }),
    });

    const result = await handleRegisterNetwork(envelope(id), deps);

    expect(result).toEqual({ status: 500, body: { error: 'allocation_failed' } });
    // Allocation precedes the writes — a failure must not touch the journal.
    expect(upsertRegistry).not.toHaveBeenCalled();
    expect(upsertOccupant).not.toHaveBeenCalled();
  });

  it('upserts an occupancy row keyed by (essid, owner_key), server-stamped from the verified pubkey', async () => {
    const id = generateIdentity();
    const { deps, upsertOccupant } = makeDeps();

    const result = await handleRegisterNetwork(envelope(id), deps);

    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(upsertOccupant).toHaveBeenCalledTimes(1);
    expect(upsertOccupant.mock.calls[0]![0]).toEqual({
      essid: ESSID,
      owner_key: id.publicKeyHex,
      workstation_machine_id: WORKSTATION_ID,
      workstation_username: USERNAME,
      workstation_machine_name: MACHINE_NAME,
      workstation_root_hash: ROOT_HASH,
    });
  });

  it('reports a server error when the occupant upsert fails (registry already written)', async () => {
    const id = generateIdentity();
    const { deps, upsertRegistry } = makeDeps({
      upsertOccupant: vi.fn(async () => ({ error: new Error('db down') })),
    });

    const result = await handleRegisterNetwork(envelope(id), deps);

    expect(result).toEqual({ status: 500, body: { error: 'occupant_write_failed' } });
    expect(upsertRegistry).toHaveBeenCalledTimes(1);
  });

  it('does not write the occupant row when the registry upsert fails first', async () => {
    const id = generateIdentity();
    const { deps, upsertOccupant } = makeDeps({
      upsertRegistry: vi.fn(async () => ({ error: new Error('db down') })),
    });

    await handleRegisterNetwork(envelope(id), deps);

    expect(upsertOccupant).not.toHaveBeenCalled();
  });
});
