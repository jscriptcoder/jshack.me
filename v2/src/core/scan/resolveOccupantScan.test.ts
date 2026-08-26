import { describe, expect, it, vi } from 'vitest';
import { handleResolveOccupantScan, type ResolveOccupantScanDeps } from './resolveOccupantScan';
import { signRequest } from '../signedRequest/sign';
import { generateIdentity } from '../identity/identity';
import { lanAddressFor, type LanLeaseRow } from '../network/lanAddress';
import { SERVICE_CATALOG } from '../services/serviceCatalog';
import { formatPidfileContent, pidfilePath } from '../services/pidfile';
import { md5 } from '../generation/md5';
import { asAbsPath } from '../types';
import type { NatOccupantRow } from './resolvePublicScan';
import type { OwnerPatchRow } from '../network/materializeWorkstationFs';
import type { NonceStore } from '../signedRequest/nonceStore';

/**
 * `handleResolveOccupantScan` answers "what is the neighbour at this address actually
 * running?" — the one question an own-LAN `nmap` cannot answer for itself.
 *
 * A generated sibling's ports come off a filesystem keyed on the host IP, so the client
 * can read them from its own seed. A fellow OCCUPANT's cannot: their box is built from
 * their identity and their journal, and reading the octet instead would report the NPC
 * this viewer's dice would have drawn there — somebody else's machine described by
 * somebody else's world.
 *
 * The LAN boundary is the same one the occupant list itself enforces: you learn what is
 * running on a WiFi by being on it. And the three answers stay apart on purpose — a box
 * that will not boot is DOWN, an address nobody occupies is down, and a lookup that
 * fails is a 500 rather than either, because a scan that guesses is worse than a scan
 * that admits it could not ask.
 */

const freshStore: NonceStore = async () => ({ fresh: true });
const ESSID = 'BEAN-THERE-WIFI';

const NEIGHBOUR = generateIdentity();
const NEIGHBOUR_OCTET = 42;
const NEIGHBOUR_IP = lanAddressFor(ESSID, NEIGHBOUR_OCTET);
const NEIGHBOUR_WS = 'workstation-c3d4e5f6';
const CALLER_OCTET = 61;

const neighbourOccupant: NatOccupantRow = {
  owner_key: NEIGHBOUR.publicKeyHex,
  workstation_machine_id: NEIGHBOUR_WS,
  workstation_username: 'neo',
  workstation_root_hash: md5('correct-horse-battery-staple'),
};

const callerOccupant = (callerKey: string): NatOccupantRow => ({
  owner_key: callerKey,
  workstation_machine_id: 'workstation-a1b2c3d4',
  workstation_username: 'trinity',
  workstation_root_hash: md5('a-different-password'),
});

const patchRow = (path: string, content: string | null): OwnerPatchRow => ({
  path: asAbsPath(path),
  content,
  owner: 'root',
  permissions: null,
  node_type: 'file',
  updated_at: '2026-08-09T11:00:00.000Z',
  writer_key: 'b'.repeat(64),
});

/** The neighbour ran `systemctl start redis`; the pidfile record is what a scan reads,
 *  the same source every door checks before it answers. */
const running = (service: (typeof SERVICE_CATALOG)[keyof typeof SERVICE_CATALOG]) =>
  patchRow(pidfilePath(service), formatPidfileContent(service, service.defaultPort));

const makeDeps = (over: Partial<ResolveOccupantScanDeps> = {}) => {
  const findPatches = vi.fn<ResolveOccupantScanDeps['findPatches']>(async () => ({
    data: [running(SERVICE_CATALOG.redis)],
    error: null,
  }));
  const deps: ResolveOccupantScanDeps = {
    nonceStore: freshStore,
    findPatches,
    listOccupantsByEssid: async () => ({ data: [neighbourOccupant], error: null }),
    listLeasesByEssid: async () => ({
      data: [{ owner_key: NEIGHBOUR.publicKeyHex, octet: NEIGHBOUR_OCTET }] as readonly LanLeaseRow[],
      error: null,
    }),
    ...over,
  };
  return { deps, findPatches };
};

/** The caller is on the WiFi too — the ordinary case, since the client only asks this
 *  about an address the occupant list just handed it. */
const asOccupant = (callerKey: string, over: Partial<ResolveOccupantScanDeps> = {}) =>
  makeDeps({
    listOccupantsByEssid: async () => ({
      data: [neighbourOccupant, callerOccupant(callerKey)],
      error: null,
    }),
    listLeasesByEssid: async () => ({
      data: [
        { owner_key: NEIGHBOUR.publicKeyHex, octet: NEIGHBOUR_OCTET },
        { owner_key: callerKey, octet: CALLER_OCTET },
      ] as readonly LanLeaseRow[],
      error: null,
    }),
    ...over,
  });

const scan = async (
  identity: ReturnType<typeof generateIdentity>,
  deps: ResolveOccupantScanDeps,
  target: string = NEIGHBOUR_IP,
) =>
  handleResolveOccupantScan(
    await signRequest(identity, 'resolveOccupantScan', { essid: ESSID, target }),
    deps,
  );

describe('scanning a fellow occupant', () => {
  it('reports what the neighbour is really running, read from their own box', async () => {
    const identity = generateIdentity();
    const { deps } = asOccupant(identity.publicKeyHex);

    const response = await scan(identity, deps);

    expect(response).toEqual({
      status: 200,
      body: {
        ok: true,
        found: true,
        ports: [{ port: SERVICE_CATALOG.redis.defaultPort, service: 'redis' }],
      },
    });
  });

  it('reads the journal of the box the LEASE puts at that address', async () => {
    const identity = generateIdentity();
    const { deps, findPatches } = asOccupant(identity.publicKeyHex);

    await scan(identity, deps);

    // The address of record is the lease, never a derivation from the owner key: a pure
    // function of one identity cannot know what OTHER identities were issued.
    expect(findPatches).toHaveBeenCalledWith({ machine_id: NEIGHBOUR_WS });
  });

  it('reports every daemon the box holds, whatever they are', async () => {
    const identity = generateIdentity();
    const { deps } = asOccupant(identity.publicKeyHex, {
      findPatches: async () => ({
        data: [running(SERVICE_CATALOG.ssh), running(SERVICE_CATALOG.mysql)],
        error: null,
      }),
    });

    const response = await scan(identity, deps);

    // Nothing here is shaped to one door. The pidfile record is the whole answer, so a
    // service added later is scannable the day it can be started.
    expect(response.body).toMatchObject({
      found: true,
      ports: [
        { port: SERVICE_CATALOG.ssh.defaultPort, service: 'ssh' },
        { port: SERVICE_CATALOG.mysql.defaultPort, service: 'mysql' },
      ],
    });
  });

  it('reports a box that will not boot as down rather than as silent', async () => {
    const identity = generateIdentity();
    const { deps } = asOccupant(identity.publicKeyHex, {
      findPatches: async () => ({
        data: [running(SERVICE_CATALOG.redis), patchRow('/boot/vmlinuz', null)],
        error: null,
      }),
    });

    const response = await scan(identity, deps);

    // A stale pidfile outlives the box it describes. The boot gate is what stops a
    // bricked machine advertising the doors it used to hold.
    expect(response).toEqual({ status: 200, body: { ok: true, found: false, ports: [] } });
  });

  it('reports an address no occupant answers to as down', async () => {
    const identity = generateIdentity();
    const { deps, findPatches } = asOccupant(identity.publicKeyHex);

    const response = await scan(identity, deps, lanAddressFor(ESSID, 200));

    // Not a refusal: the caller may simply have asked a beat after the neighbour left.
    // No journal is read for a box nobody is standing on.
    expect(response).toEqual({ status: 200, body: { ok: true, found: false, ports: [] } });
    expect(findPatches).not.toHaveBeenCalled();
  });

  it('never answers about the caller themselves', async () => {
    const identity = generateIdentity();
    const { deps } = asOccupant(identity.publicKeyHex);

    const response = await scan(identity, deps, lanAddressFor(ESSID, CALLER_OCTET));

    // Your own ports are the one thing you can read locally, off the live filesystem
    // the shell is standing on — which shows a daemon started this second, as a
    // round-trip through the journal would not.
    expect(response).toEqual({ status: 200, body: { ok: true, found: false, ports: [] } });
  });

  it('refuses a caller who is not on the WiFi they are asking about', async () => {
    const identity = generateIdentity();
    const { deps, findPatches } = makeDeps();

    const response = await scan(identity, deps);

    // The same boundary the occupant list itself draws. Without it, one signed request
    // per address would enumerate the running services of every player in the game.
    expect(response).toEqual({ status: 403, body: { error: 'not_an_occupant' } });
    expect(findPatches).not.toHaveBeenCalled();
  });

  it('refuses a payload that names its own player key, however well signed', async () => {
    const identity = generateIdentity();
    const { deps } = asOccupant(identity.publicKeyHex);

    const response = await handleResolveOccupantScan(
      await signRequest(identity, 'resolveOccupantScan', {
        essid: ESSID,
        target: NEIGHBOUR_IP,
        player_key: generateIdentity().publicKeyHex,
      }),
      deps,
    );

    // The caller IS the verified pubkey. A request that offers another one is refused
    // outright rather than ignored, because its other fields are not worth trusting.
    expect(response.status).toBe(400);
  });

  it('refuses a request that names no address to scan', async () => {
    const identity = generateIdentity();
    const { deps, findPatches } = asOccupant(identity.publicKeyHex);

    const response = await handleResolveOccupantScan(
      await signRequest(identity, 'resolveOccupantScan', { essid: ESSID }),
      deps,
    );

    // The envelope being signed says who is asking, not that what they asked is
    // answerable. Nothing is read for a request that never named a target.
    expect(response.status).toBe(400);
    expect(findPatches).not.toHaveBeenCalled();
  });

  it('says a lookup failed rather than guessing at the LAN', async () => {
    const identity = generateIdentity();
    const { deps } = asOccupant(identity.publicKeyHex, {
      listOccupantsByEssid: async () => ({ data: null, error: new Error('offline') }),
    });

    const response = await scan(identity, deps);

    expect(response).toEqual({ status: 500, body: { error: 'occupants_lookup_failed' } });
  });

  it('says a lease lookup failed rather than deriving an address', async () => {
    const identity = generateIdentity();
    const { deps } = asOccupant(identity.publicKeyHex, {
      listLeasesByEssid: async () => ({ data: null, error: new Error('offline') }),
    });

    const response = await scan(identity, deps);

    expect(response).toEqual({ status: 500, body: { error: 'leases_lookup_failed' } });
  });

  it('says a journal read failed rather than reporting no ports', async () => {
    const identity = generateIdentity();
    const { deps } = asOccupant(identity.publicKeyHex, {
      findPatches: async () => ({ data: null, error: new Error('offline') }),
    });

    const response = await scan(identity, deps);

    // Reporting an unreadable box as running nothing would be the scan asserting a
    // fact it does not have — and the client renders that as an empty port table.
    expect(response).toEqual({ status: 500, body: { error: 'patches_lookup_failed' } });
  });

  it('reads an answer that carries no rows as nobody being there', async () => {
    const identity = generateIdentity();
    const { deps } = asOccupant(identity.publicKeyHex, {
      listOccupantsByEssid: async () => ({ data: null, error: null }),
    });

    const response = await scan(identity, deps);

    // The shape of "no rows" rather than a state the game reaches: the store answers an
    // empty read with `[]`. Without the fallback the boundary check throws instead.
    expect(response).toEqual({ status: 403, body: { error: 'not_an_occupant' } });
  });

  it('reads a lease answer that carries no rows as nobody being addressed', async () => {
    const identity = generateIdentity();
    const { deps } = asOccupant(identity.publicKeyHex, {
      listLeasesByEssid: async () => ({ data: null, error: null }),
    });

    const response = await scan(identity, deps);

    expect(response).toEqual({ status: 200, body: { ok: true, found: false, ports: [] } });
  });
});
