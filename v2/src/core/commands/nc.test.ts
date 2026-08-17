import { describe, expect, it } from 'vitest';
import { nc } from './nc';
import { commandRegistry } from './registry';
import {
  mockCommandEnv,
  mockIdentity,
  mockNetworkViewFromConnectivity,
  mockScanApi,
} from '../../test/factories/commandEnv';
import { generateHomeLan, type LanHost } from '../generation/generateHomeLan';
import { buildRemoteHostFs } from '../generation/remoteHostFs';
import { readOpenPorts } from '../services/pidfile';
import { SERVICE_CATALOG } from '../services/serviceCatalog';
import { assignHomeNetwork } from '../network/homeNetwork';
import { buildColdStartConnectivity, type ConnectivityState } from '../network/interfaces';
import { asNetworkAddress, asPlayerKeyHex } from '../types';
import type { CommandResult } from './types';

/**
 * `nc <host> <port>` — point netcat at a port and learn what answers.
 *
 * The recon verb: an open port a scan cannot name is a question, and connecting
 * is how a player answers it. Reachability resolves from the same world every
 * other network command reads — the deterministic LAN for a neighbour, the
 * server for an address on another network — so what `nmap` shows open is
 * exactly what `nc` can reach.
 */

const PUBKEY = 'a'.repeat(64);
const ESSID = 'BEAN-THERE-WIFI';
const NO_FLAGS = new Map<string, string | true>();

/** wlan0 associated + addressed on `essid`, holding the address the join would
 *  really have issued. */
const onlineConnectivity = (essid: string): ConnectivityState => {
  const cold = buildColdStartConnectivity(PUBKEY);
  const wlan0 = cold.interfaces.get('wlan0');
  if (wlan0 === undefined || wlan0.kind !== 'wireless') throw new Error('no wlan0 in cold start');
  const { localIp } = assignHomeNetwork(PUBKEY, essid);
  const connected = { ...wlan0, association: { essid, bssid: 'AA:BB:CC:DD:EE:FF' }, ipv4: localIp };
  return { interfaces: new Map(cold.interfaces).set('wlan0', connected) };
};

const SELF_IP = assignHomeNetwork(PUBKEY, ESSID).localIp;

const onlineEnv = (overrides: Partial<Parameters<typeof mockCommandEnv>[0]> = {}) =>
  mockCommandEnv({
    identity: mockIdentity({ publicKeyHex: asPlayerKeyHex(PUBKEY) }),
    network: mockNetworkViewFromConnectivity(onlineConnectivity(ESSID)),
    ...overrides,
  });

/** A deterministic LAN neighbour serving `service` on `port`. Drawn from the
 *  generated world rather than hand-built, so the test reaches a host the player
 *  could really scan. */
const lanHostServing = (port: number, service: string): LanHost => {
  for (const host of generateHomeLan(ESSID).hosts) {
    if (host.kind !== 'machine') continue;
    const ports = readOpenPorts(buildRemoteHostFs(ESSID, host));
    if (ports.some((entry) => entry.port === port && entry.service === service)) return host;
  }
  throw new Error(`no generated LAN host serves ${service} on ${port}`);
};

/** An address on the player's own subnet that no generated host holds. */
const emptyAddress = (): string => {
  const lan = generateHomeLan(ESSID);
  const taken = new Set(lan.hosts.map((host) => host.ip));
  for (let octet = 2; octet < 255; octet++) {
    const candidate = `${lan.subnet}.${octet}`;
    if (!taken.has(candidate) && candidate !== SELF_IP) return candidate;
  }
  throw new Error('the whole subnet is occupied');
};

const drain = async (result: CommandResult): Promise<{ lines: string[]; exitCode: number }> => {
  if (result.kind !== 'async') throw new Error('expected an async result');
  const lines: string[] = [];
  for await (const line of result.lines) lines.push(line.content);
  return { lines, exitCode: await result.exitCode() };
};

const sync = (result: CommandResult) => {
  if (result.kind !== 'sync') throw new Error('expected a sync result');
  return { text: result.lines.map((line) => line.content).join('\n'), exitCode: result.exitCode };
};

describe('nc against a port on someone else’s box', () => {
  it('prints what is answering there, then closes the connection', async () => {
    const host = lanHostServing(22, 'ssh');

    const { lines, exitCode } = await drain(await nc.execute(onlineEnv(), [host.ip, '22'], NO_FLAGS));

    expect(lines).toEqual([
      `Connecting to ${host.ip}:22...`,
      `Connected to ${host.ip}.`,
      'SSH-2.0-OpenSSH',
      '',
      'Connection closed.',
    ]);
    expect(exitCode).toBe(0);
  });

  it('refuses a port nothing is serving, naming the port asked for', async () => {
    const host = lanHostServing(22, 'ssh');

    const { text, exitCode } = await sync(await nc.execute(onlineEnv(), [host.ip, '9999'], NO_FLAGS));

    expect(text).toBe(`nc: connect to ${host.ip} port 9999: Connection refused`);
    expect(exitCode).toBe(1);
  });

  it('times out at an address no host holds — nothing there is a different fact from a shut port', async () => {
    const address = emptyAddress();

    const { text, exitCode } = await sync(await nc.execute(onlineEnv(), [address, '22'], NO_FLAGS));

    expect(text).toBe(`nc: connect to ${address} port 22: Connection timed out`);
    expect(exitCode).toBe(1);
  });

  it('refuses your own box by name and by address — planting is local, connecting is not', async () => {
    const byName = sync(await nc.execute(onlineEnv(), ['localhost', '22'], NO_FLAGS));
    const byAddress = sync(await nc.execute(onlineEnv(), [SELF_IP, '22'], NO_FLAGS));
    const byLoopback = sync(await nc.execute(onlineEnv(), ['127.0.0.1', '22'], NO_FLAGS));

    expect(byName.text).toBe('nc: connect to localhost: Connection refused');
    expect(byAddress.text).toBe('nc: connect to localhost: Connection refused');
    expect(byLoopback.text).toBe('nc: connect to localhost: Connection refused');
  });

  it('never answers for a neighbour — a real occupant’s box is not the world’s to describe', async () => {
    // The high-risk case: an occupant holding the very octet a generated NPC serves
    // ssh on. Falling through to the generated world would have this box greet as
    // an sshd that belongs to nobody, on a machine whose services only its owner's
    // journal knows. `nmap` refuses to invent them for the same reason.
    const collided = lanHostServing(22, 'ssh');
    const env = onlineEnv({
      scan: mockScanApi({
        resolveOccupants: async () => [
          {
            workstation_machine_id: 'ws-neighbour',
            localIp: asNetworkAddress(collided.ip),
            machineName: 'skylab-neighbour',
          },
        ],
      }),
    });

    const { text, exitCode } = sync(await nc.execute(env, [collided.ip, '22'], NO_FLAGS));

    expect(text).toBe(`nc: connect to ${collided.ip} port 22: Connection refused`);
    expect(exitCode).toBe(1);
  });

  it('still answers for the NPC boxes while a neighbour is on the LAN — the address is what is spared, not the network', async () => {
    const npc = lanHostServing(22, 'ssh');
    const env = onlineEnv({
      scan: mockScanApi({
        resolveOccupants: async () => [
          {
            workstation_machine_id: 'ws-neighbour',
            localIp: asNetworkAddress(emptyAddress()),
            machineName: 'skylab-neighbour',
          },
        ],
      }),
    });

    const { lines } = await drain(await nc.execute(env, [npc.ip, '22'], NO_FLAGS));

    expect(lines).toContain('SSH-2.0-OpenSSH');
  });

  it('refuses rather than times out at a neighbour on an address no NPC holds — they are up, we just cannot say what they run', async () => {
    const address = emptyAddress();
    const env = onlineEnv({
      scan: mockScanApi({
        resolveOccupants: async () => [
          {
            workstation_machine_id: 'ws-neighbour',
            localIp: asNetworkAddress(address),
            machineName: 'skylab-neighbour',
          },
        ],
      }),
    });

    const { text } = sync(await nc.execute(env, [address, '22'], NO_FLAGS));

    expect(text).toBe(`nc: connect to ${address} port 22: Connection refused`);
  });

  it('reaches a host on another network through the server, and speaks to it the same way', async () => {
    const env = onlineEnv({
      scan: mockScanApi({
        resolvePublic: async () => ({ found: true, ports: [{ port: 21, service: 'ftp' }] }),
      }),
    });

    const { lines, exitCode } = await drain(await nc.execute(env, ['203.0.113.7', '21'], NO_FLAGS));

    expect(lines).toEqual([
      'Connecting to 203.0.113.7:21...',
      'Connected to 203.0.113.7.',
      '220 FTP server ready.',
      '',
      'Connection closed.',
    ]);
    expect(exitCode).toBe(0);
  });

  it('times out on a public address the server finds nobody at', async () => {
    const env = onlineEnv({
      scan: mockScanApi({ resolvePublic: async () => ({ found: false, ports: [] }) }),
    });

    const { text, exitCode } = sync(await nc.execute(env, ['203.0.113.7', '21'], NO_FLAGS));

    expect(text).toBe('nc: connect to 203.0.113.7 port 21: Connection timed out');
    expect(exitCode).toBe(1);
  });

  it('refuses a public port the server reports shut', async () => {
    const env = onlineEnv({
      scan: mockScanApi({
        resolvePublic: async () => ({ found: true, ports: [{ port: 21, service: 'ftp' }] }),
      }),
    });

    const { text } = sync(await nc.execute(env, ['203.0.113.7', '22'], NO_FLAGS));

    expect(text).toBe('nc: connect to 203.0.113.7 port 22: Connection refused');
  });

  it('stops mid-connect without ever printing the banner when the pace aborts', async () => {
    const host = lanHostServing(22, 'ssh');
    const env = onlineEnv({
      sleep: () => Promise.reject(new DOMException('aborted', 'AbortError')),
    });

    const result = await nc.execute(env, [host.ip, '22'], NO_FLAGS);
    if (result.kind !== 'async') throw new Error('expected an async result');
    const lines: string[] = [];
    let rejected = false;
    try {
      for await (const line of result.lines) lines.push(line.content);
    } catch {
      rejected = true;
    }

    expect(rejected).toBe(true);
    expect(lines).not.toContain('SSH-2.0-OpenSSH');
  });
});

describe('nc argument handling', () => {
  it('shows usage when the host or the port is missing', async () => {
    const noArgs = sync(await nc.execute(onlineEnv(), [], NO_FLAGS));
    const noPort = sync(await nc.execute(onlineEnv(), ['192.168.0.5'], NO_FLAGS));

    expect(noArgs.text).toBe('nc: usage: nc <host> <port>');
    expect(noPort.text).toBe('nc: usage: nc <host> <port>');
    expect(noArgs.exitCode).toBe(1);
  });

  it('rejects a port outside the range a port can hold', async () => {
    const host = lanHostServing(22, 'ssh');
    const tooLow = sync(await nc.execute(onlineEnv(), [host.ip, '0'], NO_FLAGS));
    const tooHigh = sync(await nc.execute(onlineEnv(), [host.ip, '65536'], NO_FLAGS));
    const notANumber = sync(await nc.execute(onlineEnv(), [host.ip, 'ssh'], NO_FLAGS));

    expect(tooLow.text).toBe('nc: port must be between 1 and 65535');
    expect(tooHigh.text).toBe('nc: port must be between 1 and 65535');
    expect(notANumber.text).toBe('nc: port must be between 1 and 65535');
  });

  it('accepts the first and last port a host could listen on, and finds them shut', async () => {
    const host = lanHostServing(22, 'ssh');
    const first = sync(await nc.execute(onlineEnv(), [host.ip, '1'], NO_FLAGS));
    const last = sync(await nc.execute(onlineEnv(), [host.ip, '65535'], NO_FLAGS));

    expect(first.text).toBe(`nc: connect to ${host.ip} port 1: Connection refused`);
    expect(last.text).toBe(`nc: connect to ${host.ip} port 65535: Connection refused`);
  });

  it('needs a network before it can reach anything', async () => {
    const { text, exitCode } = sync(await nc.execute(mockCommandEnv(), ['192.168.0.5', '22'], NO_FLAGS));

    expect(text).toBe('nc: network is unreachable — connect to a network first');
    expect(exitCode).toBe(1);
  });

  it('is not on a box until someone installs it', async () => {
    const gated = commandRegistry.get('nc');
    if (gated === undefined) throw new Error('nc is not registered');

    const { text, exitCode } = sync(await gated.execute(mockCommandEnv(), ['192.168.0.5', '22'], NO_FLAGS));

    expect(text).toContain('apt install netcat');
    expect(exitCode).toBe(127);
  });
});

describe('the banners the world’s doors answer with', () => {
  // Pinned together, and deliberately version-free: `nmap -sV` reads versions from
  // /var/lib/dpkg/status, so a version baked into a banner would be a second and
  // contradicting source of truth for the fact CVEs are keyed on. `SSH-2.0` and
  // `HTTP/1.1` are PROTOCOL identifiers, which is a different thing from a patch
  // level — neither one narrows a box to a build anyone could look up.
  it('name the protocol and the daemon, never the build', () => {
    const banners = Object.values(SERVICE_CATALOG).map((spec) => spec.banner);

    expect(banners).toEqual([
      'SSH-2.0-OpenSSH',
      'HTTP/1.1 400 Bad Request',
      '220 FTP server ready.',
    ]);
  });
});
