import { describe, expect, it, vi } from 'vitest';
import { handleSnmpSet, type SnmpSetDeps } from './snmpSet';
import { signRequest } from '../signedRequest/sign';
import { generateIdentity } from '../identity/identity';
import { generateHomeLan, type LanHost } from '../generation/generateHomeLan';
import { resolveLanHostIdentity } from '../generation/lanHostIdentity';
import { SERVICE_CATALOG } from '../services/serviceCatalog';
import { formatPidfileContent, pidfilePath, readOpenPorts } from '../services/pidfile';
import { SNMPD_LOG_PATH } from '../logging/snmpdLog';
import { RULES_V4_OWNER, RULES_V4_PATH, RULES_V4_PERMISSIONS } from '../network/iptablesRules';
import { ACL_CONF_PATH } from '../network/switchAcl';
import { formatSnmpdState } from '../snmp/rwCommunity';
import { md5 } from '../generation/md5';
import { asAbsPath } from '../types';
import type { OwnerPatchRow } from '../network/materializeMachineFs';
import type { MachineLogReadQuery, MachineLogReadResult } from '../patches/appendMachineLog';
import type { PatchRow } from '../patches/upsertPatch';
import type { NonceStore } from '../signedRequest/nonceStore';

/**
 * `handleSnmpSet` is the write half of the door, and the only place in the game where a
 * player changes what a machine DOES without ever standing on it.
 *
 * No session is minted, and the community is re-read and re-judged on every set. A row
 * here would hand `listPatches` and `upsertPatch` to whoever reached port 161 — at the
 * tier that rewrites a NAT table — because `authorizeMachineAccess` never inspects
 * session kind. Re-judging per call is also what makes `systemctl stop snmpd` a real
 * defence: there is no session to invalidate, so the next set simply finds nothing.
 *
 * THREE ANSWERS, and the distinction between them is the whole design. A device that is
 * not there, one whose agent was stopped, and one that refused the community are all
 * silence — a real agent drops a bad community without a word, and telling them apart
 * would hand a scanner a free map of which devices are worth a wordlist. But once the
 * community is ACCEPTED the caller is talking to the agent, and a refusal from there on
 * says what was wrong: they have already proved the string, and on the one door whose
 * whole promise is the write, silence would leave them unable to tell a bad value from
 * a working one without walking the device again.
 */

const freshStore: NonceStore = async () => ({ fresh: true });
// 2026-08-09 11:04:07 UTC — the server clock every log line here is stamped with.
const FIXED_NOW = Date.UTC(2026, 7, 9, 11, 4, 7);
const CLIENT_IP = '192.168.1.50';
const RW_COMMUNITY = 'corpnet';

import { ownAgentCommunity } from '../snmp/ownAgent';
import { SNMPD_CONF_PATH, SNMPD_CONF_SEED } from '../snmp/conf';
import { SNMPD_STATE_PATH } from '../snmp/rwCommunity';
import { lanAddressFor } from '../network/lanAddress';
import { portsOpenToNetwork } from '../network/portsOpenToNetwork';
import { buildDirectory, buildFile } from '../../test/factories/filesystem';
const CANDIDATE_ESSIDS = ['BEAN-THERE-WIFI', 'BREW-AND-CODE', 'NAKATOMI-PLAZA', 'PIED-PIPER'];

const runsAgent = (host: LanHost, essid: string): boolean =>
  readOpenPorts(resolveLanHostIdentity(host, essid).baseFs).some(
    (openPort) => openPort.service === SERVICE_CATALOG.snmp.service,
  );

/** The access point's own `.1` — PINNED to run the agent for every ESSID, and the
 *  router every player can be relied on to have. */
const apGatewayOn = (essid: string): LanHost => {
  const gateway = generateHomeLan(essid).hosts.find((host) => host.ip.endsWith('.1'));
  if (gateway === undefined) throw new Error('no gateway on LAN');
  return gateway;
};

const switchRunningAgent = (): { readonly essid: string; readonly host: LanHost } => {
  for (const essid of CANDIDATE_ESSIDS) {
    const host = generateHomeLan(essid).hosts.find(
      (candidate) =>
        candidate.kind === 'switch' && !candidate.ip.endsWith('.1') && runsAgent(candidate, essid),
    );
    if (host !== undefined) return { essid, host };
  }
  throw new Error('no switch running an agent across the candidate worlds');
};

/** An address on the device's own segment — where a forward is allowed to point. */
const onSegment = (essid: string, octet: number): string =>
  `${generateHomeLan(essid).subnet}.${octet}`;

const patchRow = (path: string, content: string | null): OwnerPatchRow =>
  ({
    path: asAbsPath(path),
    content,
    owner: 'root',
    permissions: null,
    node_type: 'file',
    updated_at: '2026-08-09T11:00:00.000Z',
    writer_key: 'b'.repeat(64),
  }) as OwnerPatchRow;

/** A device whose read-write community is a string this test knows, planted the way its
 *  owner's own edit would arrive, optionally over a port-table file of its own. */
const answering = (...files: readonly OwnerPatchRow[]): Partial<SnmpSetDeps> => ({
  findPatches: async () => ({
    data: [patchRow('/var/lib/snmp/snmpd.conf', formatSnmpdState(md5(RW_COMMUNITY))), ...files],
    error: null,
  }),
});

const makeDeps = (over: Partial<SnmpSetDeps> = {}) => {
  const findPatches = vi.fn<SnmpSetDeps['findPatches']>(async () => ({ data: [], error: null }));
  const upsertPatch = vi.fn<(row: PatchRow) => Promise<{ error: unknown }>>(async () => ({
    error: null,
  }));
  const readSnmpdLog = vi.fn<(query: MachineLogReadQuery) => Promise<MachineLogReadResult>>(
    async () => ({ data: null, error: null }),
  );
  const deps: SnmpSetDeps = {
    nonceStore: freshStore,
    now: () => FIXED_NOW,
    findPatches,
    readSnmpdLog,
    upsertPatch,
    findNetworkByPublicIp: async () => ({ data: null, error: null }),
    listOccupantsByEssid: async () => ({ data: [], error: null }),
    listLeasesByEssid: async () => ({ data: [], error: null }),
    findHomeNetworkByOwnerKey: async () => ({ data: null, error: null }),
    ...over,
  };
  return { deps, findPatches, readSnmpdLog, upsertPatch };
};

const signedSet = (
  identity: ReturnType<typeof generateIdentity>,
  request: {
    readonly essid: string;
    readonly target_ip: string;
    readonly assignment: string;
    readonly community?: string;
  },
) =>
  signRequest(identity, 'snmpSet', {
    essid: request.essid,
    target_ip: request.target_ip,
    community: request.community ?? RW_COMMUNITY,
    assignment: request.assignment,
    source_ip: CLIENT_IP,
  });

/** A set whose caller states no address at all — the log line then has nothing but the
 *  route to go on, and on the caller's own LAN the route knows nothing either. */
const signedSetWithoutSource = (
  identity: ReturnType<typeof generateIdentity>,
  request: { readonly essid: string; readonly target_ip: string; readonly assignment: string },
) =>
  signRequest(identity, 'snmpSet', {
    essid: request.essid,
    target_ip: request.target_ip,
    community: RW_COMMUNITY,
    assignment: request.assignment,
  });

/** The row this set left on a given file, or `undefined` when it wrote none. */
const writtenTo = (
  upsertPatch: ReturnType<typeof makeDeps>['upsertPatch'],
  path: string,
): PatchRow | undefined => upsertPatch.mock.calls.map((call) => call[0]).find((row) => row.path === path);

describe('opening a port on a router', () => {
  it('writes the forward the player asked for and echoes it back', async () => {
    const identity = generateIdentity();
    const essid = CANDIDATE_ESSIDS[0]!;
    const gateway = apGatewayOn(essid);
    const workstation = onSegment(essid, 10);
    const { deps, upsertPatch } = makeDeps(answering());

    const response = await handleSnmpSet(
      await signedSet(identity, {
        essid,
        target_ip: gateway.ip,
        assignment: `forward.2222=${workstation}:22`,
      }),
      deps,
    );

    expect(response).toEqual({
      status: 200,
      body: { ok: true, oid: 'forward.2222', value: `${workstation}:22` },
    });
    expect(writtenTo(upsertPatch, RULES_V4_PATH)?.content).toContain(
      `forward 2222 to ${workstation}:22`,
    );
  });

  it("writes it as the file's own row, so the seed and the edit cannot drift apart", async () => {
    const identity = generateIdentity();
    const essid = CANDIDATE_ESSIDS[0]!;
    const gateway = apGatewayOn(essid);
    const { deps, upsertPatch } = makeDeps(answering());

    await handleSnmpSet(
      await signedSet(identity, {
        essid,
        target_ip: gateway.ip,
        assignment: `forward.2222=${onSegment(essid, 10)}:22`,
      }),
      deps,
    );

    // Root-only, exactly as the boot seed plants it. A row that widened the permissions
    // would let a set do what no `nano` edit can: leave the file readable to a guest.
    expect(writtenTo(upsertPatch, RULES_V4_PATH)).toMatchObject({
      owner: RULES_V4_OWNER,
      permissions: RULES_V4_PERMISSIONS,
      node_type: 'file',
      // A GENERATED device belongs to nobody, so the caller's own key is the only
      // stable thing there is to file under. Once a box has an owner the reach hands
      // back theirs instead, which is what keeps a defender's device on one rules.v4
      // however many strangers set on it — the cross-player half proves that.
      writer_key: identity.publicKeyHex,
    });
  });

  it('leaves the header and every other rule exactly where they were', async () => {
    const identity = generateIdentity();
    const essid = CANDIDATE_ESSIDS[0]!;
    const gateway = apGatewayOn(essid);
    const { deps, upsertPatch } = makeDeps(
      answering(patchRow(RULES_V4_PATH, '# my rules\nforward 8080 to 10.0.0.9:80\n')),
    );

    await handleSnmpSet(
      await signedSet(identity, {
        essid,
        target_ip: gateway.ip,
        assignment: `forward.2222=${onSegment(essid, 10)}:22`,
      }),
      deps,
    );

    expect(writtenTo(upsertPatch, RULES_V4_PATH)?.content).toBe(
      `# my rules\nforward 8080 to 10.0.0.9:80\nforward 2222 to ${onSegment(essid, 10)}:22\n`,
    );
  });

  it('overwrites a port that already forwards somewhere', async () => {
    const identity = generateIdentity();
    const essid = CANDIDATE_ESSIDS[0]!;
    const gateway = apGatewayOn(essid);
    const { deps, upsertPatch } = makeDeps(
      answering(patchRow(RULES_V4_PATH, `forward 2222 to ${onSegment(essid, 9)}:22\n`)),
    );

    const response = await handleSnmpSet(
      await signedSet(identity, {
        essid,
        target_ip: gateway.ip,
        assignment: `forward.2222=${onSegment(essid, 10)}:3306`,
      }),
      deps,
    );

    // A forward table is keyed by public port, so one port with two destinations is not
    // a state the file can hold. Overwriting is what the owner's own edit would do; the
    // log line is what keeps it from being silent.
    expect(response.body).toEqual({
      ok: true,
      oid: 'forward.2222',
      value: `${onSegment(essid, 10)}:3306`,
    });
    expect(writtenTo(upsertPatch, RULES_V4_PATH)?.content).toBe(
      `forward 2222 to ${onSegment(essid, 10)}:3306\n`,
    );
  });

  it('closes a port again when the value names no destination', async () => {
    const identity = generateIdentity();
    const essid = CANDIDATE_ESSIDS[0]!;
    const gateway = apGatewayOn(essid);
    const { deps, upsertPatch } = makeDeps(
      answering(patchRow(RULES_V4_PATH, `forward 2222 to ${onSegment(essid, 9)}:22\n`)),
    );

    const response = await handleSnmpSet(
      await signedSet(identity, { essid, target_ip: gateway.ip, assignment: 'forward.2222=none' }),
      deps,
    );

    expect(response.body).toEqual({ ok: true, oid: 'forward.2222', value: 'none' });
    expect(writtenTo(upsertPatch, RULES_V4_PATH)?.content).toBe('\n');
  });
});

describe('filtering a port on a switch', () => {
  it('shuts a port and opens it again, through the file the switch routes by', async () => {
    const identity = generateIdentity();
    const { essid, host } = switchRunningAgent();

    const shut = makeDeps(answering());
    const shutResponse = await handleSnmpSet(
      await signedSet(identity, { essid, target_ip: host.ip, assignment: 'aclPort.22=deny' }),
      shut.deps,
    );

    expect(shutResponse.body).toEqual({ ok: true, oid: 'aclPort.22', value: 'deny' });
    expect(writtenTo(shut.upsertPatch, ACL_CONF_PATH)?.content).toContain('deny 22');

    const open = makeDeps(answering());
    const openResponse = await handleSnmpSet(
      await signedSet(identity, { essid, target_ip: host.ip, assignment: 'aclPort.8080=permit' }),
      open.deps,
    );

    // The seeded switch ships one active `deny 8080`, so this is the removal a player
    // makes to re-open the segment — the same thing deleting the line by hand does.
    expect(openResponse.body).toEqual({ ok: true, oid: 'aclPort.8080', value: 'permit' });
    expect(writtenTo(open.upsertPatch, ACL_CONF_PATH)?.content).not.toContain('deny 8080');
  });
});

describe('what an agent refuses once the community is accepted', () => {
  it("refuses a forward that points off the device's own segment", async () => {
    const identity = generateIdentity();
    const essid = CANDIDATE_ESSIDS[0]!;
    const gateway = apGatewayOn(essid);
    const { deps, upsertPatch } = makeDeps(answering());

    const response = await handleSnmpSet(
      await signedSet(identity, {
        essid,
        target_ip: gateway.ip,
        assignment: 'forward.2222=10.9.9.9:22',
      }),
      deps,
    );

    // A router forwards INTO the segment behind it. A destination somewhere else names
    // a host this device has no route to, and the rule would sit in the file looking
    // like it worked.
    expect(response).toEqual({
      status: 200,
      body: {
        ok: false,
        refusal: {
          reason: 'wrongValue',
          detail: "10.9.9.9 is not on this device's segment",
          failedObject: 'forward.2222',
        },
      },
    });
    expect(writtenTo(upsertPatch, RULES_V4_PATH)).toBeUndefined();
  });

  it('refuses an OID the device does not implement, in either direction', async () => {
    const identity = generateIdentity();
    const essid = CANDIDATE_ESSIDS[0]!;
    const gateway = apGatewayOn(essid);
    const onSwitch = switchRunningAgent();

    const router = makeDeps(answering());
    const atRouter = await handleSnmpSet(
      await signedSet(identity, { essid, target_ip: gateway.ip, assignment: 'aclPort.22=deny' }),
      router.deps,
    );

    const switched = makeDeps(answering());
    const atSwitch = await handleSnmpSet(
      await signedSet(identity, {
        essid: onSwitch.essid,
        target_ip: onSwitch.host.ip,
        assignment: `forward.2222=${onSegment(onSwitch.essid, 10)}:22`,
      }),
      switched.deps,
    );

    // A router keeps a NAT table and a switch keeps an access list. Offering either
    // device the other's OID is naming something that is not on it.
    expect(atRouter.body).toEqual({
      ok: false,
      refusal: {
        reason: 'noSuchName',
        detail: 'aclPort is not implemented on this device',
        failedObject: 'aclPort.22',
      },
    });
    expect(atSwitch.body).toEqual({
      ok: false,
      refusal: {
        reason: 'noSuchName',
        detail: 'forward is not implemented on this device',
        failedObject: 'forward.2222',
      },
    });
    expect(writtenTo(router.upsertPatch, RULES_V4_PATH)).toBeUndefined();
    expect(writtenTo(switched.upsertPatch, ACL_CONF_PATH)).toBeUndefined();
  });

  it('passes an assignment it cannot parse through to the agent refusal', async () => {
    const identity = generateIdentity();
    const essid = CANDIDATE_ESSIDS[0]!;
    const gateway = apGatewayOn(essid);
    const { deps, upsertPatch } = makeDeps(answering());

    const response = await handleSnmpSet(
      await signedSet(identity, { essid, target_ip: gateway.ip, assignment: 'sysDescr.0=hello' }),
      deps,
    );

    // The grammar lives one layer down and the door does not second-guess it. What the
    // door owns is that a refusal stops here: nothing is written, and nothing further
    // is judged against a target that was never parsed.
    expect(response.body).toEqual({
      ok: false,
      refusal: {
        reason: 'noSuchName',
        detail: 'The name does not exist in the MIB',
        failedObject: 'sysDescr.0',
      },
    });
    expect(writtenTo(upsertPatch, RULES_V4_PATH)).toBeUndefined();
  });

  it('refuses a neighbouring segment, not merely one that reads differently', async () => {
    const identity = generateIdentity();
    const essid = CANDIDATE_ESSIDS[0]!;
    const gateway = apGatewayOn(essid);
    const { deps, upsertPatch } = makeDeps(answering());
    // The /24 next door — same leading characters, different network. A bound compared
    // on anything but whole octets would wave this through, and the forward would sit in
    // the file naming a host on somebody else's segment.
    const neighbour = gateway.ip.replace(/\.\d+\.\d+$/, (match) =>
      match.replace(/^\.(\d+)/, (_, octet: string) => `.${Number(octet) + 1}`),
    );

    const response = await handleSnmpSet(
      await signedSet(identity, {
        essid,
        target_ip: gateway.ip,
        assignment: `forward.2222=${neighbour.replace(/\.\d+$/, '.10')}:22`,
      }),
      deps,
    );

    // The DETAIL, not just the reason: an unparseable value refuses at `wrongValue` too,
    // so a test satisfied by the reason alone would pass for a fixture that never
    // reached the segment check at all.
    expect(response.body).toEqual({
      ok: false,
      refusal: {
        reason: 'wrongValue',
        detail: `${neighbour.replace(/\.\d+$/, '.10')} is not on this device's segment`,
        failedObject: 'forward.2222',
      },
    });
    expect(writtenTo(upsertPatch, RULES_V4_PATH)).toBeUndefined();
  });

  it('refuses the read-only community rather than pretending the device is gone', async () => {
    const identity = generateIdentity();
    const essid = CANDIDATE_ESSIDS[0]!;
    const gateway = apGatewayOn(essid);
    const { deps, upsertPatch } = makeDeps(answering());

    const response = await handleSnmpSet(
      await signedSet(identity, {
        essid,
        target_ip: gateway.ip,
        assignment: `forward.2222=${onSegment(essid, 10)}:22`,
        community: 'public',
      }),
      deps,
    );

    // `public` is a community the device DOES answer — a walk with it works — so
    // silence here would read as the device being down while the walk beside it says
    // otherwise. Naming the tier is also the lesson: go and crack the other string.
    expect(response).toEqual({
      status: 200,
      body: {
        ok: false,
        refusal: {
          reason: 'notWritable',
          detail: 'the community "public" is read-only',
          failedObject: 'forward.2222',
        },
      },
    });
    expect(writtenTo(upsertPatch, RULES_V4_PATH)).toBeUndefined();
  });
});

describe('what an agent answers before the community is accepted', () => {
  it('answers a wrong community exactly as a device that is not there answers', async () => {
    const identity = generateIdentity();
    const essid = CANDIDATE_ESSIDS[0]!;
    const gateway = apGatewayOn(essid);
    const refused = makeDeps(answering());
    const absent = makeDeps(answering());

    const [wrongString, noDevice] = await Promise.all([
      handleSnmpSet(
        await signedSet(identity, {
          essid,
          target_ip: gateway.ip,
          assignment: 'forward.2222=none',
          community: 'not-the-string',
        }),
        refused.deps,
      ),
      handleSnmpSet(
        await signedSet(identity, {
          essid,
          target_ip: '192.168.188.253',
          assignment: 'forward.2222=none',
        }),
        absent.deps,
      ),
    ]);

    expect(wrongString).toEqual({ status: 404, body: { error: 'host_unreachable' } });
    expect(wrongString).toEqual(noDevice);
    expect(writtenTo(refused.upsertPatch, RULES_V4_PATH)).toBeUndefined();
    // The guess is still on the record, and recorded as the FAILURE it was. A verdict
    // line reading "succeeded" behind a refused string would tell a defender their
    // community is out when it is not — and hide the wall of guessing that says it is.
    const logged = writtenTo(refused.upsertPatch, SNMPD_LOG_PATH)?.content ?? '';
    expect(logged).toContain('Authentication failure (incorrect community name)');
    expect(logged).not.toContain('SET ');
  });

  it('is unreachable when the agent has been stopped, and records nothing', async () => {
    const identity = generateIdentity();
    const essid = CANDIDATE_ESSIDS[0]!;
    const gateway = apGatewayOn(essid);
    const { deps, upsertPatch } = makeDeps({
      findPatches: async () => ({
        data: [
          patchRow('/var/lib/snmp/snmpd.conf', formatSnmpdState(md5(RW_COMMUNITY))),
          patchRow(pidfilePath(SERVICE_CATALOG.snmp), null),
        ],
        error: null,
      }),
    });

    const response = await handleSnmpSet(
      await signedSet(identity, { essid, target_ip: gateway.ip, assignment: 'forward.2222=none' }),
      deps,
    );

    // `systemctl stop snmpd` is the owner's real defence. Routing and liveness are
    // separate facts server-side, so this 404 names the stopped service where a wrong
    // community's names an absent host — and the command collapses both into the one
    // silence the player sees. Nothing is written: the box never heard the request.
    expect(response.status).toBe(404);
    expect(upsertPatch).not.toHaveBeenCalled();
  });
});

describe('what a set leaves on the device', () => {
  it('records the OID, both values and the caller, beside the arrival it came in on', async () => {
    const identity = generateIdentity();
    const essid = CANDIDATE_ESSIDS[0]!;
    const gateway = apGatewayOn(essid);
    const workstation = onSegment(essid, 10);
    const { deps, upsertPatch } = makeDeps(
      answering(patchRow(RULES_V4_PATH, `forward 2222 to ${onSegment(essid, 9)}:22\n`)),
    );

    await handleSnmpSet(
      await signedSet(identity, {
        essid,
        target_ip: gateway.ip,
        assignment: `forward.2222=${workstation}:22`,
      }),
      deps,
    );

    // One append, three lines: somebody arrived, the community was accepted, and this
    // is what they changed. Separate appends would be separate read-modify-writes
    // racing over one file.
    const logged = writtenTo(upsertPatch, SNMPD_LOG_PATH)?.content ?? '';
    expect(logged).toContain('Connection from UDP: [192.168.1.50]');
    expect(logged).toContain('Authentication succeeded from UDP: [192.168.1.50]');
    expect(logged).toContain(
      `SET forward.2222 = ${onSegment(essid, 9)}:22 -> ${workstation}:22 ` +
        'from UDP: [192.168.1.50]',
    );
  });

  it('records a set that changed nothing, because somebody still held the community', async () => {
    const identity = generateIdentity();
    const essid = CANDIDATE_ESSIDS[0]!;
    const gateway = apGatewayOn(essid);
    const { deps, upsertPatch } = makeDeps(answering());

    await handleSnmpSet(
      await signedSet(identity, { essid, target_ip: gateway.ip, assignment: 'forward.9999=none' }),
      deps,
    );

    expect(writtenTo(upsertPatch, SNMPD_LOG_PATH)?.content).toContain(
      'SET forward.9999 = none -> none from UDP: [192.168.1.50]',
    );
  });

  it('leaves no SET line behind when the community bought nothing', async () => {
    const identity = generateIdentity();
    const essid = CANDIDATE_ESSIDS[0]!;
    const gateway = apGatewayOn(essid);
    const { deps, upsertPatch } = makeDeps(answering());

    await handleSnmpSet(
      await signedSet(identity, {
        essid,
        target_ip: gateway.ip,
        assignment: 'forward.2222=10.9.9.9:22',
      }),
      deps,
    );

    // The arrival and the verdict still land — somebody reached the agent and named a
    // string that worked. Nothing changed, so nothing claims to have.
    const logged = writtenTo(upsertPatch, SNMPD_LOG_PATH)?.content ?? '';
    expect(logged).toContain('Authentication succeeded');
    // EXACTLY the arrival and the verdict. Asserting only the absence of a SET line
    // would let any other line through, and a device's log is read as a record of what
    // happened rather than as a list of things that did not.
    expect(logged.split('\n').filter(Boolean)).toHaveLength(2);
  });

  it('names the value THAT port held, not whichever forward came first', async () => {
    const identity = generateIdentity();
    const essid = CANDIDATE_ESSIDS[0]!;
    const gateway = apGatewayOn(essid);
    const { deps, upsertPatch } = makeDeps(
      answering(
        patchRow(
          RULES_V4_PATH,
          `forward 8080 to ${onSegment(essid, 8)}:80
forward 2222 to ${onSegment(essid, 9)}:22
`,
        ),
      ),
    );

    await handleSnmpSet(
      await signedSet(identity, {
        essid,
        target_ip: gateway.ip,
        assignment: `forward.2222=${onSegment(essid, 10)}:22`,
      }),
      deps,
    );

    // A device with more than one forward is the ordinary case, and `old` has to come
    // from the port being set. Reading whichever rule sat first would tell a defender a
    // port changed that nobody touched.
    expect(writtenTo(upsertPatch, SNMPD_LOG_PATH)?.content).toContain(
      `SET forward.2222 = ${onSegment(essid, 9)}:22 -> ${onSegment(essid, 10)}:22`,
    );
  });

  it('reads the old value off the file that device actually keeps', async () => {
    const identity = generateIdentity();
    const { essid, host } = switchRunningAgent();
    const { deps, upsertPatch } = makeDeps(answering());

    await handleSnmpSet(
      await signedSet(identity, { essid, target_ip: host.ip, assignment: 'aclPort.8080=permit' }),
      deps,
    );

    // The seeded switch ships one active `deny 8080`. Read from a router's NAT table
    // instead, the old value would come back `none` — a line saying a port was opened
    // that had never been shut.
    expect(writtenTo(upsertPatch, SNMPD_LOG_PATH)?.content).toContain(
      'SET aclPort.8080 = deny -> permit',
    );
  });

  it('records an address it cannot resolve as unknown, never as a guess', async () => {
    const identity = generateIdentity();
    const essid = CANDIDATE_ESSIDS[0]!;
    const gateway = apGatewayOn(essid);
    const { deps, upsertPatch } = makeDeps(answering());

    await handleSnmpSet(
      await signRequest(identity, 'snmpSet', {
        essid,
        target_ip: gateway.ip,
        community: RW_COMMUNITY,
        assignment: `forward.2222=${onSegment(essid, 10)}:22`,
        source_ip: null,
      }),
      deps,
    );

    // On the caller's own LAN the route knows no address and the client claimed none.
    // A blank or invented one would be worse than an honest gap: a defender's log is
    // evidence, and a false address in it is worse than no address at all.
    expect(writtenTo(upsertPatch, SNMPD_LOG_PATH)?.content).toContain('from UDP: [unknown]');
  });

  it('refuses a request that names its own player, however well it is signed', async () => {
    const identity = generateIdentity();
    const essid = CANDIDATE_ESSIDS[0]!;
    const gateway = apGatewayOn(essid);
    const { deps, upsertPatch } = makeDeps(answering());

    const response = await handleSnmpSet(
      await signRequest(identity, 'snmpSet', {
        essid,
        target_ip: gateway.ip,
        community: RW_COMMUNITY,
        assignment: `forward.2222=${onSegment(essid, 10)}:22`,
        source_ip: CLIENT_IP,
        // The server stamps the actor from the verified signature. A payload carrying
        // one is a caller asking to be somebody else, and the write it wants lands on a
        // device under whatever key it named.
        player_key: 'f'.repeat(64),
      }),
      deps,
    );

    // The reason travels back, not just the status: a client that cannot tell a
    // malformed envelope from a stale nonce has nothing to retry on.
    expect(response.body).toEqual({ error: 'payload_invalid' });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('refuses a signed request that is not the shape this door accepts', async () => {
    const identity = generateIdentity();
    const essid = CANDIDATE_ESSIDS[0]!;
    const gateway = apGatewayOn(essid);
    const { deps, upsertPatch } = makeDeps(answering());

    const response = await handleSnmpSet(
      // Signed by a real key and still refused. A signature says who sent it, never that
      // what they sent means anything — and this door's every field is load-bearing: the
      // assignment IS the change, so a request without one is not a set that does
      // nothing, it is not a set.
      await signRequest(identity, 'snmpSet', {
        essid,
        target_ip: gateway.ip,
        community: RW_COMMUNITY,
        source_ip: CLIENT_IP,
      }),
      deps,
    );

    expect(response.body).toEqual({ error: 'payload_invalid' });
    // Nothing written, and nothing LOGGED: the agent never heard a request this door
    // could not read, so the device has no visit to record.
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('mints no session, because a set is still nobody logging in', async () => {
    const identity = generateIdentity();
    const essid = CANDIDATE_ESSIDS[0]!;
    const gateway = apGatewayOn(essid);
    const { deps, upsertPatch } = makeDeps(answering());

    await handleSnmpSet(
      await signedSet(identity, {
        essid,
        target_ip: gateway.ip,
        assignment: `forward.2222=${onSegment(essid, 10)}:22`,
      }),
      deps,
    );

    // Two rows, and they are the whole footprint of a set: the file it changed, and the
    // record that it changed it.
    expect(upsertPatch).toHaveBeenCalledTimes(2);
    expect(upsertPatch.mock.calls.map((call) => call[0].path).sort()).toEqual(
      [RULES_V4_PATH, SNMPD_LOG_PATH].sort(),
    );
  });

  it('does not claim a set that the journal refused to store', async () => {
    const identity = generateIdentity();
    const essid = CANDIDATE_ESSIDS[0]!;
    const gateway = apGatewayOn(essid);
    const upsertPatch = vi.fn<(row: PatchRow) => Promise<{ error: unknown }>>(async (row) => ({
      error: row.path === RULES_V4_PATH ? new Error('journal down') : null,
    }));
    const { deps } = makeDeps({ ...answering(), upsertPatch });

    const response = await handleSnmpSet(
      await signedSet(identity, {
        essid,
        target_ip: gateway.ip,
        assignment: `forward.2222=${onSegment(essid, 10)}:22`,
      }),
      deps,
    );

    expect(response).toEqual({ status: 500, body: { error: 'port_table_write_failed' } });
    // And it claims nothing on the device's own log. The SET line is the defender's
    // only evidence, so one naming a change the journal refused to store would be worse
    // than no line at all — the arrival and the verdict still stand.
    // EXACTLY the arrival and the verdict. Asserting only the absence of a SET line
    // would let any other line through, and a device's log is read as a record of what
    // happened rather than as a list of things that did not.
    const logged = writtenTo(upsertPatch, SNMPD_LOG_PATH)?.content ?? '';
    expect(logged).toContain('Authentication succeeded');
    expect(logged.split('\n').filter(Boolean)).toHaveLength(2);
  });
  it('records an unnamed source as unknown in BOTH the contact and the SET line', async () => {
    // On the caller's own LAN the route knows nothing about the address, so the client's
    // claim stands — and a client that claims nothing leaves the device a line with a
    // hole in it. `unknown` says a visit happened from somewhere unstated; an empty
    // bracket reads like a line the device failed to finish writing. Both lines say it,
    // because they are written by two different calls and only agree on purpose.
    const identity = generateIdentity();
    const essid = CANDIDATE_ESSIDS[0]!;
    const gateway = apGatewayOn(essid);
    const { deps, upsertPatch } = makeDeps(answering());

    const response = await handleSnmpSet(
      await signedSetWithoutSource(identity, {
        essid,
        target_ip: gateway.ip,
        assignment: `forward.2222=${onSegment(essid, 10)}:22`,
      }),
      deps,
    );

    expect(response.status).toBe(200);
    const logged = writtenTo(upsertPatch, SNMPD_LOG_PATH)?.content ?? '';
    expect(logged).toContain('Connection from UDP: [unknown]');
    expect(logged).toContain('from UDP: [unknown]');
    expect(logged).not.toContain('[]');
  });
});

/**
 * The third write: a port on the filter the answering box keeps about ITSELF.
 *
 * It lands in `rules.v4`, the same file a gateway forwards from, because a real one
 * carries both chains. So the two writes have to leave each other alone — a deny that
 * ate a forward would close a port its owner opened, and neither the walk nor the file
 * would say who did it.
 */
describe('closing a port on the box that answers', () => {
  it('writes the deny into the file the device already routes by, and echoes it back', async () => {
    const identity = generateIdentity();
    const essid = CANDIDATE_ESSIDS[0]!;
    const gateway = apGatewayOn(essid);
    const { deps, upsertPatch } = makeDeps(answering());

    const response = await handleSnmpSet(
      await signedSet(identity, {
        essid,
        target_ip: gateway.ip,
        assignment: 'inputPort.6379=deny',
      }),
      deps,
    );

    expect(response).toEqual({
      status: 200,
      body: { ok: true, oid: 'inputPort.6379', value: 'deny' },
    });
    expect(writtenTo(upsertPatch, RULES_V4_PATH)?.content).toContain('deny 6379');
  });

  it('leaves every forward in the file exactly where it was', async () => {
    const identity = generateIdentity();
    const essid = CANDIDATE_ESSIDS[0]!;
    const gateway = apGatewayOn(essid);
    const seeded = `# my rules\nforward 8080 to ${onSegment(essid, 9)}:80\n`;
    const { deps, upsertPatch } = makeDeps(answering(patchRow(RULES_V4_PATH, seeded)));

    await handleSnmpSet(
      await signedSet(identity, {
        essid,
        target_ip: gateway.ip,
        assignment: 'inputPort.6379=deny',
      }),
      deps,
    );

    const written = writtenTo(upsertPatch, RULES_V4_PATH)?.content;
    expect(written).toContain(`forward 8080 to ${onSegment(essid, 9)}:80`);
    expect(written).toContain('# my rules');
    expect(written).toContain('deny 6379');
  });

  it('opens the port again, and says what it was before', async () => {
    const identity = generateIdentity();
    const essid = CANDIDATE_ESSIDS[0]!;
    const gateway = apGatewayOn(essid);
    const { deps, upsertPatch } = makeDeps(
      answering(patchRow(RULES_V4_PATH, '# my rules\ndeny 6379\n')),
    );

    const response = await handleSnmpSet(
      await signedSet(identity, {
        essid,
        target_ip: gateway.ip,
        assignment: 'inputPort.6379=permit',
      }),
      deps,
    );

    expect(response.body).toEqual({ ok: true, oid: 'inputPort.6379', value: 'permit' });
    expect(writtenTo(upsertPatch, RULES_V4_PATH)?.content).not.toContain('deny 6379');
    // Read from the wrong chain of the same file, the old value would come back
    // `permit` — a line saying a port was opened that had never been shut.
    expect(writtenTo(upsertPatch, SNMPD_LOG_PATH)?.content).toContain(
      'SET inputPort.6379 = deny -> permit',
    );
  });

  it('refuses the filter OID on a switch, which keeps no such file', async () => {
    const identity = generateIdentity();
    const { essid, host } = switchRunningAgent();
    const { deps, upsertPatch } = makeDeps(answering());

    const response = await handleSnmpSet(
      await signedSet(identity, { essid, target_ip: host.ip, assignment: 'inputPort.22=deny' }),
      deps,
    );

    // A switch routes by its access list and has no `rules.v4` at all. Accepted here,
    // the write would create the file a switch is defined by not having.
    expect(response.body).toEqual({
      ok: false,
      refusal: {
        reason: 'noSuchName',
        detail: 'inputPort is not implemented on this device',
        failedObject: 'inputPort.22',
      },
    });
    expect(writtenTo(upsertPatch, RULES_V4_PATH)).toBeUndefined();
  });
});


/**
 * The whole point of the arc, on a box nothing generated.
 *
 * A player closed a port on their own machine with the only defence in the game that is
 * not `systemctl stop`: the service keeps running and keeps answering them, and the
 * network stops seeing it. Then somebody else cracks the community their own install
 * planted and opens it again — no shell, no session, no login, and nothing restarted.
 *
 * Different from every set before it in the file the write lands on and the vantage it
 * arrives by. A gateway's NAT table routes traffic ELSEWHERE; this is the INPUT chain of
 * the box that terminates it, and the target is a fellow occupant rather than a device
 * the world drew.
 */
describe("re-opening a port on a neighbour's own box", () => {
  /** An octet the generator did not fill, so the box answering is unambiguously the
   *  occupant's own and not a seeded sibling standing at the same address. */
  const freeOctet = (essid: string): number => {
    const taken = new Set(
      generateHomeLan(essid).hosts.map((host) => Number(host.ip.split('.')[3])),
    );
    for (let candidate = 2; candidate < 255; candidate += 1) {
      if (!taken.has(candidate)) return candidate;
    }
    throw new Error('every octet on this LAN is taken');
  };

  const occupantRow = (ownerKey: string, machineName: string) => ({
    owner_key: ownerKey,
    workstation_machine_id: `ws-${machineName}`,
    workstation_machine_name: machineName,
    workstation_username: 'neo',
    workstation_root_hash: md5('whatever'),
  });

  /** A's box as A left it: the agent up, redis up, and 6379 denied to the network by
   *  A's own hand. */
  const defendedBox = (ownerKey: string, rules: string): readonly OwnerPatchRow[] => [
    patchRow(SNMPD_CONF_PATH, SNMPD_CONF_SEED),
    patchRow(SNMPD_STATE_PATH, formatSnmpdState(md5(ownAgentCommunity(ownerKey)))),
    patchRow(
      pidfilePath(SERVICE_CATALOG.snmp),
      formatPidfileContent(SERVICE_CATALOG.snmp, SERVICE_CATALOG.snmp.defaultPort),
    ),
    patchRow(
      pidfilePath(SERVICE_CATALOG.redis),
      formatPidfileContent(SERVICE_CATALOG.redis, SERVICE_CATALOG.redis.defaultPort),
    ),
    patchRow(RULES_V4_PATH, rules),
  ];

  /** The box as it stands once the set has landed — the filter the world is judged by,
   *  read through the same function every door consults. */
  const boxWithRules = (rules: string) =>
    buildDirectory({
      etc: buildDirectory({
        iptables: buildDirectory({ 'rules.v4': buildFile(rules) }),
      }),
      var: buildDirectory({
        run: buildDirectory({
          'redis-server.pid': buildFile(
            formatPidfileContent(SERVICE_CATALOG.redis, SERVICE_CATALOG.redis.defaultPort),
          ),
        }),
      }),
    });

  const attack = (over: { readonly rules: string }) => {
    const owner = generateIdentity();
    const neighbour = generateIdentity();
    const essid = CANDIDATE_ESSIDS[0]!;
    const ownerOctet = freeOctet(essid);
    const { deps, upsertPatch } = makeDeps({
      listOccupantsByEssid: async () => ({
        data: [
          occupantRow(owner.publicKeyHex, 'nebuchadnezzar'),
          occupantRow(neighbour.publicKeyHex, 'logos'),
        ],
        error: null,
      }),
      listLeasesByEssid: async () => ({
        data: [
          { owner_key: owner.publicKeyHex, octet: ownerOctet },
          { owner_key: neighbour.publicKeyHex, octet: ownerOctet + 1 },
        ],
        error: null,
      }),
      findPatches: async () => ({
        data: [...defendedBox(owner.publicKeyHex, over.rules)],
        error: null,
      }),
    });
    return {
      deps,
      upsertPatch,
      neighbour,
      essid,
      ownerKey: owner.publicKeyHex,
      ownerIp: lanAddressFor(essid, ownerOctet),
      neighbourIp: lanAddressFor(essid, ownerOctet + 1),
      community: ownAgentCommunity(owner.publicKeyHex),
    };
  };

  it("opens a port its owner shut, with the community the owner's own install planted", async () => {
    const { deps, upsertPatch, neighbour, essid, ownerIp, community } = attack({
      rules: '# mine\ndeny 6379\n',
    });

    const response = await handleSnmpSet(
      await signedSet(neighbour, {
        essid,
        target_ip: ownerIp,
        community,
        assignment: 'inputPort.6379=permit',
      }),
      deps,
    );

    expect(response).toEqual({
      status: 200,
      body: { ok: true, oid: 'inputPort.6379', value: 'permit' },
    });

    // The observable, read through the rule every door judges the network by rather than
    // through the file: A's redis is reachable from the LAN again, and A restarted
    // nothing and was told nothing.
    const rewritten = writtenTo(upsertPatch, RULES_V4_PATH)?.content ?? '';
    expect(portsOpenToNetwork(boxWithRules(rewritten))).toContainEqual({
      port: SERVICE_CATALOG.redis.defaultPort,
      service: SERVICE_CATALOG.redis.service,
    });
  });

  it("refuses the community the owner replaced, and leaves the port shut", async () => {
    // The rotation earning its keep on the door it exists for. A stale community that
    // still opened ports would make rotation a gesture.
    const { deps, upsertPatch, neighbour, essid, ownerIp } = attack({
      rules: '# mine\ndeny 6379\n',
    });

    const response = await handleSnmpSet(
      await signedSet(neighbour, {
        essid,
        target_ip: ownerIp,
        community: 'the-one-they-rotated-away',
        assignment: 'inputPort.6379=permit',
      }),
      deps,
    );

    expect(response.status).not.toBe(200);
    expect(writtenTo(upsertPatch, RULES_V4_PATH)).toBeUndefined();
  });

  it("lands in the owner's own log, under the owner's key rather than the visitor's", async () => {
    // A's box keeps ONE log however many neighbours touch it. Written under the caller's
    // key instead, every visitor would get a row of their own and the newest would be all
    // a defender could see — a log that erased the previous attacker each time somebody
    // new arrived would not be a log at all.
    const { deps, upsertPatch, neighbour, essid, ownerIp, ownerKey, community } = attack({
      rules: '# mine' + String.fromCharCode(10) + 'deny 6379' + String.fromCharCode(10),
    });

    await handleSnmpSet(
      await signedSet(neighbour, {
        essid,
        target_ip: ownerIp,
        community,
        assignment: 'inputPort.6379=permit',
      }),
      deps,
    );

    expect(writtenTo(upsertPatch, SNMPD_LOG_PATH)).toMatchObject({
      path: SNMPD_LOG_PATH,
      writer_key: ownerKey,
    });
    expect(writtenTo(upsertPatch, SNMPD_LOG_PATH)?.writer_key).not.toBe(neighbour.publicKeyHex);
  });

  it('records the address the visitor actually arrived from, not the one they claimed', async () => {
    // The defender's only evidence, so it may not be anything the caller controls. B signs
    // a source address of their own choosing; the box logs the LEASE the server issued
    // them, because that is the address A's machine would really have seen on the WiFi.
    const { deps, upsertPatch, neighbour, essid, ownerIp, neighbourIp, community } = attack({
      rules: '# mine' + String.fromCharCode(10) + 'deny 6379' + String.fromCharCode(10),
    });

    await handleSnmpSet(
      await signedSet(neighbour, {
        essid,
        target_ip: ownerIp,
        community,
        assignment: 'inputPort.6379=permit',
      }),
      deps,
    );

    const logged = writtenTo(upsertPatch, SNMPD_LOG_PATH)?.content ?? '';
    expect(logged).toContain(neighbourIp);
    expect(logged).not.toContain(CLIENT_IP);
  });

  it("writes a refused community into that same log, so a failed attempt is evidence too", async () => {
    // The attempt a defender most wants to see. A door that logged only what succeeded
    // would leave somebody sweeping their box invisible right up until the moment they
    // got in.
    const { deps, upsertPatch, neighbour, essid, ownerIp, ownerKey } = attack({
      rules: '# mine' + String.fromCharCode(10) + 'deny 6379' + String.fromCharCode(10),
    });

    await handleSnmpSet(
      await signedSet(neighbour, {
        essid,
        target_ip: ownerIp,
        community: 'not-the-one',
        assignment: 'inputPort.6379=permit',
      }),
      deps,
    );

    expect(writtenTo(upsertPatch, SNMPD_LOG_PATH)).toMatchObject({ writer_key: ownerKey });
  });
});

