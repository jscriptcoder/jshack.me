import { describe, expect, it, vi } from 'vitest';
import { handleSnmpSet, type SnmpSetDeps } from './snmpSet';
import { signRequest } from '../signedRequest/sign';
import { generateIdentity } from '../identity/identity';
import { generateHomeLan, type LanHost } from '../generation/generateHomeLan';
import { generateDeepLayer, seedNetworkDepth } from '../generation/generateDeepLayer';
import { crackableEssidPool } from '../generation/generateWifi';
import { computeDeepGatewayId, computeInnerGatewayId } from '../identity/router';
import { buildDeepSwitchBaseFs, seedSnmpCommunity } from '../generation/routerFs';
import { resolveLanHostIdentity } from '../generation/lanHostIdentity';
import { readOpenPorts } from '../services/pidfile';
import { SERVICE_CATALOG } from '../services/serviceCatalog';
import { ACL_CONF_PATH } from '../network/switchAcl';
import { RULES_V4_PATH } from '../network/iptablesRules';
import { asAbsPath } from '../types';
import type { Directory } from '../filesystem/types';
import type { OwnerPatchRow } from '../network/materializeMachineFs';
import type { MachineLogReadQuery, MachineLogReadResult } from '../patches/appendMachineLog';
import type { PatchRow } from '../patches/upsertPatch';
import type { NonceStore } from '../signedRequest/nonceStore';

/**
 * Writing to a device through an inner gateway, and what a forward on that gateway is
 * allowed to point AT.
 *
 * Two claims, one root. A device behind a forward is named by the PORT, so a write
 * addressed to the gateway's own address reaches the gateway and a write addressed to a
 * forwarded port reaches the box behind it. And the destination a forward may name is
 * bounded by the network the device FRONTS — which for an inner gateway is its hidden
 * layer, not the LAN the gateway stands on.
 *
 * That bound is the correction. Judged against the typed address, an inner gateway would
 * accept only LAN destinations — every one of them a DNAT target the chain resolves to
 * nothing — while refusing the deep addresses that are the only ones it can route to.
 * Every legal write useless, every useful write illegal.
 */

const freshStore: NonceStore = async () => ({ fresh: true });
// 2026-08-09 11:04:07 UTC — the server clock every log line here is stamped with.
const FIXED_NOW = Date.UTC(2026, 7, 9, 11, 4, 7);
const CLIENT_IP = '192.168.1.50';
const FORWARDED_PORT = 2222;

const octetOf = (host: LanHost): number => Number(host.ip.split('.')[3]);

const runsAgent = (fs: Directory): boolean =>
  readOpenPorts(fs).some((openPort) => openPort.service === SERVICE_CATALOG.snmp.service);

/** An inner ROUTER that answers SNMP, together with the deep layer it fronts — the
 *  device the bound has to judge against the layer rather than against the LAN. */
const innerGatewayWithAnAgent = (): {
  readonly essid: string;
  readonly gateway: LanHost;
  readonly gatewayId: string;
  readonly community: string;
  readonly deepSubnet: string;
} => {
  for (const essid of crackableEssidPool) {
    const gateway = generateHomeLan(essid).hosts.find(
      (host) => host.kind === 'router' && octetOf(host) !== 1,
    );
    if (gateway === undefined) continue;
    if (!runsAgent(resolveLanHostIdentity(gateway, essid).baseFs)) continue;
    const gatewayId = computeInnerGatewayId(essid, octetOf(gateway));
    return {
      essid,
      gateway,
      gatewayId,
      community: seedSnmpCommunity(`inner-gw-community-${essid}:${octetOf(gateway)}`),
      deepSubnet: generateDeepLayer(essid, { machineId: gatewayId, kind: 'router' }).subnet,
    };
  }
  throw new Error('no seeded world puts an agent on an inner router');
};

/** A device on the hidden layer that answers SNMP, reached through a forward on the
 *  gateway above it. A switch, so the write under test is its access list. */
const deepSwitchWithAnAgent = (): {
  readonly essid: string;
  readonly gateway: LanHost;
  readonly gatewayId: string;
  readonly device: LanHost;
  readonly deviceId: string;
  readonly community: string;
} => {
  for (const essid of crackableEssidPool) {
    if (seedNetworkDepth(essid) < 2) continue;
    const gateway = generateHomeLan(essid).hosts.find(
      (host) => host.kind === 'router' && octetOf(host) !== 1,
    );
    if (gateway === undefined) continue;
    const gatewayId = computeInnerGatewayId(essid, octetOf(gateway));
    const device = generateDeepLayer(essid, { machineId: gatewayId, kind: 'router' }).childGateway;
    if (device === null || device.kind !== 'switch') continue;
    const deviceOctet = octetOf(device);
    if (!runsAgent(buildDeepSwitchBaseFs(gatewayId, deviceOctet))) continue;
    return {
      essid,
      gateway,
      gatewayId,
      device,
      deviceId: computeDeepGatewayId(gatewayId, deviceOctet),
      community: seedSnmpCommunity(`deep-sw-community-${gatewayId}:${deviceOctet}`),
    };
  }
  throw new Error('no seeded world hangs a deep switch running an SNMP agent');
};

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

const makeDeps = (patchesByMachine: Readonly<Record<string, readonly OwnerPatchRow[]>>) => {
  const upsertPatch = vi.fn<(row: PatchRow) => Promise<{ error: unknown }>>(async () => ({
    error: null,
  }));
  const readSnmpdLog = vi.fn<(query: MachineLogReadQuery) => Promise<MachineLogReadResult>>(
    async () => ({ data: null, error: null }),
  );
  const deps: SnmpSetDeps = {
    nonceStore: freshStore,
    now: () => FIXED_NOW,
    findPatches: async ({ machine_id }) => ({
      data: [...(patchesByMachine[machine_id] ?? [])],
      error: null,
    }),
    readSnmpdLog,
    upsertPatch,
    findNetworkByPublicIp: async () => ({ data: null, error: null }),
    listOccupantsByEssid: async () => ({ data: [], error: null }),
    listLeasesByEssid: async () => ({ data: [], error: null }),
    findHomeNetworkByOwnerKey: async () => ({ data: null, error: null }),
  };
  return { deps, upsertPatch };
};

const signedSet = (request: {
  readonly essid: string;
  readonly target_ip: string;
  readonly port?: number;
  readonly community: string;
  readonly assignment: string;
}) =>
  signRequest(PLAYER, 'snmpSet', {
    essid: request.essid,
    target_ip: request.target_ip,
    port: request.port,
    community: request.community,
    assignment: request.assignment,
    source_ip: CLIENT_IP,
  });

const writesTo = (upsertPatch: ReturnType<typeof makeDeps>['upsertPatch'], path: string) =>
  upsertPatch.mock.calls.map(([row]) => row).filter((row) => row.path === path);

describe('setting on a device behind an inner gateway', () => {
  const DEEP = deepSwitchWithAnAgent();

  it('writes the access list of the device the forward reaches', async () => {
    const { deps, upsertPatch } = makeDeps({
      [DEEP.gatewayId]: [
        patchRow(RULES_V4_PATH, `forward ${FORWARDED_PORT} to ${DEEP.device.ip}:161`),
      ],
    });

    const response = await handleSnmpSet(
      await signedSet({
        essid: DEEP.essid,
        target_ip: DEEP.gateway.ip,
        port: FORWARDED_PORT,
        community: DEEP.community,
        assignment: 'aclPort.8080=deny',
      }),
      deps,
    );

    expect(response).toEqual({
      status: 200,
      body: { ok: true, oid: 'ACL-MIB::aclPort.8080', value: 'deny' },
    });
    // On the DEVICE's own machine, never the gateway the request was addressed to.
    const [written] = writesTo(upsertPatch, ACL_CONF_PATH);
    expect(written?.machine_id).toBe(DEEP.deviceId);
    expect(written?.content).toContain('deny 8080');
  });

  it('refuses the gateway community on the device behind it', async () => {
    // Each box keeps its own community. A string cracked on the gateway is not a key to
    // everything the gateway can reach, or one crack would own the whole chain.
    const { deps, upsertPatch } = makeDeps({
      [DEEP.gatewayId]: [
        patchRow(RULES_V4_PATH, `forward ${FORWARDED_PORT} to ${DEEP.device.ip}:161`),
      ],
    });

    const response = await handleSnmpSet(
      await signedSet({
        essid: DEEP.essid,
        target_ip: DEEP.gateway.ip,
        port: FORWARDED_PORT,
        community: seedSnmpCommunity(`inner-gw-community-${DEEP.essid}:${octetOf(DEEP.gateway)}`),
        assignment: 'aclPort.8080=deny',
      }),
      deps,
    );

    expect(response.status).toBe(404);
    expect(writesTo(upsertPatch, ACL_CONF_PATH)).toHaveLength(0);
  });
});

describe('what a forward on an inner gateway may point at', () => {
  const INNER = innerGatewayWithAnAgent();

  it('accepts a destination on the layer the gateway fronts', async () => {
    // The only kind of destination that can route: the chain resolves a forward against
    // the deep layer, so an address there is a box the world can actually reach.
    const { deps, upsertPatch } = makeDeps({});

    const response = await handleSnmpSet(
      await signedSet({
        essid: INNER.essid,
        target_ip: INNER.gateway.ip,
        community: INNER.community,
        assignment: `natForward.${FORWARDED_PORT}=${INNER.deepSubnet}.9:22`,
      }),
      deps,
    );

    expect(response).toEqual({
      status: 200,
      body: {
        ok: true,
        oid: `NAT-MIB::natForward.${FORWARDED_PORT}`,
        value: `${INNER.deepSubnet}.9:22`,
      },
    });
    expect(writesTo(upsertPatch, RULES_V4_PATH)).toHaveLength(1);
  });

  it('refuses a destination on the LAN the gateway merely stands on', async () => {
    // Accepted, this would be a forward the chain resolves to nothing — a rule sitting
    // in the table, echoed back as success, routing nowhere for as long as it is there.
    const lanAddress = `${generateHomeLan(INNER.essid).subnet}.9`;
    const { deps, upsertPatch } = makeDeps({});

    const response = await handleSnmpSet(
      await signedSet({
        essid: INNER.essid,
        target_ip: INNER.gateway.ip,
        community: INNER.community,
        assignment: `natForward.${FORWARDED_PORT}=${lanAddress}:22`,
      }),
      deps,
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ok: false,
      refusal: { reason: 'wrongValue', failedObject: `NAT-MIB::natForward.${FORWARDED_PORT}` },
    });
    expect(writesTo(upsertPatch, RULES_V4_PATH)).toHaveLength(0);
  });
});
