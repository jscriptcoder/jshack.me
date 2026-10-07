import { describe, expect, it, vi } from 'vitest';
import { dig } from './dig.js';
import { nslookup } from './nslookup.js';
import type { CommandResult } from './types.js';
import {
  mockCommandEnv,
  mockIdentity,
  mockNetworkView,
  mockNetworkViewFromConnectivity,
  mockScanApi,
  mockSession,
} from '../../test/factories/commandEnv.js';
import { buildColdStartConnectivity, type ConnectivityState } from '../network/interfaces.js';
import { buildDirectory } from '../../test/factories/filesystem.js';
import { assignHomeNetwork } from '../network/homeNetwork.js';
import { generateHomeLan, type LanHost } from '../generation/generateHomeLan.js';
import { zoneRecordsFor } from '../generation/generateDnsZone.js';
import { resolveLanHostIdentity } from '../generation/lanHostIdentity.js';
import { chainLinks } from '../generation/lanTopology.js';
import { resolveDeepScanHosts } from '../scan/deepScanHosts.js';
import type { OccupantProjection } from '../network/resolveOccupants.js';
import { asEpochMs, asMachineId, asPlayerKeyHex } from '../types.js';

/**
 * `dig <name>` — the same question `nslookup` asks, in the form the tool most
 * people reach for actually answers it: a record, a TTL, a class and a type, with
 * the resolver and the time it took reported underneath.
 *
 * The query time is REPORTED rather than spent. A lookup on the network you are
 * standing on is instant, and seeding the number off the name keeps it a stable
 * property of that name rather than fresh noise on every run.
 */

const PUBKEY = 'a'.repeat(64);
const ESSID = 'BEAN-THERE-WIFI';
const SLUG = 'bean-there-wifi';
/** Fri Jan 05 2024 09:07:03 UTC — a fixed clock, and deliberately one whose day,
 *  hour, minute and second are all single digits: `dig` zero-pads each of them, and
 *  a clock that never needed padding would agree with a build that did not pad. */
const NOW = 1704445623000;

const onlineConnectivity = (essid: string): ConnectivityState => {
  const cold = buildColdStartConnectivity(PUBKEY);
  const wlan0 = cold.interfaces.get('wlan0');
  if (wlan0 === undefined || wlan0.kind !== 'wireless') throw new Error('no wlan0 in cold start');
  const { localIp } = assignHomeNetwork(PUBKEY, essid);
  const connected = { ...wlan0, association: { essid, bssid: 'AA:BB:CC:DD:EE:FF' }, ipv4: localIp };
  return { interfaces: new Map(cold.interfaces).set('wlan0', connected) };
};

const onlineEnv = (occupants: readonly OccupantProjection[] = []) =>
  mockCommandEnv({
    identity: mockIdentity({ publicKeyHex: asPlayerKeyHex(PUBKEY) }),
    network: mockNetworkViewFromConnectivity(onlineConnectivity(ESSID)),
    scan: mockScanApi({ resolveOccupants: async () => occupants }),
    now: () => asEpochMs(NOW),
  });

const drain = async (
  result: CommandResult,
): Promise<{ lines: readonly string[]; exitCode: number }> => {
  if (result.kind === 'sync') {
    return { lines: result.lines.map((line) => line.content), exitCode: result.exitCode };
  }
  if (result.kind !== 'async') throw new Error('expected sync or async result');
  const lines: string[] = [];
  for await (const line of result.lines) lines.push(line.content);
  return { lines, exitCode: await result.exitCode() };
};

const run = async (...args: readonly string[]) =>
  drain(await dig.execute(onlineEnv(), args, new Map()));

const hostOnLan = (): LanHost => {
  const host = generateHomeLan(ESSID).hosts.find((candidate) => candidate.kind === 'machine');
  if (host === undefined) throw new Error('expected a generated host on the LAN');
  return host;
};

const gatewayIp = (): string => `${generateHomeLan(ESSID).subnet}.1`;

/** The `Query time:` line, whatever number it seeded — the numbers are the
 *  command's own business; that it reports one is the behaviour. */
const queryTimeLine = (lines: readonly string[]): string | undefined =>
  lines.find((line) => line.startsWith(';; Query time:'));

const HOP_ESSID = 'RIDGEMONT-OFFICE';

/** A machine on `essid`'s LAN, other than any excluded — a box a player could hop onto. */
const machineOn = (essid: string, exclude: readonly string[] = []): LanHost => {
  const host = generateHomeLan(essid).hosts.find(
    (candidate) => candidate.kind === 'machine' && !exclude.includes(candidate.ip),
  );
  if (host === undefined) throw new Error(`${essid} has no spare machine`);
  return host;
};

/** Stand in a shell on box `machineId` of `essid`, the player's own WiFi card off. */
const standingOn = (
  essid: string,
  machineId: string,
  overrides: Partial<Parameters<typeof mockCommandEnv>[0]> = {},
) =>
  mockCommandEnv({
    identity: mockIdentity({ publicKeyHex: asPlayerKeyHex(PUBKEY) }),
    network: mockNetworkView({ isOnline: () => false, interfaces: () => [] }),
    session: mockSession({
      id: 'ssh-hop-1',
      machineId: asMachineId(machineId),
      userType: 'root',
      essid,
    }),
    scan: mockScanApi({ resolveOccupants: async () => [] }),
    now: () => asEpochMs(NOW),
    ...overrides,
  });

describe('dig', () => {
  it('answers a name with an A record, the resolver, and the time it claims to have taken', async () => {
    const machine = hostOnLan();

    const { lines, exitCode } = await run(machine.hostname);

    // The WHOLE block, blank separators included: those lines are the shape real
    // `dig` output has, and a spot-check of the interesting rows would agree with a
    // build that ran them all together.
    expect(lines).toEqual([
      `; <<>> DiG 9.16.0 <<>> ${machine.hostname}`,
      ';; global options: +cmd',
      '',
      ';; ANSWER SECTION:',
      `${`${machine.hostname}.${SLUG}.lan.`.padEnd(23)} 3600  IN    A     ${machine.ip}`,
      '',
      // The number is seeded off the name, so it is pinned rather than matched: a
      // build that stopped seeding would still print SOME number here.
      ';; Query time: 4 msec',
      `;; SERVER: ${gatewayIp()}#53`,
      ';; WHEN: Fri Jan 05 09:07:03 UTC 2024',
    ]);
    expect(exitCode).toBe(0);
  });

  it('reports the same query time for the same name every run', async () => {
    // Seeded off the name: a shimmering number would read as noise, where a stable
    // one reads as a property of the lookup.
    const machine = hostOnLan();

    const first = await run(machine.hostname);
    const second = await run(machine.hostname);

    expect(queryTimeLine(first.lines)).toBe(queryTimeLine(second.lines));
  });

  it('answers NXDOMAIN for a name this network has never heard of', async () => {
    const { lines, exitCode } = await run('nosuchbox');

    // A miss drops the answer section and keeps everything else — what was asked,
    // who was asked, how long they took is what makes a failed lookup readable.
    expect(lines).toEqual([
      '; <<>> DiG 9.16.0 <<>> nosuchbox',
      ';; global options: +cmd',
      '',
      ';; status: NXDOMAIN',
      '',
      ';; Query time: 4 msec',
      `;; SERVER: ${gatewayIp()}#53`,
      ';; WHEN: Fri Jan 05 09:07:03 UTC 2024',
    ]);
    expect(exitCode).toBe(1);
  });

  it('resolves exactly what nslookup resolves, down to the address', async () => {
    // Two tools, one resolver. A player who learns an address from one and cannot
    // reach it with the other has found a bug, not a subtlety.
    const machine = hostOnLan();

    const digged = await run(machine.hostname);
    const looked = await drain(
      await nslookup.execute(onlineEnv(), [machine.hostname], new Map()),
    );

    expect(digged.lines.some((line) => line.includes(machine.ip))).toBe(true);
    expect(looked.lines).toContain(`Address: ${machine.ip}`);
  });

  it('answers for a fellow player on the network too', async () => {
    const alice: OccupantProjection = {
      workstation_machine_id: 'skylab-aaaa',
      localIp: `${generateHomeLan(ESSID).subnet}.88`,
      machineName: 'alice-rig',
    };

    const { lines } = await drain(
      await dig.execute(onlineEnv([alice]), ['alice-rig'], new Map()),
    );

    expect(lines).toContain(
      `${`alice-rig.${SLUG}.lan.`.padEnd(23)} 3600  IN    A     ${alice.localIp}`,
    );
  });

  it('answers at once, with nothing to wait for or interrupt', async () => {
    const result = await dig.execute(onlineEnv(), [hostOnLan().hostname], new Map());

    expect(result.kind).toBe('sync');
  });

  it('reports usage when asked to look up nothing', async () => {
    const { lines, exitCode } = await run();

    expect(lines).toEqual(['dig: usage: dig <name>']);
    expect(exitCode).toBe(1);
  });

  it('refuses while offline, even with a fully associated, addressed wlan0', async () => {
    const conn = onlineConnectivity(ESSID);
    const env = mockCommandEnv({
      identity: mockIdentity({ publicKeyHex: asPlayerKeyHex(PUBKEY) }),
      network: mockNetworkView({
        isOnline: () => false,
        interfaces: () => [...conn.interfaces.values()],
      }),
    });

    const { lines, exitCode } = await drain(await dig.execute(env, ['gw-main'], new Map()));

    expect(lines).toEqual(['dig: network is unreachable — connect to a network first']);
    expect(exitCode).toBe(1);
  });
});

/**
 * `dig <name>` from a hop — the lookup follows the box the shell stands on, like every
 * other IP tool. The resolver it names is the gateway of the segment that box stands
 * on, and the names it answers are that network's.
 */
describe('dig from a hop', () => {
  it('asks the hop network’s resolver and answers its names, the player’s card off', async () => {
    const hop = machineOn(HOP_ESSID);
    const target = machineOn(HOP_ESSID, [hop.ip]);
    const resolver = `${generateHomeLan(HOP_ESSID).subnet}.1`;
    const env = standingOn(HOP_ESSID, resolveLanHostIdentity(hop, HOP_ESSID).machineId);

    const { lines, exitCode } = await drain(await dig.execute(env, [target.hostname], new Map()));

    expect(lines).toContain(';; ANSWER SECTION:');
    expect(lines.some((line) => line.includes(target.ip))).toBe(true);
    expect(lines).toContain(`;; SERVER: ${resolver}#53`);
    expect(exitCode).toBe(0);
  });

  it('does not answer the player’s home names — that is another network from here', async () => {
    const hop = machineOn(HOP_ESSID);
    const hopNames = generateHomeLan(HOP_ESSID).hosts.map((host) => host.hostname);
    const home = generateHomeLan(ESSID).hosts.find(
      (host) => host.kind === 'machine' && !hopNames.includes(host.hostname),
    );
    if (home === undefined) throw new Error('expected a home name the hop’s LAN lacks');
    const env = standingOn(HOP_ESSID, resolveLanHostIdentity(hop, HOP_ESSID).machineId);

    const { lines, exitCode } = await drain(await dig.execute(env, [home.hostname], new Map()));

    expect(lines).toContain(';; status: NXDOMAIN');
    expect(exitCode).toBe(1);
  });
});

/**
 * `dig @<server> axfr` — the zone transfer. A name server hands its WHOLE zone to
 * anyone who asks: every configured host on the LAN and every host on the layers
 * behind it, addresses included — unless an admin closed `allow-transfer`. The zone is
 * generated from the ESSID, so the transfer reads it client-side and answers at once,
 * the same way `dig <name>` resolves without a round-trip.
 *
 * The transfer reaches only a name server the box can reach — the one it stands on, or
 * a layer it fronts (criterion 6): `ns-116` on GRAD-STUDENT-WIFI is a deep box at
 * 10.165.42.116 on the layer its inner gateway fronts, so a player reaches it by
 * standing on that gateway, not from home. OSCORP-GUEST's `bind-224` at 192.168.118.224
 * is a Layer-1 name server that refuses, reached from home.
 */

const GRAD_ESSID = 'GRAD-STUDENT-WIFI';
const GRAD_SLUG = 'grad-student-wifi';
/** ns-116 — a deep name server on GRAD-STUDENT-WIFI, transfer OPEN, on the layer its
 *  inner gateway fronts. */
const GRAD_NS_IP = '10.165.42.116';
/** warehouse-241, a database server on GRAD-STUDENT-WIFI's own LAN — a real MACHINE
 *  reachable from home, but not a name server, so a transfer aimed at it has no zone. */
const GRAD_NON_NS_IP = '192.168.112.241';

/** bind-224 — a Layer-1 name server on OSCORP-GUEST whose `allow-transfer` is closed. */
const OSCORP_ESSID = 'OSCORP-GUEST';
const OSCORP_NS_IP = '192.168.118.224';

/** The gateway whose fronted layer carries `serverIp` — the box a player stands on to
 *  reach a deep name server, derived so an octet reshuffle cannot rot the fixture. */
const gatewayReaching = (essid: string, serverIp: string): string => {
  for (const link of chainLinks(essid)) {
    const resolution = resolveDeepScanHosts(essid, link, buildDirectory({}));
    if (resolution.hosts.some((entry) => entry.host.ip === serverIp)) return link.machineId;
  }
  throw new Error(`no gateway fronts ${serverIp} on ${essid}`);
};

/** The home env, connected to `essid` by the player's own card — it reaches the top LAN. */
const axfrEnv = (essid: string, overrides: Partial<Parameters<typeof mockCommandEnv>[0]> = {}) =>
  mockCommandEnv({
    identity: mockIdentity({ publicKeyHex: asPlayerKeyHex(PUBKEY) }),
    network: mockNetworkViewFromConnectivity(onlineConnectivity(essid)),
    scan: mockScanApi({ resolveOccupants: async () => [] }),
    now: () => asEpochMs(NOW),
    ...overrides,
  });

/** The vantage that reaches `serverIp`: home when it is on the connected top LAN,
 *  otherwise a shell on the gateway that fronts its deep layer. */
const reachEnv = (
  essid: string,
  serverIp: string,
  overrides: Partial<Parameters<typeof mockCommandEnv>[0]> = {},
) =>
  serverIp.startsWith(`${generateHomeLan(essid).subnet}.`)
    ? axfrEnv(essid, overrides)
    : standingOn(essid, gatewayReaching(essid, serverIp), overrides);

/** The server address in an argument list — @-stripped, wherever it sits — or undefined
 *  when none was given (the usage case). */
const serverInArgs = (args: readonly string[]): string | undefined =>
  args.map((arg) => (arg.startsWith('@') ? arg.slice(1) : arg)).find((arg) => /^\d+\.\d+\.\d+\.\d+$/.test(arg));

const transfer = async (essid: string, ...args: readonly string[]) => {
  const serverIp = serverInArgs(args);
  const env = serverIp === undefined ? axfrEnv(essid) : reachEnv(essid, serverIp);
  return drain(await dig.execute(env, args, new Map()));
};

/** One transferred record in the shape `dig` prints it: the fully qualified name,
 *  then TTL, class, type and address — the same columns `dig <name>` uses for a single
 *  answer. Written from the format here, so a build that re-rendered a record has to
 *  disagree with this line rather than agree with itself. */
const axfrRecordLine = ({ name, ip }: { readonly name: string; readonly ip: string }): string =>
  `${`${name}.${GRAD_SLUG}.lan.`.padEnd(23)} 3600  IN    A     ${ip}`;

/** The A lines a transfer emits — every one, and nothing else. */
const answerRecords = (lines: readonly string[]): readonly string[] =>
  lines.filter((line) => line.includes(' IN    A     '));

describe('dig — zone transfer', () => {
  it('hands the whole zone over, line for line, when the server allows it', async () => {
    const { lines, exitCode } = await transfer(GRAD_ESSID, `@${GRAD_NS_IP}`, 'axfr');

    // The records come from the zone (the authority); the columns, the footer and the
    // seeded time are pinned here. Every configured LAN host and every deep-layer host,
    // in the zone file's own order.
    const records = zoneRecordsFor(GRAD_ESSID).map(axfrRecordLine);

    expect(lines).toEqual([
      `; <<>> DiG 9.16.0 <<>> AXFR @${GRAD_NS_IP}`,
      ';; global options: +cmd',
      '',
      ';; ANSWER SECTION:',
      ...records,
      '',
      `;; XFR size: ${records.length} records`,
      // Seeded off (essid, ip): a build that stopped seeding still prints A number,
      // and a shimmering one would read as noise where this reads as the transfer's.
      ';; Query time: 2 msec',
      `;; SERVER: ${GRAD_NS_IP}#53`,
      ';; WHEN: Fri Jan 05 09:07:03 UTC 2024',
    ]);
    expect(exitCode).toBe(0);
    // The zone spans layers: a 192.168 host the player could scan, and a 10.x host on a
    // segment behind a gateway they have not rooted. Knowing it is not reaching it.
    expect(records.some((line) => / 192\.168\./.test(line))).toBe(true);
    expect(records.some((line) => / 10\.\d/.test(line))).toBe(true);
  });

  it('refuses, and says so, when the name server locks the transfer down', async () => {
    const { lines, exitCode } = await transfer(OSCORP_ESSID, `@${OSCORP_NS_IP}`, 'axfr');

    expect(answerRecords(lines)).toEqual([]);
    expect(lines).not.toContain(';; ANSWER SECTION:');
    expect(lines).toContain('; Transfer failed.');
    expect(exitCode).toBe(1);
  });

  it('refuses a name server the box cannot reach from where it stands', async () => {
    // ns-116 is a real, open name server — but deep, on a layer a box at home does not
    // reach. From home it is refused exactly as a non-existent name server is: a player
    // reaches it only by standing on the gateway that fronts its layer (criterion 6).
    const { lines, exitCode } = await drain(
      await dig.execute(axfrEnv(GRAD_ESSID), [`@${GRAD_NS_IP}`, 'axfr'], new Map()),
    );

    expect(lines).toEqual([`dig: ${GRAD_NS_IP}: no DNS service on target`]);
    expect(exitCode).toBe(1);
  });

  it('refuses a target that is not a name server on this network', async () => {
    // A transfer aimed at a LAN machine has no zone to hand over. Without this the
    // command would answer with the current network's zone for ANY address typed.
    const { lines, exitCode } = await transfer(GRAD_ESSID, `@${GRAD_NON_NS_IP}`, 'axfr');

    expect(lines).toEqual([`dig: ${GRAD_NON_NS_IP}: no DNS service on target`]);
    expect(exitCode).toBe(1);
  });

  it('reads the server and the keyword in any order and any case', async () => {
    const canonical = await transfer(GRAD_ESSID, `@${GRAD_NS_IP}`, 'axfr');
    const reversed = await transfer(GRAD_ESSID, 'axfr', `@${GRAD_NS_IP}`);
    const shouted = await transfer(GRAD_ESSID, `@${GRAD_NS_IP}`, 'AXFR');

    expect(reversed).toEqual(canonical);
    expect(shouted).toEqual(canonical);
  });

  it('takes the server as a bare address, without the @ prefix', async () => {
    // `@server` is the convention, but a bare address names the same box. The strip and
    // the match have to agree, or `dig 10.165.42.116 axfr` targets a different IP than
    // `dig @10.165.42.116 axfr` and the two forms quietly disagree.
    const prefixed = await transfer(GRAD_ESSID, `@${GRAD_NS_IP}`, 'axfr');
    const bare = await transfer(GRAD_ESSID, GRAD_NS_IP, 'axfr');

    expect(bare).toEqual(prefixed);
  });

  it('refuses a transfer while offline, like every other network command', async () => {
    const conn = onlineConnectivity(GRAD_ESSID);
    const env = mockCommandEnv({
      identity: mockIdentity({ publicKeyHex: asPlayerKeyHex(PUBKEY) }),
      network: mockNetworkView({
        isOnline: () => false,
        interfaces: () => [...conn.interfaces.values()],
      }),
    });

    const { lines, exitCode } = await drain(
      await dig.execute(env, [`@${GRAD_NS_IP}`, 'axfr'], new Map()),
    );

    expect(lines).toEqual(['dig: network is unreachable — connect to a network first']);
    expect(exitCode).toBe(1);
  });

  it('reports the same transfer every run, for every occupant of the network', async () => {
    // The gate and the query time are seeded off (network, server) and nothing about
    // who ran it, so two players on one access point read one answer and a find repeats.
    const first = await transfer(GRAD_ESSID, `@${GRAD_NS_IP}`, 'axfr');
    const second = await transfer(GRAD_ESSID, `@${GRAD_NS_IP}`, 'axfr');

    expect(second).toEqual(first);
  });

  it('reports usage when asked to transfer from nowhere', async () => {
    const { lines, exitCode } = await transfer(GRAD_ESSID, 'axfr');

    expect(lines).toEqual(['dig: usage: dig @<server> axfr']);
    expect(exitCode).toBe(1);
  });
});

/**
 * The trace the transfer leaves. `dig` reads generation and answers instantly, so the
 * name server would learn nothing on its own — after it prints, `dig` fires a
 * fire-and-forget notify so the server can leave a `/var/log/named.log` line. The
 * notify carries only the network, the server, and the box it ran from; the server
 * places the caller and decides everything else. A lookup, a target that is not a name
 * server, and an offline terminal fire nothing — only a real transfer or a real refusal
 * is loud.
 */
describe('dig — the transfer leaves a trace', () => {
  const traceEnv = (
    essid: string,
    serverIp: string,
    recordZoneTransfer = vi.fn(async () => undefined),
  ) => ({
    recordZoneTransfer,
    env: reachEnv(essid, serverIp, {
      scan: mockScanApi({ resolveOccupants: async () => [], recordZoneTransfer }),
    }),
  });

  it('tells the name server after handing its zone over, naming the box it ran from', async () => {
    const { env, recordZoneTransfer } = traceEnv(GRAD_ESSID, GRAD_NS_IP);

    const traced = await drain(await dig.execute(env, [`@${GRAD_NS_IP}`, 'axfr'], new Map()));

    // Byte-for-byte the untraced transfer — the notify is invisible to the player.
    expect(traced).toEqual(await transfer(GRAD_ESSID, `@${GRAD_NS_IP}`, 'axfr'));
    expect(recordZoneTransfer).toHaveBeenCalledTimes(1);
    expect(recordZoneTransfer).toHaveBeenCalledWith({
      essid: GRAD_ESSID,
      serverIp: GRAD_NS_IP,
      callerMachineId: env.session.machineId,
    });
  });

  it('tells the name server about a refusal too — a denied attempt is still attributable', async () => {
    const { env, recordZoneTransfer } = traceEnv(OSCORP_ESSID, OSCORP_NS_IP);

    await drain(await dig.execute(env, [`@${OSCORP_NS_IP}`, 'axfr'], new Map()));

    expect(recordZoneTransfer).toHaveBeenCalledTimes(1);
    expect(recordZoneTransfer).toHaveBeenCalledWith({
      essid: OSCORP_ESSID,
      serverIp: OSCORP_NS_IP,
      callerMachineId: env.session.machineId,
    });
  });

  it('says nothing for an ordinary lookup — querylog is off, only transfers are loud', async () => {
    const { env, recordZoneTransfer } = traceEnv(GRAD_ESSID, GRAD_NS_IP);

    await drain(await dig.execute(env, ['ns-116'], new Map()));

    expect(recordZoneTransfer).not.toHaveBeenCalled();
  });

  it('says nothing when no name server stands at the target — there is no daemon to log it', async () => {
    const { env, recordZoneTransfer } = traceEnv(GRAD_ESSID, GRAD_NON_NS_IP);

    await drain(await dig.execute(env, [`@${GRAD_NON_NS_IP}`, 'axfr'], new Map()));

    expect(recordZoneTransfer).not.toHaveBeenCalled();
  });

  it('says nothing while offline — there was no transfer to record', async () => {
    const conn = onlineConnectivity(GRAD_ESSID);
    const recordZoneTransfer = vi.fn(async () => undefined);
    const env = mockCommandEnv({
      identity: mockIdentity({ publicKeyHex: asPlayerKeyHex(PUBKEY) }),
      network: mockNetworkView({
        isOnline: () => false,
        interfaces: () => [...conn.interfaces.values()],
      }),
      scan: mockScanApi({ resolveOccupants: async () => [], recordZoneTransfer }),
    });

    await drain(await dig.execute(env, [`@${GRAD_NS_IP}`, 'axfr'], new Map()));

    expect(recordZoneTransfer).not.toHaveBeenCalled();
  });

  it('hands over the zone even if the trace fails — logging is best-effort', async () => {
    const failing = vi.fn(async () => {
      throw new Error('trace endpoint down');
    });
    const { env } = traceEnv(GRAD_ESSID, GRAD_NS_IP, failing);

    const traced = await drain(await dig.execute(env, [`@${GRAD_NS_IP}`, 'axfr'], new Map()));

    // A rejected notify never reaches the player: the payout and exit are unchanged.
    expect(traced).toEqual(await transfer(GRAD_ESSID, `@${GRAD_NS_IP}`, 'axfr'));
  });
});

describe('man dig', () => {
  it('says it answers for the network the shell is on', () => {
    expect(dig.manual?.description).toContain('the network you are on');
  });
});
