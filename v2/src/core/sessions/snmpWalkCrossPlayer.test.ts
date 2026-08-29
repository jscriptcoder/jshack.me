import { describe, expect, it, vi } from 'vitest';
import { handleSnmpWalk, type SnmpWalkDeps } from './snmpWalk';
import { signRequest } from '../signedRequest/sign';
import { generateIdentity } from '../identity/identity';
import { generateHomeLan } from '../generation/generateHomeLan';
import { seedApGatewayCommunity, seedApGatewayHostname } from '../generation/routerFs';
import { computeApGatewayId } from '../identity/router';
import { renderIdentityWalk, type SnmpIdentity } from '../snmp/walk';
import { pidfilePath } from '../services/pidfile';
import { SERVICE_CATALOG } from '../services/serviceCatalog';
import { RULES_V4_PATH } from '../network/iptablesRules';
import { SNMPD_LOG_PATH } from '../logging/snmpdLog';
import { asAbsPath } from '../types';
import type { ApNetworkLookup } from '../network/resolvePublicTarget';
import type { LanLeaseRow } from '../network/lanAddress';
import type { OwnerPatchRow } from '../network/materializeMachineFs';
import type { MachineLogReadQuery, MachineLogReadResult } from '../patches/appendMachineLog';
import type { PatchRow } from '../patches/upsertPatch';
import type { NonceStore } from '../signedRequest/nonceStore';
import type { Identity } from '../commands/types';

/**
 * Reading a device that belongs to somebody else, reached by the address the world
 * routes it by.
 *
 * B has never stood on A's network and never will. They hold no account on the gateway,
 * open no session, and know the ESSID only as a string the device prints back at them.
 * Everything the walk answers has to be resolved from the address alone, server-side,
 * because the one field their client fully controls — the network its own card is
 * associated with — describes a world the device under the question is not in.
 *
 * What the read-only tier may say is bounded from the other direction too. A gateway
 * holds an address on the LAN behind it, and printing that to a stranger would hand
 * them the shape of a network they have not reached: the first three octets of every
 * box worth aiming at, for the price of a community string that was never a secret.
 *
 * And every way of not answering has to look the same. A device that is not there, one
 * whose agent was stopped, one that filtered the port, and one that refused the
 * community are four facts the server knows and the caller may not — told apart, they
 * sort the world into boxes worth a wordlist before a single word is spent on one.
 */

const freshStore: NonceStore = async () => ({ fresh: true });
// 2026-08-09 11:04:07 UTC — the server clock every log line here is stamped with.
const FIXED_NOW = Date.UTC(2026, 7, 9, 11, 4, 7);

const TARGET_PUBLIC_IP = '203.0.113.9';
const TARGET_ESSID = 'PIED-PIPER-GUEST';
const AP_GATEWAY_ID = computeApGatewayId(TARGET_ESSID);
const AP_NETWORK: ApNetworkLookup = { router_machine_id: AP_GATEWAY_ID, essid: TARGET_ESSID };

/** The community the gateway answers its port table to, seeded from the DEFENDER's
 *  ESSID — the thing a sweep has to crack, and nothing the attacker's own world holds. */
const COMMUNITY = seedApGatewayCommunity(TARGET_ESSID);

/** The network the ATTACKER's card is associated with, and therefore the ESSID their
 *  client sends. Deliberately not the defender's. */
const ATTACKER_ESSID = 'BEAN-THERE-WIFI';
const ATTACKER_PUBLIC_IP = '198.51.100.22';

const TARGET_SUBNET = generateHomeLan(TARGET_ESSID).subnet;

const DEFENDER = generateIdentity();
const DEFENDER_OCTET = 84;
const DEFENDER_LAN_IP = `${TARGET_SUBNET}.${DEFENDER_OCTET}`;
const DEFENDER_LEASES: readonly LanLeaseRow[] = [
  { owner_key: DEFENDER.publicKeyHex, octet: DEFENDER_OCTET },
];

/** A forward the defender opened with `nano` on the gateway's own file — the table a
 *  cracked community buys a look at, read from where they wrote it rather than a copy. */
const PUBLISHED_PORT = 2222;
const DEFENDER_FORWARD = `forward ${PUBLISHED_PORT} to ${DEFENDER_LAN_IP}:22\n`;

const patchRow = (path: string, content: string | null): OwnerPatchRow =>
  ({
    path: asAbsPath(path),
    content,
    owner: 'root',
    permissions: null,
    node_type: 'file',
    updated_at: '2026-08-09T11:00:00.000Z',
    writer_key: DEFENDER.publicKeyHex,
  }) as OwnerPatchRow;

const makeDeps = (
  gatewayPatches: readonly OwnerPatchRow[] = [],
  over: Partial<SnmpWalkDeps> = {},
) => {
  const upsertPatch = vi.fn<(row: PatchRow) => Promise<{ error: unknown }>>(async () => ({
    error: null,
  }));
  const readSnmpdLog = vi.fn<(query: MachineLogReadQuery) => Promise<MachineLogReadResult>>(
    async () => ({ data: null, error: null }),
  );
  const deps: SnmpWalkDeps = {
    nonceStore: freshStore,
    now: () => FIXED_NOW,
    findPatches: async () => ({ data: [...gatewayPatches], error: null }),
    readSnmpdLog,
    upsertPatch,
    findNetworkByPublicIp: async () => ({ data: AP_NETWORK, error: null }),
    listOccupantsByEssid: async () => ({ data: [], error: null }),
    listLeasesByEssid: async () => ({ data: DEFENDER_LEASES, error: null }),
    findHomeNetworkByOwnerKey: async () => ({
      data: { public_ip: ATTACKER_PUBLIC_IP },
      error: null,
    }),
    findPublicIpByEssid: async (essid) => ({
      data: { public_ip: essid === TARGET_ESSID ? TARGET_PUBLIC_IP : ATTACKER_PUBLIC_IP },
      error: null,
    }),
    ...over,
  };
  return { deps, upsertPatch };
};

/** A walk sent from across the world. The attacker's OWN ESSID travels with it, because
 *  it is the only network their client can name. */
const walkAcrossTheWorld = async (
  deps: SnmpWalkDeps,
  request: {
    readonly attacker?: Identity;
    readonly community?: string;
  } = {},
) =>
  handleSnmpWalk(
    await signRequest(request.attacker ?? generateIdentity(), 'snmpWalk', {
      essid: ATTACKER_ESSID,
      target_ip: TARGET_PUBLIC_IP,
      community: request.community ?? 'public',
    }),
    deps,
  );

const identityOf = (response: { readonly body: Record<string, unknown> }): SnmpIdentity =>
  (response.body as { readonly identity: SnmpIdentity }).identity;

const loggedRow = (upsertPatch: ReturnType<typeof makeDeps>['upsertPatch']) =>
  upsertPatch.mock.calls.map(([row]) => row).find((row) => row.path === SNMPD_LOG_PATH);

describe('walking a device that belongs to somebody else, by the address the world routes it by', () => {
  it('names the gateway and shows the PUBLIC address alone, never the LAN behind it', async () => {
    const { deps } = makeDeps();

    const response = await walkAcrossTheWorld(deps);

    expect(response).toEqual({
      status: 200,
      body: {
        ok: true,
        tier: 'read-only',
        identity: {
          hostname: seedApGatewayHostname(TARGET_ESSID),
          kind: 'router',
          sysContact: expect.any(String),
          // ONE address. The gateway holds a LAN address as well, and printing it
          // would hand a stranger the first three octets of every box on a network
          // they have not reached.
          addresses: [TARGET_PUBLIC_IP],
        },
      },
    });
    // Not merely absent from the address list: absent from the whole answer.
    expect(JSON.stringify(response)).not.toContain(TARGET_SUBNET);
  });

  it('reads to a stranger as the platform block any device on their own LAN would', async () => {
    const { deps } = makeDeps();

    const response = await walkAcrossTheWorld(deps);

    expect(
      renderIdentityWalk({
        target: TARGET_PUBLIC_IP,
        community: 'public',
        identity: identityOf(response),
      }).join('\n'),
    ).toContain(`Linux ${seedApGatewayHostname(TARGET_ESSID)}`);
  });

  it("renders the forward table out of the defender's own rules file once the community is cracked", async () => {
    const { deps } = makeDeps([patchRow(RULES_V4_PATH, DEFENDER_FORWARD)]);

    const response = await walkAcrossTheWorld(deps, { community: COMMUNITY });

    expect(response.body).toMatchObject({
      ok: true,
      tier: 'read-write',
      portTables: [
        {
          kind: 'nat',
          forwards: [{ publicPort: PUBLISHED_PORT, internalIp: DEFENDER_LAN_IP, internalPort: 22 }],
        },
        { kind: 'filter', denies: [] },
      ],
    });
  });
});

describe('every way of not answering a stranger, which has to be one way', () => {
  it('answers a community it does not hold exactly as an address bearing no network does', async () => {
    const { deps } = makeDeps();
    const { deps: noNetwork } = makeDeps([], {
      findNetworkByPublicIp: async () => ({ data: null, error: null }),
    });

    const refused = await walkAcrossTheWorld(deps, { community: 'not-the-one' });
    const nowhere = await walkAcrossTheWorld(noNetwork);

    expect(refused).toEqual(nowhere);
    expect(refused).toEqual({ status: 404, body: { error: 'host_unreachable' } });
  });

  it('still records the visit of a stranger whose community was refused', async () => {
    const { deps, upsertPatch } = makeDeps();

    await walkAcrossTheWorld(deps, { community: 'not-the-one' });

    // Silent to the caller, never to the owner: this file is the only evidence a walk
    // leaves anywhere in the world.
    expect(loggedRow(upsertPatch)?.content).toContain(
      `Authentication failure (incorrect community name) from UDP: [${ATTACKER_PUBLIC_IP}]`,
    );
  });

  it("files a stranger's walk under the access point's own row, never the visitor's", async () => {
    const attacker = generateIdentity();
    const { deps, upsertPatch } = makeDeps();

    await walkAcrossTheWorld(deps, { attacker });

    const logged = loggedRow(upsertPatch);
    expect(logged?.machine_id).toBe(AP_GATEWAY_ID);
    expect(logged?.writer_key).toBe(DEFENDER.publicKeyHex);
    expect(logged?.writer_key).not.toBe(attacker.publicKeyHex);
  });

  it('answers a gateway that filtered the agent port the way a stopped agent answers', async () => {
    const filtered = makeDeps([
      patchRow(RULES_V4_PATH, `deny ${SERVICE_CATALOG.snmp.defaultPort}\n`),
    ]);
    const stopped = makeDeps([patchRow(pidfilePath(SERVICE_CATALOG.snmp), null)]);

    const behindFilter = await walkAcrossTheWorld(filtered.deps, { community: COMMUNITY });
    const behindStop = await walkAcrossTheWorld(stopped.deps, { community: COMMUNITY });

    // The filter was built one slice ago and could only be exercised from inside the
    // LAN. The world is the vantage it exists for.
    expect(behindFilter).toEqual(behindStop);
    expect(behindFilter.status).toBe(404);
  });

  it('leaves no line on a gateway that never heard the stranger', async () => {
    const { deps, upsertPatch } = makeDeps([
      patchRow(RULES_V4_PATH, `deny ${SERVICE_CATALOG.snmp.defaultPort}\n`),
    ]);

    await walkAcrossTheWorld(deps, { community: COMMUNITY });

    // A line here would tell the owner somebody reached a port they had closed, and
    // tell the stranger their community had been read.
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('still answers on every port the gateway did not close', async () => {
    const { deps } = makeDeps([patchRow(RULES_V4_PATH, 'deny 8080\n')]);

    const response = await walkAcrossTheWorld(deps, { community: COMMUNITY });

    expect(response.status).toBe(200);
  });
});

describe('walking your OWN public address, which comes back through the same door', () => {
  it('reports the address once, however many faces the gateway wears', async () => {
    const { deps } = makeDeps();

    // The owner's client sends the network it really is on, and the box behind the
    // address really is their own access point's gateway. From OUTSIDE it wears one
    // face, and which vantage a request arrived on is not a thing the caller decides.
    const response = await handleSnmpWalk(
      await signRequest(DEFENDER, 'snmpWalk', {
        essid: TARGET_ESSID,
        target_ip: TARGET_PUBLIC_IP,
        community: 'public',
      }),
      deps,
    );

    expect(identityOf(response).addresses).toEqual([TARGET_PUBLIC_IP]);
  });
});
