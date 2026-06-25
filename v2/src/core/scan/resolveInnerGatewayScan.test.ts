import { describe, expect, it, vi } from 'vitest';
import {
  handleResolveInnerGatewayScan,
  type ResolveInnerGatewayScanDeps,
} from './resolveInnerGatewayScan';
import { signRequest } from '../signedRequest/sign';
import { generateIdentity } from '../identity/identity';
import { generateHomeLan, type LanHost } from '../generation/generateHomeLan';
import { generateDeepLayer, seedNetworkDepth } from '../generation/generateDeepLayer';
import type { Identity } from '../commands/types';
import { computeDeepGatewayId, computeInnerGatewayId } from '../identity/router';
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

/** A player whose home is seeded to EXACTLY `depth` layers. Depth is a per-(key, essid)
 *  roll, so pick deterministically rather than hoping a random identity lands at the
 *  depth a test needs. A depth-2 home is the shallowest whose inner router hangs a child
 *  gateway (the forward-to-child test needs the chain door); a depth-1 home hangs none. */
const playerWithNetworkDepth = (depth: number): Identity => {
  const found = Array.from({ length: 96 }, () => generateIdentity()).find(
    (identity) => seedNetworkDepth(identity.publicKeyHex, ESSID) === depth,
  );
  if (found === undefined) throw new Error(`no identity seeds network depth ${depth}`);
  return found;
};
const PLAYER = playerWithNetworkDepth(2);

const octetOf = (host: LanHost): number => Number(host.ip.split('.')[3]);

/** A player whose home is seeded to EXACTLY `depth` layers AND whose entire gateway chain
 *  is routers — every layer hangs a ROUTER child, so the chain runs the full `depth`
 *  gateways deep. The chained-forward tests need this: a switch caps the chain short (it
 *  forwards nothing), so a random depth-N home no longer guarantees N router hops. Picks
 *  deterministically by walking each candidate's seeded chain. */
const playerWithAllRouterChain = (depth: number): Identity => {
  const isAllRouterChain = (identity: Identity): boolean => {
    if (seedNetworkDepth(identity.publicKeyHex, ESSID) !== depth) return false;
    const inner = generateHomeLan(identity.publicKeyHex, ESSID).hosts.find(
      (host) => host.kind === 'router' && octetOf(host) !== 1,
    );
    if (inner === undefined) return false;
    let parentId = computeInnerGatewayId(identity.publicKeyHex, octetOf(inner));
    for (let position = 1; position < depth; position++) {
      const child = generateDeepLayer(
        identity.publicKeyHex,
        ESSID,
        { machineId: parentId, kind: 'router' },
        { hangsChild: true },
      ).childGateway;
      if (child === null || child.kind !== 'router') return false;
      parentId = computeDeepGatewayId(identity.publicKeyHex, parentId, octetOf(child));
    }
    return true;
  };
  const found = Array.from({ length: 400 }, () => generateIdentity()).find(isAllRouterChain);
  if (found === undefined) throw new Error(`no identity seeds an all-router depth-${depth} chain`);
  return found;
};

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
const INNER_GW_ID = computeInnerGatewayId(PLAYER.publicKeyHex, octetOf(INNER));
const DEEP_LAYER = generateDeepLayer(PLAYER.publicKeyHex, ESSID, {
  machineId: INNER_GW_ID,
  kind: 'router',
});
const DEEP_IP = DEEP_LAYER.host.ip;
/** The child gateway hanging on the inner router's deep layer (5b.4a) — a forward to
 *  its `:22` must surface from the upstream scan so a reach to it passes its gate. */
const CHILD = DEEP_LAYER.childGateway;
if (CHILD === null) throw new Error('the inner router deep layer hangs no child gateway');
const CHILD_ID = computeDeepGatewayId(PLAYER.publicKeyHex, INNER_GW_ID, octetOf(CHILD));

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

/** Deps whose journal lookup answers per machine_id (each gateway in a chain has its
 *  own journal), defaulting to an empty journal for any id not listed. */
const perIdDeps = (journals: Record<string, readonly OwnerPatchRow[]>) => {
  const findPatches = vi.fn<(query: { machine_id: string }) => Promise<PatchesResult>>(async (query) => ({
    data: journals[query.machine_id] ?? [],
    error: null,
  }));
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

  it('surfaces the forwarded port when the forward targets the live child gateway', async () => {
    const childForward: OwnerPatchRow = { ...forwardPatch, content: `forward 2223 to ${CHILD.ip}:22` };
    const { deps } = makeDeps(async () => ({ data: [childForward], error: null }));

    const result = await handleResolveInnerGatewayScan(envelope(INNER.ip), deps);

    // The gateway's own :22 PLUS the live forward to the child gateway at :2223.
    expect(result).toEqual({
      status: 200,
      body: {
        ok: true,
        found: true,
        ports: [
          { port: 22, service: 'ssh' },
          { port: 2223, service: 'ssh' },
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

  it('hides the forwarded port when the deep host does not serve the internal port', async () => {
    const portMismatch: OwnerPatchRow = { ...forwardPatch, content: `forward 2222 to ${DEEP_IP}:9999` };
    const { deps } = makeDeps(async () => ({ data: [portMismatch], error: null }));

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

describe('handleResolveInnerGatewayScan — chained forward down a deeper chain', () => {
  // A depth-3 home runs a gateway chain three deep: the inner router fronts an L2 child
  // gateway, which itself fronts an L3 child gateway. TWO chained forwards expose the L3
  // gateway end-to-end — the inner forwards a port to the L2 child, and the L2 child
  // forwards that same port on to the L3 gateway's own sshd. The upstream scan of the
  // inner should surface that chained port only while the WHOLE chain below stays live.
  const DEEP3 = playerWithAllRouterChain(3);
  const deep3Host = (predicate: (host: LanHost) => boolean): LanHost => {
    const host = generateHomeLan(DEEP3.publicKeyHex, ESSID).hosts.find(predicate);
    if (host === undefined) throw new Error('no matching host on the depth-3 LAN');
    return host;
  };
  const INNER3 = deep3Host((host) => host.kind === 'router' && octetOf(host) !== 1);
  const INNER3_ID = computeInnerGatewayId(DEEP3.publicKeyHex, octetOf(INNER3));
  const L2CHILD = generateDeepLayer(
    DEEP3.publicKeyHex,
    ESSID,
    { machineId: INNER3_ID, kind: 'router' },
    { hangsChild: true },
  ).childGateway;
  if (L2CHILD === null) throw new Error('the depth-3 inner router fronts no L2 child gateway');
  const L2CHILD_ID = computeDeepGatewayId(DEEP3.publicKeyHex, INNER3_ID, octetOf(L2CHILD));
  const L3CHILD = generateDeepLayer(
    DEEP3.publicKeyHex,
    ESSID,
    { machineId: L2CHILD_ID, kind: 'router' },
    { hangsChild: true },
  ).childGateway;
  if (L3CHILD === null) throw new Error('the depth-3 L2 child fronts no L3 child gateway');

  const CHAINED_PORT = 2222;
  const innerForward: OwnerPatchRow = {
    path: '/etc/iptables/rules.v4',
    content: `forward ${CHAINED_PORT} to ${L2CHILD.ip}:${CHAINED_PORT}`,
    owner: 'root',
    permissions: null,
    node_type: 'file',
    updated_at: '2026-06-17T00:00:01.000Z',
    writer_key: DEEP3.publicKeyHex,
  };
  const l2ToL3: OwnerPatchRow = { ...innerForward, content: `forward ${CHAINED_PORT} to ${L3CHILD.ip}:22` };
  const l2Brick: OwnerPatchRow = {
    path: '/boot/vmlinuz',
    content: null,
    owner: 'root',
    permissions: null,
    node_type: null,
    updated_at: '2026-06-17T00:00:00.000Z',
    writer_key: DEEP3.publicKeyHex,
  };

  const scanInner3 = (deps: ResolveInnerGatewayScanDeps) =>
    handleResolveInnerGatewayScan(
      signRequest(DEEP3, 'resolveInnerGatewayScan', { essid: ESSID, target: INNER3.ip }),
      deps,
    );

  it('surfaces the chained port through two live forwards', async () => {
    const { deps } = perIdDeps({ [INNER3_ID]: [innerForward], [L2CHILD_ID]: [l2ToL3] });

    const result = await scanInner3(deps);

    expect(result).toEqual({
      status: 200,
      body: {
        ok: true,
        found: true,
        ports: [
          { port: 22, service: 'ssh' },
          { port: CHAINED_PORT, service: 'ssh' },
        ],
      },
    });
  });

  it('hides the chained port when the deeper forward dead-ends at no host', async () => {
    const l2ToNowhere: OwnerPatchRow = { ...innerForward, content: `forward ${CHAINED_PORT} to 10.9.9.9:22` };
    const { deps } = perIdDeps({ [INNER3_ID]: [innerForward], [L2CHILD_ID]: [l2ToNowhere] });

    const result = await scanInner3(deps);

    expect(result).toEqual({
      status: 200,
      body: { ok: true, found: true, ports: [{ port: 22, service: 'ssh' }] },
    });
  });

  it('hides the chained port when the intermediate gateway is bricked', async () => {
    const { deps } = perIdDeps({ [INNER3_ID]: [innerForward], [L2CHILD_ID]: [l2ToL3, l2Brick] });

    const result = await scanInner3(deps);

    expect(result).toEqual({
      status: 200,
      body: { ok: true, found: true, ports: [{ port: 22, service: 'ssh' }] },
    });
  });

  it('reports a server error when the first child journal lookup fails', async () => {
    const findPatches = vi.fn<(query: { machine_id: string }) => Promise<PatchesResult>>(async (query) =>
      query.machine_id === L2CHILD_ID
        ? { data: null, error: new Error('db down') }
        : { data: [innerForward], error: null },
    );
    const deps: ResolveInnerGatewayScanDeps = { nonceStore: freshStore, findPatches };

    const result = await scanInner3(deps);

    expect(result).toEqual({ status: 500, body: { error: 'patches_lookup_failed' } });
  });

  it('reports a server error when a journal lookup fails two layers deep', async () => {
    // The inner reaches the L2 child fine; the BREAK is one layer deeper, where the L2
    // child forwards on to the L3 gateway. The failure must propagate back up the chain
    // as a 500 rather than silently dropping the chained port.
    const findPatches = vi.fn<(query: { machine_id: string }) => Promise<PatchesResult>>(async (query) => {
      if (query.machine_id === INNER3_ID) return { data: [innerForward], error: null };
      if (query.machine_id === L2CHILD_ID) return { data: [l2ToL3], error: null };
      return { data: null, error: new Error('db down') };
    });
    const deps: ResolveInnerGatewayScanDeps = { nonceStore: freshStore, findPatches };

    const result = await scanInner3(deps);

    expect(result).toEqual({ status: 500, body: { error: 'patches_lookup_failed' } });
  });
});

describe('handleResolveInnerGatewayScan — the seeded depth + forward set bound the chain', () => {
  it('hides a chain that steps past the seeded depth onto a third gateway', async () => {
    // PLAYER is depth-2: the inner fronts the L2 child, which fronts a TERMINAL layer. A
    // forward chain pointed at where a deeper home WOULD hang a third gateway reaches
    // nothing — the chained port stays dark.
    const grandchild = generateDeepLayer(
      PLAYER.publicKeyHex,
      ESSID,
      { machineId: CHILD_ID, kind: 'router' },
      { hangsChild: true },
    ).childGateway;
    if (grandchild === null) throw new Error('expected a would-be grandchild gateway to assert absence of');
    const innerToChild: OwnerPatchRow = { ...forwardPatch, content: `forward 2222 to ${CHILD.ip}:2222` };
    const childToGrandchild: OwnerPatchRow = { ...forwardPatch, content: `forward 2222 to ${grandchild.ip}:22` };
    const { deps } = perIdDeps({ [INNER_GW_ID]: [innerToChild], [CHILD_ID]: [childToGrandchild] });

    const result = await handleResolveInnerGatewayScan(envelope(INNER.ip), deps);

    expect(result).toEqual({
      status: 200,
      body: { ok: true, found: true, ports: [{ port: 22, service: 'ssh' }] },
    });
  });

  it('surfaces both an NPC forward and a forward to the child gateway from the same gateway', async () => {
    // A player can expose the Layer-2 NPC AND the chain door at once: two forwards off
    // one gateway, one to each. Both must surface — resolving the child is gated on a
    // forward pointing AT it, not on every forward doing so.
    const twoForwards: OwnerPatchRow = {
      ...forwardPatch,
      content: `forward 2222 to ${DEEP_IP}:22\nforward 2223 to ${CHILD.ip}:22`,
    };
    const { deps } = perIdDeps({ [INNER_GW_ID]: [twoForwards] });

    const result = await handleResolveInnerGatewayScan(envelope(INNER.ip), deps);

    expect(result).toEqual({
      status: 200,
      body: {
        ok: true,
        found: true,
        ports: [
          { port: 22, service: 'ssh' },
          { port: 2222, service: 'ssh' },
          { port: 2223, service: 'ssh' },
        ],
      },
    });
  });

  it('resolves only the chain its forwards reference — an NPC-only forward is unaffected by a broken deep gateway', async () => {
    // The inner forwards only to its own NPC; the child gateway it COULD chain to has a
    // broken journal. Because nothing forwards to the child, the scan never walks down to
    // it, so the broken deep journal cannot turn this into a spurious 500.
    const npcForward: OwnerPatchRow = { ...forwardPatch, content: `forward 2222 to ${DEEP_IP}:22` };
    const findPatches = vi.fn<(query: { machine_id: string }) => Promise<PatchesResult>>(async (query) =>
      query.machine_id === CHILD_ID
        ? { data: null, error: new Error('db down') }
        : { data: [npcForward], error: null },
    );
    const deps: ResolveInnerGatewayScanDeps = { nonceStore: freshStore, findPatches };

    const result = await handleResolveInnerGatewayScan(envelope(INNER.ip), deps);

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
});

describe('handleResolveInnerGatewayScan — depth-1 home (no child gateway to surface)', () => {
  // A depth-1 home's inner router fronts a single TERMINAL layer, so a forward to where a
  // deeper home WOULD hang a child gateway points at a dark target — the upstream scan
  // drops it and reports only the gateway's own :22.
  const SHALLOW = playerWithNetworkDepth(1);
  const shallowHost = (predicate: (host: LanHost) => boolean): LanHost => {
    const host = generateHomeLan(SHALLOW.publicKeyHex, ESSID).hosts.find(predicate);
    if (host === undefined) throw new Error('no matching host on shallow LAN');
    return host;
  };
  const SHALLOW_INNER = shallowHost((host) => host.kind === 'router' && octetOf(host) !== 1);
  const SHALLOW_GATEWAY_ID = computeInnerGatewayId(SHALLOW.publicKeyHex, octetOf(SHALLOW_INNER));
  const WOULD_BE_CHILD = generateDeepLayer(
    SHALLOW.publicKeyHex,
    ESSID,
    { machineId: SHALLOW_GATEWAY_ID, kind: 'router' },
    { hangsChild: true },
  ).childGateway;
  if (WOULD_BE_CHILD === null) throw new Error('expected a would-be child gateway to assert absence of');

  it('hides a forward to the would-be child gateway — only the gateway’s own :22 surfaces', async () => {
    const forwardToWouldBeChild: OwnerPatchRow = {
      path: '/etc/iptables/rules.v4',
      content: `forward 2223 to ${WOULD_BE_CHILD.ip}:22`,
      owner: 'root',
      permissions: null,
      node_type: 'file',
      updated_at: '2026-06-17T00:00:01.000Z',
      writer_key: SHALLOW.publicKeyHex,
    };
    const findPatches = vi.fn<(query: { machine_id: string }) => Promise<PatchesResult>>(async () => ({
      data: [forwardToWouldBeChild],
      error: null,
    }));
    const deps: ResolveInnerGatewayScanDeps = { nonceStore: freshStore, findPatches };

    const result = await handleResolveInnerGatewayScan(
      signRequest(SHALLOW, 'resolveInnerGatewayScan', { essid: ESSID, target: SHALLOW_INNER.ip }),
      deps,
    );

    expect(result).toEqual({
      status: 200,
      body: { ok: true, found: true, ports: [{ port: 22, service: 'ssh' }] },
    });
  });
});
