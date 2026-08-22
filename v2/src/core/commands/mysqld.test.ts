import { describe, expect, it } from 'vitest';
import { asAbsPath, asMachineId, asPlayerKeyHex, type UserType } from '../types';
import type { CommandResult, TerminalLine } from './types';
import {
  mockCommandEnv,
  mockFsViewFromTree,
  mockIdentity,
  mockNetworkViewFromConnectivity,
  mockPatchApi,
  mockSession,
} from '../../test/factories/commandEnv';
import { buildDirectory, buildFile } from '../../test/factories/filesystem';
import { buildColdStartConnectivity, type ConnectivityState } from '../network/interfaces';
import { assignHomeNetwork } from '../network/homeNetwork';
import { PIDFILE_PERMISSIONS } from '../services/pidfile';
import { commandRegistry } from './registry';
import { mysqld } from './daemon';
import { nmap } from './nmap';
import { ps } from './ps';

/**
 * `mysqld` is the fifth front door and the first a player has to BUY. `sshd` and
 * `vsftpd` ship on every machine; the web servers and this one arrive through
 * `apt install`, which is what makes running a database a choice with a
 * consequence — you installed it, you started it, you are now a target.
 *
 * It brings the port up exactly as the other four do, by writing
 * `/var/run/mysqld.pid`, so everything that already reads that file — `nmap`,
 * `ps`, `systemctl`, and a stranger's scan across the network — sees the door
 * with nothing added for it. That shared file is the point of these tests: they
 * drive the real `ps` and the real `nmap` over the pidfile this daemon actually
 * wrote, rather than over a line hand-typed to match.
 */

const NO_FLAGS = new Map<string, string | true>();

const PUBKEY = 'a'.repeat(64);
const ESSID = 'BEAN-THERE-WIFI';

type WriteCall = {
  readonly path: string;
  readonly content: string;
  readonly options?: { readonly isNew?: boolean } | undefined;
};

type MysqldEnvOpts = {
  readonly userType?: UserType;
  /** Existing `/var/run/mysqld.pid` content (omit ⇒ not running). */
  readonly pidfile?: string;
};

/** An env whose `/var/run` optionally holds a pidfile and whose `patches.write`
 *  is a spy. Defaults: root, not running, writes succeed. */
const mysqldEnv = (opts: MysqldEnvOpts = {}) => {
  const userType = opts.userType ?? 'root';
  const writes: WriteCall[] = [];
  const run =
    opts.pidfile === undefined
      ? buildDirectory({})
      : buildDirectory({ 'mysqld.pid': buildFile(opts.pidfile, { owner: 'root' }) });
  const tree = buildDirectory({ var: buildDirectory({ run }) });
  const env = mockCommandEnv({
    session: mockSession({ userType }),
    fs: mockFsViewFromTree(tree, { userType, cwd: () => asAbsPath('/') }),
    patches: {
      ...mockPatchApi(),
      write: async (path, content, options) => {
        writes.push({ path, content, options });
        return { ok: true };
      },
    },
  });
  return { env, writes };
};

const syncResult = (
  result: CommandResult,
): { readonly text: string; readonly exitCode: number } => {
  if (result.kind !== 'sync') throw new Error('sync expected');
  return { text: result.lines.map((line) => line.content).join('\n'), exitCode: result.exitCode };
};

const streamResult = async (
  result: CommandResult,
): Promise<{
  readonly lines: readonly TerminalLine[];
  readonly text: string;
  readonly exitCode: number;
}> => {
  if (result.kind !== 'async') throw new Error('async expected');
  const lines: TerminalLine[] = [];
  for await (const line of result.lines) lines.push(line);
  return {
    lines,
    text: lines.map((line) => line.content).join('\n'),
    exitCode: await result.exitCode(),
  };
};

/** The FIRST streamed line, pulled without draining the rest — leaving the daemon
 *  suspended before the write that opens the port. */
const firstStreamedLine = async (result: CommandResult): Promise<TerminalLine | undefined> => {
  if (result.kind !== 'async') throw new Error('async expected');
  for await (const line of result.lines) return line;
  return undefined;
};

/** Start the daemon on `port` and return the `/var/run` the world is left with —
 *  built from the write it really made, so a daemon that wrote the wrong name or
 *  the wrong line leaves the readers below nothing to find. */
const varRunAfterStart = async (args: readonly string[] = []) => {
  const { env, writes } = mysqldEnv();
  await streamResult(await mysqld.execute(env, args, NO_FLAGS));
  const pidfile = writes[0];
  if (pidfile === undefined) throw new Error('mysqld wrote no pidfile');
  return buildDirectory({
    var: buildDirectory({
      run: buildDirectory({
        [pidfile.path.split('/').pop() ?? '']: buildFile(pidfile.content, { owner: 'root' }),
      }),
    }),
  });
};

describe('mysqld', () => {
  it('reports command-not-found with an apt hint on a box that never bought it', async () => {
    // The purchase is the whole gate: a fresh workstation ships no database, and
    // the player is told the package by name rather than left to guess which one
    // carries the daemon.
    const gated = commandRegistry.get('mysqld');
    if (gated === undefined) throw new Error('mysqld not registered');

    const result = await gated.execute(mockCommandEnv(), [], NO_FLAGS);

    expect(syncResult(result)).toEqual({
      text: 'bash: mysqld: command not found. Install with: apt install mysql',
      exitCode: 127,
    });
  });

  it('announces the daemon start before the pidfile is written', async () => {
    const { env, writes } = mysqldEnv();

    const first = await firstStreamedLine(await mysqld.execute(env, [], NO_FLAGS));

    expect(first).toEqual({ kind: 'text', content: 'Starting MySQL server...' });
    expect(writes).toEqual([]);
  });

  it('starts on port 3306, writing /var/run/mysqld.pid as a new file', async () => {
    const { env, writes } = mysqldEnv();

    const { lines, exitCode } = await streamResult(await mysqld.execute(env, [], NO_FLAGS));

    expect(writes).toEqual([
      {
        path: '/var/run/mysqld.pid',
        content: 'mysqld:port=3306',
        options: { isNew: true, permissions: PIDFILE_PERMISSIONS },
      },
    ]);
    expect(lines).toEqual([
      { kind: 'text', content: 'Starting MySQL server...' },
      { kind: 'text', content: 'Server listening on 0.0.0.0 port 3306.' },
    ]);
    expect(exitCode).toBe(0);
  });

  it('starts on a given port, writing that port into the pidfile', async () => {
    const { env, writes } = mysqldEnv();

    const { text, exitCode } = await streamResult(await mysqld.execute(env, ['3307'], NO_FLAGS));

    expect(writes[0].content).toBe('mysqld:port=3307');
    expect(text).toContain('port 3307');
    expect(exitCode).toBe(0);
  });

  it('refuses to start as a non-root user and writes nothing', async () => {
    const { env, writes } = mysqldEnv({ userType: 'user' });

    const result = await mysqld.execute(env, [], NO_FLAGS);

    expect(result).toEqual({
      kind: 'sync',
      lines: [{ kind: 'error', content: 'mysqld: must be run as root' }],
      exitCode: 1,
    });
    expect(writes).toEqual([]);
  });

  it('refuses to start when already running, reporting the running port, writing nothing', async () => {
    const { env, writes } = mysqldEnv({ pidfile: 'mysqld:port=3307' });

    const { text, exitCode } = syncResult(await mysqld.execute(env, [], NO_FLAGS));

    expect(text).toBe('mysqld: already running on port 3307');
    expect(exitCode).toBe(1);
    expect(writes).toEqual([]);
  });

  it('rejects a port that is no port, and writes nothing', async () => {
    const { env, writes } = mysqldEnv();

    const { text, exitCode } = syncResult(await mysqld.execute(env, ['abc'], NO_FLAGS));

    expect(text).toBe('mysqld: invalid port: abc');
    expect(exitCode).toBe(1);
    expect(writes).toEqual([]);
  });
});

/**
 * What the box says about itself once the database is up. Neither reader was
 * taught anything about mysqld: both walk `/var/run` through the shared pidfile
 * reader, which resolves `mysqld.pid` to the catalog's mysql row — so the
 * service label a scan prints and the account a survey prints come from the same
 * row the world's own database boxes are built from.
 */
describe('the door mysqld opens, as the box reports it', () => {
  it('shows up in ps as mysqld, owned by the account a database runs as', async () => {
    // `mysql`, not `root`: the catalog row says so, and every generated database
    // box in the world already shows it — a player's own box printing `root`
    // would be the one box in the game that stands out.
    const tree = await varRunAfterStart();
    const env = mockCommandEnv({
      session: mockSession({ userType: 'root', machineId: asMachineId('ws-alice') }),
      fs: mockFsViewFromTree(tree, { userType: 'root', cwd: () => asAbsPath('/') }),
    });

    const result = await ps.execute(env, [], NO_FLAGS);
    if (result.kind !== 'sync') throw new Error('sync expected');

    expect(result.lines.map((line) => line.content)).toEqual([
      'PID     USER      COMMAND     PORT',
      '-       mysql     mysqld      3306',
    ]);
  });

  it('shows up in a scan of the player’s own address as 3306/tcp open mysql', async () => {
    const cold = buildColdStartConnectivity(PUBKEY);
    const wlan0 = cold.interfaces.get('wlan0');
    if (wlan0 === undefined || wlan0.kind !== 'wireless') throw new Error('no wlan0 in cold start');
    const { localIp } = assignHomeNetwork(PUBKEY, ESSID);
    const connectivity: ConnectivityState = {
      interfaces: new Map(cold.interfaces).set('wlan0', {
        ...wlan0,
        association: { essid: ESSID, bssid: 'AA:BB:CC:DD:EE:FF' },
        ipv4: localIp,
      }),
    };
    const env = mockCommandEnv({
      identity: mockIdentity({ publicKeyHex: asPlayerKeyHex(PUBKEY) }),
      network: mockNetworkViewFromConnectivity(connectivity),
      fs: mockFsViewFromTree(await varRunAfterStart(), { userType: 'user' }),
    });

    const result = await nmap.execute(env, [localIp], NO_FLAGS);
    if (result.kind !== 'async') throw new Error('async expected');
    const lines: string[] = [];
    for await (const line of result.lines) lines.push(line.content);

    expect(lines.join('\n')).toContain('3306/tcp open  mysql');
  });

  it('closes that door again when the daemon was started on another port', async () => {
    // The scan reads the pidfile's port, not the catalog's — a player who moved
    // their database to 3307 must be able to see 3307, or they would be looking
    // for a door that is shut and missing the one that is open.
    const tree = await varRunAfterStart(['3307']);
    const env = mockCommandEnv({
      session: mockSession({ userType: 'root', machineId: asMachineId('ws-alice') }),
      fs: mockFsViewFromTree(tree, { userType: 'root', cwd: () => asAbsPath('/') }),
    });

    const result = await ps.execute(env, [], NO_FLAGS);
    if (result.kind !== 'sync') throw new Error('sync expected');

    expect(result.lines.map((line) => line.content)).toEqual([
      'PID     USER      COMMAND     PORT',
      '-       mysql     mysqld      3307',
    ]);
  });
});
