import { describe, expect, it, vi } from 'vitest';
import {
  handleRegisterNetwork,
  type HomeNetworkOccupantRow,
  type RegisterNetworkDeps,
} from './registerNetwork.js';
import { signRequest } from '../signedRequest/sign.js';
import { generateIdentity } from '../identity/identity.js';
import { assignHomeNetwork } from './homeNetwork.js';
import { lanAddressFor } from './lanAddress.js';
import type { NonceStore } from '../signedRequest/nonceStore.js';
import { DECLARED_NETWORKS, RIDGEMONT } from '../generation/world.js';
import { sessionRow, sessionTable, type SessionRow } from '../../test/factories/sessionTable.js';

/**
 * `handleRegisterNetwork` is the server-side join action. It verifies the signed
 * envelope, leases the caller its own address on the ESSID's LAN, and records the caller
 * as an occupant of the ESSID. The AP's public address is its place in the world, so
 * the join stores none. That occupancy row is the whole cross-player surface: it is what lets a
 * DIFFERENT identity resolve, reach, and reconstruct this box, and it exists exactly
 * while the machine is on the WiFi. `owner_key` is stamped from the verified pubkey,
 * never claimed.
 *
 * The AP's gateway is NOT recorded by the join: its id derives from the ESSID at read
 * time, so every occupant resolves the same one.
 */

const freshStore: NonceStore = async () => ({ fresh: true });
const ESSID = 'BEAN-THERE-WIFI';
// A made-up network of the kind the wire-checks join, so each run starts on a gateway
// nobody has written to.
const LAB_NETWORK = 'LEASE-TEST-NET';
const WORKSTATION_ID = 'skylab-deadbeef';
// The player-private workstation identity the server persists so a cross-player
// reader can reconstruct the box. The root value is already an md5 HASH — the client
// hashes it; the server stores it opaquely, never seeing plaintext.
const USERNAME = 'neo';
const MACHINE_NAME = 'skylab';
const ROOT_HASH = 'd41d8cd98f00b204e9800998ecf8427e';
// The host octet the stub lease allocator issues. Opaque to the handler: the join's job
// is to make the allocation happen, and the real uniqueness guarantee is a database
// constraint, so it is wire-checked.
const LEASED_OCTET = 84;

/** A handler wired to stub stores and an in-memory `sessions` table. The box joins from
 *  no network unless `onNetwork` names the one it is already on. */
const makeDeps = (
  over: Partial<RegisterNetworkDeps> = {},
  options: { readonly onNetwork?: string; readonly sessions?: readonly SessionRow[] } = {},
) => {
  const upsertOccupant = vi.fn<(row: HomeNetworkOccupantRow) => Promise<{ error: unknown }>>(
    async () => ({ error: null }),
  );
  const allocateLanLease = vi.fn<(essid: string, ownerKey: string) => Promise<number>>(
    async () => LEASED_OCTET,
  );
  const deleteOtherOccupancies = vi.fn<RegisterNetworkDeps['deleteOtherOccupancies']>(
    async (query) => ({
      data:
        options.onNetwork === undefined || options.onNetwork === query.essid
          ? []
          : [{ workstation_machine_id: WORKSTATION_ID }],
      error: null,
    }),
  );
  const table = sessionTable(options.sessions ?? []);
  const deps: RegisterNetworkDeps = {
    nonceStore: freshStore,
    allocateLanLease,
    upsertOccupant,
    deleteOtherOccupancies,
    endVisitorSessions: table.endVisitorSessions,
    endSessionsAbove: table.endSessionsAbove,
    admitsUndeclaredNetworks: false,
    ...over,
  };
  return { deps, upsertOccupant, allocateLanLease, deleteOtherOccupancies, table };
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
    // registers the player on a network they hold no address on.
    expect(result).toEqual({ status: 500, body: { error: 'lease_allocation_failed' } });
    expect(upsertOccupant).not.toHaveBeenCalled();
  });
});

// Until players can travel, every player lives in Ridgemont, so its networks are the only
// ones a join may reach. Another town's networks are never offered on WiFi, and their keys
// are guessable, so a modified client could otherwise sit on them.
const RIDGEMONT_KEYS = DECLARED_NETWORKS.filter((network) => network.town === RIDGEMONT).map(
  (network) => network.key,
);
const OUT_OF_TOWN_KEYS = DECLARED_NETWORKS.filter((network) => network.town !== RIDGEMONT).map(
  (network) => network.key,
);
const NOT_JOINABLE = { status: 403, body: { error: 'network_not_joinable' } };

describe('handleRegisterNetwork: which networks a player may join', () => {
  it.each(OUT_OF_TOWN_KEYS)('refuses a join to %s, outside Ridgemont, without writing', async (key) => {
    const id = generateIdentity();
    const { deps, allocateLanLease, upsertOccupant } = makeDeps();

    const result = await handleRegisterNetwork(envelope(id, { essid: key }), deps);

    expect(result).toEqual(NOT_JOINABLE);
        expect(allocateLanLease).not.toHaveBeenCalled();
    expect(upsertOccupant).not.toHaveBeenCalled();
  });

  it('refuses a join to a network the world does not declare, without writing', async () => {
    const id = generateIdentity();
    const { deps, allocateLanLease, upsertOccupant } = makeDeps();

    const result = await handleRegisterNetwork(envelope(id, { essid: LAB_NETWORK }), deps);

    expect(result).toEqual(NOT_JOINABLE);
        expect(allocateLanLease).not.toHaveBeenCalled();
    expect(upsertOccupant).not.toHaveBeenCalled();
  });

  it('still answers a badly signed join by its signature, before asking where it leads', async () => {
    const id = generateIdentity();
    const { deps } = makeDeps();
    const signed = envelope(id, { essid: OUT_OF_TOWN_KEYS[0] });
    const tampered = { ...signed, payload: `${signed.payload} ` };

    const result = await handleRegisterNetwork(tampered, deps);

    expect(result).toEqual({ status: 401, body: { error: 'signature_invalid' } });
  });

  it('lets a player join every one of Ridgemont’s networks', async () => {
    const id = generateIdentity();
    const joined = await Promise.all(
      RIDGEMONT_KEYS.map(async (key) => {
        const { deps, upsertOccupant } = makeDeps();
        const result = await handleRegisterNetwork(envelope(id, { essid: key }), deps);
        return {
          key,
          result,
          occupantEssid: upsertOccupant.mock.calls[0]?.[0].essid,
        };
      }),
    );

    expect(RIDGEMONT_KEYS).toHaveLength(178);
    expect(joined).toEqual(
      RIDGEMONT_KEYS.map((key) => ({
        key,
        result: { status: 200, body: { ok: true, local_ip: lanAddressFor(key, LEASED_OCTET) } },
        occupantEssid: key,
      })),
    );
  });

  it('admits a network the world does not declare when undeclared networks are admitted', async () => {
    const id = generateIdentity();
    const { deps, upsertOccupant } = makeDeps({ admitsUndeclaredNetworks: true });

    const result = await handleRegisterNetwork(envelope(id, { essid: LAB_NETWORK }), deps);

    expect(result).toEqual({
      status: 200,
      body: { ok: true, local_ip: lanAddressFor(LAB_NETWORK, LEASED_OCTET) },
    });
    expect(upsertOccupant.mock.calls[0]?.[0].essid).toBe(LAB_NETWORK);
  });

  it.each(OUT_OF_TOWN_KEYS)(
    'still refuses %s, outside Ridgemont, when undeclared networks are admitted',
    async (key) => {
      const id = generateIdentity();
      const { deps, allocateLanLease, upsertOccupant } = makeDeps({
        admitsUndeclaredNetworks: true,
      });

      const result = await handleRegisterNetwork(envelope(id, { essid: key }), deps);

      expect(result).toEqual(NOT_JOINABLE);
            expect(allocateLanLease).not.toHaveBeenCalled();
      expect(upsertOccupant).not.toHaveBeenCalled();
    },
  );
});

/**
 * A box is on one network at a time. A join from a box already on another network takes
 * it off that one first, exactly as a disconnect would: its occupancy there goes, and so
 * does every connection another player held to it through that network. The game client
 * refuses the second join itself; this is what holds for a request that skips it, or for
 * a disconnect whose fire-and-forget leave never landed.
 */
describe('handleRegisterNetwork: one network at a time', () => {
  const OLD_NETWORK = 'TYRELL-CORP';

  it('takes the box off every other network it is on, scoped to the verified pubkey', async () => {
    const id = generateIdentity();
    const { deps, deleteOtherOccupancies } = makeDeps({}, { onNetwork: OLD_NETWORK });

    const result = await handleRegisterNetwork(envelope(id), deps);

    expect(result.status).toBe(200);
    expect(deleteOtherOccupancies).toHaveBeenCalledTimes(1);
    expect(deleteOtherOccupancies).toHaveBeenCalledWith({
      essid: ESSID,
      owner_key: id.publicKeyHex,
    });
  });

  it("closes a visitor's session on the box, recorded as the box leaving", async () => {
    const id = generateIdentity();
    const { deps, table } = makeDeps(
      {},
      {
        onNetwork: OLD_NETWORK,
        sessions: [sessionRow({ session_id: 'visitor-shell', machine_id: WORKSTATION_ID })],
      },
    );

    await handleRegisterNetwork(envelope(id), deps);

    expect(table.reasonOf('visitor-shell')).toBe('network_left');
  });

  it('closes the sessions a visitor opened from the box, all the way up their chain', async () => {
    const id = generateIdentity();
    const { deps, table } = makeDeps(
      {},
      {
        onNetwork: OLD_NETWORK,
        sessions: [
          sessionRow({ session_id: 'visitor-shell', machine_id: WORKSTATION_ID }),
          sessionRow({
            session_id: 'hop-from-the-box',
            machine_id: 'web-01-cafef00d',
            parent_session_id: 'visitor-shell',
          }),
        ],
      },
    );

    await handleRegisterNetwork(envelope(id), deps);

    expect(table.reasonOf('hop-from-the-box')).toBe('upstream_lost');
  });

  it("leaves the owner's own sessions on their box open", async () => {
    const id = generateIdentity();
    const { deps, table } = makeDeps(
      {},
      {
        onNetwork: OLD_NETWORK,
        sessions: [
          sessionRow({
            session_id: 'own-su',
            player_key: id.publicKeyHex,
            machine_id: WORKSTATION_ID,
            kind: 'su',
          }),
        ],
      },
    );

    await handleRegisterNetwork(envelope(id), deps);

    expect(table.reasonOf('own-su')).toBeUndefined();
  });

  // Re-joining the network the box is already on moves it nowhere, so nobody standing
  // on it through that network is thrown off.
  it('closes nothing when the box is on no other network', async () => {
    const id = generateIdentity();
    const { deps, table } = makeDeps(
      {},
      {
        onNetwork: ESSID,
        sessions: [sessionRow({ session_id: 'visitor-shell', machine_id: WORKSTATION_ID })],
      },
    );

    const result = await handleRegisterNetwork(envelope(id), deps);

    expect(result.status).toBe(200);
    expect(table.reasonOf('visitor-shell')).toBeUndefined();
  });

  it('closes nothing when the store answers with no rows at all', async () => {
    const id = generateIdentity();
    const endVisitorSessions = vi.fn<RegisterNetworkDeps['endVisitorSessions']>(async () => ({
      data: [],
      error: null,
    }));
    const { deps } = makeDeps({
      deleteOtherOccupancies: vi.fn(async () => ({ data: null, error: null })),
      endVisitorSessions,
    });

    const result = await handleRegisterNetwork(envelope(id), deps);

    expect(result.status).toBe(200);
    expect(endVisitorSessions).not.toHaveBeenCalled();
  });

  it('leaves the old network untouched when the new one is not joinable', async () => {
    const id = generateIdentity();
    const { deps, deleteOtherOccupancies } = makeDeps({}, { onNetwork: OLD_NETWORK });

    await handleRegisterNetwork(envelope(id, { essid: OUT_OF_TOWN_KEYS[0] }), deps);

    expect(deleteOtherOccupancies).not.toHaveBeenCalled();
  });

  // No address on the new network means no join, so the box stays where it was.
  it('leaves the old network untouched when no address could be leased', async () => {
    const id = generateIdentity();
    const { deps, deleteOtherOccupancies } = makeDeps(
      {
        allocateLanLease: vi.fn(async () => {
          throw new Error('lan lease allocation exhausted');
        }),
      },
      { onNetwork: OLD_NETWORK },
    );

    await handleRegisterNetwork(envelope(id), deps);

    expect(deleteOtherOccupancies).not.toHaveBeenCalled();
  });

  it('reports a server error, without joining, when the old network could not be left', async () => {
    const id = generateIdentity();
    const { deps, upsertOccupant } = makeDeps({
      deleteOtherOccupancies: vi.fn(async () => ({ data: null, error: new Error('db down') })),
    });

    const result = await handleRegisterNetwork(envelope(id), deps);

    expect(result).toEqual({ status: 500, body: { error: 'occupant_delete_failed' } });
    expect(upsertOccupant).not.toHaveBeenCalled();
  });

  // Loud, as a disconnect's is: a join that left a visitor's row open puts the box on a
  // new network while the visitor still stands on it through the old one.
  it('reports a server error, without joining, when the sessions could not be closed', async () => {
    const id = generateIdentity();
    const { deps, upsertOccupant } = makeDeps(
      { endVisitorSessions: async () => ({ data: null, error: new Error('db down') }) },
      { onNetwork: OLD_NETWORK },
    );

    const result = await handleRegisterNetwork(envelope(id), deps);

    expect(result).toEqual({ status: 500, body: { error: 'sessions_end_failed' } });
    expect(upsertOccupant).not.toHaveBeenCalled();
  });
});
