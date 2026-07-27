import { describe, expect, it, vi } from 'vitest';
import {
  handleRegisterNetwork,
  type HomeNetworkOccupantRow,
  type RegisterNetworkDeps,
} from './registerNetwork';
import { signRequest } from '../signedRequest/sign';
import { generateIdentity } from '../identity/identity';
import { assignHomeNetwork } from './homeNetwork';
import { lanAddressFor } from './lanAddress';
import type { NonceStore } from '../signedRequest/nonceStore';

/**
 * `handleRegisterNetwork` is the server-side join action. It verifies the signed
 * envelope, makes both allocations the join depends on — the AP's per-ESSID public
 * IP and the caller's own LAN lease — and records the caller as an occupant of the
 * ESSID. That occupancy row is the whole cross-player surface: it is what lets a
 * DIFFERENT identity resolve, reach, and reconstruct this box, and it exists exactly
 * while the machine is on the WiFi. `owner_key` is stamped from the verified pubkey,
 * never claimed.
 *
 * The AP's gateway is NOT recorded by the join: its id derives from the ESSID at read
 * time, so every occupant resolves the same one.
 */

const freshStore: NonceStore = async () => ({ fresh: true });
const ESSID = 'BEAN-THERE-WIFI';
const WORKSTATION_ID = 'skylab-deadbeef';
// The player-private workstation identity the server persists so a cross-player
// reader can reconstruct the box. The root value is already an md5 HASH — the client
// hashes it; the server stores it opaquely, never seeing plaintext.
const USERNAME = 'neo';
const MACHINE_NAME = 'skylab';
const ROOT_HASH = 'd41d8cd98f00b204e9800998ecf8427e';
// What the stub allocator issues for the ESSID. The handler never reads the value —
// its job is to make the allocation HAPPEN, and that stored row is what a foreign
// scanner resolves the AP by. Sharing one IP across an ESSID is `allocatePublicIp`'s
// own claim, proven in its tests and wire-checked end to end.
const ALLOCATED_IP = '203.0.113.7';
// The host octet the stub lease allocator issues. Opaque to the handler in the same
// way the public IP is: the join's job is to make the allocation happen, and the
// real uniqueness guarantee is a database constraint, so it is wire-checked.
const LEASED_OCTET = 84;

const makeDeps = (over: Partial<RegisterNetworkDeps> = {}) => {
  const upsertOccupant = vi.fn<(row: HomeNetworkOccupantRow) => Promise<{ error: unknown }>>(
    async () => ({ error: null }),
  );
  const allocatePublicIp = vi.fn<(essid: string) => Promise<string>>(async () => ALLOCATED_IP);
  const allocateLanLease = vi.fn<(essid: string, ownerKey: string) => Promise<number>>(
    async () => LEASED_OCTET,
  );
  const deps: RegisterNetworkDeps = {
    nonceStore: freshStore,
    allocatePublicIp,
    allocateLanLease,
    upsertOccupant,
    ...over,
  };
  return { deps, upsertOccupant, allocatePublicIp, allocateLanLease };
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
  it('allocates the AP’s public IP for the joined ESSID, so the network is resolvable from outside', async () => {
    const id = generateIdentity();
    const { deps, allocatePublicIp } = makeDeps();

    const result = await handleRegisterNetwork(envelope(id), deps);

    expect(result).toEqual({
      status: 200,
      body: { ok: true, local_ip: lanAddressFor(ESSID, LEASED_OCTET) },
    });
    // Keyed by the ESSID the caller joined — an address belonging to the ACCESS POINT,
    // not to the joiner, which is why nothing about the caller enters the call.
    expect(allocatePublicIp).toHaveBeenCalledTimes(1);
    expect(allocatePublicIp).toHaveBeenCalledWith(ESSID);
  });

  it('persists the workstation identity (username/machineName/root-hash) so a cross-player reader can reconstruct the box', async () => {
    const id = generateIdentity();
    const { deps, upsertOccupant } = makeDeps();

    await handleRegisterNetwork(
      envelope(id, {
        workstation_username: 'trinity',
        workstation_machine_name: 'nebuchadnezzar',
        workstation_root_hash: 'a'.repeat(32),
      }),
      deps,
    );

    const row = upsertOccupant.mock.calls[0]![0];
    expect(row.workstation_username).toBe('trinity');
    expect(row.workstation_machine_name).toBe('nebuchadnezzar');
    expect(row.workstation_root_hash).toBe('a'.repeat(32));
  });

  it('rejects an envelope missing the workstation_username without writing', async () => {
    const id = generateIdentity();
    const { deps, upsertOccupant } = makeDeps();

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
    expect(upsertOccupant).not.toHaveBeenCalled();
  });

  it('rejects an envelope missing the workstation_root_hash without writing', async () => {
    const id = generateIdentity();
    const { deps, upsertOccupant } = makeDeps();

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
    expect(upsertOccupant).not.toHaveBeenCalled();
  });

  it('keys the public-IP allocation on the ESSID alone — two identities joining one AP make the same request', async () => {
    const idA = generateIdentity();
    const idB = generateIdentity();
    const { deps: depsA, allocatePublicIp: allocA } = makeDeps();
    const { deps: depsB, allocatePublicIp: allocB } = makeDeps();

    await handleRegisterNetwork(envelope(idA), depsA);
    await handleRegisterNetwork(envelope(idB), depsB);

    // The address belongs to the ACCESS POINT, so two occupants ask the allocator the
    // same question and get one answer. That they then SHARE it is `allocatePublicIp`'s
    // claim (it recalls a known ESSID's IP without drawing); what the join owes is that
    // nothing identity-specific enters the request in the first place.
    expect(allocA).toHaveBeenCalledWith(ESSID);
    expect(allocB).toHaveBeenCalledWith(ESSID);
    expect(allocA.mock.calls[0]).toEqual(allocB.mock.calls[0]);
  });

  it('rejects an envelope that smuggles a client-supplied player_key without writing', async () => {
    const id = generateIdentity();
    const { deps, upsertOccupant } = makeDeps();

    const result = await handleRegisterNetwork(envelope(id, { player_key: 'attacker-key' }), deps);

    expect(result.status).toBe(400);
    expect(upsertOccupant).not.toHaveBeenCalled();
  });

  it('rejects an envelope that smuggles a client-supplied public_ip without writing', async () => {
    const id = generateIdentity();
    const { deps, upsertOccupant } = makeDeps();

    const result = await handleRegisterNetwork(envelope(id, { public_ip: '1.2.3.4' }), deps);

    expect(result.status).toBe(400);
    expect(upsertOccupant).not.toHaveBeenCalled();
  });

  it('rejects a tampered envelope (payload changed after signing) without writing', async () => {
    const id = generateIdentity();
    const { deps, upsertOccupant } = makeDeps();
    const signed = envelope(id);
    const tampered = { ...signed, payload: `${signed.payload} ` };

    const result = await handleRegisterNetwork(tampered, deps);

    expect(result).toEqual({ status: 401, body: { error: 'signature_invalid' } });
    expect(upsertOccupant).not.toHaveBeenCalled();
  });

  it('rejects an envelope missing the workstation_machine_id without writing', async () => {
    const id = generateIdentity();
    const { deps, upsertOccupant } = makeDeps();

    const result = await handleRegisterNetwork(
      signRequest(id, 'registerNetwork', { essid: ESSID }),
      deps,
    );

    expect(result.status).toBe(400);
    expect(upsertOccupant).not.toHaveBeenCalled();
  });

  it('reports a server error when public-IP allocation fails, without writing', async () => {
    const id = generateIdentity();
    const { deps, upsertOccupant } = makeDeps({
      allocatePublicIp: vi.fn(async () => {
        throw new Error('allocation exhausted');
      }),
    });

    const result = await handleRegisterNetwork(envelope(id), deps);

    expect(result).toEqual({ status: 500, body: { error: 'allocation_failed' } });
    // Allocation precedes the write — a failure must not leave an occupant on a
    // network that has no address to be reached at.
    expect(upsertOccupant).not.toHaveBeenCalled();
  });

  it('upserts an occupancy row keyed by (essid, owner_key), server-stamped from the verified pubkey', async () => {
    const id = generateIdentity();
    const { deps, upsertOccupant } = makeDeps();

    const result = await handleRegisterNetwork(envelope(id), deps);

    expect(result).toEqual({
      status: 200,
      body: { ok: true, local_ip: lanAddressFor(ESSID, LEASED_OCTET) },
    });
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

  it('reports a server error when the occupant upsert fails', async () => {
    const id = generateIdentity();
    const { deps } = makeDeps({
      upsertOccupant: vi.fn(async () => ({ error: new Error('db down') })),
    });

    const result = await handleRegisterNetwork(envelope(id), deps);

    // The occupancy row IS the join: a caller told the join succeeded while no row
    // landed would believe it is on a network that cannot see or reach it.
    expect(result).toEqual({ status: 500, body: { error: 'occupant_write_failed' } });
  });

  it('leases a LAN address for the occupant, keyed by the VERIFIED pubkey', async () => {
    const id = generateIdentity();
    const { deps, allocateLanLease } = makeDeps();

    const result = await handleRegisterNetwork(envelope(id), deps);

    // The lease is what stops two occupants of one ESSID colliding on an address.
    // Keyed by the verified pubkey, so a caller cannot lease an address for anyone
    // else — the same posture as the owner-stamped occupancy row.
    expect(result.status).toBe(200);
    expect(allocateLanLease).toHaveBeenCalledTimes(1);
    expect(allocateLanLease).toHaveBeenCalledWith(ESSID, id.publicKeyHex);
  });

  it('returns the LEASED address, so a redrawn occupant is told where it actually lives', async () => {
    const id = generateIdentity();
    // The address the pure derivation would have issued — what the client used to
    // assume it could compute for itself.
    const derived = assignHomeNetwork(id.publicKeyHex, ESSID).localIp;
    const derivedOctet = Number(derived.split('.')[3]);
    // A collided occupant: the allocator hands back an octet the derivation never
    // would have picked for this identity. This is the case the whole slice exists
    // for — a client that derives its own address is simply wrong here.
    const redrawnOctet = derivedOctet === 254 ? 2 : derivedOctet + 1;
    const { deps } = makeDeps({ allocateLanLease: vi.fn(async () => redrawnOctet) });

    const result = await handleRegisterNetwork(envelope(id), deps);

    expect(result).toEqual({
      status: 200,
      body: { ok: true, local_ip: lanAddressFor(ESSID, redrawnOctet) },
    });
    expect(result.body.local_ip).not.toBe(derived);
  });

  it('leases per occupant, not per ESSID — two identities on one AP lease separately', async () => {
    const alice = generateIdentity();
    const bob = generateIdentity();
    const { deps: aliceDeps, allocateLanLease: aliceLease } = makeDeps();
    const { deps: bobDeps, allocateLanLease: bobLease } = makeDeps();

    await handleRegisterNetwork(envelope(alice), aliceDeps);
    await handleRegisterNetwork(envelope(bob), bobDeps);

    // This is the axis on which a LAN lease differs from the AP's public IP: the
    // public IP is one address SHARED by the whole ESSID, while each occupant holds
    // its own host octet. Both requests name the same ESSID and different owners.
    expect(aliceLease).toHaveBeenCalledWith(ESSID, alice.publicKeyHex);
    expect(bobLease).toHaveBeenCalledWith(ESSID, bob.publicKeyHex);
  });

  it('reports a server error when LAN lease allocation fails, without writing', async () => {
    const id = generateIdentity();
    const { deps, upsertOccupant } = makeDeps({
      allocateLanLease: vi.fn(async () => {
        throw new Error('lan lease allocation exhausted');
      }),
    });

    const result = await handleRegisterNetwork(envelope(id), deps);

    // A full subnet (or a store failure) is a clean 500, never a partial join that
    // registers the player on a network they hold no address on. Distinct from
    // `allocation_failed` so the two allocators are separable in a log.
    expect(result).toEqual({ status: 500, body: { error: 'lease_allocation_failed' } });
    expect(upsertOccupant).not.toHaveBeenCalled();
  });
});
