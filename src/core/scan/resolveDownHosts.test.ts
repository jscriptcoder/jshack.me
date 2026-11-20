import { describe, expect, it, vi } from 'vitest';
import { handleResolveDownHosts, type ResolveDownHostsDeps } from './resolveDownHosts.js';
import { signRequest } from '../signedRequest/sign.js';
import { generateIdentity } from '../identity/identity.js';
import { generateHomeLan, type LanHost } from '../generation/generateHomeLan.js';
import { isInnerGateway, machineIdForLanHost } from '../generation/lanHostIdentity.js';
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

/** A root `rm /boot/vmlinuz` on a box's own journal — the box cannot come up again. */
const kernelDeleted = (host: LanHost): MachinePatchRow => ({
  machine_id: machineIdForLanHost(host, ESSID),
  path: '/boot/vmlinuz',
  content: null,
  owner: 'root',
  permissions: null,
  node_type: null,
  updated_at: '2026-11-20T00:00:00.000Z',
  writer_key: PLAYER.publicKeyHex,
});

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
