import { describe, expect, it, vi } from 'vitest';
import { handleNmapScanDeep, type NmapScanDeepDeps } from './nmapScanDeep';
import { signRequest } from '../signedRequest/sign';
import { generateIdentity } from '../identity/identity';
import { generateHomeLan, type LanHost } from '../generation/generateHomeLan';
import { crackableEssidPool } from '../generation/generateWifi';
import { generateDeepLayer } from '../generation/generateDeepLayer';
import { buildDeepHostFs } from '../generation/deepHostFs';
import {
  machineIdForLanHost,
  pivotVantageForMachineId,
  resolveDeepGatewayIdentity,
} from '../generation/lanHostIdentity';
import { hostMachineId } from '../generation/remoteHostId';
import { computeApGatewayId } from '../identity/router';
import { readOpenPorts } from '../services/pidfile';
import { formatNmapScanAggregate, KERN_LOG_OWNER, KERN_LOG_PERMISSIONS } from '../logging/kernLog';
import { asGameTime, asPlayerKeyHex } from '../types';
import type { OwnerPatchRow } from '../network/materializeMachineFs';
import type { MachineLogReadQuery, MachineLogReadResult } from '../patches/appendMachineLog';
import type { PatchRow } from '../patches/upsertPatch';
import type { NonceStore } from '../signedRequest/nonceStore';

/**
 * `handleNmapScanDeep` is the deep-layer counterpart of `handleNmapScan`: a pivot
 * scan from a gateway the shell stands on fires this server side-effect, which
 * REGENERATES the deep `/24` behind the vantage from the essid + the vantage
 * machine_id, then appends ONE aggregate `/var/log/kern.log` line to EACH touched
 * deep host (the terminal NPC, plus the child gateway when the layer hangs one and
 * it is in range). The source is the fronting gateway's downstream `.1`
 * (`${subnet}.1`); the writer is the SCANNER's key, which is provenance — the line
 * records who ran the scan, on a box every occupant of the network shares. The
 * claimed vantage is server-validated: a machine_id that is not a real gateway in
 * the network's chain logs nothing.
 */

const freshStore: NonceStore = async () => ({ fresh: true });
const ESSID = 'BEAN-THERE-WIFI';
// 2026-06-07 14:32:01 UTC — the server clock the kern.log line is stamped with.
const FIXED_NOW = Date.UTC(2026, 5, 7, 14, 32, 1);

// Both the LAN and the chain behind it are the access point's, so what used to be picked
// by searching IDENTITIES is now picked by searching NETWORKS. `ESSID` is a network whose
// inner router fronts a child ROUTER, so a range scan of its deep /24 touches both the
// terminal NPC and the chain door.
//
// A network whose inner router fronts a child SWITCH instead — the case the resolution
// must route through the switch base FS, not the NPC tree (a switch child must never alias
// an NPC).
const switchChildEssid = (): string => {
  const found = crackableEssidPool.find((essid) => {
    const vantage = pivotVantageForMachineId(essid, innerRouterVantage(essid));
    if (vantage === null) return false;
    return (
      generateDeepLayer(
        essid,
        { machineId: vantage.machineId, kind: vantage.kind },
        { hangsChild: vantage.hangsChild },
      ).childGateway?.kind === 'switch'
    );
  });
  if (found === undefined) throw new Error('no network fronts a child switch gateway');
  return found;
};

// Two occupants of one network. Nothing about the world varies with them — that is the
// point: what an identity still decides is whose signature the envelope carries and, for
// the trace, whose scan is being recorded.
const ALICE: ReturnType<typeof generateIdentity> = {
  publicKeyHex: asPlayerKeyHex('c5f198557ddbb348afb472f07b6c6b7f5d5146a9cb7c390e5d5f5bedb107b899'),
  privateKeyHex: 'af99d372e96d0f968f9e3452d970354b937af8dc859c99f7850cb7a6440fa85c',
};
const BOB: ReturnType<typeof generateIdentity> = {
  publicKeyHex: asPlayerKeyHex('71b464730c30a57beb3d9e57dcaff6a758e4d340b4a3aaa3df024b2259d38a89'),
  privateKeyHex: '2810dcd34cd4bfe27a0fdd13877e5fe4e7a621dae1531f65e794944bbaad1364',
};
const CAROL: ReturnType<typeof generateIdentity> = {
  publicKeyHex: asPlayerKeyHex('f906134a8bf63d9f0954fd1730a6b0b45b6b3576914c828821ca779dc3997d83'),
  privateKeyHex: 'e013bbef97df72e994a9833910bd0826723f2a4754ba36674cb07cfd5c49f977',
};

type PatchesResult = { data: readonly OwnerPatchRow[] | null; error: unknown };

const makeDeps = (over: Partial<NmapScanDeepDeps> = {}) => {
  const upsertPatch = vi.fn<(row: PatchRow) => Promise<{ error: unknown }>>(async () => ({
    error: null,
  }));
  const readLog = vi.fn<(query: MachineLogReadQuery) => Promise<MachineLogReadResult>>(
    async () => ({ data: null, error: null }),
  );
  // Default: an empty vantage journal (a freshly generated gateway, no player edits).
  const findPatches = vi.fn<(query: { machine_id: string }) => Promise<PatchesResult>>(
    async () => ({ data: [], error: null }),
  );
  const deps: NmapScanDeepDeps = {
    nonceStore: freshStore,
    now: () => FIXED_NOW,
    readLog,
    upsertPatch,
    findPatches,
    ...over,
  };
  return { deps, upsertPatch, readLog, findPatches };
};

const octetOf = (host: LanHost): number => Number(host.ip.split('.')[3]);

/** The inner ROUTER gateway's machine_id — the pivot vantage whose deep /24 carries
 *  a terminal NPC and (for these deep fixtures) a child gateway. */
const innerRouterVantage = (essid: string = ESSID): string => {
  const inner = generateHomeLan(essid).hosts.find(
    (host) => host.kind === 'router' && octetOf(host) !== 1,
  )!;
  return machineIdForLanHost(inner, essid);
};

/** The inner SWITCH gateway's machine_id — a switch vantage whose deep /24 carries
 *  only a terminal NPC (a switch forwards nothing, so it fronts no child), filtered
 *  by the switch's own `/etc/switch/acl.conf`. */
const innerSwitchVantage = (): string => {
  const device = generateHomeLan(ESSID).hosts.find((host) => host.kind === 'switch')!;
  return machineIdForLanHost(device, ESSID);
};

type ExpectedDeepHost = { host: LanHost; machineId: string; ports: readonly number[] };
type ExpectedDeepLayer = {
  subnet: string;
  sourceIp: string;
  hosts: readonly ExpectedDeepHost[];
};

/** The deep hosts a pivot scan should touch, computed independently from the
 *  generation primitives (the same way `nmapScan.test.ts` derives its expected
 *  lines): the terminal NPC reads its forced-sshd tree, a child gateway reads its
 *  own gateway base FS, and a `deniedPorts` set models a switch vantage's ACL. */
const expectedDeepLayer = (
  essid: string,
  vantageMachineId: string,
  deniedPorts: ReadonlySet<number> = new Set(),
): ExpectedDeepLayer => {
  const vantage = pivotVantageForMachineId(essid, vantageMachineId)!;
  const deep = generateDeepLayer(
    essid,
    { machineId: vantage.machineId, kind: vantage.kind },
    { hangsChild: vantage.hangsChild },
  );
  const layerHosts = deep.childGateway === null ? [deep.host] : [deep.host, deep.childGateway];
  const hosts = layerHosts.map((host) => {
    const identity =
      host.kind === 'machine'
        ? { machineId: hostMachineId(host, essid), baseFs: buildDeepHostFs(essid, host) }
        : resolveDeepGatewayIdentity(vantage.machineId, host.ip, host.kind);
    const ports = readOpenPorts(identity.baseFs)
      .map((port) => port.port)
      .filter((port) => !deniedPorts.has(port));
    return { host, machineId: identity.machineId, ports };
  });
  return { subnet: deep.subnet, sourceIp: `${deep.subnet}.1`, hosts };
};

/** The kern.log line the server should stamp for a scan of `entry` at FIXED_NOW. */
const expectedDeepLine = (sourceIp: string, entry: ExpectedDeepHost): string =>
  formatNmapScanAggregate({
    time: asGameTime(FIXED_NOW),
    hostname: entry.host.hostname,
    sourceIp,
    probedPorts: entry.ports,
  });

/** Locate the upsert call that wrote a trace on the given machine_id (the order is
 *  layer order, but locating by target keeps the assertions robust). */
const traceOn = (
  upsertPatch: ReturnType<typeof makeDeps>['upsertPatch'],
  machineId: string,
): PatchRow | undefined =>
  upsertPatch.mock.calls.map((call) => call[0]).find((row) => row.machine_id === machineId);

const envelope = (
  id: ReturnType<typeof generateIdentity>,
  vantageMachineId: string,
  target: string,
  over: Record<string, unknown> = {},
) =>
  signRequest(id, 'nmapScanDeep', {
    essid: ESSID,
    target,
    vantage_machine_id: vantageMachineId,
    ...over,
  });

/** The boxes one occupant's pivot scan actually touched, as the rows it wrote MINUS the
 *  writer key. The writer key is provenance — which player did the scanning — and is the
 *  one field two occupants scanning one layer are supposed to differ on; everything else
 *  answers "which machines, and what was recorded on them". */
const tracedBoxes = async (
  identity: ReturnType<typeof generateIdentity>,
  vantageMachineId: string,
  target: string,
): Promise<readonly Omit<PatchRow, 'writer_key'>[]> => {
  const { deps, upsertPatch } = makeDeps();
  await handleNmapScanDeep(envelope(identity, vantageMachineId, target), deps);
  return upsertPatch.mock.calls.map(([row]) => {
    const { writer_key: _writerKey, ...touched } = row;
    return touched;
  });
};

describe('handleNmapScanDeep', () => {
  it('reaches one deep layer for every occupant standing on a shared chain door', async () => {
    const vantage = innerRouterVantage();
    // The whole deep /24 behind the door. The chain hangs off a gateway that belongs to
    // the access point, so the same command, from the same door, on the same network must
    // touch the same boxes and record the same lines — whoever runs it.
    const target = `${expectedDeepLayer(ESSID, vantage).subnet}.1-254`;

    const scanned = await tracedBoxes(ALICE, vantage, target);

    expect(scanned.length).toBeGreaterThan(0);
    expect(await tracedBoxes(BOB, vantage, target)).toEqual(scanned);
    expect(await tracedBoxes(CAROL, vantage, target)).toEqual(scanned);
  });

  it('traces every deep host on the inner-router vantage layer (NPC + child gateway)', async () => {
    const vantage = innerRouterVantage();
    const expected = expectedDeepLayer(ESSID, vantage);
    // Fixture premise: this vantage's layer really does hang a child gateway, so the
    // assertion below covers BOTH the NPC and the gateway resolution paths.
    expect(expected.hosts.length).toBe(2);
    const { deps, upsertPatch } = makeDeps();

    const result = await handleNmapScanDeep(
      envelope(ALICE, vantage, `${expected.subnet}.1-254`),
      deps,
    );

    expect(result).toEqual({ status: 200, body: { ok: true, hostsLogged: expected.hosts.length } });
    expect(upsertPatch).toHaveBeenCalledTimes(expected.hosts.length);
    for (const entry of expected.hosts) {
      expect(traceOn(upsertPatch, entry.machineId)).toEqual({
        writer_key: ALICE.publicKeyHex,
        machine_id: entry.machineId,
        path: '/var/log/kern.log',
        content: `${expectedDeepLine(expected.sourceIp, entry)}\n`,
        owner: KERN_LOG_OWNER,
        permissions: KERN_LOG_PERMISSIONS,
        node_type: 'file',
      });
    }
  });

  it('sources every line from the fronting gateway downstream .1, never the home IP', async () => {
    const vantage = innerRouterVantage();
    const expected = expectedDeepLayer(ESSID, vantage);
    const { deps, upsertPatch } = makeDeps();

    await handleNmapScanDeep(envelope(ALICE, vantage, `${expected.subnet}.1-254`), deps);

    for (const call of upsertPatch.mock.calls) {
      expect(call[0].content).toContain(`Port scan from ${expected.subnet}.1 —`);
    }
  });

  it('logs exactly one line for a single-IP scan of the terminal NPC, listing its forced sshd:22', async () => {
    const vantage = innerRouterVantage();
    const expected = expectedDeepLayer(ESSID, vantage);
    const npc = expected.hosts.find((entry) => entry.host.kind === 'machine')!;
    expect(npc.ports).toContain(22);
    const { deps, upsertPatch } = makeDeps();

    const result = await handleNmapScanDeep(envelope(ALICE, vantage, npc.host.ip), deps);

    expect(result.body).toEqual({ ok: true, hostsLogged: 1 });
    expect(upsertPatch).toHaveBeenCalledTimes(1);
    expect(upsertPatch.mock.calls[0]![0].machine_id).toBe(npc.machineId);
    expect(upsertPatch.mock.calls[0]![0].content).toBe(`${expectedDeepLine(expected.sourceIp, npc)}\n`);
    expect(upsertPatch.mock.calls[0]![0].content).toContain('22');
  });

  it('resolves a child SWITCH gateway through its switch base FS, not the NPC tree', async () => {
    // A network whose chain door seeds as a SWITCH rather than a router — which network
    // that is now depends on the ESSID, not on who is looking.
    const essid = switchChildEssid();
    const vantage = innerRouterVantage(essid);
    const expected = expectedDeepLayer(essid, vantage);
    const child = expected.hosts.find((entry) => entry.host.kind === 'switch')!;
    // The child gateway resolves to its octet-keyed deep-gateway id (a switch box),
    // distinct from the coordinate id an NPC at that IP would have taken.
    expect(child.machineId).not.toBe(hostMachineId(child.host, essid));
    const { deps, upsertPatch } = makeDeps();

    await handleNmapScanDeep(envelope(BOB, vantage, child.host.ip, { essid }), deps);

    expect(upsertPatch).toHaveBeenCalledTimes(1);
    expect(upsertPatch.mock.calls[0]![0].machine_id).toBe(child.machineId);
    expect(upsertPatch.mock.calls[0]![0].content).toBe(`${expectedDeepLine(expected.sourceIp, child)}\n`);
  });

  it('appends after the existing log content rather than clobbering it', async () => {
    const vantage = innerRouterVantage();
    const expected = expectedDeepLayer(ESSID, vantage);
    const npc = expected.hosts.find((entry) => entry.host.kind === 'machine')!;
    const { deps, upsertPatch } = makeDeps({
      readLog: vi.fn(async () => ({ data: { content: 'PRIOR LINE\n' }, error: null })),
    });

    await handleNmapScanDeep(envelope(ALICE, vantage, npc.host.ip), deps);

    expect(upsertPatch.mock.calls[0]![0].content).toBe(
      `PRIOR LINE\n${expectedDeepLine(expected.sourceIp, npc)}\n`,
    );
  });

  it('filters a port the switch vantage ACL denies, and re-opens it when the deny is gone', async () => {
    const vantage = innerSwitchVantage();
    const expected = expectedDeepLayer(ESSID, vantage);
    const npc = expected.hosts.find((entry) => entry.host.kind === 'machine')!;
    expect(npc.ports).toContain(22);
    const aclPatch = (content: string): OwnerPatchRow => ({
      path: '/etc/switch/acl.conf',
      content,
      owner: 'root',
      permissions: null,
      node_type: 'file',
      updated_at: '2026-06-19T00:00:00.000Z',
      writer_key: ALICE.publicKeyHex,
    });

    const denied = makeDeps({ findPatches: vi.fn(async () => ({ data: [aclPatch('deny 22')], error: null })) });
    await handleNmapScanDeep(envelope(ALICE, vantage, npc.host.ip), denied.deps);
    expect(traceOn(denied.upsertPatch, npc.machineId)!.content).not.toContain('probed ports 22');

    const opened = makeDeps({ findPatches: vi.fn(async () => ({ data: [aclPatch('deny 9999')], error: null })) });
    await handleNmapScanDeep(envelope(ALICE, vantage, npc.host.ip), opened.deps);
    expect(traceOn(opened.upsertPatch, npc.machineId)!.content).toContain('probed ports 22');
  });

  it('records nothing when the claimed vantage is not a gateway in the caller chain', async () => {
    // The edge .1 router is a real box but NOT a pivot vantage (it fronts no deep layer).
    const edgeId = computeApGatewayId(ESSID);
    const expected = expectedDeepLayer(ESSID, innerRouterVantage());
    const { deps, upsertPatch } = makeDeps();

    const result = await handleNmapScanDeep(
      envelope(ALICE, edgeId, `${expected.subnet}.1-254`),
      deps,
    );

    expect(result).toEqual({ status: 200, body: { ok: true, hostsLogged: 0 } });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('records nothing for a target outside the vantage deep subnet', async () => {
    const vantage = innerRouterVantage();
    const { deps, upsertPatch } = makeDeps();

    const result = await handleNmapScanDeep(envelope(ALICE, vantage, '192.168.29.1-254'), deps);

    expect(result.body).toEqual({ ok: true, hostsLogged: 0 });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('does not fail the action when a per-host log write throws (best-effort)', async () => {
    const vantage = innerRouterVantage();
    const expected = expectedDeepLayer(ESSID, vantage);
    const { deps } = makeDeps({
      upsertPatch: vi.fn(async () => {
        throw new Error('db down');
      }),
    });

    const result = await handleNmapScanDeep(
      envelope(ALICE, vantage, `${expected.subnet}.1-254`),
      deps,
    );

    expect(result).toEqual({ status: 200, body: { ok: true, hostsLogged: expected.hosts.length } });
  });

  it('surfaces a 500 — reading the vantage journal — when the switch vantage lookup errors', async () => {
    const vantage = innerSwitchVantage();
    const expected = expectedDeepLayer(ESSID, vantage);
    const npc = expected.hosts.find((entry) => entry.host.kind === 'machine')!;
    const findPatches = vi.fn(async () => ({ data: null, error: new Error('db down') }));
    const { deps, upsertPatch } = makeDeps({ findPatches });

    const result = await handleNmapScanDeep(envelope(ALICE, vantage, npc.host.ip), deps);

    expect(result).toEqual({ status: 500, body: { error: 'patches_lookup_failed' } });
    // The journal it read is the SWITCH vantage's own (keyed by its machine_id).
    expect(findPatches).toHaveBeenCalledWith({ machine_id: vantage });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('ignores the vantage journal for a ROUTER vantage — a findPatches error does not 500', async () => {
    const vantage = innerRouterVantage();
    const expected = expectedDeepLayer(ESSID, vantage);
    const findPatches = vi.fn(async () => ({ data: null, error: new Error('db down') }));
    const { deps } = makeDeps({ findPatches });

    const result = await handleNmapScanDeep(
      envelope(ALICE, vantage, `${expected.subnet}.1-254`),
      deps,
    );

    // A router forwards rather than filters, so it never reads its journal — the trace
    // stands even when a journal lookup would have failed.
    expect(result).toEqual({ status: 200, body: { ok: true, hostsLogged: expected.hosts.length } });
    expect(findPatches).not.toHaveBeenCalled();
  });

  it('rejects a tampered envelope without writing', async () => {
    const vantage = innerRouterVantage();
    const expected = expectedDeepLayer(ESSID, vantage);
    const signed = envelope(ALICE, vantage, `${expected.subnet}.1-254`);
    const tampered = { ...signed, payload: `${signed.payload} ` };
    const { deps, upsertPatch } = makeDeps();

    const result = await handleNmapScanDeep(tampered, deps);

    expect(result).toEqual({ status: 401, body: { error: 'signature_invalid' } });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('rejects an envelope that smuggles a client-supplied player_key', async () => {
    const vantage = innerRouterVantage();
    const expected = expectedDeepLayer(ESSID, vantage);
    const { deps, upsertPatch } = makeDeps();

    const result = await handleNmapScanDeep(
      envelope(ALICE, vantage, `${expected.subnet}.1-254`, { player_key: 'attacker-key' }),
      deps,
    );

    expect(result.status).toBe(400);
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('rejects an envelope missing the vantage_machine_id field', async () => {
    const { deps, upsertPatch } = makeDeps();

    const result = await handleNmapScanDeep(
      signRequest(ALICE, 'nmapScanDeep', { essid: ESSID, target: '10.0.0.1-254' }),
      deps,
    );

    expect(result.status).toBe(400);
    expect(upsertPatch).not.toHaveBeenCalled();
  });
});
