import { describe, expect, it, vi } from 'vitest';
import { ping } from './ping.js';
import type { CommandResult } from './types.js';
import {
  mockCommandEnv,
  mockFsViewFromTree,
  mockIdentity,
  mockNetworkView,
  mockNetworkViewFromConnectivity,
  mockScanApi,
  mockSession,
} from '../../test/factories/commandEnv.js';
import { buildDirectory } from '../../test/factories/filesystem.js';
import { resolveLanHostIdentity } from '../generation/lanHostIdentity.js';
import { chainLinks } from '../generation/lanTopology.js';
import { resolveDeepScanHosts } from '../scan/deepScanHosts.js';
import type { OccupantProjection } from '../network/resolveOccupants.js';
import { buildColdStartConnectivity, type ConnectivityState } from '../network/interfaces.js';
import { assignHomeNetwork } from '../network/homeNetwork.js';
import { generateHomeLan, type LanHost } from '../generation/generateHomeLan.js';
import { asAbsPath, asMachineId, asPlayerKeyHex } from '../types.js';

/**
 * `ping <host>` — the cheapest question a player can ask the network: is
 * anything at this address at all? It answers reachability ALONE, with no regard
 * for what the host runs, which is what makes it the step before `nmap`: an address
 * that never replies is not worth scanning.
 *
 * Round-trip times are seeded from the address, so a host reports the same latency
 * every time rather than shimmering on each run.
 */

const PUBKEY = 'a'.repeat(64);
const ESSID = 'BEAN-THERE-WIFI';

const onlineConnectivity = (essid: string): ConnectivityState => {
  const cold = buildColdStartConnectivity(PUBKEY);
  const wlan0 = cold.interfaces.get('wlan0');
  if (wlan0 === undefined || wlan0.kind !== 'wireless') throw new Error('no wlan0 in cold start');
  const { localIp } = assignHomeNetwork(PUBKEY, essid);
  const connected = { ...wlan0, association: { essid, bssid: 'AA:BB:CC:DD:EE:FF' }, ipv4: localIp };
  return { interfaces: new Map(cold.interfaces).set('wlan0', connected) };
};

const onlineEnv = () =>
  mockCommandEnv({
    identity: mockIdentity({ publicKeyHex: asPlayerKeyHex(PUBKEY) }),
    network: mockNetworkViewFromConnectivity(onlineConnectivity(ESSID)),
  });

const drain = async (result: CommandResult): Promise<{ text: string; exitCode: number }> => {
  if (result.kind === 'sync') {
    return {
      text: result.lines.map((line) => line.content).join('\n'),
      exitCode: result.exitCode,
    };
  }
  if (result.kind !== 'async') throw new Error('expected sync or async result');
  const lines: string[] = [];
  for await (const line of result.lines) lines.push(line.content);
  return { text: lines.join('\n'), exitCode: await result.exitCode() };
};

const run = async (...args: readonly string[]): Promise<{ text: string; exitCode: number }> =>
  drain(await ping.execute(onlineEnv(), args, new Map()));

/** Any generated NPC host on the LAN — a real address that must answer. */
const hostOnLan = (): LanHost => {
  const host = generateHomeLan(ESSID).hosts.find((candidate) => candidate.kind === 'machine');
  if (host === undefined) throw new Error('expected a generated host on the LAN');
  return host;
};

/** The player's own LAN address — the lease their join was issued. */
const ownIp = (): string => assignHomeNetwork(PUBKEY, ESSID).localIp;

const unoccupiedIp = (): string => {
  const lan = generateHomeLan(ESSID);
  const taken = new Set([...lan.hosts.map((host) => host.ip), ownIp()]);
  const free = Array.from({ length: 253 }, (_unused, index) => `${lan.subnet}.${index + 2}`).find(
    (ip) => !taken.has(ip),
  );
  if (free === undefined) throw new Error('expected a free address on the subnet');
  return free;
};

describe('ping', () => {
  it('reports replies from a host on the LAN', async () => {
    const host = hostOnLan();

    const { text, exitCode } = await run(host.ip);

    expect(exitCode).toBe(0);
    expect(text).toContain(`PING ${host.ip}`);
    expect(text).toMatch(new RegExp(`64 bytes from ${host.ip}: icmp_seq=1 ttl=\\d+ time=[\\d.]+ ms`));
    expect(text).toContain('4 packets transmitted, 4 received, 0% packet loss');
  });

  it('answers for the player’s own address', async () => {
    // Pinging yourself has to work — it is how a player checks their own stack
    // before blaming the network.
    const { text, exitCode } = await run(ownIp());

    expect(exitCode).toBe(0);
    expect(text).toContain('4 received');
  });

  it('reports total packet loss for an address nobody holds', async () => {
    const { text, exitCode } = await run(unoccupiedIp());

    expect(exitCode).toBe(1);
    expect(text).toContain('4 packets transmitted, 0 received, 100% packet loss');
    expect(text).not.toContain('64 bytes from');
  });

  it('always sends four packets, ignoring a surplus argument', async () => {
    // A count would be the only place in the game where a bare number carries
    // meaning, so ping takes a target and nothing else. A surplus word is dropped
    // the way nmap and lynx drop theirs, rather than refused.
    const host = hostOnLan();

    const { text, exitCode } = await run(host.ip, '2');

    expect(exitCode).toBe(0);
    expect(text).toContain('4 packets transmitted, 4 received');
    expect(text).toContain('icmp_seq=4');
  });

  it('reports the whole exchange in ping’s own shape', async () => {
    // Pinned line by line: the payload/packet sizes, the reply format, the blank
    // separator and the statistics header are what make the output recognisable as
    // ping rather than as some other tool's summary.
    const host = hostOnLan();

    const { text } = await run(host.ip);

    const lines = text.split('\n');
    expect(lines[0]).toBe(`PING ${host.ip} (${host.ip}) 56(84) bytes of data.`);
    for (const sequence of [1, 2, 3, 4]) {
      expect(lines[sequence]).toMatch(
        new RegExp(
          `^64 bytes from ${host.ip}: icmp_seq=${sequence} ttl=64 time=\\d+\\.\\d{3} ms$`,
        ),
      );
    }
    expect(lines[5]).toBe('');
    expect(lines[6]).toBe(`--- ${host.ip} ping statistics ---`);
    expect(lines[7]).toBe('4 packets transmitted, 4 received, 0% packet loss');
    expect(lines).toHaveLength(8);
  });

  it('reports round-trip times spread across a plausible range', async () => {
    // Latency has to look like latency: sub-millisecond-ish, always positive, and
    // varying between echoes rather than pinned to one value.
    const host = hostOnLan();

    const { text } = await run(host.ip);

    const times = [...text.matchAll(/time=([\d.]+) ms/g)].map((match) => Number(match[1]));
    expect(times).toHaveLength(4);
    for (const time of times) {
      expect(time).toBeGreaterThanOrEqual(0.2);
      expect(time).toBeLessThanOrEqual(2);
    }
    // Across the four echoes the range is genuinely used — a compressed or collapsed
    // spread would mean the seeded draw stopped varying.
    expect(Math.max(...times)).toBeGreaterThan(0.9);
    expect(new Set(times).size).toBeGreaterThan(1);
  });

  it('reports the same timings for the same host every run (seeded, not shimmering)', async () => {
    const host = hostOnLan();

    const first = await run(host.ip);
    const second = await run(host.ip);

    expect(first.text).toBe(second.text);
  });

  it('reports different hosts with different timings', async () => {
    const hosts = generateHomeLan(ESSID).hosts.filter((host) => host.kind === 'machine');
    const [one, two] = hosts;
    if (one === undefined || two === undefined) throw new Error('expected two generated hosts');

    const first = await run(one.ip);
    const second = await run(two.ip);

    const timesOf = (text: string): readonly string[] => text.match(/time=[\d.]+/g) ?? [];
    expect(timesOf(first.text)).not.toEqual(timesOf(second.text));
  });

  describe('refuses what it cannot send', () => {
    it('reports usage when given no target', async () => {
      const { text, exitCode } = await run();

      expect(exitCode).toBe(1);
      expect(text).toContain('usage');
    });

    it('refuses to send while offline even with a fully associated, addressed wlan0', async () => {
      // Offline while presenting an interface that would pass every later check, so
      // only the isOnline() gate can reject it.
      const conn = onlineConnectivity(ESSID);
      const env = mockCommandEnv({
        identity: mockIdentity({ publicKeyHex: asPlayerKeyHex(PUBKEY) }),
        network: mockNetworkView({
          isOnline: () => false,
          interfaces: () => [...conn.interfaces.values()],
        }),
      });

      const { text, exitCode } = await drain(await ping.execute(env, ['192.168.1.5'], new Map()));

      expect(exitCode).toBe(1);
      expect(text).toContain('unreachable');
    });

    it('refuses when online but wlan0 is not associated with a network', async () => {
      const env = mockCommandEnv({
        identity: mockIdentity({ publicKeyHex: asPlayerKeyHex(PUBKEY) }),
        network: mockNetworkViewFromConnectivity(buildColdStartConnectivity(PUBKEY)),
      });

      const { text, exitCode } = await drain(await ping.execute(env, ['192.168.1.5'], new Map()));

      expect(exitCode).toBe(1);
      expect(text).toContain('unreachable');
    });

    it('refuses when wlan0 holds an address but is associated with nothing', async () => {
      // An address without an association is still no network — and unlike the
      // no-address case (which is already offline by definition) this state passes
      // the online gate, so only the association check can stop it.
      const cold = buildColdStartConnectivity(PUBKEY);
      const wlan0 = cold.interfaces.get('wlan0');
      if (wlan0 === undefined || wlan0.kind !== 'wireless') throw new Error('no wlan0');
      const addressedOnly = { ...wlan0, association: null, ipv4: '192.168.29.7' };
      const env = mockCommandEnv({
        identity: mockIdentity({ publicKeyHex: asPlayerKeyHex(PUBKEY) }),
        network: mockNetworkViewFromConnectivity({
          interfaces: new Map(cold.interfaces).set('wlan0', addressedOnly),
        }),
      });

      const { text, exitCode } = await drain(await ping.execute(env, ['192.168.1.5'], new Map()));

      expect(exitCode).toBe(1);
      expect(text).toContain('unreachable');
    });

    it('refuses when wlan0 is associated but holds no address', async () => {
      const cold = buildColdStartConnectivity(PUBKEY);
      const wlan0 = cold.interfaces.get('wlan0');
      if (wlan0 === undefined || wlan0.kind !== 'wireless') throw new Error('no wlan0');
      const associatedOnly = {
        ...wlan0,
        association: { essid: ESSID, bssid: 'AA:BB:CC:DD:EE:FF' },
        ipv4: null,
      };
      const env = mockCommandEnv({
        identity: mockIdentity({ publicKeyHex: asPlayerKeyHex(PUBKEY) }),
        network: mockNetworkViewFromConnectivity({
          interfaces: new Map(cold.interfaces).set('wlan0', associatedOnly),
        }),
      });

      const { text, exitCode } = await drain(await ping.execute(env, ['192.168.1.5'], new Map()));

      expect(exitCode).toBe(1);
      expect(text).toContain('unreachable');
    });

    it('refuses when there is no wlan0 at all', async () => {
      const env = mockCommandEnv({
        identity: mockIdentity({ publicKeyHex: asPlayerKeyHex(PUBKEY) }),
        network: mockNetworkView({ isOnline: () => true, interfaces: () => [] }),
      });

      const { text, exitCode } = await drain(await ping.execute(env, ['192.168.1.5'], new Map()));

      expect(exitCode).toBe(1);
      expect(text).toContain('unreachable');
    });
  });
});

const HOP_ESSID = 'RIDGEMONT-OFFICE';
const DEEP_ESSID = 'TYRELL-CORP';

/** A machine on `essid`'s LAN, other than any excluded — a box a player could really
 *  hop onto. */
const machineOn = (essid: string, exclude: readonly string[] = []): LanHost => {
  const host = generateHomeLan(essid).hosts.find(
    (candidate) => candidate.kind === 'machine' && !exclude.includes(candidate.ip),
  );
  if (host === undefined) throw new Error(`${essid} has no spare machine`);
  return host;
};

/** The player stands in a shell on box `machineId` of `essid`, with their own WiFi card
 *  switched off — the radio stays with the body, the address follows the shell. */
const standingOn = (
  essid: string,
  machineId: string,
  overrides: Partial<Parameters<typeof mockCommandEnv>[0]> = {},
) =>
  mockCommandEnv({
    identity: mockIdentity({ publicKeyHex: asPlayerKeyHex(PUBKEY) }),
    network: mockNetworkView({ isOnline: () => false, interfaces: () => [] }),
    fs: mockFsViewFromTree(buildDirectory({}), { userType: 'root', cwd: () => asAbsPath('/') }),
    session: mockSession({
      id: 'ssh-hop-1',
      machineId: asMachineId(machineId),
      userType: 'root',
      essid,
    }),
    ...overrides,
  });

const hopEnv = (hop: LanHost, overrides: Partial<Parameters<typeof mockCommandEnv>[0]> = {}) =>
  standingOn(HOP_ESSID, resolveLanHostIdentity(hop, HOP_ESSID).machineId, overrides);

const pingFrom = async (
  env: ReturnType<typeof mockCommandEnv>,
  target: string,
): Promise<{ text: string; exitCode: number }> =>
  drain(await ping.execute(env, [target], new Map()));

/** An address on `essid`'s subnet that no generated host holds. */
const freeAddressOn = (essid: string, exclude: readonly string[] = []): string => {
  const lan = generateHomeLan(essid);
  const taken = new Set([...lan.hosts.map((host) => host.ip), ...exclude]);
  const free = Array.from({ length: 253 }, (_unused, index) => `${lan.subnet}.${index + 2}`).find(
    (ip) => !taken.has(ip),
  );
  if (free === undefined) throw new Error(`expected a free address on ${essid}`);
  return free;
};

const occupant = (localIp: string): OccupantProjection => ({
  workstation_machine_id: 'ws-neighbour',
  localIp,
  machineName: 'skylab-neighbour',
});

describe('ping from a hop', () => {
  it('reaches a host on the hop’s LAN with the player’s own card off', async () => {
    const hop = machineOn(HOP_ESSID);
    const target = machineOn(HOP_ESSID, [hop.ip]);

    const { text, exitCode } = await pingFrom(hopEnv(hop), target.ip);

    expect(exitCode).toBe(0);
    expect(text).toContain('4 packets transmitted, 4 received, 0% packet loss');
  });

  it('answers for the hop’s own address', async () => {
    const hop = machineOn(HOP_ESSID);

    const { exitCode } = await pingFrom(hopEnv(hop), hop.ip);

    expect(exitCode).toBe(0);
  });

  it('gets no reply from the player’s home LAN, which is another network from here', async () => {
    const hop = machineOn(HOP_ESSID);
    const hopAddresses = generateHomeLan(HOP_ESSID).hosts.map((host) => host.ip);
    const home = generateHomeLan(ESSID).hosts.find(
      (host) => host.kind === 'machine' && !hopAddresses.includes(host.ip),
    );
    if (home === undefined) throw new Error('expected a home host off the hop’s LAN');

    const { text, exitCode } = await pingFrom(hopEnv(hop), home.ip);

    expect(exitCode).toBe(1);
    expect(text).toContain('0 received, 100% packet loss');
  });

  it('reaches a fellow player’s box on the hop’s LAN, asking from the hop', async () => {
    const hop = machineOn(HOP_ESSID);
    const neighbourIp = freeAddressOn(HOP_ESSID);
    const resolveOccupants = vi.fn(async () => [occupant(neighbourIp)]);
    const env = hopEnv(hop, { scan: mockScanApi({ resolveOccupants }) });

    const { exitCode } = await pingFrom(env, neighbourIp);

    expect(exitCode).toBe(0);
    expect(resolveOccupants).toHaveBeenCalledWith(
      HOP_ESSID,
      resolveLanHostIdentity(hop, HOP_ESSID).machineId,
    );
  });

  it('does not answer a hop address no occupant holds, though another occupant is present', async () => {
    // The occupant arm answers for the box AT the address, not "someone is here": a
    // neighbour present at one address must not make a different, unheld address reply.
    const hop = machineOn(HOP_ESSID);
    const present = freeAddressOn(HOP_ESSID);
    const unheld = freeAddressOn(HOP_ESSID, [present]);
    const env = hopEnv(hop, {
      scan: mockScanApi({ resolveOccupants: async () => [occupant(present)] }),
    });

    const { text, exitCode } = await pingFrom(env, unheld);

    expect(exitCode).toBe(1);
    expect(text).toContain('0 received, 100% packet loss');
  });
});

describe('ping from a box on a deep layer', () => {
  /** The first chain link on DEEP_ESSID that fronts a machine, with that machine —
   *  found rather than hardcoded, so an octet reshuffle does not rot it. */
  const deepMachine = () => {
    for (const link of chainLinks(DEEP_ESSID)) {
      const resolution = resolveDeepScanHosts(DEEP_ESSID, link, buildDirectory({}));
      const onLayer = resolution.hosts.find((entry) => entry.host.kind === 'machine');
      if (onLayer !== undefined) return { gatewayId: link.machineId, resolution, deep: onLayer };
    }
    throw new Error(`${DEEP_ESSID} fronts no deep machine`);
  };

  it('reaches a host on the layer the gateway it stands on fronts', async () => {
    const { gatewayId, deep } = deepMachine();

    const { exitCode } = await pingFrom(standingOn(DEEP_ESSID, gatewayId), deep.host.ip);

    expect(exitCode).toBe(0);
  });

  it('gets no reply from an empty address on that layer', async () => {
    const { gatewayId, resolution } = deepMachine();
    const taken = resolution.hosts.map((entry) => entry.host.ip);
    const empty = Array.from(
      { length: 253 },
      (_unused, index) => `${resolution.subnet}.${index + 2}`,
    ).find((ip) => !taken.includes(ip));
    if (empty === undefined) throw new Error('expected a free address on the layer');

    const { exitCode } = await pingFrom(standingOn(DEEP_ESSID, gatewayId), empty);

    expect(exitCode).toBe(1);
  });

  it('answers one host on a deep layer that carries several — not only when it is the sole box', async () => {
    // A layer with a machine AND a neighbour (a gateway/router) beside it: pinging the
    // one host must still answer, so reachability is "this address is among the layer's
    // hosts", never "this address is the layer's only host".
    const essid = 'ACME-CORP';
    const crowded = chainLinks(essid)
      .map((link) => ({ link, resolution: resolveDeepScanHosts(essid, link, buildDirectory({})) }))
      .find(
        ({ resolution }) =>
          resolution.hosts.length >= 2 &&
          resolution.hosts.some((entry) => entry.host.kind === 'machine'),
      );
    if (crowded === undefined) throw new Error('expected a multi-host deep layer on ACME-CORP');
    const machine = crowded.resolution.hosts.find((entry) => entry.host.kind === 'machine')!;

    const { exitCode } = await pingFrom(
      standingOn(essid, crowded.link.machineId),
      machine.host.ip,
    );

    expect(exitCode).toBe(0);
  });
});

describe('ping at home', () => {
  it('reaches a fellow player’s box on the LAN', async () => {
    const neighbourIp = freeAddressOn(ESSID, [ownIp()]);
    const env = {
      ...onlineEnv(),
      scan: mockScanApi({ resolveOccupants: async () => [occupant(neighbourIp)] }),
    };

    const { exitCode } = await pingFrom(env, neighbourIp);

    expect(exitCode).toBe(0);
  });
});

describe('ping by name', () => {
  it('resolves a host’s name on the network the shell stands on, and pings its address', async () => {
    const hop = machineOn(HOP_ESSID);
    const target = machineOn(HOP_ESSID, [hop.ip]);

    const { text, exitCode } = await pingFrom(hopEnv(hop), target.hostname);

    expect(exitCode).toBe(0);
    const lines = text.split('\n');
    expect(lines[0]).toBe(`PING ${target.hostname} (${target.ip}) 56(84) bytes of data.`);
    expect(lines[1]).toMatch(new RegExp(`^64 bytes from ${target.ip}: icmp_seq=1 `));
    expect(lines[6]).toBe(`--- ${target.hostname} ping statistics ---`);
  });

  it('reports total loss for a name nothing answers to, as typed', async () => {
    const { text, exitCode } = await run('no-such-box');

    expect(exitCode).toBe(1);
    expect(text.split('\n')[0]).toBe('PING no-such-box (no-such-box) 56(84) bytes of data.');
  });
});

describe('man ping', () => {
  it('says it reaches the network the shell is on', () => {
    expect(ping.manual?.description).toContain('the network you are on');
  });
});
