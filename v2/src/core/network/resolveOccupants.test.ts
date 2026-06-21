import { describe, expect, it, vi } from 'vitest';
import {
  handleResolveOccupants,
  type OccupantListRow,
  type ResolveOccupantsDeps,
} from './resolveOccupants';
import { signRequest } from '../signedRequest/sign';
import { generateIdentity } from '../identity/identity';
import { assignHomeNetwork } from './homeNetwork';
import type { NonceStore } from '../signedRequest/nonceStore';

/**
 * `handleResolveOccupants` answers "who else is on ESSID X?" to a VERIFIED occupant
 * (Story 7, slice 7.2a). The LAN boundary (decision D11) means you must hold a live
 * occupancy row for the ESSID to enumerate it — a non-occupant is refused before any
 * list crosses the wire. The caller is always excluded from its own result, and each
 * returned occupant's LAN IP is RE-DERIVED from `assignHomeNetwork(owner_key, essid)`
 * (server-side, not stored, not client-claimed — `minimize-api-projections`).
 */

const freshStore: NonceStore = async () => ({ fresh: true });
const ESSID = 'BEAN-THERE-WIFI';

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
  const deps: ResolveOccupantsDeps = { nonceStore: freshStore, listOccupantsByEssid, ...over };
  return { deps, listOccupantsByEssid };
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
});
