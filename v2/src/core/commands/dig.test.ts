import { describe, expect, it } from 'vitest';
import { dig } from './dig';
import { nslookup } from './nslookup';
import type { CommandResult } from './types';
import {
  mockCommandEnv,
  mockIdentity,
  mockNetworkView,
  mockNetworkViewFromConnectivity,
  mockScanApi,
} from '../../test/factories/commandEnv';
import { buildColdStartConnectivity, type ConnectivityState } from '../network/interfaces';
import { assignHomeNetwork } from '../network/homeNetwork';
import { generateHomeLan, type LanHost } from '../generation/generateHomeLan';
import type { OccupantProjection } from '../network/resolveOccupants';
import { asEpochMs, asPlayerKeyHex } from '../types';

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
