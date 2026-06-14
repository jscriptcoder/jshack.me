import { describe, expect, it, vi } from 'vitest';
import {
  handleRegisterNetwork,
  type NetworkRegistryRow,
  type RegisterNetworkDeps,
} from './registerNetwork';
import { signRequest } from '../signedRequest/sign';
import { generateIdentity } from '../identity/identity';
import { assignHomeNetwork } from './homeNetwork';
import type { NonceStore } from '../signedRequest/nonceStore';

/**
 * `handleRegisterNetwork` is the server-side join action (Story 1, slice 1a). It
 * verifies the signed envelope and upserts a public-IP registry row so a DIFFERENT
 * identity can later resolve this network by its public IP. The public IP is
 * derived SERVER-SIDE from the ESSID (the WAN address belongs to the AP, shared by
 * every occupant); `owner_key` is stamped from the verified pubkey, never claimed.
 * The degenerate NAT (`router_machine_id` = the workstation, `forward_table` =
 * all → workstation) is stored as a VALUE from the start so Story 5 swaps it for
 * real iptables rules without a schema change.
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

const makeDeps = (over: Partial<RegisterNetworkDeps> = {}) => {
  const upsertRegistry = vi.fn<(row: NetworkRegistryRow) => Promise<{ error: unknown }>>(
    async () => ({ error: null }),
  );
  const deps: RegisterNetworkDeps = { nonceStore: freshStore, upsertRegistry, ...over };
  return { deps, upsertRegistry };
};

const envelope = (
  id: ReturnType<typeof generateIdentity>,
  over: Record<string, unknown> = {},
) =>
  signRequest(id, 'registerNetwork', {
    essid: ESSID,
    workstation_machine_id: WORKSTATION_ID,
    workstation_username: USERNAME,
    workstation_machine_name: MACHINE_NAME,
    workstation_root_hash: ROOT_HASH,
    ...over,
  });

describe('handleRegisterNetwork', () => {
  it('upserts a registry row keyed by the server-derived public IP, owner-stamped from the verified pubkey', async () => {
    const id = generateIdentity();
    const { deps, upsertRegistry } = makeDeps();
    const publicIp = assignHomeNetwork(id.publicKeyHex, ESSID).publicIp;

    const result = await handleRegisterNetwork(envelope(id), deps);

    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(upsertRegistry).toHaveBeenCalledTimes(1);
    expect(upsertRegistry.mock.calls[0]![0]).toEqual({
      public_ip: publicIp,
      owner_key: id.publicKeyHex,
      workstation_machine_id: WORKSTATION_ID,
      router_machine_id: WORKSTATION_ID,
      forward_table: [{ publicPort: '*', targetMachineId: WORKSTATION_ID }],
      essid: ESSID,
      workstation_username: USERNAME,
      workstation_machine_name: MACHINE_NAME,
      workstation_root_hash: ROOT_HASH,
    });
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

  it('derives the public IP from the ESSID alone — two identities on the same AP register the same public IP but their own owner_key', async () => {
    const idA = generateIdentity();
    const idB = generateIdentity();
    const { deps: depsA, upsertRegistry: upA } = makeDeps();
    const { deps: depsB, upsertRegistry: upB } = makeDeps();

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
});
