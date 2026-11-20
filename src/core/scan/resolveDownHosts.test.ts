import { describe, expect, it, vi } from 'vitest';
import { handleResolveDownHosts, type ResolveDownHostsDeps } from './resolveDownHosts.js';
import { signRequest } from '../signedRequest/sign.js';
import { generateIdentity } from '../identity/identity.js';
import { generateHomeLan, type LanHost } from '../generation/generateHomeLan.js';
import {
  isInnerGateway,
  machineIdForLanHost,
  networkBaseFsForMachineId,
} from '../generation/lanHostIdentity.js';
import { segmentsReachedFrom } from '../generation/lanTopology.js';
import { resolveDeepScanHosts } from './deepScanHosts.js';
import { lanAddressFor, type LanLeaseRow } from '../network/lanAddress.js';
import { md5 } from '../generation/md5.js';
import type { NatOccupantRow } from './resolvePublicScan.js';
import type { MachinePatchRow } from '../findit/webIndex.js';
import type { NonceStore } from '../signedRequest/nonceStore.js';

/**
 * `handleResolveDownHosts` answers the one question a range sweep has about the boxes
 * the access point owns: which of them can no longer boot. Whether a box was bricked is
 * on its server-side journal, so a sweep built from the seeded world alone listed a
 * halted machine as up while a single-host scan of the same address called it down.
 */

const freshStore: NonceStore = async () => ({ fresh: true });

const PLAYER = generateIdentity();

/** A network whose LAN carries an inner gateway as well as the edge `.1` and plain
 *  siblings, so every kind of box the access point owns is on it. */
const ESSID = 'BEAN-THERE-WIFI';
const LAN = generateHomeLan(ESSID);

const hostWhere = (matches: (host: LanHost) => boolean): LanHost => {
  const host = LAN.hosts.find(matches);
  if (host === undefined) throw new Error('expected such a host on the LAN');
  return host;
};

const EDGE_GATEWAY = hostWhere((host) => host.ip === `${LAN.subnet}.1`);
const INNER_GATEWAY = hostWhere(isInnerGateway);
const SIBLING = hostWhere((host) => host.kind === 'machine');

/** A root `rm /boot/vmlinuz` on a machine's own journal — it cannot come up again. */
const kernelDeletedOn = (machineId: string): MachinePatchRow => ({
  machine_id: machineId,
  path: '/boot/vmlinuz',
  content: null,
  owner: 'root',
  permissions: null,
  node_type: null,
  updated_at: '2026-11-20T00:00:00.000Z',
  writer_key: PLAYER.publicKeyHex,
});

const kernelDeleted = (host: LanHost): MachinePatchRow =>
  kernelDeletedOn(machineIdForLanHost(host, ESSID));

/** A harmless write on a box's journal: touched, and still able to boot. */
const noteLeft = (host: LanHost): MachinePatchRow => ({
  ...kernelDeleted(host),
  path: '/tmp/note',
  content: 'was here',
  node_type: 'file',
});

type BatchResult = { data: readonly MachinePatchRow[] | null; error: unknown };

const makeDeps = (
  journal: readonly MachinePatchRow[] = [],
  over: Partial<ResolveDownHostsDeps> = {},
) => {
  const findPatchesForMachines = vi.fn<(ids: readonly string[]) => Promise<BatchResult>>(
    async () => ({ data: journal, error: null }),
  );
  const deps: ResolveDownHostsDeps = {
    nonceStore: freshStore,
    findPatchesForMachines,
    findActiveSession: async () => ({ data: null, error: null }),
    findHomeVantage: async () => ({ data: { essid: ESSID, octet: 50 }, error: null }),
    findWorkstationLease: async () => ({ data: null, error: null }),
    listOccupantsByEssid: async () => ({ data: [], error: null }),
    listLeasesByEssid: async () => ({ data: [], error: null }),
    ...over,
  };
  return { deps, findPatchesForMachines };
};

const envelope = (over: Record<string, unknown> = {}) =>
  signRequest(PLAYER, 'resolveDownHosts', { essid: ESSID, ...over });

describe('handleResolveDownHosts', () => {
  it('names no box on a LAN nobody has bricked, reading every journal in one batch', async () => {
    const { deps, findPatchesForMachines } = makeDeps([noteLeft(SIBLING)]);

    const result = await handleResolveDownHosts(envelope(), deps);

    expect(result).toEqual({ status: 200, body: { ok: true, down: [] } });
    expect(findPatchesForMachines).toHaveBeenCalledTimes(1);
    expect(findPatchesForMachines).toHaveBeenCalledWith(
      LAN.hosts.map((host) => machineIdForLanHost(host, ESSID)),
    );
  });

  it('names a sibling whose kernel was deleted, and only that sibling', async () => {
    const { deps } = makeDeps([kernelDeleted(SIBLING), noteLeft(EDGE_GATEWAY)]);

    const result = await handleResolveDownHosts(envelope(), deps);

    expect(result).toEqual({ status: 200, body: { ok: true, down: [SIBLING.ip] } });
  });

  it('names a bricked gateway, edge or inner, the same way as any other box', async () => {
    const { deps } = makeDeps([kernelDeleted(EDGE_GATEWAY), kernelDeleted(INNER_GATEWAY)]);

    const result = await handleResolveDownHosts(envelope(), deps);

    expect(result.body.down).toEqual(expect.arrayContaining([EDGE_GATEWAY.ip, INNER_GATEWAY.ip]));
    expect(result.body.down).toHaveLength(2);
  });

  it('answers 500 when the journals cannot be read, rather than calling every box up', async () => {
    const { deps } = makeDeps([], {
      findPatchesForMachines: async () => ({ data: null, error: { message: 'connection reset' } }),
    });

    const result = await handleResolveDownHosts(envelope(), deps);

    expect(result).toEqual({ status: 500, body: { error: 'patches_lookup_failed' } });
  });

  it('refuses a caller at home on another network, reading no journal', async () => {
    const { deps, findPatchesForMachines } = makeDeps([], {
      findHomeVantage: async () => ({ data: { essid: 'SOMEWHERE-ELSE', octet: 50 }, error: null }),
    });

    const result = await handleResolveDownHosts(envelope(), deps);

    expect(result).toEqual({ status: 403, body: { error: 'wrong_network' } });
    expect(findPatchesForMachines).not.toHaveBeenCalled();
  });

  it('answers a caller whose shell stands on a box on this LAN — a sweep run from a hop', async () => {
    const { deps } = makeDeps([kernelDeleted(SIBLING)], {
      findActiveSession: async () => ({
        data: { username: 'root', userType: 'root', essid: ESSID },
        error: null,
      }),
      findHomeVantage: async () => ({ data: null, error: null }),
    });

    const result = await handleResolveDownHosts(
      envelope({ caller_machine_id: 'some-box-on-the-lan' }),
      deps,
    );

    expect(result).toEqual({ status: 200, body: { ok: true, down: [SIBLING.ip] } });
  });

  it('rejects a replayed request', async () => {
    const { deps, findPatchesForMachines } = makeDeps([], {
      nonceStore: async () => ({ fresh: false }),
    });

    const result = await handleResolveDownHosts(envelope(), deps);

    expect(result).toEqual({ status: 401, body: { error: 'replay' } });
    expect(findPatchesForMachines).not.toHaveBeenCalled();
  });

  it('rejects an envelope that smuggles a client-supplied player_key', async () => {
    const { deps, findPatchesForMachines } = makeDeps();

    const result = await handleResolveDownHosts(envelope({ player_key: 'attacker' }), deps);

    expect(result.status).toBe(400);
    expect(findPatchesForMachines).not.toHaveBeenCalled();
  });

  it('rejects an envelope missing the essid', async () => {
    const { deps } = makeDeps();

    const result = await handleResolveDownHosts(signRequest(PLAYER, 'resolveDownHosts', {}), deps);

    expect(result.status).toBe(400);
  });

  it('rejects a tampered envelope without reading any journal', async () => {
    const { deps, findPatchesForMachines } = makeDeps();

    const signed = envelope();
    const tampered = { ...signed, payload: `${signed.payload} ` };

    const result = await handleResolveDownHosts(tampered, deps);

    expect(result).toEqual({ status: 401, body: { error: 'signature_invalid' } });
    expect(findPatchesForMachines).not.toHaveBeenCalled();
  });
});

/** A fellow player on the WiFi, at an octet no generated box holds. */
const NEIGHBOUR = generateIdentity();
const NEIGHBOUR_WS = 'workstation-c3d4e5f6';
const FREE_OCTET = Array.from({ length: 200 }, (_unused, index) => index + 20).find(
  (octet) => !LAN.hosts.some((host) => host.ip === lanAddressFor(ESSID, octet)),
);
if (FREE_OCTET === undefined) throw new Error('expected a free octet on the LAN');

const neighbour: NatOccupantRow = {
  owner_key: NEIGHBOUR.publicKeyHex,
  workstation_machine_id: NEIGHBOUR_WS,
  workstation_username: 'neo',
  workstation_root_hash: md5('correct-horse-battery-staple'),
};

/** The neighbour on the WiFi, leased at `octet`. */
const withNeighbourAt = (octet: number): Partial<ResolveDownHostsDeps> => ({
  listOccupantsByEssid: async () => ({ data: [neighbour], error: null }),
  listLeasesByEssid: async () => ({
    data: [{ owner_key: NEIGHBOUR.publicKeyHex, octet }] as readonly LanLeaseRow[],
    error: null,
  }),
});

describe('handleResolveDownHosts — a fellow player on the LAN', () => {
  it("names a fellow player's box that can no longer boot, at the address their lease holds", async () => {
    const { deps } = makeDeps([kernelDeletedOn(NEIGHBOUR_WS)], withNeighbourAt(FREE_OCTET));

    const result = await handleResolveDownHosts(envelope(), deps);

    expect(result).toEqual({
      status: 200,
      body: { ok: true, down: [lanAddressFor(ESSID, FREE_OCTET)] },
    });
  });

  it("does not name a fellow player's box that still boots", async () => {
    const { deps, findPatchesForMachines } = makeDeps([], withNeighbourAt(FREE_OCTET));

    const result = await handleResolveDownHosts(envelope(), deps);

    expect(result).toEqual({ status: 200, body: { ok: true, down: [] } });
    expect(findPatchesForMachines).toHaveBeenCalledWith(expect.arrayContaining([NEIGHBOUR_WS]));
  });

  it('does not ask after a fellow player who holds no address on the LAN', async () => {
    // No lease is no address: there is nowhere on the LAN their box could answer from.
    const { deps, findPatchesForMachines } = makeDeps([kernelDeletedOn(NEIGHBOUR_WS)], {
      listOccupantsByEssid: async () => ({ data: [neighbour], error: null }),
    });

    const result = await handleResolveDownHosts(envelope(), deps);

    expect(result).toEqual({ status: 200, body: { ok: true, down: [] } });
    expect(findPatchesForMachines).not.toHaveBeenCalledWith(
      expect.arrayContaining([NEIGHBOUR_WS]),
    );
  });

  it("does not ask after the caller's own box", async () => {
    const { deps, findPatchesForMachines } = makeDeps([], {
      listOccupantsByEssid: async () => ({
        data: [{ ...neighbour, owner_key: PLAYER.publicKeyHex }],
        error: null,
      }),
      listLeasesByEssid: async () => ({
        data: [{ owner_key: PLAYER.publicKeyHex, octet: FREE_OCTET }],
        error: null,
      }),
    });

    await handleResolveDownHosts(envelope(), deps);

    expect(findPatchesForMachines).not.toHaveBeenCalledWith(expect.arrayContaining([NEIGHBOUR_WS]));
  });

  it('does not name a bricked box the network rolled at an octet a player holds: the player answers there', async () => {
    const octet = Number(SIBLING.ip.split('.')[3]);
    const { deps } = makeDeps([kernelDeleted(SIBLING)], withNeighbourAt(octet));

    const result = await handleResolveDownHosts(envelope(), deps);

    expect(result).toEqual({ status: 200, body: { ok: true, down: [] } });
  });

  it.each([
    [
      'the players on the WiFi',
      { listOccupantsByEssid: async () => ({ data: null, error: 'down' }) },
      'occupants_lookup_failed',
    ],
    [
      'their leases',
      { listLeasesByEssid: async () => ({ data: null, error: 'down' }) },
      'leases_lookup_failed',
    ],
  ] as const)('answers 500 when %s cannot be read', async (_label, failing, error) => {
    const { deps, findPatchesForMachines } = makeDeps([], failing);

    const result = await handleResolveDownHosts(envelope(), deps);

    expect(result).toEqual({ status: 500, body: { error } });
    expect(findPatchesForMachines).not.toHaveBeenCalled();
  });
});

/** The layer the inner gateway fronts, and the boxes on it. */
const INNER_ID = machineIdForLanHost(INNER_GATEWAY, ESSID);
const fronted = segmentsReachedFrom(ESSID, INNER_ID)?.find(
  (segment) => segment.fronting?.machineId === INNER_ID,
)?.fronting;
const innerBase = networkBaseFsForMachineId(ESSID, INNER_ID);
if (fronted == null || innerBase === null)
  throw new Error('expected the inner gateway to front a layer');
const LAYER = resolveDeepScanHosts(ESSID, fronted, innerBase);
const deepBox = LAYER.hosts.find((entry) => entry.host.kind === 'machine');
if (deepBox === undefined) throw new Error('expected a box on the layer');
const DEEP_BOX = deepBox;

/** A shell held on `machineId`, on this network. */
const shellOn = (): Partial<ResolveDownHostsDeps> => ({
  findActiveSession: async () => ({
    data: { username: 'root', userType: 'root', essid: ESSID },
    error: null,
  }),
  findHomeVantage: async () => ({ data: null, error: null }),
});

describe('handleResolveDownHosts — the deep layers the shell reaches', () => {
  it('names a bricked box on the layer a gateway fronts, asked from that gateway', async () => {
    const { deps } = makeDeps([kernelDeletedOn(DEEP_BOX.machineId)], shellOn());

    const result = await handleResolveDownHosts(envelope({ caller_machine_id: INNER_ID }), deps);

    expect(result).toEqual({ status: 200, body: { ok: true, down: [DEEP_BOX.host.ip] } });
  });

  it('names a bricked box on the LAN above, asked from a box deep behind it', async () => {
    const { deps } = makeDeps([kernelDeleted(SIBLING)], shellOn());

    const result = await handleResolveDownHosts(
      envelope({ caller_machine_id: DEEP_BOX.machineId }),
      deps,
    );

    expect(result).toEqual({ status: 200, body: { ok: true, down: [SIBLING.ip] } });
  });

  it('reads no deep box from a shell that reaches no deep layer', async () => {
    const { deps, findPatchesForMachines } = makeDeps([kernelDeletedOn(DEEP_BOX.machineId)]);

    const result = await handleResolveDownHosts(envelope(), deps);

    expect(result).toEqual({ status: 200, body: { ok: true, down: [] } });
    expect(findPatchesForMachines).not.toHaveBeenCalledWith(
      expect.arrayContaining([DEEP_BOX.machineId]),
    );
  });
});
