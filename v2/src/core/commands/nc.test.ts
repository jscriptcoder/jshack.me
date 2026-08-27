import { describe, expect, it, vi } from 'vitest';
import { nc } from './nc';
import { commandRegistry } from './registry';
import {
  mockCommandEnv,
  mockFsViewFromTree,
  mockIdentity,
  mockNcApi,
  mockNetworkViewFromConnectivity,
  mockPatchApi,
  mockScanApi,
  mockSession,
} from '../../test/factories/commandEnv';
import { buildDirectory, buildFile } from '../../test/factories/filesystem';
import { generateHomeLan, type LanHost } from '../generation/generateHomeLan';
import { buildRemoteHostFs } from '../generation/remoteHostFs';
import { resolveLanHostIdentity } from '../generation/lanHostIdentity';
import { PIDFILE_PERMISSIONS, readOpenPorts } from '../services/pidfile';
import { SERVICE_CATALOG } from '../services/serviceCatalog';
import { assignHomeNetwork } from '../network/homeNetwork';
import { buildColdStartConnectivity, type ConnectivityState } from '../network/interfaces';
import { asAbsPath, asMachineId, asNetworkAddress, asPlayerKeyHex, type UserType } from '../types';
import type { FilePermissions } from '../filesystem/types';
import type { CommandEnv, CommandResult, NcApi, PatchResult } from './types';

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

/** No door anywhere — the default world for every test about banners and refusals.
 *  A closed port is now the BOX's answer rather than this side's: a planted listener
 *  lives in a journal only the server replays, so netcat has to knock before it can
 *  say a port is shut. */
const noDoors = (): NcApi =>
  mockNcApi({
    connect: async () => ({ ok: false, error: 'host_unreachable' }),
    connectPublic: async () => ({ ok: false, error: 'host_unreachable' }),
    connectSameLan: async () => ({ ok: false, error: 'host_unreachable' }),
    connectInnerGateway: async () => ({ ok: false, error: 'host_unreachable' }),
  });

const onlineEnv = (overrides: Partial<Parameters<typeof mockCommandEnv>[0]> = {}) =>
  mockCommandEnv({
    identity: mockIdentity({ publicKeyHex: asPlayerKeyHex(PUBKEY) }),
    network: mockNetworkViewFromConnectivity(onlineConnectivity(ESSID)),
    nc: noDoors(),
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
  it('shows usage when the host or the port is missing, naming both modes', async () => {
    // One usage line for one command. A player who typed too little has not yet
    // said which half of netcat they wanted, so the answer names both.
    const noArgs = sync(await nc.execute(onlineEnv(), [], NO_FLAGS));
    const noPort = sync(await nc.execute(onlineEnv(), ['192.168.0.5'], NO_FLAGS));

    expect(noArgs.text).toBe('nc: usage: nc <host> <port> | nc -l <port>');
    expect(noPort.text).toBe('nc: usage: nc <host> <port> | nc -l <port>');
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
  //
  // mysql is the row that shows what the rule costs: its REAL greeting is a version
  // string, so the only thing it can say here is the handshake it refuses. redis is the
  // same lesson twice — its own greeting carries a version too, so what identifies the
  // port is the error it answers a line of nonsense with. A door may identify itself; it
  // may not date itself.
  //
  // The agent is the row with the least to say. It is a datagram door, so it has no
  // greeting to quote and no handshake to refuse — a raw connection to it gets silence.
  // What is left is the plainest reading of the rule the others were bent to fit: name
  // the daemon, and stop there.
  it('name the protocol and the daemon, never the build', () => {
    const banners = Object.values(SERVICE_CATALOG).map((spec) => spec.banner);

    expect(banners).toEqual([
      'SSH-2.0-OpenSSH',
      'HTTP/1.1 400 Bad Request',
      '220 FTP server ready.',
      'ERROR 1043 (08S01): Bad handshake',
      '-ERR unknown command',
      'SNMP agent',
    ]);
  });
});

/**
 * `nc -l <port>` — leave something behind on a box you have taken.
 *
 * The other half of netcat, and the first thing in the game a player can leave on
 * a machine that outlives the shell they left it from. Planting is a purely LOCAL
 * act: it opens no connection, so it needs no network — a box whose owner pulled
 * the wifi is still a box with a backdoor waiting on it.
 *
 * The gates read in the order a player meets them: what they typed, then whether
 * they may, then whether the door is free.
 */
const LISTEN = new Map<string, string | true>([['-l', true]]);

/** A `/var/run` holding the given pidfiles (basename → content), plus any
 *  DIRECTORIES wearing a pidfile's name — something a root player can really
 *  leave there, and the reason presence alone never settles what is running. */
const varRun = (
  pidfiles: Readonly<Record<string, string>>,
  directories: readonly string[] = [],
) =>
  buildDirectory({
    var: buildDirectory({
      run: buildDirectory({
        ...Object.fromEntries(
          Object.entries(pidfiles).map(([name, content]) => [
            name,
            buildFile(content, { owner: 'root' }),
          ]),
        ),
        ...Object.fromEntries(directories.map((name) => [name, buildDirectory({})])),
      }),
    }),
  });

type RecordedWrite = {
  readonly path: string;
  readonly content: string;
  readonly isNew: boolean | undefined;
  readonly permissions: FilePermissions | undefined;
};

/** A box with the given services/listeners already up, and a recording write.
 *  Deliberately built on `mockCommandEnv`'s OFFLINE network, so every test here
 *  proves listening needs no connection rather than one of them claiming it. */
const listenEnv = (
  opts: {
    readonly userType?: UserType;
    readonly username?: string;
    readonly running?: Readonly<Record<string, string>>;
    readonly runDirectories?: readonly string[];
    readonly write?: CommandEnv['patches']['write'];
  } = {},
) => {
  const userType = opts.userType ?? 'root';
  const writes: RecordedWrite[] = [];
  const env = mockCommandEnv({
    session: mockSession({ userType, username: opts.username ?? 'mallory' }),
    fs: mockFsViewFromTree(varRun(opts.running ?? {}, opts.runDirectories), {
      userType,
      cwd: () => asAbsPath('/'),
    }),
    patches: {
      ...mockPatchApi(),
      write:
        opts.write ??
        (async (path, content, options) => {
          writes.push({
            path,
            content,
            isNew: options?.isNew,
            permissions: options?.permissions,
          });
          return { ok: true };
        }),
    },
  });
  return { env, writes };
};

describe('nc -l, planting a listener', () => {
  it('reports the port it is holding, in netcat’s own words', async () => {
    const { env } = listenEnv();

    const { text, exitCode } = sync(await nc.execute(env, ['4444'], LISTEN));

    expect(text).toBe('Listening on 0.0.0.0 4444');
    expect(exitCode).toBe(0);
  });

  it('leaves a pidfile naming the account that planted it and the tier it holds', async () => {
    // The tier is written down because the door it opens has to remember what it
    // is worth: a listener planted by root lets its next visitor do root things,
    // and one planted by a user does not.
    const { env, writes } = listenEnv({ username: 'mallory' });

    await nc.execute(env, ['4444'], LISTEN);

    expect(writes).toEqual([
      {
        path: '/var/run/nc-4444.pid',
        content: 'nc:port=4444,user=mallory,userType=root',
        isNew: true,
        permissions: PIDFILE_PERMISSIONS,
      },
    ]);
  });

  it('stamps the permissions that keep it visible one hop later', async () => {
    // Named rather than defaulted: a write that omits them takes the caller's own
    // tier defaults, and planting takes root, so the file would come out
    // root-readable and vanish on exactly the hop where a visitor's `ps` should
    // have shown it. The fifth producer is where that mistake comes back.
    const { env, writes } = listenEnv();

    await nc.execute(env, ['4444'], LISTEN);

    expect(writes[0]?.permissions).toEqual({
      read: ['root', 'user', 'guest'],
      write: ['root'],
      execute: [],
    });
  });

  it('refuses anyone but root, and writes nothing', async () => {
    // Forced rather than chosen: `/var/run` is root-writable, so a user-tier plant
    // would be refused by the walker anyway. Refusing up front says why, in the
    // words every other door on the box already uses.
    const { env, writes } = listenEnv({ userType: 'user' });

    const { text, exitCode } = sync(await nc.execute(env, ['4444'], LISTEN));

    expect(text).toBe('nc: must be run as root');
    expect(exitCode).toBe(1);
    expect(writes).toEqual([]);
  });

  it('refuses a port it is already listening on', async () => {
    const { env, writes } = listenEnv({
      running: { 'nc-4444.pid': 'nc:port=4444,user=mallory,userType=root' },
    });

    const { text, exitCode } = sync(await nc.execute(env, ['4444'], LISTEN));

    expect(text).toBe('nc: already listening on port 4444');
    expect(exitCode).toBe(1);
    expect(writes).toEqual([]);
  });

  it('refuses a port a daemon already holds, naming the conflict not the daemon', async () => {
    // Two refusals because they are two facts. Your own listener is something you
    // can `kill`; the box's sshd is something you would have to stop, which is a
    // different command and a louder one.
    const { env, writes } = listenEnv({ running: { 'sshd.pid': 'sshd:port=22' } });

    const { text, exitCode } = sync(await nc.execute(env, ['22'], LISTEN));

    expect(text).toBe('nc: port 22 already in use');
    expect(exitCode).toBe(1);
    expect(writes).toEqual([]);
  });

  it('reads the port a daemon was started on, not the one it usually takes', async () => {
    // A defender who moved ftp to 2121 has freed 21. Guarding the catalog default
    // instead of the pidfile would bar a door nobody is standing at and leave the
    // real one bindable.
    const { env, writes } = listenEnv({ running: { 'vsftpd.pid': 'vsftpd:port=2121' } });

    expect(sync(await nc.execute(env, ['2121'], LISTEN)).text).toBe(
      'nc: port 2121 already in use',
    );
    expect(sync(await nc.execute(env, ['21'], LISTEN)).text).toBe('Listening on 0.0.0.0 21');
    expect(writes).toHaveLength(1);
  });

  it('refuses a port no host could listen on, in the words connect mode already uses', async () => {
    // One command, one answer to "that is not a port". A second phrasing for the
    // same mistake would be a second thing to learn for no gain.
    for (const raw of ['0', '65536', 'abc', '4444.5', '-1']) {
      const { env, writes } = listenEnv();

      const { text, exitCode } = sync(await nc.execute(env, [raw], LISTEN));

      expect(text).toBe('nc: port must be between 1 and 65535');
      expect(exitCode).toBe(1);
      expect(writes).toEqual([]);
    }
  });

  it('accepts both ends of the range a port really has', async () => {
    for (const raw of ['1', '65535']) {
      const { env } = listenEnv();

      expect(sync(await nc.execute(env, [raw], LISTEN)).text).toBe(`Listening on 0.0.0.0 ${raw}`);
    }
  });

  it('names both of its modes when told to listen on nothing', async () => {
    const { env } = listenEnv();

    const { text, exitCode } = sync(await nc.execute(env, [], LISTEN));

    expect(text).toBe('nc: usage: nc <host> <port> | nc -l <port>');
    expect(exitCode).toBe(1);
  });

  it('reports a refused write rather than claiming a door it never opened', async () => {
    // Each failure gets its own sentence because they send a player somewhere
    // different: a refusal means try again as somebody else, a round-trip that
    // never completed means try again at all.
    const reasons = [
      { error: 'permission_denied', expected: 'nc: Permission denied' },
      { error: 'no_session', expected: 'nc: Permission denied' },
      { error: 'network_error', expected: 'nc: I/O error' },
      { error: 'modified_since_open', expected: 'nc: File changed on disk' },
    ] as const;

    for (const { error, expected } of reasons) {
      const { env } = listenEnv({ write: async (): Promise<PatchResult> => ({ ok: false, error }) });

      const { text, exitCode } = sync(await nc.execute(env, ['4444'], LISTEN));

      expect(text).toBe(expected);
      expect(exitCode).toBe(1);
    }
  });

  it('does not call a directory wearing a listener’s name an open port', async () => {
    // `mkdir /var/run/nc-4444.pid` is something a root player can really do, and
    // the reader already refuses to count it as a running process. The plant gate
    // has to agree: a box that is not listening on 4444 must not say it is, or
    // one `mkdir` bars a door nobody is standing at.
    const { env, writes } = listenEnv({ runDirectories: ['nc-4444.pid'] });

    const { exitCode } = sync(await nc.execute(env, ['4444'], LISTEN));

    expect(exitCode).toBe(0);
    expect(writes).toHaveLength(1);
  });

  it('plants on a box with no network at all', async () => {
    // Connect mode needs a wire; listening does not. `env.network` follows the
    // player's own machine rather than the box the shell is standing on, so a
    // connectivity gate here would refuse plants that have nothing to do with it.
    const { env, writes } = listenEnv();
    expect(env.network.isOnline()).toBe(false);

    expect(sync(await nc.execute(env, ['4444'], LISTEN)).exitCode).toBe(0);
    expect(writes).toHaveLength(1);
  });
});

describe('nc against a port a listener is holding', () => {
  it('still refuses, because nothing on that port knows how to answer yet', async () => {
    // An open port nothing can name is the question this whole arc exists to
    // pose. A scan calls it `unknown`, connecting is how a player asks — and
    // until the door learns to answer, the honest reply is a shut port's.
    const host = lanHostServing(22, 'ssh');
    expect(readOpenPorts(buildRemoteHostFs(ESSID, host)).some((entry) => entry.port === 4444))
      .toBe(false);

    const { text } = sync(await nc.execute(onlineEnv(), [host.ip, '4444'], NO_FLAGS));

    expect(text).toBe(`nc: connect to ${host.ip} port 4444: Connection refused`);
  });
});

describe('nc when a listener answers instead of a service', () => {
  const OPENED = { ok: true, username: 'mallory', userType: 'user' } as const;

  /** The env plus the spies, so a test can say both what the player saw and which
   *  door was knocked on — the two halves of "reachability decides the gate". */
  const withDoors = (overrides: Partial<NcApi> = {}) => {
    const connect = vi.fn(async () => ({ ...OPENED }));
    const connectPublic = vi.fn(async () => ({ ...OPENED, machineId: 'ws-remote' }));
    const connectSameLan = vi.fn(async () => ({ ...OPENED, machineId: 'ws-neighbour' }));
    const connectInnerGateway = vi.fn(async () => ({ ...OPENED, machineId: 'gw-inner' }));
    const pushSession = vi.fn();
    const setCwd = vi.fn();
    const env = onlineEnv({
      nc: mockNcApi({
        connect,
        connectPublic,
        connectSameLan,
        connectInnerGateway,
        ...overrides,
      }),
      pushSession,
      setCwd,
    });
    return { env, connect, connectPublic, connectSameLan, connectInnerGateway, pushSession, setCwd };
  };

  it('drops the player into a shell as whoever the box says planted it', async () => {
    const host = lanHostServing(22, 'ssh');
    const { env, pushSession, setCwd } = withDoors();

    const { text, exitCode } = sync(await nc.execute(env, [host.ip, '4444'], NO_FLAGS));

    expect(pushSession).toHaveBeenCalledWith(
      expect.objectContaining({ username: 'mallory', userType: 'user', kind: 'nc' }),
    );
    expect(setCwd).toHaveBeenCalledWith(asAbsPath('/home/mallory'));
    expect(text).toBe(`Connecting to ${host.ip}:4444...\nConnected to ${host.ip}.`);
    expect(exitCode).toBe(0);
  });

  it('records the port it came in through, so the shell can tell when that door is gone', async () => {
    const host = lanHostServing(22, 'ssh');
    const { env, pushSession } = withDoors();

    await nc.execute(env, [host.ip, '4444'], NO_FLAGS);

    expect(pushSession).toHaveBeenCalledWith(expect.objectContaining({ port: 4444 }));
  });

  it('lands on the machine the shared resolver names, never one the client invented', async () => {
    const host = lanHostServing(22, 'ssh');
    const { env, pushSession } = withDoors();

    await nc.execute(env, [host.ip, '4444'], NO_FLAGS);

    expect(pushSession).toHaveBeenCalledWith(
      expect.objectContaining({
        machineId: resolveLanHostIdentity(host, ESSID).machineId,
      }),
    );
  });

  it('asks nobody when the catalog can already name the port — a banner is not a way in', async () => {
    const host = lanHostServing(22, 'ssh');
    const { env, connect, pushSession } = withDoors();

    await drain(await nc.execute(env, [host.ip, '22'], NO_FLAGS));

    expect(connect).not.toHaveBeenCalled();
    expect(pushSession).not.toHaveBeenCalled();
  });

  it('refuses in netcat’s own words when the box says there is no door', async () => {
    const host = lanHostServing(22, 'ssh');
    const { env, pushSession } = withDoors({
      connect: async () => ({ ok: false, error: 'host_unreachable' }),
    });

    const { text, exitCode } = sync(await nc.execute(env, [host.ip, '4444'], NO_FLAGS));

    expect(text).toBe(`nc: connect to ${host.ip} port 4444: Connection refused`);
    expect(exitCode).toBe(1);
    expect(pushSession).not.toHaveBeenCalled();
  });

  it('knocks at the door the address decides, not one door for everything', async () => {
    const occupantIp = asNetworkAddress(emptyAddress());
    const lan = withDoors();
    await nc.execute(lan.env, [lanHostServing(22, 'ssh').ip, '4444'], NO_FLAGS);

    const neighbour = withDoors();
    const neighbourEnv = {
      ...neighbour.env,
      scan: mockScanApi({
        resolveOccupants: async () => [
          {
            workstation_machine_id: 'ws-neighbour',
            localIp: occupantIp,
            machineName: 'skylab-neighbour',
          },
        ],
      }),
    };
    await nc.execute(neighbourEnv, [occupantIp, '4444'], NO_FLAGS);

    const stranger = withDoors();
    const strangerEnv = {
      ...stranger.env,
      scan: mockScanApi({ resolvePublic: async () => ({ found: true, ports: [] }) }),
    };
    await nc.execute(strangerEnv, ['203.0.113.7', '4444'], NO_FLAGS);

    expect(lan.connect).toHaveBeenCalledTimes(1);
    expect(neighbour.connectSameLan).toHaveBeenCalledTimes(1);
    expect(stranger.connectPublic).toHaveBeenCalledTimes(1);
  });

  it('routes an inner gateway through its own door, as ssh does', async () => {
    const inner = generateHomeLan(ESSID).hosts.find(
      (host) => (host.kind === 'router' || host.kind === 'switch') && !host.ip.endsWith('.1'),
    );
    if (inner === undefined) throw new Error('no inner gateway on the generated LAN');
    const { env, connectInnerGateway, pushSession } = withDoors();

    await nc.execute(env, [inner.ip, '4444'], NO_FLAGS);

    expect(connectInnerGateway).toHaveBeenCalledTimes(1);
    expect(pushSession).toHaveBeenCalledWith(expect.objectContaining({ machineId: 'gw-inner' }));
  });
});

describe('what nc actually sends when it knocks', () => {
  const opened = { ok: true, username: 'mallory', userType: 'user' } as const;

  it('names the box, the port and the session it is opening — not just the endpoint', async () => {
    const host = lanHostServing(22, 'ssh');
    const connect = vi.fn<NcApi['connect']>(async () => opened);
    const pushSession = vi.fn();
    const env = onlineEnv({
      nc: mockNcApi({ connect }),
      pushSession,
      session: mockSession({ id: 'sess-below' }),
    });

    await nc.execute(env, [host.ip, '4444'], NO_FLAGS);

    expect(connect).toHaveBeenCalledWith({
      sessionId: expect.stringContaining('nc-4444-'),
      essid: ESSID,
      targetIp: host.ip,
      port: 4444,
      parentSessionId: 'sess-below',
      sourceIp: null,
    });
    // The row the client keeps and the one the server was asked for are the same
    // session — an id invented twice would leave the shell holding a row nobody has.
    const sent = connect.mock.calls[0][0];
    expect(pushSession).toHaveBeenCalledWith(expect.objectContaining({ id: sent.sessionId }));
  });

  it('names the LAN and the address when the door is a neighbour’s', async () => {
    const occupantIp = asNetworkAddress(emptyAddress());
    const connectSameLan = vi.fn<NcApi['connectSameLan']>(async () => ({
      ...opened,
      machineId: 'ws-neighbour',
    }));
    const env = onlineEnv({
      nc: mockNcApi({ connectSameLan }),
      session: mockSession({ id: 'sess-below' }),
      scan: mockScanApi({
        resolveOccupants: async () => [
          {
            workstation_machine_id: 'ws-neighbour',
            localIp: occupantIp,
            machineName: 'skylab-neighbour',
          },
        ],
      }),
    });

    await nc.execute(env, [occupantIp, '4444'], NO_FLAGS);

    expect(connectSameLan).toHaveBeenCalledWith({
      sessionId: expect.stringContaining('nc-4444-'),
      essid: ESSID,
      targetIp: occupantIp,
      port: 4444,
      parentSessionId: 'sess-below',
      sourceIp: null,
    });
  });

  it('names the gateway it is reaching THROUGH, not a host behind it', async () => {
    const inner = generateHomeLan(ESSID).hosts.find(
      (host) => (host.kind === 'router' || host.kind === 'switch') && !host.ip.endsWith('.1'),
    );
    if (inner === undefined) throw new Error('no inner gateway on the generated LAN');
    const connectInnerGateway = vi.fn<NcApi['connectInnerGateway']>(async () => ({
      ...opened,
      machineId: 'gw-inner',
    }));
    const env = onlineEnv({
      nc: mockNcApi({ connectInnerGateway }),
      session: mockSession({ id: 'sess-below' }),
    });

    await nc.execute(env, [inner.ip, '4444'], NO_FLAGS);

    expect(connectInnerGateway).toHaveBeenCalledWith({
      sessionId: expect.stringContaining('nc-4444-'),
      essid: ESSID,
      target: inner.ip,
      port: 4444,
      parentSessionId: 'sess-below',
      sourceIp: null,
    });
  });

  it('tells a cross-network door where the knock is being made FROM', async () => {
    const connectPublic = vi.fn<NcApi['connectPublic']>(async () => ({ ...opened, machineId: 'ws-remote' }));
    const env = onlineEnv({
      nc: mockNcApi({ connectPublic }),
      scan: mockScanApi({ resolvePublic: async () => ({ found: true, ports: [] }) }),
      session: mockSession({ id: 'sess-below', machineId: asMachineId('ws-mine') }),
    });

    await nc.execute(env, ['203.0.113.7', '4444'], NO_FLAGS);

    expect(connectPublic).toHaveBeenCalledWith({
      sessionId: expect.stringContaining('nc-4444-'),
      target: '203.0.113.7',
      callerMachineId: 'ws-mine',
      port: 4444,
      parentSessionId: 'sess-below',
      sourceIp: null,
    });
  });
});
