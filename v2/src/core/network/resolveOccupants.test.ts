import { describe, expect, it, vi } from 'vitest';
import {
  handleResolveOccupants,
  type OccupantListRow,
  type ResolveOccupantsDeps,
} from './resolveOccupants';
import { signRequest } from '../signedRequest/sign';
import { generateIdentity } from '../identity/identity';
import { assignHomeNetwork } from './homeNetwork';
import type { LanLeaseRow } from './lanAddress';
import type { NonceStore } from '../signedRequest/nonceStore';

/**
 * `handleResolveOccupants` answers "who else is on ESSID X?" to a VERIFIED occupant
 * (Story 7, slice 7.2a). The LAN boundary (decision D11) means you must hold a live
 * occupancy row for the ESSID to enumerate it — a non-occupant is refused before any
 * list crosses the wire. The caller is always excluded from its own result, and each
 * returned occupant's LAN IP is the one that occupant HOLDS A LEASE ON — the AP's
 * `/24` is still ESSID-seeded, but the host octet is the server-allocated lease, so
 * two occupants the old pure derivation put at one address are now distinct.
 */

const freshStore: NonceStore = async () => ({ fresh: true });
const ESSID = 'BEAN-THERE-WIFI';

/** The AP's `/24` — still ESSID-seeded, so any seed reports the same prefix. */
const subnetOf = (essid: string): string =>
  assignHomeNetwork('any-seed', essid).localIp.split('.').slice(0, 3).join('.');

const derivedOctet = (pubkeyHex: string, essid: string): number =>
  Number(assignHomeNetwork(pubkeyHex, essid).localIp.split('.')[3]);

/**
 * Two identities the pure derivation puts at the SAME host octet — the exact case the
 * lease exists to resolve. Searched rather than hard-coded so a change to the
 * derivation can't leave a stale fixture silently proving nothing.
 */
const collidingIdentities = (essid: string) => {
  const first = generateIdentity();
  const collidedOctet = derivedOctet(first.publicKeyHex, essid);
  for (let attempt = 0; attempt < 5000; attempt += 1) {
    const second = generateIdentity();
    if (derivedOctet(second.publicKeyHex, essid) === collidedOctet) {
      return { first, second, collidedOctet };
    }
  }
  throw new Error('no colliding identity pair found');
};

/** Leases as the allocator seeds them: each occupant holds the octet the derivation
 *  issued. Where nothing collided the two agree, so an address moves only for an
 *  occupant the derivation actually collided — nobody else is relocated. */
const derivedLeases = (rows: readonly OccupantListRow[]): readonly LanLeaseRow[] =>
  rows.map((row) => ({ owner_key: row.owner_key, octet: derivedOctet(row.owner_key, ESSID) }));

const occupant = (
  id: ReturnType<typeof generateIdentity>,
  machineId: string,
  machineName = `box-${machineId}`,
): OccupantListRow => ({
  owner_key: id.publicKeyHex,
  workstation_machine_id: machineId,
  workstation_machine_name: machineName,
});

const makeDeps = (rows: readonly OccupantListRow[], over: Partial<ResolveOccupantsDeps> = {}) => {
  const listOccupantsByEssid = vi.fn<
    (essid: string) => Promise<{ data: readonly OccupantListRow[] | null; error: unknown }>
  >(async () => ({ data: rows, error: null }));
  const listLeasesByEssid = vi.fn<
    (essid: string) => Promise<{ data: readonly LanLeaseRow[] | null; error: unknown }>
  >(async () => ({ data: derivedLeases(rows), error: null }));
  const deps: ResolveOccupantsDeps = {
    nonceStore: freshStore,
    listOccupantsByEssid,
    listLeasesByEssid,
    ...over,
  };
  return { deps, listOccupantsByEssid, listLeasesByEssid };
};

const envelope = (id: ReturnType<typeof generateIdentity>, over: Record<string, unknown> = {}) =>
  signRequest(id, 'resolveOccupants', { essid: ESSID, ...over });

describe('handleResolveOccupants', () => {
  it("returns a fellow occupant's workstation id + re-derived LAN IP, excluding the caller", async () => {
    const alice = generateIdentity();
    const bob = generateIdentity();
    const { deps } = makeDeps([
      occupant(alice, 'skylab-aaaa', 'alice-rig'),
      occupant(bob, 'nebu-bbbb'),
    ]);

    const result = await handleResolveOccupants(envelope(bob), deps);

    expect(result).toEqual({
      status: 200,
      body: {
        ok: true,
        occupants: [
          {
            workstation_machine_id: 'skylab-aaaa',
            localIp: assignHomeNetwork(alice.publicKeyHex, ESSID).localIp,
            machineName: 'alice-rig',
          },
        ],
      },
    });
  });

  it("includes each occupant's real machine name (for the scan host display)", async () => {
    const alice = generateIdentity();
    const bob = generateIdentity();
    const { deps } = makeDeps([
      occupant(alice, 'skylab-aaaa', 'alice-rig'),
      occupant(bob, 'nebu-bbbb'),
    ]);

    const result = await handleResolveOccupants(envelope(bob), deps);

    const occupants = result.body.occupants as readonly { machineName: string }[];
    expect(occupants[0]!.machineName).toBe('alice-rig');
  });

  it("derives each occupant's LAN IP from THAT occupant's key+ESSID, not the caller's", async () => {
    const alice = generateIdentity();
    const bob = generateIdentity();
    const { deps } = makeDeps([occupant(alice, 'skylab-aaaa'), occupant(bob, 'nebu-bbbb')]);

    const result = await handleResolveOccupants(envelope(bob), deps);

    const occupants = result.body.occupants as readonly { localIp: string }[];
    expect(occupants[0]!.localIp).toBe(assignHomeNetwork(alice.publicKeyHex, ESSID).localIp);
    expect(occupants[0]!.localIp).not.toBe(assignHomeNetwork(bob.publicKeyHex, ESSID).localIp);
  });

  it('excludes the caller even when the caller is the only occupant — returns an empty list', async () => {
    const bob = generateIdentity();
    const { deps } = makeDeps([occupant(bob, 'nebu-bbbb')]);

    const result = await handleResolveOccupants(envelope(bob), deps);

    expect(result).toEqual({ status: 200, body: { ok: true, occupants: [] } });
  });

  it('denies a caller who holds no occupancy row for the ESSID (LAN boundary)', async () => {
    const alice = generateIdentity();
    const bob = generateIdentity();
    const { deps } = makeDeps([occupant(alice, 'skylab-aaaa')]);

    const result = await handleResolveOccupants(envelope(bob), deps);

    expect(result).toEqual({ status: 403, body: { error: 'not_an_occupant' } });
  });

  it('denies when the ESSID has no occupants at all', async () => {
    const bob = generateIdentity();
    const { deps } = makeDeps([]);

    const result = await handleResolveOccupants(envelope(bob), deps);

    expect(result).toEqual({ status: 403, body: { error: 'not_an_occupant' } });
  });

  it('rejects a payload that smuggles a client-supplied owner_key without reading', async () => {
    const bob = generateIdentity();
    const { deps, listOccupantsByEssid } = makeDeps([occupant(bob, 'nebu-bbbb')]);

    const result = await handleResolveOccupants(envelope(bob, { owner_key: 'attacker-key' }), deps);

    expect(result.status).toBe(400);
    expect(listOccupantsByEssid).not.toHaveBeenCalled();
  });

  it('rejects a payload that smuggles a client-supplied player_key without reading', async () => {
    const bob = generateIdentity();
    const { deps, listOccupantsByEssid } = makeDeps([occupant(bob, 'nebu-bbbb')]);

    const result = await handleResolveOccupants(envelope(bob, { player_key: 'attacker-key' }), deps);

    expect(result.status).toBe(400);
    expect(listOccupantsByEssid).not.toHaveBeenCalled();
  });

  it('rejects an envelope missing the essid without reading', async () => {
    const bob = generateIdentity();
    const { deps, listOccupantsByEssid } = makeDeps([occupant(bob, 'nebu-bbbb')]);

    const result = await handleResolveOccupants(signRequest(bob, 'resolveOccupants', {}), deps);

    expect(result.status).toBe(400);
    expect(listOccupantsByEssid).not.toHaveBeenCalled();
  });

  it('rejects a tampered envelope (payload changed after signing) without reading', async () => {
    const bob = generateIdentity();
    const { deps, listOccupantsByEssid } = makeDeps([occupant(bob, 'nebu-bbbb')]);
    const signed = envelope(bob);
    const tampered = { ...signed, payload: `${signed.payload} ` };

    const result = await handleResolveOccupants(tampered, deps);

    expect(result).toEqual({ status: 401, body: { error: 'signature_invalid' } });
    expect(listOccupantsByEssid).not.toHaveBeenCalled();
  });

  it('reports a server error when the occupant lookup fails', async () => {
    const bob = generateIdentity();
    const { deps } = makeDeps([], {
      listOccupantsByEssid: vi.fn(async () => ({ data: null, error: new Error('db down') })),
    });

    const result = await handleResolveOccupants(envelope(bob), deps);

    expect(result).toEqual({ status: 500, body: { error: 'occupants_lookup_failed' } });
  });

  it('reports a fellow occupant at the address it LEASED, not the one the derivation collided on', async () => {
    const { first: alice, second: bob, collidedOctet } = collidingIdentities(ESSID);
    const redrawnOctet = collidedOctet === 2 ? 3 : 2;
    const rows = [occupant(alice, 'skylab-aaaa', 'alice-rig'), occupant(bob, 'nebu-bbbb')];
    const { deps } = makeDeps(rows, {
      listLeasesByEssid: async () => ({
        data: [
          { owner_key: alice.publicKeyHex, octet: collidedOctet },
          { owner_key: bob.publicKeyHex, octet: redrawnOctet },
        ],
        error: null,
      }),
    });

    const result = await handleResolveOccupants(envelope(alice), deps);

    const occupants = result.body.occupants as readonly { localIp: string }[];
    expect(occupants[0]!.localIp).toBe(`${subnetOf(ESSID)}.${redrawnOctet}`);
  });

  it('puts two occupants the derivation collided on at DISTINCT addresses, each seeing the other', async () => {
    const { first: alice, second: bob, collidedOctet } = collidingIdentities(ESSID);
    const redrawnOctet = collidedOctet === 2 ? 3 : 2;
    const rows = [occupant(alice, 'skylab-aaaa'), occupant(bob, 'nebu-bbbb')];
    const leases = {
      data: [
        { owner_key: alice.publicKeyHex, octet: collidedOctet },
        { owner_key: bob.publicKeyHex, octet: redrawnOctet },
      ],
      error: null,
    };
    const { deps } = makeDeps(rows, { listLeasesByEssid: async () => leases });

    const bobSeenByAlice = (
      (await handleResolveOccupants(envelope(alice), deps)).body
        .occupants as readonly { localIp: string }[]
    )[0]!.localIp;
    const aliceSeenByBob = (
      (await handleResolveOccupants(envelope(bob), deps)).body
        .occupants as readonly { localIp: string }[]
    )[0]!.localIp;

    expect(bobSeenByAlice).toBe(`${subnetOf(ESSID)}.${redrawnOctet}`);
    expect(aliceSeenByBob).toBe(`${subnetOf(ESSID)}.${collidedOctet}`);
    expect(bobSeenByAlice).not.toBe(aliceSeenByBob);
  });

  it('omits an occupant that holds no lease — it has no address to be reached at', async () => {
    const alice = generateIdentity();
    const bob = generateIdentity();
    const rows = [occupant(alice, 'skylab-aaaa'), occupant(bob, 'nebu-bbbb')];
    const { deps } = makeDeps(rows, {
      listLeasesByEssid: async () => ({
        data: [{ owner_key: bob.publicKeyHex, octet: derivedOctet(bob.publicKeyHex, ESSID) }],
        error: null,
      }),
    });

    const result = await handleResolveOccupants(envelope(bob), deps);

    expect(result).toEqual({ status: 200, body: { ok: true, occupants: [] } });
  });

  it('reports a server error when the lease lookup fails — never an invented address', async () => {
    const alice = generateIdentity();
    const bob = generateIdentity();
    const { deps } = makeDeps([occupant(alice, 'skylab-aaaa'), occupant(bob, 'nebu-bbbb')], {
      listLeasesByEssid: vi.fn(async () => ({ data: null, error: new Error('db down') })),
    });

    const result = await handleResolveOccupants(envelope(bob), deps);

    expect(result).toEqual({ status: 500, body: { error: 'leases_lookup_failed' } });
  });

  it('refuses a non-occupant before any lease crosses the wire', async () => {
    const alice = generateIdentity();
    const bob = generateIdentity();
    const { deps, listLeasesByEssid } = makeDeps([occupant(alice, 'skylab-aaaa')]);

    const result = await handleResolveOccupants(envelope(bob), deps);

    expect(result.status).toBe(403);
    expect(listLeasesByEssid).not.toHaveBeenCalled();
  });
});
