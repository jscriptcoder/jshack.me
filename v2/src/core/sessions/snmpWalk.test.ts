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
