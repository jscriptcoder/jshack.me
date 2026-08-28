import { describe, expect, it, vi } from 'vitest';
import { handleSnmpWalk, type SnmpWalkDeps } from './snmpWalk';
import { signRequest } from '../signedRequest/sign';
import { generateIdentity } from '../identity/identity';
import { generateHomeLan, type LanHost } from '../generation/generateHomeLan';
import { generateDeepLayer, seedNetworkDepth } from '../generation/generateDeepLayer';
import { crackableEssidPool } from '../generation/generateWifi';
import { computeDeepGatewayId, computeInnerGatewayId } from '../identity/router';
import { buildDeepGatewayBaseFs, buildDeepSwitchBaseFs } from '../generation/routerFs';
import { resolveLanHostIdentity } from '../generation/lanHostIdentity';
import { readOpenPorts } from '../services/pidfile';
import { SERVICE_CATALOG } from '../services/serviceCatalog';
import { SNMPD_LOG_PATH } from '../logging/snmpdLog';
import { asAbsPath } from '../types';
import type { Directory } from '../filesystem/types';
import type { OwnerPatchRow } from '../network/materializeMachineFs';
import type { MachineLogReadQuery, MachineLogReadResult } from '../patches/appendMachineLog';
import type { PatchRow } from '../patches/upsertPatch';
import type { NonceStore } from '../signedRequest/nonceStore';

/**
 * Walking a device on the HIDDEN LAYER behind an inner gateway.
 *
 * The address a player types here names the gateway, and the PORT names the box behind
 * it — through a forward, that is the whole of how a hidden device is named at all.
 * Everything the walk then reports has to be the device's rather than the gateway's:
 * its hostname, its own address, and a log line stamped from the address the box
 * actually saw the request arrive from, which through NAT is the fronting gateway's
 * `.1` and never the player's own.
 *
 * A device behind a forward is a CHILD GATEWAY. The NPC on a deep layer is a
 * workstation, and a workstation never rolls an agent — so the only thing down there
 * worth walking is the router or switch that fronts the next layer down.
 */

const freshStore: NonceStore = async () => ({ fresh: true });
// 2026-08-09 11:04:07 UTC — the server clock every log line here is stamped with.
const FIXED_NOW = Date.UTC(2026, 7, 9, 11, 4, 7);
const CLIENT_IP = '192.168.1.50';
const PUBLIC_IP = '203.0.113.42';
/** The port the gateway's owner opened onto the device — any port but the gateway's
 *  own, since that one names the gateway itself. */
const FORWARDED_PORT = 2222;

const octetOf = (host: LanHost): number => Number(host.ip.split('.')[3]);

const runsAgent = (fs: Directory): boolean =>
  readOpenPorts(fs).some((openPort) => openPort.service === SERVICE_CATALOG.snmp.service);

/** An inner gateway whose deep layer hangs a child gateway that rolled an agent, found
 *  by walking the seeded worlds rather than pinned to one ESSID — the roll is per
 *  device, so a fixed world would make this suite depend on a coin flip. */
const deepDevice = (): {
  readonly essid: string;
  readonly gateway: LanHost;
  readonly gatewayId: string;
  readonly device: LanHost;
  readonly deviceId: string;
  readonly subnet: string;
} => {
  for (const essid of crackableEssidPool) {
    if (seedNetworkDepth(essid) < 2) continue;
    const gateway = generateHomeLan(essid).hosts.find(
      (host) => host.kind === 'router' && octetOf(host) !== 1,
    );
    if (gateway === undefined) continue;
    const gatewayId = computeInnerGatewayId(essid, octetOf(gateway));
    const deep = generateDeepLayer(essid, { machineId: gatewayId, kind: 'router' });
    const device = deep.childGateway;
    if (device === null) continue;
    const deviceOctet = octetOf(device);
    const baseFs =
      device.kind === 'switch'
        ? buildDeepSwitchBaseFs(gatewayId, deviceOctet)
        : buildDeepGatewayBaseFs(gatewayId, deviceOctet);
    if (!runsAgent(baseFs)) continue;
    return {
      essid,
      gateway,
      gatewayId,
      device,
      deviceId: computeDeepGatewayId(gatewayId, deviceOctet),
      subnet: deep.subnet,
    };
  }
  throw new Error('no seeded world hangs a child gateway running an SNMP agent');
};

const DEEP = deepDevice();
const PLAYER = generateIdentity();

const patchRow = (path: string, content: string): OwnerPatchRow =>
  ({
    path: asAbsPath(path),
    content,
    owner: 'root',
    permissions: null,
    node_type: 'file',
    updated_at: '2026-08-09T11:00:00.000Z',
    writer_key: 'b'.repeat(64),
  }) as OwnerPatchRow;

/** The gateway owner's own `nano` edit, opening a forward onto the device's agent. */
const forwardTo = (destination: string): OwnerPatchRow =>
  patchRow('/etc/iptables/rules.v4', `forward ${FORWARDED_PORT} to ${destination}`);

const makeDeps = (gatewayPatches: readonly OwnerPatchRow[]) => {
  const upsertPatch = vi.fn<(row: PatchRow) => Promise<{ error: unknown }>>(async () => ({
    error: null,
  }));
  const readSnmpdLog = vi.fn<(query: MachineLogReadQuery) => Promise<MachineLogReadResult>>(
    async () => ({ data: null, error: null }),
  );
  const deps: SnmpWalkDeps = {
    nonceStore: freshStore,
    now: () => FIXED_NOW,
    // Keyed by machine, because the chain reads two journals: the gateway's, for the
    // forward it routes by, and the device's own.
    findPatches: async ({ machine_id }) => ({
      data: machine_id === DEEP.gatewayId ? [...gatewayPatches] : [],
      error: null,
    }),
    readSnmpdLog,
    upsertPatch,
    findPublicIpByEssid: async () => ({ data: { public_ip: PUBLIC_IP }, error: null }),
    findNetworkByPublicIp: async () => ({ data: null, error: null }),
    listOccupantsByEssid: async () => ({ data: [], error: null }),
    listLeasesByEssid: async () => ({ data: [], error: null }),
    findHomeNetworkByOwnerKey: async () => ({ data: null, error: null }),
  };
  return { deps, upsertPatch };
};

const walk = (request: { readonly port?: number; readonly community?: string } = {}) =>
  signRequest(PLAYER, 'snmpWalk', {
    essid: DEEP.essid,
    target_ip: DEEP.gateway.ip,
    port: request.port ?? FORWARDED_PORT,
    community: request.community ?? 'public',
    source_ip: CLIENT_IP,
  });

const snmpdLogWrites = (upsertPatch: ReturnType<typeof makeDeps>['upsertPatch']) =>
  upsertPatch.mock.calls.map(([row]) => row).filter((row) => row.path === SNMPD_LOG_PATH);

describe('walking a device behind an inner gateway', () => {
  it('answers as the device the forward reaches, not as the gateway addressed', async () => {
    const { deps } = makeDeps([forwardTo(`${DEEP.device.ip}:161`)]);

    const response = await handleSnmpWalk(await walk(), deps);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ok: true,
      identity: { hostname: DEEP.device.hostname, kind: DEEP.device.kind },
    });
    expect(response.body).not.toMatchObject({ identity: { hostname: DEEP.gateway.hostname } });
  });

  it('reports the address the device holds, never the one the player typed', async () => {
    // The typed address belongs to the GATEWAY. A walk that echoed it back would name a
    // box on the LAN while describing one two hops away, and the player would have no
    // way to tell the two apart.
    const { deps } = makeDeps([forwardTo(`${DEEP.device.ip}:161`)]);

    const response = await handleSnmpWalk(await walk(), deps);

    expect(response.body).toMatchObject({ identity: { addresses: [DEEP.device.ip] } });
  });

  it('stamps the log with the address the device saw, which through NAT is the gateway', async () => {
    // A deep box is shown the fronting gateway's downstream `.1` and nothing else. The
    // player's own LAN address never reaches it, so a log line carrying that address
    // would be evidence of a request the device never received.
    const { deps, upsertPatch } = makeDeps([forwardTo(`${DEEP.device.ip}:161`)]);

    await handleSnmpWalk(await walk(), deps);

    const [logWrite] = snmpdLogWrites(upsertPatch);
    expect(logWrite?.machine_id).toBe(DEEP.deviceId);
    expect(logWrite?.content).toContain(`${DEEP.subnet}.1`);
    expect(logWrite?.content).not.toContain(CLIENT_IP);
  });

  it('is silent when the forward lands somewhere other than the agent', async () => {
    // A forward to sshd is a door to a shell, not to the agent behind it. The port
    // reached has to be the one the daemon holds, or every forward on a box would be a
    // door to every daemon on it.
    const { deps } = makeDeps([forwardTo(`${DEEP.device.ip}:22`)]);

    const response = await handleSnmpWalk(await walk(), deps);

    expect(response.status).toBe(404);
  });

  it('is silent on a port the gateway neither listens on nor forwards', async () => {
    const { deps } = makeDeps([]);

    const response = await handleSnmpWalk(await walk(), deps);

    expect(response.status).toBe(404);
  });
});

/** An inner gateway that answers SNMP at its OWN address — the device a player meets
 *  first, one hop before anything hidden. */
const innerGatewayWithAnAgent = (): { readonly essid: string; readonly gateway: LanHost } => {
  for (const essid of crackableEssidPool) {
    const gateway = generateHomeLan(essid).hosts.find(
      (host) => host.kind === 'router' && octetOf(host) !== 1,
    );
    if (gateway === undefined) continue;
    if (runsAgent(resolveLanHostIdentity(gateway, essid).baseFs)) return { essid, gateway };
  }
  throw new Error('no seeded world puts an agent on an inner router');
};

describe('walking the inner gateway itself', () => {
  const INNER = innerGatewayWithAnAgent();

  it('answers as the gateway when no port names anything behind it', async () => {
    // A bare address is the box standing at it, even though that box is a gateway with
    // forwards of its own. The port a request arrives on is what decides which of the
    // two it is, and 161 is the gateway's own.
    const upsertPatch = vi.fn<(row: PatchRow) => Promise<{ error: unknown }>>(async () => ({
      error: null,
    }));
    const deps: SnmpWalkDeps = {
      nonceStore: freshStore,
      now: () => FIXED_NOW,
      findPatches: async () => ({ data: [], error: null }),
      readSnmpdLog: async () => ({ data: null, error: null }),
      upsertPatch,
      findPublicIpByEssid: async () => ({ data: { public_ip: PUBLIC_IP }, error: null }),
      findNetworkByPublicIp: async () => ({ data: null, error: null }),
      listOccupantsByEssid: async () => ({ data: [], error: null }),
      listLeasesByEssid: async () => ({ data: [], error: null }),
      findHomeNetworkByOwnerKey: async () => ({ data: null, error: null }),
    };

    const response = await handleSnmpWalk(
      await signRequest(PLAYER, 'snmpWalk', {
        essid: INNER.essid,
        target_ip: INNER.gateway.ip,
        community: 'public',
        source_ip: CLIENT_IP,
      }),
      deps,
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ok: true,
      identity: { hostname: INNER.gateway.hostname, addresses: [INNER.gateway.ip] },
    });
  });
});
