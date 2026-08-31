import { describe, expect, it, vi } from 'vitest';
import {
  handleResolveInnerGatewayScan,
  type ResolveInnerGatewayScanDeps,
} from './resolveInnerGatewayScan';
import { signRequest } from '../signedRequest/sign';
import { generateIdentity } from '../identity/identity';
import { generateHomeLan, type LanHost } from '../generation/generateHomeLan';
import { crackableEssidPool } from '../generation/generateWifi';
import { generateDeepLayer, seedNetworkDepth } from '../generation/generateDeepLayer';
import { computeDeepGatewayId, computeInnerGatewayId } from '../identity/router';
import { hostMachineId } from '../generation/remoteHostId';
import { formatPidfileContent, pidfilePath } from '../services/pidfile';
import { SERVICE_CATALOG } from '../services/serviceCatalog';
import type { OwnerPatchRow } from '../network/materializeWorkstationFs';
import type { NonceStore } from '../signedRequest/nonceStore';

/**
 * `handleResolveInnerGatewayScan` resolves the player's OWN-LAN `nmap` of an inner
 * gateway from the upstream (`external`) vantage — the only place a NAT forward on
 * the gateway is visible. The forward lives in the gateway's server-side journal
 * (`nano rules.v4`), so the scan can't be computed client-side; the server
 * regenerates the gateway from the verified pubkey + essid, replays its journal,
 * and reports its own `sshd:22` plus any live forward via the single `scanResult`
 * total function. The chain regenerates from the ESSID + journals — no cross-player lookup.
 */

const freshStore: NonceStore = async () => ({ fresh: true });
const octetOf = (host: LanHost): number => Number(host.ip.split('.')[3]);

/** A network seeded to EXACTLY `depth` layers. Depth is a per-network roll, so pick
 *  deterministically rather than hoping an arbitrary ESSID lands at the depth a test
 *  needs. A depth-2 network is the shallowest whose inner router hangs a child gateway
 *  (the forward-to-child test needs the chain door); a depth-1 one hangs none. */
const networkWithDepth = (depth: number): string => {
  const found = crackableEssidPool.find((essid) => seedNetworkDepth(essid) === depth);
  if (found === undefined) throw new Error(`no network seeds depth ${depth}`);
  return found;
};

/** A network seeded to EXACTLY `depth` layers AND whose entire gateway chain is routers —
 *  every layer hangs a ROUTER child, so the chain runs the full `depth` gateways deep. The
 *  chained-forward tests need this: a switch caps the chain short (it forwards nothing), so
 *  a depth-N network does not on its own guarantee N router hops. Picks deterministically
 *  by walking each candidate's seeded chain. */
const networkWithAllRouterChain = (depth: number): string => {
  const isAllRouterChain = (essid: string): boolean => {
    if (seedNetworkDepth(essid) !== depth) return false;
    const inner = generateHomeLan(essid).hosts.find(
      (host) => host.kind === 'router' && octetOf(host) !== 1,
    );
    if (inner === undefined) return false;
    let parentId = computeInnerGatewayId(essid, octetOf(inner));
    for (let position = 1; position < depth; position++) {
      const child = generateDeepLayer(
        essid,
        { machineId: parentId, kind: 'router' },
        { hangsChild: true },
      ).childGateway;
      if (child === null || child.kind !== 'router') return false;
      parentId = computeDeepGatewayId(parentId, octetOf(child));
    }
    return true;
  };
  const found = crackableEssidPool.find(isAllRouterChain);
  if (found === undefined) throw new Error(`no network seeds an all-router depth-${depth} chain`);
  return found;
};

// The network under test: depth 2, so its inner router fronts a child gateway which in
// turn fronts a TERMINAL layer — the shape most of these tests reason about.
const ESSID = networkWithDepth(2);
// The acting player. The world no longer varies with an identity; what a signer still
// decides is whose signature the envelope carries.
const PLAYER = generateIdentity();

const innerGatewayOf = ( essid: string): LanHost => {
  const gateway = generateHomeLan(essid).hosts.find(
    (host) => host.kind === 'router' && octetOf(host) !== 1,
  );
  if (gateway === undefined) throw new Error('no inner gateway on LAN');
  return gateway;
};

const hostMatching = ( essid: string, predicate: (host: LanHost) => boolean): LanHost => {
  const host = generateHomeLan(essid).hosts.find(predicate);
  if (host === undefined) throw new Error('no matching host on LAN');
  return host;
};

const INNER = innerGatewayOf( ESSID);
const EDGE = hostMatching( ESSID, (host) => octetOf(host) === 1);
const SIBLING = hostMatching( ESSID, (host) => host.kind === 'machine');
const INNER_GW_ID = computeInnerGatewayId(ESSID, octetOf(INNER));
const DEEP_LAYER = generateDeepLayer(ESSID, {
  machineId: INNER_GW_ID,
  kind: 'router',
});
const DEEP_IP = DEEP_LAYER.host.ip;
const DEEP_HOST_ID = hostMachineId(DEEP_LAYER.host, ESSID);

/** A row on the DEEP BOX's own journal — what a player left behind after rooting it.
 *  Which machine it is filed against is part of the claim: the gateway carried the
 *  packet and ran nothing. */
const deepPatchRow = (path: string, content: string | null): OwnerPatchRow => ({
  path,
  content,
  owner: 'root',
  permissions: null,
  node_type: content === null ? null : 'file',
  updated_at: '2026-08-26T00:00:00.000Z',
  writer_key: PLAYER.publicKeyHex,
});
/** The child gateway hanging on the inner router's deep layer (5b.4a) — a forward to
 *  its `:22` must surface from the upstream scan so a reach to it passes its gate. */
const CHILD = DEEP_LAYER.childGateway;
if (CHILD === null) throw new Error('the inner router deep layer hangs no child gateway');
const CHILD_ID = computeDeepGatewayId(INNER_GW_ID, octetOf(CHILD));

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

/** The two doors an inner gateway or switch in these fixtures bears: the shell every
 *  gateway runs by design, and the SNMP agent this one rolled. Both are seeded, so both
 *  are fixed — the RATE that decides the second is measured across a population in
 *  `routerFs.test.ts`, not here. */
const SSH_22 = { port: 22, service: 'ssh' };
const SNMP_161 = { port: 161, service: 'snmp' };

describe('handleResolveInnerGatewayScan', () => {
  it("resolves an inner gateway with no forward to its own sshd:22 (deep layer dark)", async () => {
    const { deps, findPatches } = makeDeps();

    const result = await handleResolveInnerGatewayScan(envelope(INNER.ip), deps);

    expect(result).toEqual({
      status: 200,
      body: { ok: true, found: true, ports: [SSH_22, SNMP_161] },
    });
    // The journal is read off the INNER GATEWAY's own machine id.
    expect(findPatches).toHaveBeenCalledWith({
      machine_id: computeInnerGatewayId(ESSID, octetOf(INNER)),
    });
  });

  it('resolves a SWITCH to its own sshd:22 only — a switch forwards nothing (dark from upstream)', async () => {
    // A switch is the second inner-gateway device type. It has no `rules.v4` at all,
    // so the external-vantage scan finds an empty forward table by construction: its
    // segment is dark from upstream with no forward mechanic to disable.
    const innerSwitch = hostMatching( ESSID, (host) => host.kind === 'switch');
    const { deps, findPatches } = makeDeps();

    const result = await handleResolveInnerGatewayScan(envelope(innerSwitch.ip), deps);

    expect(result).toEqual({
      status: 200,
      body: { ok: true, found: true, ports: [SSH_22, SNMP_161] },
    });
    expect(findPatches).toHaveBeenCalledWith({
      machine_id: computeInnerGatewayId(ESSID, octetOf(innerSwitch)),
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
          SSH_22,
          SNMP_161,
          { port: 2222, service: 'ssh' },
        ],
      },
    });
  });

  it('drops a forwarded port whose daemon the player STOPPED on the deep box', async () => {
    const { deps } = perIdDeps({
      [INNER_GW_ID]: [forwardPatch],
      [DEEP_HOST_ID]: [deepPatchRow(pidfilePath(SERVICE_CATALOG.ssh), null)],
    });

    const result = await handleResolveInnerGatewayScan(envelope(INNER.ip), deps);

    // The terminal box's ports used to come straight off its regenerated tree, so a
    // daemon a player stopped down there went on being advertised — a scan promising a
    // door the reach then refuses.
    expect(result).toEqual({
      status: 200,
      body: { ok: true, found: true, ports: [SSH_22, SNMP_161] },
    });
  });

  it('drops a forwarded port the deep box has DENIED in its own filter', async () => {
    const { deps } = perIdDeps({
      [INNER_GW_ID]: [forwardPatch],
      [DEEP_HOST_ID]: [
        deepPatchRow('/etc/iptables/rules.v4', `deny ${SERVICE_CATALOG.ssh.defaultPort}`),
      ],
    });

    const result = await handleResolveInnerGatewayScan(envelope(INNER.ip), deps);

    // The daemon is still running down there — the box refuses the network instead of
    // stopping the service, and the box that TERMINATES the forwarded traffic is the one
    // whose filter governs it. The reach already answers this port as though nothing were
    // serving, so a scan still listing it would promise a door the chain refuses.
    expect(result).toEqual({
      status: 200,
      body: { ok: true, found: true, ports: [SSH_22, SNMP_161] },
    });
  });

  it('advertises nothing for a deep box bricked through its own journal', async () => {
    const { deps } = perIdDeps({
      [INNER_GW_ID]: [forwardPatch],
      [DEEP_HOST_ID]: [bootTombstone],
    });

    const result = await handleResolveInnerGatewayScan(envelope(INNER.ip), deps);

    // A box that cannot boot has no doors, and the reach already refuses it. A scan
    // still listing its port would send a player at something that is dark.
    expect(result).toEqual({
      status: 200,
      body: { ok: true, found: true, ports: [SSH_22, SNMP_161] },
    });
  });

  it('reports a deep box whose journal could not be READ as a server fault', async () => {
    const findPatches = vi.fn<(query: { machine_id: string }) => Promise<PatchesResult>>(
      async ({ machine_id }) =>
        machine_id === DEEP_HOST_ID
          ? { data: null, error: { message: 'boom' } }
          : { data: [forwardPatch], error: null },
    );
    const deps: ResolveInnerGatewayScanDeps = { nonceStore: freshStore, findPatches };

    const result = await handleResolveInnerGatewayScan(envelope(INNER.ip), deps);

    // Not an empty port list: a scan that reports nothing found tells a player the layer
    // is bare, and they would stop looking at a network that is fine.
    expect(result).toEqual({ status: 500, body: { error: 'patches_lookup_failed' } });
  });

  it('follows a daemon the player MOVED on the deep box to its new port', async () => {
    const moved = 2022;
    const movedForward: OwnerPatchRow = {
      ...forwardPatch,
      content: `forward 2222 to ${DEEP_IP}:${moved}`,
    };
    const { deps } = perIdDeps({
      [INNER_GW_ID]: [movedForward],
      [DEEP_HOST_ID]: [
        deepPatchRow(
          pidfilePath(SERVICE_CATALOG.ssh),
          formatPidfileContent(SERVICE_CATALOG.ssh, moved),
        ),
      ],
    });

    const result = await handleResolveInnerGatewayScan(envelope(INNER.ip), deps);

    // The other direction: a forward pointing where the daemon actually is now was dark
    // to the scan, because the seeded tree still had it on its old port.
    expect(result).toEqual({
      status: 200,
      body: {
        ok: true,
        found: true,
        ports: [
          SSH_22,
          SNMP_161,
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
          SSH_22,
          SNMP_161,
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
      body: { ok: true, found: true, ports: [SSH_22, SNMP_161] },
    });
  });

  it('hides the forwarded port when the deep host does not serve the internal port', async () => {
    const portMismatch: OwnerPatchRow = { ...forwardPatch, content: `forward 2222 to ${DEEP_IP}:9999` };
    const { deps } = makeDeps(async () => ({ data: [portMismatch], error: null }));

    const result = await handleResolveInnerGatewayScan(envelope(INNER.ip), deps);

    expect(result).toEqual({
      status: 200,
      body: { ok: true, found: true, ports: [SSH_22, SNMP_161] },
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

  it('reports a server error when only the GATEWAY OWN journal fails, reading nothing from it', async () => {
    const { deps } = makeDeps(async ({ machine_id }) =>
      machine_id === INNER_GW_ID
        ? { data: null, error: new Error('db down') }
        : { data: [], error: null },
    );

    const result = await handleResolveInnerGatewayScan(envelope(INNER.ip), deps);

    // A journal that cannot be read is never treated as an empty one. Without this the
    // gateway would materialize from its SEED and the scan would answer 200 with the
    // ports it was born with, describing a box whose real state nobody could see — the
    // same reason every other lookup here fails loudly rather than falling back.
    //
    // The sibling test fails EVERY read, so a guard further down the chain produces the
    // identical 500 and cannot tell the two apart. Only the gateway's own read fails
    // here, which is what makes the guard at the top load-bearing.
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
  // A depth-3 network runs a gateway chain three deep: the inner router fronts an L2 child
  // gateway, which itself fronts an L3 child gateway. TWO chained forwards expose the L3
  // gateway end-to-end — the inner forwards a port to the L2 child, and the L2 child
  // forwards that same port on to the L3 gateway's own sshd. The upstream scan of the
  // inner should surface that chained port only while the WHOLE chain below stays live.
  const ESSID3 = networkWithAllRouterChain(3);
  const deep3Host = (predicate: (host: LanHost) => boolean): LanHost => {
    const host = generateHomeLan(ESSID3).hosts.find(predicate);
    if (host === undefined) throw new Error('no matching host on the depth-3 LAN');
    return host;
  };
  const INNER3 = deep3Host((host) => host.kind === 'router' && octetOf(host) !== 1);
  const INNER3_ID = computeInnerGatewayId(ESSID3, octetOf(INNER3));
  const L2CHILD = generateDeepLayer(
    ESSID3,
    { machineId: INNER3_ID, kind: 'router' },
    { hangsChild: true },
  ).childGateway;
  if (L2CHILD === null) throw new Error('the depth-3 inner router fronts no L2 child gateway');
  const L2CHILD_ID = computeDeepGatewayId(INNER3_ID, octetOf(L2CHILD));
  const L3CHILD = generateDeepLayer(
    ESSID3,
    { machineId: L2CHILD_ID, kind: 'router' },
    { hangsChild: true },
  ).childGateway;
  if (L3CHILD === null) throw new Error('the depth-3 L2 child fronts no L3 child gateway');

  const L3CHILD_ID = computeDeepGatewayId(L2CHILD_ID, octetOf(L3CHILD));

  const CHAINED_PORT = 2222;
  const innerForward: OwnerPatchRow = {
    path: '/etc/iptables/rules.v4',
    content: `forward ${CHAINED_PORT} to ${L2CHILD.ip}:${CHAINED_PORT}`,
    owner: 'root',
    permissions: null,
    node_type: 'file',
    updated_at: '2026-06-17T00:00:01.000Z',
    writer_key: PLAYER.publicKeyHex,
  };
  const l2ToL3: OwnerPatchRow = { ...innerForward, content: `forward ${CHAINED_PORT} to ${L3CHILD.ip}:22` };
  const l2Brick: OwnerPatchRow = {
    path: '/boot/vmlinuz',
    content: null,
    owner: 'root',
    permissions: null,
    node_type: null,
    updated_at: '2026-06-17T00:00:00.000Z',
    writer_key: PLAYER.publicKeyHex,
  };

  const scanInner3 = (deps: ResolveInnerGatewayScanDeps) =>
    handleResolveInnerGatewayScan(
      signRequest(PLAYER, 'resolveInnerGatewayScan', { essid: ESSID3, target: INNER3.ip }),
      deps,
    );

  it('reports a server error when a journal fails BELOW the child, never a dark chained port', async () => {
    const { deps } = makeDeps(async ({ machine_id }) => {
      if (machine_id === L3CHILD_ID) return { data: null, error: new Error('db down') };
      if (machine_id === INNER3_ID) return { data: [innerForward], error: null };
      if (machine_id === L2CHILD_ID) return { data: [l2ToL3], error: null };
      return { data: [], error: null };
    });

    const result = await scanInner3(deps);

    // The failure happens a layer below the child, so it comes back OUT of the recursion
    // rather than off the hop itself. Left to fall through, the failed layer would land
    // in the map as an absent entry, the chained port would drop, and a database blip
    // would render as a defender's box having gone quiet — a player reading their own
    // infrastructure failing as somebody else's door closing.
    //
    // Every neighbouring failure test fails EVERY read, so a guard nearer the top returns
    // the identical 500 and none of them can tell this one apart.
    expect(result).toEqual({ status: 500, body: { error: 'patches_lookup_failed' } });
  });

  it('surfaces the chained port through two live forwards', async () => {
    const { deps } = perIdDeps({ [INNER3_ID]: [innerForward], [L2CHILD_ID]: [l2ToL3] });

    const result = await scanInner3(deps);

    expect(result).toEqual({
      status: 200,
      body: {
        ok: true,
        found: true,
        ports: [
          SSH_22,
          SNMP_161,
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
      body: { ok: true, found: true, ports: [SSH_22, SNMP_161] },
    });
  });

  it('hides the chained port when the intermediate gateway is bricked', async () => {
    const { deps } = perIdDeps({ [INNER3_ID]: [innerForward], [L2CHILD_ID]: [l2ToL3, l2Brick] });

    const result = await scanInner3(deps);

    expect(result).toEqual({
      status: 200,
      body: { ok: true, found: true, ports: [SSH_22, SNMP_161] },
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
      body: { ok: true, found: true, ports: [SSH_22, SNMP_161] },
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
          SSH_22,
          SNMP_161,
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
          SSH_22,
          SNMP_161,
          { port: 2222, service: 'ssh' },
        ],
      },
    });
  });
});

describe('handleResolveInnerGatewayScan — a depth-1 network (no child gateway to surface)', () => {
  // A depth-1 network's inner router fronts a single TERMINAL layer, so a forward to where
  // a deeper one WOULD hang a child gateway points at a dark target — the upstream scan
  // drops it and reports only the gateway's own :22.
  const SHALLOW_ESSID = networkWithDepth(1);
  const shallowHost = (predicate: (host: LanHost) => boolean): LanHost => {
    const host = generateHomeLan(SHALLOW_ESSID).hosts.find(predicate);
    if (host === undefined) throw new Error('no matching host on shallow LAN');
    return host;
  };
  const SHALLOW_INNER = shallowHost((host) => host.kind === 'router' && octetOf(host) !== 1);
  const SHALLOW_GATEWAY_ID = computeInnerGatewayId(SHALLOW_ESSID, octetOf(SHALLOW_INNER));
  const WOULD_BE_CHILD = generateDeepLayer(
    SHALLOW_ESSID,
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
      writer_key: PLAYER.publicKeyHex,
    };
    const findPatches = vi.fn<(query: { machine_id: string }) => Promise<PatchesResult>>(async () => ({
      data: [forwardToWouldBeChild],
      error: null,
    }));
    const deps: ResolveInnerGatewayScanDeps = { nonceStore: freshStore, findPatches };

    const result = await handleResolveInnerGatewayScan(
      signRequest(PLAYER, 'resolveInnerGatewayScan', { essid: SHALLOW_ESSID, target: SHALLOW_INNER.ip }),
      deps,
    );

    expect(result).toEqual({
      status: 200,
      body: { ok: true, found: true, ports: [SSH_22, SNMP_161] },
    });
  });
});
