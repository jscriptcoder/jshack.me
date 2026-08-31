import { describe, expect, it, vi } from 'vitest';
import { handleSnmpSet, type SnmpSetDeps } from './snmpSet';
import { signRequest } from '../signedRequest/sign';
import { generateIdentity } from '../identity/identity';
import { generateHomeLan } from '../generation/generateHomeLan';
import { seedApGatewayCommunity } from '../generation/routerFs';
import { computeApGatewayId } from '../identity/router';
import { pidfilePath, formatPidfileContent } from '../services/pidfile';
import { SERVICE_CATALOG } from '../services/serviceCatalog';
import { RULES_V4_PATH } from '../network/iptablesRules';
import { formatSnmpdState } from '../snmp/rwCommunity';
import { SNMPD_LOG_PATH } from '../logging/snmpdLog';
import { md5 } from '../generation/md5';
import { asAbsPath } from '../types';
import { resolvePublicTarget } from '../network/resolvePublicTarget';
import type {
  ApNetworkLookup,
  NatOccupantRow,
  ResolvePublicTargetDeps,
} from '../network/resolvePublicTarget';
import type { LanLeaseRow } from '../network/lanAddress';
import type { OwnerPatchRow } from '../network/materializeMachineFs';
import type { MachineLogReadQuery, MachineLogReadResult } from '../patches/appendMachineLog';
import type { PatchRow } from '../patches/upsertPatch';
import type { NonceStore } from '../signedRequest/nonceStore';
import type { Identity } from '../commands/types';

/**
 * Writing to a device that belongs to somebody else, reached by their public address —
 * and the bound on what a forward written from out there may point AT.
 *
 * The attacker never joins the defender's network and never learns its name. They type a
 * public address, and the ESSID travelling with their request is the one their OWN card
 * is associated with, because that is the only network a client knows it is on. So a
 * bound derived from the request describes the attacker's world and judges the
 * defender's device by it — every address inside the LAN under attack falls outside a
 * subnet drawn for a different network, and the refusal that follows names the right
 * address for the wrong reason.
 *
 * The device's own network is the only correct authority, and only the layer that
 * resolved the device knows it: a public address is answered by the access point that
 * bears it, and the server read that access point's ESSID out of its own records on the
 * way in. What a caller claims about their surroundings can never decide where somebody
 * else's router is allowed to send traffic.
 *
 * The third case is the one with no segment at all. A box reached THROUGH a forward is
 * an occupant's workstation: it stands on a LAN and fronts nothing behind it, so a NAT
 * rule on it could not route anywhere. That is a reason to refuse, not an absence of
 * information, and the answer says so rather than failing a comparison against a network
 * nobody is on.
 */

const freshStore: NonceStore = async () => ({ fresh: true });
// 2026-08-09 11:04:07 UTC — the server clock every log line here is stamped with.
const FIXED_NOW = Date.UTC(2026, 7, 9, 11, 4, 7);

const TARGET_PUBLIC_IP = '203.0.113.9';
const TARGET_ESSID = 'PIED-PIPER-GUEST';
const AP_GATEWAY_ID = computeApGatewayId(TARGET_ESSID);
const AP_NETWORK: ApNetworkLookup = { router_machine_id: AP_GATEWAY_ID, essid: TARGET_ESSID };

/** The community a `hydra <public ip> snmp` sweep earns. Seeded from the defender's
 *  ESSID and never from anything the attacker holds, which is what makes it worth
 *  cracking. */
const COMMUNITY = seedApGatewayCommunity(TARGET_ESSID);

/** The network the ATTACKER's own card is associated with, and the ESSID their client
 *  therefore sends. Deliberately not the defender's: it is the whole point that a
 *  request carries the wrong network's name and the door must not believe it. */
const ATTACKER_ESSID = 'BEAN-THERE-WIFI';

/** The attacker's own public address, as the server resolves it from their VERIFIED
 *  key — the address the defender's log will carry. */
const ATTACKER_PUBLIC_IP = '198.51.100.22';

/** A SECOND stranger, from a third network. One device visited by two people who have
 *  never met is the case the gateway's single log row exists for. */
const SECOND_ATTACKER_PUBLIC_IP = '198.51.100.77';

const TARGET_SUBNET = generateHomeLan(TARGET_ESSID).subnet;
const ATTACKER_SUBNET = generateHomeLan(ATTACKER_ESSID).subnet;
if (TARGET_SUBNET === ATTACKER_SUBNET) {
  throw new Error('the two worlds must sit on different subnets for this bound to mean anything');
}

const DEFENDER = generateIdentity();
const DEFENDER_OCTET = 84;
const DEFENDER_LAN_IP = `${TARGET_SUBNET}.${DEFENDER_OCTET}`;
const DEFENDER_WS = 'workstation-c3d4e5f6';

/** An address on the ATTACKER's own LAN. A bound taken from the request would place
 *  this inside the world the request described; a bound taken from the device places it
 *  nowhere near the network that device fronts. */
const ATTACKER_LAN_IP = `${ATTACKER_SUBNET}.44`;

const PUBLISHED_PORT = 2222;

const defenderOccupant: NatOccupantRow = {
  owner_key: DEFENDER.publicKeyHex,
  workstation_machine_id: DEFENDER_WS,
  workstation_machine_name: 'nebuchadnezzar',
  workstation_username: 'neo',
  workstation_root_hash: md5('correct-horse-battery-staple'),
};

const DEFENDER_LEASES: readonly LanLeaseRow[] = [
  { owner_key: DEFENDER.publicKeyHex, octet: DEFENDER_OCTET },
];

const patchRow = (path: string, content: string): OwnerPatchRow =>
  ({
    path: asAbsPath(path),
    content,
    owner: 'root',
    permissions: null,
    node_type: 'file',
    updated_at: '2026-08-09T11:00:00.000Z',
    writer_key: DEFENDER.publicKeyHex,
  }) as OwnerPatchRow;

/** The occupant's own agent: the daemon running, and a community of their own. Planted
 *  the way their own install and their own edit would arrive. */
const OCCUPANT_COMMUNITY = 'homelab';
const occupantAgent: readonly OwnerPatchRow[] = [
  patchRow(
    pidfilePath(SERVICE_CATALOG.snmp),
    formatPidfileContent(SERVICE_CATALOG.snmp, SERVICE_CATALOG.snmp.defaultPort),
  ),
  patchRow('/var/lib/snmp/snmpd.conf', formatSnmpdState(md5(OCCUPANT_COMMUNITY))),
];

/** How the journal really keys a row: `(machine_id, path, writer_key)`. A log patch
 *  carries the WHOLE file, so two writers under two keys are two rows and replay hands
 *  back the newest outright — the later visit erasing the earlier one rather than adding
 *  to it. The store is modelled rather than stubbed because the guarantee under test is
 *  about the KEY, and a stub that always read back the last content written would hide
 *  exactly the split it exists to prevent. */
const rowKey = (row: {
  readonly machine_id: string;
  readonly path: string;
  readonly writer_key: string;
}) => `${row.machine_id}|${row.path}|${row.writer_key}`;

const makeDeps = (
  patchesByMachine: Readonly<Record<string, readonly OwnerPatchRow[]>> = {},
  over: Partial<SnmpSetDeps> = {},
) => {
  const stored = new Map<string, string | null>();
  const upsertPatch = vi.fn<(row: PatchRow) => Promise<{ error: unknown }>>(async (row) => {
    stored.set(rowKey(row), row.content);
    return { error: null };
  });
  const readSnmpdLog = vi.fn<(query: MachineLogReadQuery) => Promise<MachineLogReadResult>>(
    async (query) => ({ data: { content: stored.get(rowKey(query)) ?? null }, error: null }),
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
    findNetworkByPublicIp: async () => ({ data: AP_NETWORK, error: null }),
    listOccupantsByEssid: async () => ({ data: [defenderOccupant], error: null }),
    listLeasesByEssid: async () => ({ data: DEFENDER_LEASES, error: null }),
    findHomeNetworkByOwnerKey: async () => ({
      data: { public_ip: ATTACKER_PUBLIC_IP },
      error: null,
    }),
    ...over,
  };
  return { deps, upsertPatch };
};

/** A set sent from across the world: the attacker's OWN ESSID travels with it, because
 *  that is the only network their client can name. The attacker's identity is a
 *  parameter so a test can name who visited — whose key the device must NOT file the
 *  visit under, and which of two strangers left which line. */
const setAcrossTheWorld = async (
  deps: SnmpSetDeps,
  request: {
    readonly assignment: string;
    readonly attacker?: Identity;
    readonly port?: number;
    readonly community?: string;
    readonly sourceIp?: string;
  },
) =>
  handleSnmpSet(
    await signRequest(request.attacker ?? generateIdentity(), 'snmpSet', {
      essid: ATTACKER_ESSID,
      target_ip: TARGET_PUBLIC_IP,
      port: request.port,
      community: request.community ?? COMMUNITY,
      assignment: request.assignment,
      source_ip: request.sourceIp,
    }),
    deps,
  );

const writtenTo = (upsertPatch: ReturnType<typeof makeDeps>['upsertPatch'], path: string) =>
  upsertPatch.mock.calls.map(([row]) => row).find((row) => row.path === path);

describe("opening a port into another player's LAN, from the other side of the world", () => {
  it('writes a forward into the network the reached device fronts, not the one the caller named', async () => {
    const { deps, upsertPatch } = makeDeps();

    const response = await setAcrossTheWorld(deps, {
      assignment: `forward.${PUBLISHED_PORT}=${DEFENDER_LAN_IP}:22`,
    });

    expect(response).toEqual({
      status: 200,
      body: {
        ok: true,
        oid: `forward.${PUBLISHED_PORT}`,
        value: `${DEFENDER_LAN_IP}:22`,
      },
    });
    expect(writtenTo(upsertPatch, RULES_V4_PATH)?.content).toContain(
      `forward ${PUBLISHED_PORT} to ${DEFENDER_LAN_IP}:22`,
    );
    expect(writtenTo(upsertPatch, RULES_V4_PATH)?.machine_id).toBe(AP_GATEWAY_ID);
  });

  it("refuses an address on the CALLER's own LAN, which the device it reached cannot route to", async () => {
    const { deps, upsertPatch } = makeDeps();

    const response = await setAcrossTheWorld(deps, {
      assignment: `forward.${PUBLISHED_PORT}=${ATTACKER_LAN_IP}:22`,
    });

    expect(response).toEqual({
      status: 200,
      body: {
        ok: false,
        refusal: {
          reason: 'wrongValue',
          detail: `${ATTACKER_LAN_IP} is not on this device's segment`,
          failedObject: `forward.${PUBLISHED_PORT}`,
        },
      },
    });
    expect(writtenTo(upsertPatch, RULES_V4_PATH)).toBeUndefined();
  });

  it('refuses a NAT rule on a box that fronts no network at all, and says that is why', async () => {
    // Reached THROUGH a forward, so the box is an occupant's workstation: it stands on
    // the defender's LAN and has nothing behind it. A forward here could not route
    // anywhere, whatever address it named — so the refusal is about the DEVICE, and
    // naming a destination that is "not on its segment" would describe a segment the
    // box does not have.
    const { deps, upsertPatch } = makeDeps({
      [AP_GATEWAY_ID]: [
        patchRow(
          RULES_V4_PATH,
          `forward ${PUBLISHED_PORT} to ${DEFENDER_LAN_IP}:${SERVICE_CATALOG.snmp.defaultPort}`,
        ),
      ],
      [DEFENDER_WS]: occupantAgent,
    });

    const response = await setAcrossTheWorld(deps, {
      port: PUBLISHED_PORT,
      community: OCCUPANT_COMMUNITY,
      assignment: `forward.9999=${DEFENDER_LAN_IP}:22`,
    });

    expect(response).toEqual({
      status: 200,
      body: {
        ok: false,
        refusal: {
          reason: 'wrongValue',
          detail: 'this device fronts no network',
          failedObject: 'forward.9999',
        },
      },
    });
    expect(writtenTo(upsertPatch, RULES_V4_PATH)).toBeUndefined();
  });
});

/**
 * The only thing the defender is ever given back.
 *
 * B holds no account on A's gateway, opens no session, and leaves no shell history. The
 * device's own `/var/log/snmpd.log` is the whole of A's evidence, and it has to survive
 * being written by strangers: the access point belongs to nobody, so its log has no
 * owner key of its own to accrete under. A row per visitor is a row the next visitor
 * silently deletes — patches rows key on `(machine_id, path, writer_key)` and a log
 * patch carries the whole file, so replay hands back the newest and drops the rest.
 * `A's snmpd.log names B` is worth nothing if the next stranger's arrival erases it.
 */
describe("the record a stranger's visit leaves on the gateway they rewrote", () => {
  it("files the visit under the access point's own row, never the visitor's", async () => {
    const attacker = generateIdentity();
    const { deps, upsertPatch } = makeDeps();

    await setAcrossTheWorld(deps, {
      attacker,
      assignment: `forward.${PUBLISHED_PORT}=${DEFENDER_LAN_IP}:22`,
    });

    const log = writtenTo(upsertPatch, SNMPD_LOG_PATH);
    expect(log?.machine_id).toBe(AP_GATEWAY_ID);
    // The lowest lease on the ESSID: stable, because leases outlive occupancy and do not
    // move when players join or leave. The visitor's own key would be neither.
    expect(log?.writer_key).toBe(DEFENDER.publicKeyHex);
    expect(log?.writer_key).not.toBe(attacker.publicKeyHex);

    // One append, three lines: somebody arrived, the community they named worked, and
    // this is what they changed — each carrying the address the server resolved for
    // them. Asserted as the WHOLE file, because a log is read as a record of what
    // happened and an extra line is as wrong as a missing one.
    expect((log?.content ?? '').split('\n').filter(Boolean)).toEqual([
      expect.stringContaining(`Connection from UDP: [${ATTACKER_PUBLIC_IP}]`),
      expect.stringContaining(`Authentication succeeded from UDP: [${ATTACKER_PUBLIC_IP}]`),
      expect.stringContaining(
        `SET forward.${PUBLISHED_PORT} = none -> ${DEFENDER_LAN_IP}:22 ` +
          `from UDP: [${ATTACKER_PUBLIC_IP}]`,
      ),
    ]);
  });

  it('records the address the server resolved for the attacker, not the one they claimed', async () => {
    const { deps, upsertPatch } = makeDeps();

    await setAcrossTheWorld(deps, {
      assignment: `forward.${PUBLISHED_PORT}=${DEFENDER_LAN_IP}:22`,
      // A client naming its own origin could write any network into a defender's
      // evidence, including one belonging to somebody they wanted blamed.
      sourceIp: '10.0.0.1',
    });

    const logged = writtenTo(upsertPatch, SNMPD_LOG_PATH)?.content ?? '';
    expect(logged).toContain(`from UDP: [${ATTACKER_PUBLIC_IP}]`);
    expect(logged).not.toContain('10.0.0.1');
  });

  it('accretes a second stranger onto the same row instead of erasing the first', async () => {
    const first = generateIdentity();
    const second = generateIdentity();
    const { deps, upsertPatch } = makeDeps(
      {},
      {
        findHomeNetworkByOwnerKey: async (ownerKey) => ({
          data: {
            public_ip:
              ownerKey === second.publicKeyHex ? SECOND_ATTACKER_PUBLIC_IP : ATTACKER_PUBLIC_IP,
          },
          error: null,
        }),
      },
    );

    await setAcrossTheWorld(deps, {
      attacker: first,
      assignment: `forward.${PUBLISHED_PORT}=${DEFENDER_LAN_IP}:22`,
    });
    await setAcrossTheWorld(deps, {
      attacker: second,
      assignment: `forward.3333=${DEFENDER_LAN_IP}:22`,
    });

    const logRows = upsertPatch.mock.calls
      .map(([row]) => row)
      .filter((row) => row.path === SNMPD_LOG_PATH);
    // ONE row. Two would each hold half the story, and only one of them would survive.
    expect(new Set(logRows.map((row) => row.writer_key))).toEqual(
      new Set([DEFENDER.publicKeyHex]),
    );

    const final = logRows.at(-1)?.content ?? '';
    expect(final).toContain(
      `SET forward.${PUBLISHED_PORT} = none -> ${DEFENDER_LAN_IP}:22 ` +
        `from UDP: [${ATTACKER_PUBLIC_IP}]`,
    );
    expect(final).toContain(
      `SET forward.3333 = none -> ${DEFENDER_LAN_IP}:22 ` +
        `from UDP: [${SECOND_ATTACKER_PUBLIC_IP}]`,
    );
    // Three lines each, both visits whole: the second did not overwrite, truncate, or
    // re-read somebody else's row.
    expect(final.split('\n').filter(Boolean)).toHaveLength(6);
  });
});

/**
 * The door B opened is a door the world actually walks through.
 *
 * Everything above proves a rule was WRITTEN. This proves it routes — and the two are
 * only the same thing because there is exactly one table. The set door reads the
 * gateway's own `rules.v4`, changes one line in it, and stores it back; the resolver
 * every public door shares reads that same file to decide whose box an address and port
 * reach. A second copy of the forwards anywhere — a cache, a projection, a client's
 * regenerated world — is precisely how a player comes to hold a port that answers
 * nothing, and there deliberately is not one.
 *
 * So the rules file here is never hand-written to match: it is taken from the patch the
 * write door actually produced and handed straight to the resolver. A fixture spelled to
 * agree with the parser would pass while the two sides disagreed.
 */
describe('the forward a stranger opened, resolved by the world that has to honour it', () => {
  /** The occupant brought their own daemons up. A fresh box has an empty `/var/run`, so
   *  a forward onto one is dark until its owner starts something behind it. */
  const occupantDaemons: readonly OwnerPatchRow[] = [
    patchRow(
      pidfilePath(SERVICE_CATALOG.ssh),
      formatPidfileContent(SERVICE_CATALOG.ssh, SERVICE_CATALOG.ssh.defaultPort),
    ),
    ...occupantAgent,
  ];

  /** A door the DEFENDER opened for themselves, before any of this. It shares the file
   *  the attacker is about to write into. */
  const OWNER_PORT = 3333;
  const ownerForward = `forward ${OWNER_PORT} to ${DEFENDER_LAN_IP}:${SERVICE_CATALOG.snmp.defaultPort}`;

  /** The world as it stands once the gateway's rules file says what it says — every
   *  public door's shared view of who is behind which port. */
  const worldWith = (rules: string): ResolvePublicTargetDeps => ({
    findNetworkByPublicIp: async () => ({ data: AP_NETWORK, error: null }),
    findPatches: async ({ machine_id }) => ({
      data: machine_id === AP_GATEWAY_ID ? [patchRow(RULES_V4_PATH, rules)] : [...occupantDaemons],
      error: null,
    }),
    listOccupantsByEssid: async () => ({ data: [defenderOccupant], error: null }),
    listLeasesByEssid: async () => ({ data: DEFENDER_LEASES, error: null }),
  });

  /** B's write, and the gateway's rules file exactly as the door left it. */
  const openedBy = async (assignment: string, seeded: string | null = null) => {
    const { deps, upsertPatch } = makeDeps(
      seeded === null ? {} : { [AP_GATEWAY_ID]: [patchRow(RULES_V4_PATH, seeded)] },
    );
    const response = await setAcrossTheWorld(deps, { assignment });
    const rules = writtenTo(upsertPatch, RULES_V4_PATH)?.content;
    // No row at all, or a tombstone: either way the write this test rests on did not
    // happen, and resolving against an empty world would pass for the wrong reason.
    if (typeof rules !== 'string') {
      throw new Error(`the set left no rules file: ${JSON.stringify(response)}`);
    }
    return rules;
  };

  it("routes the published port to the occupant leasing the address the stranger named", async () => {
    const rules = await openedBy(`forward.${PUBLISHED_PORT}=${DEFENDER_LAN_IP}:22`);

    const resolved = await resolvePublicTarget(worldWith(rules), {
      publicIp: TARGET_PUBLIC_IP,
      port: PUBLISHED_PORT,
    });

    expect(resolved).toMatchObject({
      ok: true,
      target: {
        // The box the LEASE names, not the gateway the port was typed at.
        machineId: DEFENDER_WS,
        hostname: 'nebuchadnezzar',
        // The far side of the forward: an attacker publishing a port does not get to
        // decide which daemon behind it answers.
        reachedPort: SERVICE_CATALOG.ssh.defaultPort,
        // The occupant's own row. A door somebody else opened onto your box does not
        // move where your box keeps its logs.
        logWriterKey: DEFENDER.publicKeyHex,
        essid: TARGET_ESSID,
        // Standing on the LAN with nothing behind it, whoever opened the door.
        frontedSegment: null,
      },
    });
  });

  it("leaves the door the owner had already opened exactly where it was", async () => {
    const rules = await openedBy(`forward.${PUBLISHED_PORT}=${DEFENDER_LAN_IP}:22`, ownerForward);

    const stillOpen = await resolvePublicTarget(worldWith(rules), {
      publicIp: TARGET_PUBLIC_IP,
      port: OWNER_PORT,
    });

    // One table with two authors. The attacker's line is added to the owner's file
    // rather than replacing it, and each port still reaches the daemon its own line
    // names — the write is a line in a file, not a new table for the last writer.
    expect(stillOpen).toMatchObject({
      ok: true,
      target: { machineId: DEFENDER_WS, reachedPort: SERVICE_CATALOG.snmp.defaultPort },
    });
  });
});
