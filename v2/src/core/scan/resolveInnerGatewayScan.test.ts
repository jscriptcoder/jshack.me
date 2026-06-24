import { describe, expect, it, vi } from 'vitest';
import {
  handleResolveInnerGatewayScan,
  type ResolveInnerGatewayScanDeps,
} from './resolveInnerGatewayScan';
import { signRequest } from '../signedRequest/sign';
import { generateIdentity } from '../identity/identity';
import { generateHomeLan, type LanHost } from '../generation/generateHomeLan';
import { generateDeepLayer } from '../generation/generateDeepLayer';
import { computeInnerGatewayId } from '../identity/router';
import type { OwnerPatchRow } from '../network/materializeWorkstationFs';
import type { NonceStore } from '../signedRequest/nonceStore';

/**
 * `handleResolveInnerGatewayScan` resolves the player's OWN-LAN `nmap` of an inner
 * gateway from the upstream (`external`) vantage — the only place a NAT forward on
 * the gateway is visible. The forward lives in the gateway's server-side journal
 * (`nano rules.v4`), so the scan can't be computed client-side; the server
 * regenerates the gateway from the verified pubkey + essid, replays its journal,
 * and reports its own `sshd:22` plus any live forward via the single `scanResult`
 * total function. The deep layer stays private: nothing here touches the cross-player
 * registry.
 */

const freshStore: NonceStore = async () => ({ fresh: true });
const ESSID = 'BEAN-THERE-WIFI';

const PLAYER = generateIdentity();

const octetOf = (host: LanHost): number => Number(host.ip.split('.')[3]);

const innerGatewayOf = (pubkey: string, essid: string): LanHost => {
  const gateway = generateHomeLan(pubkey, essid).hosts.find(
    (host) => host.kind === 'router' && octetOf(host) !== 1,
  );
  if (gateway === undefined) throw new Error('no inner gateway on LAN');
  return gateway;
};

const hostMatching = (pubkey: string, essid: string, predicate: (host: LanHost) => boolean): LanHost => {
  const host = generateHomeLan(pubkey, essid).hosts.find(predicate);
  if (host === undefined) throw new Error('no matching host on LAN');
  return host;
};

const INNER = innerGatewayOf(PLAYER.publicKeyHex, ESSID);
const EDGE = hostMatching(PLAYER.publicKeyHex, ESSID, (host) => octetOf(host) === 1);
const SIBLING = hostMatching(PLAYER.publicKeyHex, ESSID, (host) => host.kind === 'machine');
const DEEP_IP = generateDeepLayer(PLAYER.publicKeyHex, ESSID, {
  machineId: computeInnerGatewayId(PLAYER.publicKeyHex, octetOf(INNER)),
  kind: 'router',
}).host.ip;

/** A root `nano /etc/iptables/rules.v4` edit on the INNER GATEWAY's journal opening a
 *  NAT forward `2222 → <deep host>:22` — the opt-in that exposes the Layer-2 machine. */
const forwardPatch: OwnerPatchRow = {
  path: '/etc/iptables/rules.v4',
  content: `forward 2222 to ${DEEP_IP}:22`,
  owner: 'root',
  permissions: null,
  node_type: 'file',
  updated_at: '2026-06-17T00:00:01.000Z',
  writer_key: PLAYER.publicKeyHex,
};

/** A root `rm /boot/vmlinuz` tombstone on the gateway journal — replayed over its
 *  seeded base it bricks the gateway, taking the deep entrance dark. */
const bootTombstone: OwnerPatchRow = {
  path: '/boot/vmlinuz',
  content: null,
  owner: 'root',
  permissions: null,
  node_type: null,
  updated_at: '2026-06-17T00:00:00.000Z',
  writer_key: PLAYER.publicKeyHex,
};

type PatchesResult = { data: readonly OwnerPatchRow[] | null; error: unknown };

const makeDeps = (
  patches: (query: { machine_id: string }) => Promise<PatchesResult> = async () => ({
    data: [],
    error: null,
  }),
) => {
  const findPatches = vi.fn<(query: { machine_id: string }) => Promise<PatchesResult>>(patches);
  const deps: ResolveInnerGatewayScanDeps = { nonceStore: freshStore, findPatches };
  return { deps, findPatches };
};

const envelope = (target: string, over: Record<string, unknown> = {}) =>
  signRequest(PLAYER, 'resolveInnerGatewayScan', { essid: ESSID, target, ...over });

describe('handleResolveInnerGatewayScan', () => {
  it("resolves an inner gateway with no forward to its own sshd:22 (deep layer dark)", async () => {
    const { deps, findPatches } = makeDeps();

    const result = await handleResolveInnerGatewayScan(envelope(INNER.ip), deps);

    expect(result).toEqual({
      status: 200,
      body: { ok: true, found: true, ports: [{ port: 22, service: 'ssh' }] },
    });
    // The journal is read off the INNER GATEWAY's own machine id.
    expect(findPatches).toHaveBeenCalledWith({
      machine_id: computeInnerGatewayId(PLAYER.publicKeyHex, octetOf(INNER)),
    });
  });

  it('resolves a SWITCH to its own sshd:22 only — a switch forwards nothing (dark from upstream)', async () => {
    // A switch is the second inner-gateway device type. It has no `rules.v4` at all,
    // so the external-vantage scan finds an empty forward table by construction: its
    // segment is dark from upstream with no forward mechanic to disable.
    const innerSwitch = hostMatching(PLAYER.publicKeyHex, ESSID, (host) => host.kind === 'switch');
    const { deps, findPatches } = makeDeps();

    const result = await handleResolveInnerGatewayScan(envelope(innerSwitch.ip), deps);

    expect(result).toEqual({
      status: 200,
      body: { ok: true, found: true, ports: [{ port: 22, service: 'ssh' }] },
    });
    expect(findPatches).toHaveBeenCalledWith({
      machine_id: computeInnerGatewayId(PLAYER.publicKeyHex, octetOf(innerSwitch)),
    });
  });

  it('surfaces the forwarded deep port when the forward targets the live deep host', async () => {
    const { deps } = makeDeps(async () => ({ data: [forwardPatch], error: null }));

    const result = await handleResolveInnerGatewayScan(envelope(INNER.ip), deps);

    // The gateway's own :22 PLUS the live forward, mapped to its public port :2222.
    expect(result).toEqual({
      status: 200,
      body: {
        ok: true,
        found: true,
        ports: [
          { port: 22, service: 'ssh' },
          { port: 2222, service: 'ssh' },
        ],
      },
    });
  });

  it('hides the forwarded port when it targets an address with no deep host', async () => {
    const deadForward: OwnerPatchRow = { ...forwardPatch, content: 'forward 2222 to 10.9.9.9:22' };
    const { deps } = makeDeps(async () => ({ data: [deadForward], error: null }));

    const result = await handleResolveInnerGatewayScan(envelope(INNER.ip), deps);

    expect(result).toEqual({
      status: 200,
      body: { ok: true, found: true, ports: [{ port: 22, service: 'ssh' }] },
    });
  });

  it('reports a bricked inner gateway (a /boot tombstone on its journal) as host down, no ports', async () => {
    const { deps } = makeDeps(async () => ({ data: [bootTombstone], error: null }));

    const result = await handleResolveInnerGatewayScan(envelope(INNER.ip), deps);

    expect(result).toEqual({ status: 200, body: { ok: true, found: false, ports: [] } });
  });

  it('reports a server error when the gateway journal lookup fails', async () => {
    const { deps } = makeDeps(async () => ({ data: null, error: new Error('db down') }));

    const result = await handleResolveInnerGatewayScan(envelope(INNER.ip), deps);

    expect(result).toEqual({ status: 500, body: { error: 'patches_lookup_failed' } });
  });

  it('reports the edge .1 router as not found (it is not an inner gateway), no journal read', async () => {
    const { deps, findPatches } = makeDeps();

    const result = await handleResolveInnerGatewayScan(envelope(EDGE.ip), deps);

    expect(result).toEqual({ status: 200, body: { ok: true, found: false, ports: [] } });
    expect(findPatches).not.toHaveBeenCalled();
  });

  it('reports an ordinary sibling machine as not found (not an inner gateway), no journal read', async () => {
    const { deps, findPatches } = makeDeps();

    const result = await handleResolveInnerGatewayScan(envelope(SIBLING.ip), deps);

    expect(result).toEqual({ status: 200, body: { ok: true, found: false, ports: [] } });
    expect(findPatches).not.toHaveBeenCalled();
  });

  it('reports a target that is not a host on the LAN as not found', async () => {
    const { deps, findPatches } = makeDeps();

    const result = await handleResolveInnerGatewayScan(envelope('192.168.250.250'), deps);

    expect(result).toEqual({ status: 200, body: { ok: true, found: false, ports: [] } });
    expect(findPatches).not.toHaveBeenCalled();
  });

  it('rejects a tampered envelope without reading any journal', async () => {
    const { deps, findPatches } = makeDeps();
    const signed = envelope(INNER.ip);
    const tampered = { ...signed, payload: `${signed.payload} ` };

    const result = await handleResolveInnerGatewayScan(tampered, deps);

    expect(result).toEqual({ status: 401, body: { error: 'signature_invalid' } });
    expect(findPatches).not.toHaveBeenCalled();
  });

  it('rejects an envelope that smuggles a client-supplied player_key', async () => {
    const { deps, findPatches } = makeDeps();

    const result = await handleResolveInnerGatewayScan(
      envelope(INNER.ip, { player_key: 'attacker' }),
      deps,
    );

    expect(result.status).toBe(400);
    expect(findPatches).not.toHaveBeenCalled();
  });

  it('rejects an envelope missing the target', async () => {
    const { deps } = makeDeps();

    const result = await handleResolveInnerGatewayScan(
      signRequest(PLAYER, 'resolveInnerGatewayScan', { essid: ESSID }),
      deps,
    );

    expect(result.status).toBe(400);
  });
});
