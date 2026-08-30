import { describe, expect, it, vi } from 'vitest';
import { handleSnmpWalk, type SnmpWalkDeps } from './snmpWalk';
import { signRequest } from '../signedRequest/sign';
import { generateIdentity } from '../identity/identity';
import { generateHomeLan, type LanHost } from '../generation/generateHomeLan';
import { resolveLanHostIdentity } from '../generation/lanHostIdentity';
import { SERVICE_CATALOG } from '../services/serviceCatalog';
import { pidfilePath, readOpenPorts } from '../services/pidfile';
import { formatSnmpdArrivalLine, formatSnmpdAttemptLine, SNMPD_LOG_PATH } from '../logging/snmpdLog';
import { derivePid } from '../logging/syslog';
import { formatSnmpdState } from '../snmp/rwCommunity';
import { md5 } from '../generation/md5';
import { asAbsPath, asGameTime } from '../types';
import type { OwnerPatchRow } from '../network/materializeMachineFs';
import type { MachineLogReadQuery, MachineLogReadResult } from '../patches/appendMachineLog';
import type { PatchRow } from '../patches/upsertPatch';
import type { NonceStore } from '../signedRequest/nonceStore';

/**
 * `handleSnmpWalk` answers what a device IS, and never what it does.
 *
 * That split is the whole of the read-only tier: a player who walks a gateway with
 * `public` learns its name, its platform and its addresses, and not one port it
 * forwards. The port table costs a community string somebody has to crack.
 *
 * The walk is answered HERE rather than on the client, for two reasons the client
 * cannot work around. The address may belong to a fellow occupant rather than to the
 * seeded box, and only the server can tell which — a client pre-flighting a neighbour
 * against its own generated world would answer for a real player out of the box their
 * lease displaced. And the two lines a walk leaves are patch rows on somebody else's
 * machine, which a client able to write would be able to write anywhere.
 *
 * A REFUSED community is answered exactly as an absent device is. A real agent drops a
 * bad community without a word, and an answer that distinguished the two would hand a
 * scanner a free map of which devices are worth a wordlist before it spent one.
 */

const freshStore: NonceStore = async () => ({ fresh: true });
// 2026-08-09 11:04:07 UTC — the server clock every log line here is stamped with.
const FIXED_NOW = Date.UTC(2026, 7, 9, 11, 4, 7);
const CLIENT_IP = '192.168.1.50';
const PUBLIC_IP = '82.14.203.77';

/** ESSIDs scanned in a fixed order for a device of the wanted kind that rolled an
 *  agent. Routers roll at 0.6 and switches at 0.9, so which world holds one is seeded
 *  rather than certain — searching a fixed list keeps the fixture deterministic without
 *  pinning a probability this test does not own. */
const CANDIDATE_ESSIDS = ['BEAN-THERE-WIFI', 'BREW-AND-CODE', 'NAKATOMI-PLAZA', 'PIED-PIPER'];

const runsAgent = (host: LanHost, essid: string): boolean =>
  readOpenPorts(resolveLanHostIdentity(host, essid).baseFs).some(
    (openPort) => openPort.service === SERVICE_CATALOG.snmp.service,
  );

/** The access point's own `.1`, which is PINNED to run the agent for every ESSID — the
 *  one device every player can be relied on to have. */
const apGatewayOn = (essid: string): LanHost => {
  const gateway = generateHomeLan(essid).hosts.find((host) => host.ip.endsWith('.1'));
  if (gateway === undefined) throw new Error('no gateway on LAN');
  return gateway;
};

const deviceOfKind = (kind: LanHost['kind']): { readonly essid: string; readonly host: LanHost } => {
  for (const essid of CANDIDATE_ESSIDS) {
    const host = generateHomeLan(essid).hosts.find(
      (candidate) =>
        candidate.kind === kind && !candidate.ip.endsWith('.1') && runsAgent(candidate, essid),
    );
    if (host !== undefined) return { essid, host };
  }
  throw new Error(`no ${kind} running an agent across the candidate worlds`);
};

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

const makeDeps = (over: Partial<SnmpWalkDeps> = {}) => {
  const findPatches = vi.fn<SnmpWalkDeps['findPatches']>(async () => ({ data: [], error: null }));
  const upsertPatch = vi.fn<(row: PatchRow) => Promise<{ error: unknown }>>(async () => ({
    error: null,
  }));
  const readSnmpdLog = vi.fn<(query: MachineLogReadQuery) => Promise<MachineLogReadResult>>(
    async () => ({ data: null, error: null }),
  );
  const deps: SnmpWalkDeps = {
    nonceStore: freshStore,
    now: () => FIXED_NOW,
    findPatches,
    readSnmpdLog,
    upsertPatch,
    findPublicIpByEssid: async () => ({ data: { public_ip: PUBLIC_IP }, error: null }),
    findNetworkByPublicIp: async () => ({ data: null, error: null }),
    listOccupantsByEssid: async () => ({ data: [], error: null }),
    listLeasesByEssid: async () => ({ data: [], error: null }),
    findHomeNetworkByOwnerKey: async () => ({ data: null, error: null }),
    ...over,
  };
  return { deps, findPatches, readSnmpdLog, upsertPatch };
};

const signedWalk = (
  identity: ReturnType<typeof generateIdentity>,
  request: {
    readonly essid: string;
    readonly target_ip: string;
    readonly community?: string;
  },
) =>
  signRequest(identity, 'snmpWalk', {
    essid: request.essid,
    target_ip: request.target_ip,
    community: request.community ?? 'public',
    source_ip: CLIENT_IP,
  });

/** The two lines a walk leaves, as the device's file ends up holding them —
 *  newline-terminated, the way every appended log line is. */
const loggedLines = (outcome: 'success' | 'failure', hostname: string): string =>
  [
    formatSnmpdArrivalLine({
      fromIp: CLIENT_IP,
      hostname,
      time: asGameTime(FIXED_NOW),
      pid: derivePid(FIXED_NOW),
    }),
    formatSnmpdAttemptLine({
      outcome,
      user: '',
      fromIp: CLIENT_IP,
      hostname,
      time: asGameTime(FIXED_NOW),
      pid: derivePid(FIXED_NOW),
    }),
  ].join('\n') + '\n';

describe('walking a device with the community it answers to', () => {
  it('names the device and every address it holds', async () => {
    const identity = generateIdentity();
    const essid = CANDIDATE_ESSIDS[0]!;
    const gateway = apGatewayOn(essid);
    const { deps } = makeDeps();

    const response = await handleSnmpWalk(
      await signedWalk(identity, { essid, target_ip: gateway.ip }),
      deps,
    );

    // The gateway fronts the world, so it holds two addresses and says so. Learning
    // that a device has an outside face is the single most useful thing this tier
    // returns, and it is what makes the cross-player half legible later.
    expect(response).toEqual({
      status: 200,
      body: {
        ok: true,
        // Stated, not inferred. The client picks its render from this rather than from
        // whether a port table came back, so an empty table cannot read as a refusal.
        tier: 'read-only',
        identity: {
          hostname: gateway.hostname,
          kind: 'router',
          sysContact: 'netops@corp.local',
          addresses: [gateway.ip, PUBLIC_IP],
        },
      },
    });
  });

  it('shows a device behind the gateway the one address it actually has', async () => {
    const identity = generateIdentity();
    const { essid, host } = deviceOfKind('switch');
    const { deps } = makeDeps();

    const response = await handleSnmpWalk(
      await signedWalk(identity, { essid, target_ip: host.ip }),
      deps,
    );

    // A switch has no outside face, and a second interface here would be an address
    // that answers nothing. It also names its own platform: a switch reading like a
    // router would make the two indistinguishable in the only tool that inspects one.
    expect(response.body).toEqual({
      ok: true,
      tier: 'read-only',
      identity: {
        hostname: host.hostname,
        kind: 'switch',
        sysContact: 'netops@corp.local',
        addresses: [host.ip],
      },
    });
  });

  it('leaves an arrival and an acceptance on the device’s own log', async () => {
    const identity = generateIdentity();
    const essid = CANDIDATE_ESSIDS[0]!;
    const gateway = apGatewayOn(essid);
    const { deps, upsertPatch } = makeDeps();

    await handleSnmpWalk(await signedWalk(identity, { essid, target_ip: gateway.ip }), deps);

    // ONE append carrying both lines: they are one event to the box, and two appends
    // would be two read-modify-writes racing over the same file.
    expect(upsertPatch).toHaveBeenCalledTimes(1);
    expect(upsertPatch.mock.calls[0]![0]).toMatchObject({
      path: SNMPD_LOG_PATH,
      content: loggedLines('success', gateway.hostname),
    });
  });

  it('records an unnamed source as unknown rather than as a blank', async () => {
    // On the caller's own LAN the route knows nothing about the address, so the client's
    // claim stands — and a client that claims nothing leaves the device a line with a
    // hole in it. `unknown` says a visit happened from somewhere unstated; an empty
    // bracket reads like a line the device failed to finish writing.
    const identity = generateIdentity();
    const essid = CANDIDATE_ESSIDS[0]!;
    const gateway = apGatewayOn(essid);
    const { deps, upsertPatch } = makeDeps();

    await handleSnmpWalk(
      await signRequest(identity, 'snmpWalk', {
        essid,
        target_ip: gateway.ip,
        community: 'public',
      }),
      deps,
    );

    expect(upsertPatch.mock.calls[0]![0].content).toContain('[unknown]');
  });
});

/**
 * The read-write tier. The read-only community is public knowledge and buys the device's
 * NAME; this one had to be cracked out of a root-only file and buys what the device
 * DOES. The table is rendered from the very file the box routes by, so the door cannot
 * report a forward the machine does not honour.
 */
describe('walking a device with its read-write community', () => {
  /** A device whose read-write community is a string this test knows, planted the way
   *  its owner's own edit would arrive. The generated one is drawn from a pool and is
   *  not guaranteed to be recoverable, and a walk is not the place to prove seeding. */
  const answering = (community: string): Partial<SnmpWalkDeps> => ({
    findPatches: async () => ({
      data: [patchRow('/var/lib/snmp/snmpd.conf', formatSnmpdState(md5(community)))],
      error: null,
    }),
  });

  it('returns the port table the device actually routes by, beside its identity', async () => {
    const identity = generateIdentity();
    const essid = CANDIDATE_ESSIDS[0]!;
    const gateway = apGatewayOn(essid);
    const { deps } = makeDeps({
      findPatches: async () => ({
        data: [
          patchRow('/var/lib/snmp/snmpd.conf', formatSnmpdState(md5('corpnet'))),
          patchRow('/etc/iptables/rules.v4', 'forward 2222 to 10.0.0.10:22\n'),
        ],
        error: null,
      }),
    });

    const response = await handleSnmpWalk(
      await signedWalk(identity, { essid, target_ip: gateway.ip, community: 'corpnet' }),
      deps,
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      ok: true,
      tier: 'read-write',
      identity: {
        hostname: gateway.hostname,
        kind: 'router',
        sysContact: 'netops@corp.local',
        addresses: [gateway.ip, PUBLIC_IP],
      },
      portTables: [
        { kind: 'nat', forwards: [{ publicPort: 2222, internalIp: '10.0.0.10', internalPort: 22 }] },
        { kind: 'filter', denies: [] },
      ],
    });
  });

  it('names the tier even when the device forwards nothing at all', async () => {
    // Default-deny makes this the ORDINARY answer for a fresh router, so it must read as
    // a device with an empty table rather than as a community that was refused.
    const identity = generateIdentity();
    const essid = CANDIDATE_ESSIDS[0]!;
    const gateway = apGatewayOn(essid);
    const { deps } = makeDeps(answering('corpnet'));

    const response = await handleSnmpWalk(
      await signedWalk(identity, { essid, target_ip: gateway.ip, community: 'corpnet' }),
      deps,
    );

    expect(response.body).toMatchObject({
      tier: 'read-write',
      portTables: [
        { kind: 'nat', forwards: [] },
        { kind: 'filter', denies: [] },
      ],
    });
  });

  it('gives a switch its own table, read from the file that platform keeps', async () => {
    const identity = generateIdentity();
    const { essid, host } = deviceOfKind('switch');
    const { deps } = makeDeps({
      findPatches: async () => ({
        data: [
          patchRow('/var/lib/snmp/snmpd.conf', formatSnmpdState(md5('corpnet'))),
          patchRow('/etc/switch/acl.conf', 'deny 8080\n'),
        ],
        error: null,
      }),
    });

    const response = await handleSnmpWalk(
      await signedWalk(identity, { essid, target_ip: host.ip, community: 'corpnet' }),
      deps,
    );

    expect(response.body).toMatchObject({
      tier: 'read-write',
      portTables: [{ kind: 'acl', denies: [8080] }],
    });
  });

  it('still tells the read-only community nothing about the port table', async () => {
    // The whole economy of the door. If `public` returned the table, the community
    // nobody has to crack would buy what the cracked one is for.
    const identity = generateIdentity();
    const essid = CANDIDATE_ESSIDS[0]!;
    const gateway = apGatewayOn(essid);
    const { deps } = makeDeps(answering('corpnet'));

    const response = await handleSnmpWalk(
      await signedWalk(identity, { essid, target_ip: gateway.ip }),
      deps,
    );

    expect(response.body).toMatchObject({ tier: 'read-only' });
    expect(response.body).not.toHaveProperty('portTable');
  });

  it('mints no session, because the tier that can write is still nobody logging in', async () => {
    // The hazard D6 found: `authorizeMachineAccess` never inspects session kind, so a
    // row minted here would hand `listPatches` and `upsertPatch` to whoever reached
    // port 161 — at the tier that rewrites the NAT table.
    const identity = generateIdentity();
    const essid = CANDIDATE_ESSIDS[0]!;
    const gateway = apGatewayOn(essid);
    const { deps, upsertPatch } = makeDeps(answering('corpnet'));

    await handleSnmpWalk(
      await signedWalk(identity, { essid, target_ip: gateway.ip, community: 'corpnet' }),
      deps,
    );

    // The log line is the only row a walk writes, at either tier.
    expect(upsertPatch).toHaveBeenCalledTimes(1);
    expect(upsertPatch.mock.calls[0]![0]).toMatchObject({ path: SNMPD_LOG_PATH });
  });
});

describe('walking a device with a community it does not answer to', () => {
  it('answers exactly as a device that is not there answers', async () => {
    const identity = generateIdentity();
    const essid = CANDIDATE_ESSIDS[0]!;
    const gateway = apGatewayOn(essid);
    const { deps } = makeDeps();

    const [refused, absent] = await Promise.all([
      handleSnmpWalk(
        await signedWalk(identity, { essid, target_ip: gateway.ip, community: 'private' }),
        deps,
      ),
      handleSnmpWalk(
        await signedWalk(identity, { essid, target_ip: '10.255.255.254' }),
        deps,
      ),
    ]);

    // Told apart, a walk becomes a free map of which devices hold a community worth
    // cracking — spendable before a single word of a wordlist.
    expect(refused).toEqual(absent);
  });

  it('still records the guess, because the wall of them is the defender’s evidence', async () => {
    const identity = generateIdentity();
    const essid = CANDIDATE_ESSIDS[0]!;
    const gateway = apGatewayOn(essid);
    const { deps, upsertPatch } = makeDeps();

    await handleSnmpWalk(
      await signedWalk(identity, { essid, target_ip: gateway.ip, community: 'private' }),
      deps,
    );

    // A refusal that left nothing behind would make a sweep free, and this log is the
    // only tell the owner of a device ever gets.
    expect(upsertPatch.mock.calls[0]![0]).toMatchObject({
      content: loggedLines('failure', gateway.hostname),
    });
  });
});

describe('walking a device that answers to nobody', () => {
  it('refuses the community every other device answers to', async () => {
    const identity = generateIdentity();
    const essid = CANDIDATE_ESSIDS[0]!;
    const gateway = apGatewayOn(essid);
    const { deps } = makeDeps({
      findPatches: async () => ({
        data: [patchRow('/etc/snmp/snmpd.conf', '# blanked by whoever owns this box')],
        error: null,
      }),
    });

    const response = await handleSnmpWalk(
      await signedWalk(identity, { essid, target_ip: gateway.ip }),
      deps,
    );

    // Deleting the community out of your own config is a real defence, and the door has
    // to read it as one. Falling back to `public` because the file named none would undo
    // it silently, and the owner would have no way to tell.
    expect(response.status).toBe(404);
  });
});

describe('walking a gateway whose network was never registered', () => {
  it('shows the one address it actually holds', async () => {
    const identity = generateIdentity();
    const essid = CANDIDATE_ESSIDS[0]!;
    const gateway = apGatewayOn(essid);
    const { deps } = makeDeps({
      findPublicIpByEssid: async () => ({ data: null, error: null }),
    });

    const response = await handleSnmpWalk(
      await signedWalk(identity, { essid, target_ip: gateway.ip }),
      deps,
    );

    // A second interface is a claim about the outside world, so it comes from the row
    // that allocated the address rather than from the shape of the device. No row, no
    // outside face — and never an address invented to fill the column.
    expect(response.body).toMatchObject({
      identity: { addresses: [gateway.ip] },
    });
  });
});

describe('the envelope a walk arrives in', () => {
  it('refuses a request nobody signed', async () => {
    const essid = CANDIDATE_ESSIDS[0]!;
    const gateway = apGatewayOn(essid);
    const { deps } = makeDeps();

    const response = await handleSnmpWalk(
      {
        action: 'snmpWalk',
        essid,
        target_ip: gateway.ip,
        community: 'public',
        source_ip: CLIENT_IP,
      },
      deps,
    );

    // There is no account at this door, which makes the signature the only thing that
    // says who left the line on the device. The refusal names its reason: a caller who
    // cannot tell a malformed request from a rejected one has nothing to fix.
    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty('error');
  });

  it('refuses a signed request that is not the shape this door accepts', async () => {
    const identity = generateIdentity();
    const essid = CANDIDATE_ESSIDS[0]!;
    const gateway = apGatewayOn(essid);
    const { deps } = makeDeps();

    const response = await handleSnmpWalk(
      // Signed by a real key and still refused: a signature says who sent it, never that
      // what they sent means anything.
      await signRequest(identity, 'snmpWalk', {
        essid,
        target_ip: gateway.ip,
        source_ip: CLIENT_IP,
      }),
      deps,
    );

    expect(response.status).toBe(400);
    expect(response.body).not.toHaveProperty('identity');
  });

  it('refuses a payload that names its own player key, however well signed', async () => {
    const identity = generateIdentity();
    const essid = CANDIDATE_ESSIDS[0]!;
    const gateway = apGatewayOn(essid);
    const { deps } = makeDeps();

    const response = await handleSnmpWalk(
      await signRequest(identity, 'snmpWalk', {
        essid,
        target_ip: gateway.ip,
        community: 'public',
        source_ip: CLIENT_IP,
        player_key: generateIdentity().publicKeyHex,
      }),
      deps,
    );

    // The key is stamped from the verified signature and never read off the payload.
    // Refused rather than ignored: a request that tried is one whose other fields are
    // not worth trusting either.
    expect(response.status).toBe(400);
  });
});

describe('walking a device whose agent is not running', () => {
  it('is unreachable, and records nothing at all', async () => {
    const identity = generateIdentity();
    const essid = CANDIDATE_ESSIDS[0]!;
    const gateway = apGatewayOn(essid);
    const { deps, upsertPatch } = makeDeps({
      findPatches: async () => ({
        data: [patchRow(pidfilePath(SERVICE_CATALOG.snmp), null)],
        error: null,
      }),
    });

    const response = await handleSnmpWalk(
      await signedWalk(identity, { essid, target_ip: gateway.ip }),
      deps,
    );

    // `systemctl stop snmpd` is a real defence: the device stops answering, and a
    // stranger's guesses stop accreting on a log its owner has to read.
    expect(response.status).toBe(404);
    expect(upsertPatch).not.toHaveBeenCalled();
  });
});

/**
 * A device that filters its own agent port stops answering the network, and says
 * nothing else about itself while doing it.
 *
 * The filter has to be indistinguishable from absence. Any refusal of its own would be
 * an oracle: a scanner who could tell "filtered" from "nothing here" would know exactly
 * which boxes are worth a wordlist.
 */
describe('a device that filters the port its agent answers on', () => {
  const answeringWith = (community: string, rules: string): Partial<SnmpWalkDeps> => ({
    findPatches: async () => ({
      data: [
        patchRow('/var/lib/snmp/snmpd.conf', formatSnmpdState(md5(community))),
        patchRow('/etc/iptables/rules.v4', rules),
      ],
      error: null,
    }),
  });

  it('answers a walk the way a device whose agent was stopped answers', async () => {
    // Not merely "some refusal": the SAME one, so the filter adds no oracle. A player
    // who could tell a filtered port from a stopped daemon would know which boxes are
    // defended and therefore worth a wordlist.
    const identity = generateIdentity();
    const essid = CANDIDATE_ESSIDS[0]!;
    const gateway = apGatewayOn(essid);

    const filtered = makeDeps(
      answeringWith('corpnet', `deny ${SERVICE_CATALOG.snmp.defaultPort}\n`),
    );
    const walked = await handleSnmpWalk(
      await signedWalk(identity, { essid, target_ip: gateway.ip, community: 'corpnet' }),
      filtered.deps,
    );

    const stopped = makeDeps({
      findPatches: async () => ({
        data: [
          patchRow('/var/lib/snmp/snmpd.conf', formatSnmpdState(md5('corpnet'))),
          patchRow(pidfilePath(SERVICE_CATALOG.snmp), null),
        ],
        error: null,
      }),
    });
    const silent = await handleSnmpWalk(
      await signedWalk(identity, { essid, target_ip: gateway.ip, community: 'corpnet' }),
      stopped.deps,
    );

    expect(walked).toEqual(silent);
    // Both read as unreachable to the player: routing and liveness were deliberately
    // made one answer at the surface, and this door inherits that rather than
    // inventing a third.
    expect(walked.status).toBe(404);
  });

  it('leaves no line on a device that never answered', async () => {
    // The agent did not hear this. A log line would tell its owner somebody had reached
    // a port they had closed — and tell an attacker their community was accepted.
    const identity = generateIdentity();
    const essid = CANDIDATE_ESSIDS[0]!;
    const gateway = apGatewayOn(essid);
    const { deps, upsertPatch } = makeDeps(
      answeringWith('corpnet', `deny ${SERVICE_CATALOG.snmp.defaultPort}\n`),
    );

    await handleSnmpWalk(
      await signedWalk(identity, { essid, target_ip: gateway.ip, community: 'corpnet' }),
      deps,
    );

    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('still answers on every port it did not close', async () => {
    // The point of a filter over `systemctl stop`: the daemon is up, and everything the
    // owner left open still works.
    const identity = generateIdentity();
    const essid = CANDIDATE_ESSIDS[0]!;
    const gateway = apGatewayOn(essid);
    const { deps } = makeDeps(answeringWith('corpnet', 'deny 8080\n'));

    const response = await handleSnmpWalk(
      await signedWalk(identity, { essid, target_ip: gateway.ip, community: 'corpnet' }),
      deps,
    );

    expect(response.status).toBe(200);
  });
});

/**
 * Whose journal row a walk's lines land in, on the one box two vantages can reach.
 *
 * `patches` rows are keyed by writer, and a log patch carries the WHOLE file, so on
 * replay the newest row for a path wins outright. A device that logged one visitor under
 * one key and the next under another would not be keeping a log at all — it would be
 * keeping whichever visit happened last.
 *
 * The access point's gateway is the box where that bites. It has no owner of its own, so
 * a walk from across the world accretes under the AP's stable key — the lowest octet ever
 * leased on the ESSID, which does not move when players join or leave. An occupant
 * walking the same gateway from inside stands on a different vantage and must still land
 * in that same row: otherwise a defender reading their own gateway's log would erase the
 * attacker's lines by looking at them.
 *
 * Every other box on the LAN is generated and ownerless in a different way — nobody's
 * lease has anything to do with it — so the caller's own key remains the only stable
 * thing there is to write under.
 */
describe("whose row a gateway's own log accretes under", () => {
  it('writes an occupant’s walk of their own gateway under the access point’s stable key', async () => {
    const identity = generateIdentity();
    const essid = CANDIDATE_ESSIDS[0]!;
    const gateway = apGatewayOn(essid);
    // A shared access point where the caller is NOT the lowest octet. On a network they
    // hold alone the two keys coincide and the claim cannot be told apart from its own
    // absence.
    const neighbour = generateIdentity();
    const { deps, upsertPatch } = makeDeps({
      listLeasesByEssid: async () => ({
        data: [
          { owner_key: identity.publicKeyHex, octet: 77 },
          { owner_key: neighbour.publicKeyHex, octet: 12 },
        ],
        error: null,
      }),
    });

    await handleSnmpWalk(await signedWalk(identity, { essid, target_ip: gateway.ip }), deps);

    expect(upsertPatch.mock.calls[0]![0]).toMatchObject({
      path: SNMPD_LOG_PATH,
      writer_key: neighbour.publicKeyHex,
    });
  });

  it('writes a walk of a device down the forward chain under the caller’s own key', async () => {
    // Every agent-running device on a LAN that is NOT the edge `.1` is an inner gateway,
    // so this walk resolves down that gateway's own chain rather than on the regenerated
    // LAN — a different vantage from the one above, and the reason the leases below
    // change nothing. Nobody owns a box on a hidden layer and no lease names it, so the
    // caller's key is the only stable thing there is to write under. Pinned beside the
    // gateway so the AP's stable key reads as a branch rather than a blanket rule.
    const identity = generateIdentity();
    const { essid, host } = deviceOfKind('switch');
    const neighbour = generateIdentity();
    const { deps, upsertPatch } = makeDeps({
      listLeasesByEssid: async () => ({
        data: [
          { owner_key: identity.publicKeyHex, octet: 77 },
          { owner_key: neighbour.publicKeyHex, octet: 12 },
        ],
        error: null,
      }),
    });

    await handleSnmpWalk(await signedWalk(identity, { essid, target_ip: host.ip }), deps);

    expect(upsertPatch.mock.calls[0]![0]).toMatchObject({
      path: SNMPD_LOG_PATH,
      writer_key: identity.publicKeyHex,
    });
  });
});
