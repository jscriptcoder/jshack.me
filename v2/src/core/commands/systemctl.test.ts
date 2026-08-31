import { describe, expect, it } from 'vitest';
import { asAbsPath, type UserType } from '../types';
import type { PatchApi } from './types';
import type { CommandResult, PatchResult, TerminalLine } from './types';
import {
  mockCommandEnv,
  mockFsViewFromTree,
  mockPatchApi,
  mockSession,
} from '../../test/factories/commandEnv';
import { buildDirectory, buildFile } from '../../test/factories/filesystem';
import { BINARY_STUB } from '../generation/binaries';
import { SERVICE_CATALOG } from '../services/serviceCatalog';
import { SYSTEM_DAEMON_NAMES } from '../generation/binaries';
import { packageForBinary } from '../packages/aptPackages';
import {
  formatSnmpdState,
  SNMPD_STATE_PATH,
  SNMPD_STATE_PERMISSIONS,
} from '../snmp/rwCommunity';
import { SNMPD_CONF_PATH, SNMPD_CONF_PERMISSIONS, SNMPD_CONF_SEED } from '../snmp/conf';
import { md5 } from '../generation/md5';
import { daemonName, pidfilePath, readOpenPorts } from '../services/pidfile';
import { APT_PACKAGES } from '../packages/aptPackages';
import { DAEMONS } from './daemon';
import { isUnitName, systemctl } from './systemctl';

/**
 * `systemctl` is the defender's half of every door: it closes a port that is
 * open, and re-opens it. A stop removes the `/var/run/*.pid` file that IS the
 * source of truth for "this service is up", so the port shuts for everyone —
 * the owner's own scan, a neighbour's, and a stranger's across the network —
 * and stays shut until someone starts it again.
 *
 * The unit, not the program, is what these verbs act on. `nginx` and `apache2`
 * are two ways to bind ONE port, so both resolve to the same unit and both are
 * answered in the unit's words: stopping the web server never claims apache2
 * was the one running when nginx was.
 *
 * `start` deliberately does NOT write the pidfile itself — it routes into the
 * daemon commands, so there is one writer with one gate ladder rather than a
 * second copy that can drift.
 */

const NO_FLAGS = new Map<string, string | true>();

type WriteCall = { readonly path: string; readonly content: string };

type WriteOptions = Parameters<PatchApi['write']>[2];

type SystemctlEnvOpts = {
  readonly userType?: UserType;
  /** `/var/run` pidfiles, basename → content (omit ⇒ nothing running). */
  readonly running?: Readonly<Record<string, string>>;
  /** Daemons this box bought — the web servers and the database arrive only via
   *  `apt install`, which lands them in `/usr/sbin` beside the ones that ship. */
  readonly installed?: readonly string[];
  /** The agent's world-readable config, as the owner left it. */
  readonly snmpdConf?: string;
  /** The root-only file holding the hash of the community it answers to. */
  readonly snmpdState?: string;
  /** Fails ONLY the write whose path matches, leaving the rest to succeed — so a
   *  failure partway through a bring-up is exercisable. */
  readonly failWritesTo?: string;
  readonly removeResult?: PatchResult;
};

const binaries = (names: readonly string[]) =>
  buildDirectory(
    Object.fromEntries(names.map((name) => [name, buildFile(BINARY_STUB, { owner: 'root' })])),
  );

/** An env whose `/var/run` holds the given pidfiles and whose patch calls are
 *  spies. `sshd` and `vsftpd` always exist in `/usr/sbin` (they ship on every
 *  machine); the bought daemons appear only when `installed` names them.
 *  Defaults: root, nothing running, patch calls succeed. */
const systemctlEnv = (opts: SystemctlEnvOpts = {}) => {
  const userType = opts.userType ?? 'root';
  const removes: string[] = [];
  const writes: WriteCall[] = [];
  const landings: { readonly path: string; readonly options: WriteOptions }[] = [];
  const pidfiles = Object.entries(opts.running ?? {}).map(([name, content]) => [
    name,
    buildFile(content, { owner: 'root' }),
  ]);
  const snmpState =
    opts.snmpdState === undefined
      ? {}
      : { snmp: buildDirectory({ 'snmpd.conf': buildFile(opts.snmpdState, { owner: 'root' }) }) };
  const tree = buildDirectory({
    var: buildDirectory({
      run: buildDirectory(Object.fromEntries(pidfiles)),
      lib: buildDirectory(snmpState),
    }),
    ...(opts.snmpdConf === undefined
      ? {}
      : {
          etc: buildDirectory({
            snmp: buildDirectory({ 'snmpd.conf': buildFile(opts.snmpdConf, { owner: 'root' }) }),
          }),
        }),
    usr: buildDirectory({
      bin: buildDirectory({}),
      sbin: binaries(['sshd', 'vsftpd', ...(opts.installed ?? [])]),
    }),
  });
  const env = mockCommandEnv({
    session: mockSession({ userType }),
    fs: mockFsViewFromTree(tree, { userType, cwd: () => asAbsPath('/') }),
    patches: {
      ...mockPatchApi(),
      remove: async (path) => {
        removes.push(path);
        return opts.removeResult ?? { ok: true };
      },
      write: async (path, content, options) => {
        writes.push({ path, content });
        // Kept apart from `writes` so the exact-shape assertions above stay readable:
        // most tests care what was written, and only a few care how it landed.
        landings.push({ path, options });
        if (opts.failWritesTo === path) return { ok: false, error: 'permission_denied' };
        return { ok: true };
      },
    },
  });
  return { env, removes, writes, landings };
};

const syncResult = (result: CommandResult): { readonly text: string; readonly exitCode: number } => {
  if (result.kind !== 'sync') throw new Error('sync expected');
  return { text: result.lines.map((line) => line.content).join('\n'), exitCode: result.exitCode };
};

/** Drain a streamed result. A streamed command is LAZY — nothing runs until its
 *  lines are consumed, so a test asserting on side effects must drain it. */
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

/** The FIRST streamed line, pulled without draining the rest — leaving the
 *  command suspended mid-flight so the world it hasn't touched yet is
 *  inspectable. */
const firstStreamedLine = async (result: CommandResult): Promise<TerminalLine | undefined> => {
  if (result.kind !== 'async') throw new Error('async expected');
  for await (const line of result.lines) return line;
  return undefined;
};

describe('systemctl stop', () => {
  it('removes the pidfile a port scan reads, closing the port', async () => {
    const { env, removes } = systemctlEnv({ running: { 'sshd.pid': 'sshd:port=22' } });

    const { exitCode } = await streamResult(
      await systemctl.execute(env, ['stop', 'sshd'], NO_FLAGS),
    );

    // Asserted against the path the READERS resolve, not a literal, so a stop
    // and a scan can never disagree about which file means "port open".
    expect(removes).toEqual([pidfilePath(SERVICE_CATALOG.ssh)]);
    expect(exitCode).toBe(0);
  });

  it('shuts the port for every reader, not just the owner', async () => {
    // `readOpenPorts` is what the local scan, the LAN scan and the server-side
    // cross-player scan all consult. Removing the file the daemon wrote is what
    // makes all three agree the door is shut.
    const open = buildDirectory({
      var: buildDirectory({
        run: buildDirectory({ 'sshd.pid': buildFile('sshd:port=22', { owner: 'root' }) }),
      }),
    });
    const shut = buildDirectory({ var: buildDirectory({ run: buildDirectory({}) }) });

    expect(readOpenPorts(open)).toEqual([{ port: 22, service: 'ssh' }]);
    expect(readOpenPorts(shut)).toEqual([]);
  });

  it('announces the stop before the port actually closes', async () => {
    const { env, removes } = systemctlEnv({ running: { 'sshd.pid': 'sshd:port=22' } });

    const first = await firstStreamedLine(await systemctl.execute(env, ['stop', 'sshd'], NO_FLAGS));

    expect(first).toEqual({ kind: 'text', content: 'Stopping OpenSSH server...' });
    // Nothing removed yet: the player watches the door close WHILE it closes.
    expect(removes).toEqual([]);
  });

  it('confirms the unit it stopped', async () => {
    const { env } = systemctlEnv({ running: { 'sshd.pid': 'sshd:port=22' } });

    const { lines } = await streamResult(await systemctl.execute(env, ['stop', 'sshd'], NO_FLAGS));

    expect(lines).toEqual([
      { kind: 'text', content: 'Stopping OpenSSH server...' },
      { kind: 'text', content: 'sshd stopped.' },
    ]);
  });

  it('succeeds and removes nothing when the unit is already stopped', async () => {
    // Stop's postcondition is "not running", which already holds — so this is a
    // success, not a refusal. `restart` on a stopped unit depends on it.
    const { env, removes } = systemctlEnv();

    const { text, exitCode } = syncResult(await systemctl.execute(env, ['stop', 'sshd'], NO_FLAGS));

    expect(text).toBe('sshd is not running.');
    expect(exitCode).toBe(0);
    expect(removes).toEqual([]);
  });

  it('does not evict anyone already inside — the door shuts, the room does not empty', async () => {
    // A defender who stops sshd while ssh'd INTO the box must not cut their own
    // connection, and an intruder already on the box outlives the closed door.
    // Only new logins are refused.
    const popped: number[] = [];
    const { env } = systemctlEnv({ running: { 'sshd.pid': 'sshd:port=22' } });
    const watched = { ...env, popSession: () => popped.push(1) };

    const { exitCode } = await streamResult(
      await systemctl.execute(watched, ['stop', 'sshd'], NO_FLAGS),
    );

    expect(exitCode).toBe(0);
    expect(popped).toEqual([]);
  });

  it('refuses a non-root caller and leaves the port open', async () => {
    const { env, removes } = systemctlEnv({
      userType: 'user',
      running: { 'sshd.pid': 'sshd:port=22' },
    });

    const result = await systemctl.execute(env, ['stop', 'sshd'], NO_FLAGS);

    expect(result).toEqual({
      kind: 'sync',
      lines: [{ kind: 'error', content: 'systemctl: must be run as root' }],
      exitCode: 1,
    });
    expect(removes).toEqual([]);
  });

  it('refuses a guest too', async () => {
    const { env, removes } = systemctlEnv({
      userType: 'guest',
      running: { 'sshd.pid': 'sshd:port=22' },
    });

    const { exitCode } = syncResult(await systemctl.execute(env, ['stop', 'sshd'], NO_FLAGS));

    expect(exitCode).toBe(1);
    expect(removes).toEqual([]);
  });

  it('reports a refused removal rather than claiming the port closed', async () => {
    const { env } = systemctlEnv({
      running: { 'sshd.pid': 'sshd:port=22' },
      removeResult: { ok: false, error: 'network_error' },
    });

    const { lines, exitCode } = await streamResult(
      await systemctl.execute(env, ['stop', 'sshd'], NO_FLAGS),
    );

    expect(lines[lines.length - 1]).toEqual({ kind: 'error', content: 'systemctl: I/O error' });
    expect(exitCode).toBe(1);
  });

  it('stops the running web server under either name, naming the unit not the program', async () => {
    // The keystone of the one-web-identity decision: `apache2` and `nginx` bind
    // ONE port, so stopping via apache2 must not claim apache2 was running when
    // it was nginx that came up.
    const { env, removes } = systemctlEnv({
      running: { 'nginx.pid': 'nginx:port=80' },
      installed: ['apache2'],
    });

    const { lines } = await streamResult(await systemctl.execute(env, ['stop', 'apache2'], NO_FLAGS));

    expect(removes).toEqual([pidfilePath(SERVICE_CATALOG.http)]);
    expect(lines).toEqual([
      { kind: 'text', content: 'Stopping web server...' },
      { kind: 'text', content: 'nginx stopped.' },
    ]);
  });
});

describe('systemctl start', () => {
  it('opens the port through the daemon that owns the pidfile', async () => {
    // Routed into the daemon command rather than writing the pidfile here, so
    // there is one writer and one gate ladder. The proof is the byte-identical
    // pidfile a direct `sshd` would have written.
    const { env, writes } = systemctlEnv();

    const { exitCode } = await streamResult(
      await systemctl.execute(env, ['start', 'sshd'], NO_FLAGS),
    );

    expect(writes).toEqual([{ path: '/var/run/sshd.pid', content: 'sshd:port=22' }]);
    expect(exitCode).toBe(0);
  });

  it('re-opens a port that was stopped, restoring what the scan sees', async () => {
    const { env, writes } = systemctlEnv();

    await streamResult(await systemctl.execute(env, ['start', 'vsftpd'], NO_FLAGS));

    const restored = buildDirectory({
      var: buildDirectory({
        run: buildDirectory({ 'vsftpd.pid': buildFile(writes[0].content, { owner: 'root' }) }),
      }),
    });
    expect(readOpenPorts(restored)).toEqual([{ port: 21, service: 'ftp' }]);
  });

  it('refuses a non-root caller and opens nothing', async () => {
    const { env, writes } = systemctlEnv({ userType: 'user' });

    const { text, exitCode } = syncResult(await systemctl.execute(env, ['start', 'sshd'], NO_FLAGS));

    expect(text).toBe('systemctl: must be run as root');
    expect(exitCode).toBe(1);
    expect(writes).toEqual([]);
  });

  it('cannot start a web server the box never installed', async () => {
    // Without this, systemctl is an apt bypass: the binary gate lives on the
    // `nginx` command, and routing around it would open port 80 on a box that
    // has no web server at all.
    const { env, writes } = systemctlEnv();

    const { text, exitCode } = syncResult(await systemctl.execute(env, ['start', 'nginx'], NO_FLAGS));

    expect(text).toBe('Unit nginx.service could not be found.');
    expect(exitCode).toBe(1);
    expect(writes).toEqual([]);
  });

  it('starts an installed web server', async () => {
    const { env, writes } = systemctlEnv({ installed: ['nginx'] });

    const { exitCode } = await streamResult(
      await systemctl.execute(env, ['start', 'nginx'], NO_FLAGS),
    );

    expect(writes).toEqual([{ path: '/var/run/nginx.pid', content: 'nginx:port=80' }]);
    expect(exitCode).toBe(0);
  });
});

describe('systemctl restart', () => {
  it('closes then re-opens a running unit', async () => {
    const { env, removes, writes } = systemctlEnv({ running: { 'vsftpd.pid': 'vsftpd:port=21' } });

    const { exitCode } = await streamResult(
      await systemctl.execute(env, ['restart', 'vsftpd'], NO_FLAGS),
    );

    expect(removes).toEqual([pidfilePath(SERVICE_CATALOG.ftp)]);
    expect(writes).toEqual([{ path: '/var/run/vsftpd.pid', content: 'vsftpd:port=21' }]);
    expect(exitCode).toBe(0);
  });

  it('brings the unit back on the port it was actually running on', async () => {
    // A restart must not silently move a service: an admin who put sshd on 2222
    // and restarts it would otherwise find it back on 22, reachable by every
    // scan that was looking for exactly that.
    const { env, writes } = systemctlEnv({ running: { 'sshd.pid': 'sshd:port=2222' } });

    await streamResult(await systemctl.execute(env, ['restart', 'sshd'], NO_FLAGS));

    expect(writes).toEqual([{ path: '/var/run/sshd.pid', content: 'sshd:port=2222' }]);
  });

  it('starts a unit that was not running, as real systemctl does', async () => {
    const { env, removes, writes } = systemctlEnv();

    const { exitCode } = await streamResult(
      await systemctl.execute(env, ['restart', 'vsftpd'], NO_FLAGS),
    );

    expect(removes).toEqual([]);
    expect(writes).toEqual([{ path: '/var/run/vsftpd.pid', content: 'vsftpd:port=21' }]);
    expect(exitCode).toBe(0);
  });

  it('does not bring the unit back up when the stop half failed', async () => {
    // A restart whose stop was refused must not write the pidfile anyway: that
    // would advertise an open port on top of a service whose state nobody
    // actually changed.
    const { env, writes } = systemctlEnv({
      running: { 'vsftpd.pid': 'vsftpd:port=21' },
      removeResult: { ok: false, error: 'network_error' },
    });

    const { exitCode } = await streamResult(
      await systemctl.execute(env, ['restart', 'vsftpd'], NO_FLAGS),
    );

    expect(writes).toEqual([]);
    expect(exitCode).toBe(1);
  });

  it('refuses a non-root caller', async () => {
    const { env, removes, writes } = systemctlEnv({
      userType: 'user',
      running: { 'vsftpd.pid': 'vsftpd:port=21' },
    });

    const { exitCode } = syncResult(await systemctl.execute(env, ['restart', 'vsftpd'], NO_FLAGS));

    expect(exitCode).toBe(1);
    expect(removes).toEqual([]);
    expect(writes).toEqual([]);
  });
});

describe('systemctl status', () => {
  it('reports a running unit as active, with its port', async () => {
    const { env } = systemctlEnv({ running: { 'vsftpd.pid': 'vsftpd:port=21' } });

    const { text, exitCode } = syncResult(
      await systemctl.execute(env, ['status', 'vsftpd'], NO_FLAGS),
    );

    expect(text).toBe('● vsftpd.service - FTP server\n     Active: active (running) on port 21');
    expect(exitCode).toBe(0);
  });

  it('reports the port a unit actually listens on, not the default', async () => {
    const { env } = systemctlEnv({ running: { 'sshd.pid': 'sshd:port=2222' } });

    const { text } = syncResult(await systemctl.execute(env, ['status', 'sshd'], NO_FLAGS));

    expect(text).toContain('on port 2222');
  });

  it('reports a stopped unit as inactive', async () => {
    const { env } = systemctlEnv();

    const { text, exitCode } = syncResult(await systemctl.execute(env, ['status', 'sshd'], NO_FLAGS));

    expect(text).toBe('○ sshd.service - OpenSSH server\n     Active: inactive (dead)');
    expect(exitCode).toBe(0);
  });

  it('answers a guest — any tier may ask what a box is running', async () => {
    const { env } = systemctlEnv({ userType: 'guest', running: { 'sshd.pid': 'sshd:port=22' } });

    const { text, exitCode } = syncResult(await systemctl.execute(env, ['status', 'sshd'], NO_FLAGS));

    expect(text).toContain('active (running)');
    expect(exitCode).toBe(0);
  });

  it('answers identically for an unknown unit and one the box has not installed', async () => {
    // A guest must not be able to enumerate a box's packages by probing: "never
    // heard of it" and "not installed here" have to be the same sentence.
    const { env } = systemctlEnv();

    const unknown = syncResult(await systemctl.execute(env, ['status', 'nonsense'], NO_FLAGS));
    const notInstalled = syncResult(await systemctl.execute(env, ['status', 'nginx'], NO_FLAGS));

    expect(unknown.text).toBe('Unit nonsense.service could not be found.');
    expect(notInstalled.text).toBe('Unit nginx.service could not be found.');
    expect(unknown.exitCode).toBe(notInstalled.exitCode);
  });

  it.each([['apache2'], ['nginx']])(
    'answers for the web unit under the name %s once installed',
    async (typed) => {
      // Both names, not just the alias: the canonical `nginx` entry carries its
      // own unit identity, and testing only `apache2` would leave it unproven.
      const { env } = systemctlEnv({
        running: { 'nginx.pid': 'nginx:port=80' },
        installed: [typed],
      });

      const { text } = syncResult(await systemctl.execute(env, ['status', typed], NO_FLAGS));

      expect(text).toBe('● nginx.service - web server\n     Active: active (running) on port 80');
    },
  );

  it('treats a directory at the pidfile path as nothing running', async () => {
    // `mkdir /var/run/sshd.pid` is something a root player can really do. Read as
    // a pidfile it has no content to parse, so a box running NOTHING would report
    // itself active on the default port — a free disguise.
    const tree = buildDirectory({
      var: buildDirectory({ run: buildDirectory({ 'sshd.pid': buildDirectory({}) }) }),
      usr: buildDirectory({ bin: binaries([]), sbin: binaries(['sshd', 'vsftpd']) }),
    });
    const env = mockCommandEnv({
      session: mockSession({ userType: 'root' }),
      fs: mockFsViewFromTree(tree, { userType: 'root', cwd: () => asAbsPath('/') }),
    });

    const { text } = syncResult(await systemctl.execute(env, ['status', 'sshd'], NO_FLAGS));

    expect(text).toBe('○ sshd.service - OpenSSH server\n     Active: inactive (dead)');
  });
});

/**
 * The database a player bought is a unit like any other. It has to be: the ONLY
 * way to shut a service is `systemctl stop` — `kill` refuses a unit name outright
 * and a service has no pid to aim at — so a door with no unit behind it is a door
 * that never closes.
 */
describe('systemctl and the database a player bought', () => {
  it('reports a running database as active, with its port', async () => {
    const { env } = systemctlEnv({
      running: { 'mysqld.pid': 'mysqld:port=3306' },
      installed: ['mysqld'],
    });

    const { text, exitCode } = syncResult(
      await systemctl.execute(env, ['status', 'mysqld'], NO_FLAGS),
    );

    expect(text).toBe('● mysqld.service - MySQL server\n     Active: active (running) on port 3306');
    expect(exitCode).toBe(0);
  });

  it('reports an installed-but-stopped database as inactive rather than absent', async () => {
    // The line that tells a player the purchase worked: before `apt install mysql`
    // there is no unit at all, and afterwards there is one, sitting dead until
    // they start it.
    const { env } = systemctlEnv({ installed: ['mysqld'] });

    const { text } = syncResult(await systemctl.execute(env, ['status', 'mysqld'], NO_FLAGS));

    expect(text).toBe('○ mysqld.service - MySQL server\n     Active: inactive (dead)');
  });

  it('closes the database port, removing the file every reader treats as open', async () => {
    const { env, removes } = systemctlEnv({
      running: { 'mysqld.pid': 'mysqld:port=3306' },
      installed: ['mysqld'],
    });

    const { exitCode } = await streamResult(
      await systemctl.execute(env, ['stop', 'mysqld'], NO_FLAGS),
    );

    expect(removes).toEqual([pidfilePath(SERVICE_CATALOG.mysql)]);
    expect(exitCode).toBe(0);
  });

  it('opens it again through the daemon that owns the pidfile', async () => {
    const { env, writes } = systemctlEnv({ installed: ['mysqld'] });

    const { exitCode } = await streamResult(
      await systemctl.execute(env, ['start', 'mysqld'], NO_FLAGS),
    );

    expect(writes).toEqual([{ path: '/var/run/mysqld.pid', content: 'mysqld:port=3306' }]);
    expect(exitCode).toBe(0);
  });

  it('brings a restarted database back on the port it was actually running on', async () => {
    const { env, writes } = systemctlEnv({
      running: { 'mysqld.pid': 'mysqld:port=3307' },
      installed: ['mysqld'],
    });

    await streamResult(await systemctl.execute(env, ['restart', 'mysqld'], NO_FLAGS));

    expect(writes).toEqual([{ path: '/var/run/mysqld.pid', content: 'mysqld:port=3307' }]);
  });

  it('cannot start a database the box never bought', async () => {
    // The same apt bypass the web servers are guarded against: the binary gate
    // lives on the `mysqld` command, and routing around it would open 3306 on a
    // box with no database on it at all.
    const { env, writes } = systemctlEnv();

    const { text, exitCode } = syncResult(
      await systemctl.execute(env, ['start', 'mysqld'], NO_FLAGS),
    );

    expect(text).toBe('Unit mysqld.service could not be found.');
    expect(exitCode).toBe(1);
    expect(writes).toEqual([]);
  });
});

describe('systemctl usage', () => {
  it('refuses a bare invocation with usage', async () => {
    const { env } = systemctlEnv();

    const { text, exitCode } = syncResult(await systemctl.execute(env, [], NO_FLAGS));

    expect(text).toContain('Usage: systemctl');
    expect(exitCode).toBe(1);
  });

  it('refuses an unknown verb', async () => {
    const { env } = systemctlEnv();

    const { text, exitCode } = syncResult(await systemctl.execute(env, ['enable', 'sshd'], NO_FLAGS));

    expect(text).toContain('Unknown operation');
    expect(exitCode).toBe(1);
  });

  it('refuses a verb with no unit named, showing usage rather than a phantom unit', async () => {
    // The missing argument has to be caught before unit resolution, or the
    // player is told `Unit undefined.service could not be found` — an answer
    // about a unit they never asked about.
    const { env } = systemctlEnv();

    const { text, exitCode } = syncResult(await systemctl.execute(env, ['stop'], NO_FLAGS));

    expect(text).toContain('Usage: systemctl');
    expect(exitCode).toBe(1);
  });
});

/**
 * The key-value store is a unit like the database beside it, and for the same
 * reason: `systemctl stop` is the ONLY way to shut a service, so a door with no
 * unit behind it is a door that never closes.
 *
 * It shipped without one. The daemon table and this unit table are two
 * declarations of the same fact, nothing checks that they agree, and the store
 * was reachable through the bare `redis-server` command the whole time — so every
 * player-facing path worked except the idiomatic one, and no test asked.
 */
describe('systemctl and the key-value store a player bought', () => {
  it('reports a running store as active, with its port', async () => {
    const { env } = systemctlEnv({
      running: { 'redis-server.pid': 'redis-server:port=6379' },
      installed: ['redis-server'],
    });

    const { text, exitCode } = syncResult(
      await systemctl.execute(env, ['status', 'redis-server'], NO_FLAGS),
    );

    expect(text).toBe('● redis-server.service - Redis server\n     Active: active (running) on port 6379');
    expect(exitCode).toBe(0);
  });

  it('reports an installed-but-stopped store as inactive rather than absent', async () => {
    const { env } = systemctlEnv({ installed: ['redis-server'] });

    const { text } = syncResult(await systemctl.execute(env, ['status', 'redis-server'], NO_FLAGS));

    expect(text).toBe('○ redis-server.service - Redis server\n     Active: inactive (dead)');
  });

  it('closes the store port, removing the file every reader treats as open', async () => {
    const { env, removes } = systemctlEnv({
      running: { 'redis-server.pid': 'redis-server:port=6379' },
      installed: ['redis-server'],
    });

    const { exitCode } = await streamResult(
      await systemctl.execute(env, ['stop', 'redis-server'], NO_FLAGS),
    );

    expect(removes).toEqual([pidfilePath(SERVICE_CATALOG.redis)]);
    expect(exitCode).toBe(0);
  });

  it('opens it again through the daemon that owns the pidfile', async () => {
    const { env, writes } = systemctlEnv({ installed: ['redis-server'] });

    const { exitCode } = await streamResult(
      await systemctl.execute(env, ['start', 'redis-server'], NO_FLAGS),
    );

    expect(writes).toEqual([{ path: '/var/run/redis-server.pid', content: 'redis-server:port=6379' }]);
    expect(exitCode).toBe(0);
  });

  it('brings a restarted store back on the port it was actually running on', async () => {
    const { env, writes } = systemctlEnv({
      running: { 'redis-server.pid': 'redis-server:port=6380' },
      installed: ['redis-server'],
    });

    await streamResult(await systemctl.execute(env, ['restart', 'redis-server'], NO_FLAGS));

    expect(writes).toEqual([{ path: '/var/run/redis-server.pid', content: 'redis-server:port=6380' }]);
  });

  it('cannot start a store the box never bought', async () => {
    const { env, writes } = systemctlEnv();

    const { text, exitCode } = syncResult(
      await systemctl.execute(env, ['start', 'redis-server'], NO_FLAGS),
    );

    expect(text).toBe('Unit redis-server.service could not be found.');
    expect(exitCode).toBe(1);
    expect(writes).toEqual([]);
  });
});

/**
 * Three separate tables state which daemons this world has: what a package
 * installs (`APT_PACKAGES[].daemons`), what can be started (`DAEMONS`), and what
 * `systemctl` will act on (`UNITS`). They are one fact written three times, and
 * nothing but these assertions makes them agree.
 *
 * The gap is invisible from every direction except the one a player reaches for.
 * It has already shipped twice on the same door: once with the package naming a
 * daemon `DAEMONS` did not carry, and once with `DAEMONS` carrying one `UNITS`
 * did not — each time leaving a service that could be installed and started but
 * never stopped, because `systemctl stop` is the only way to shut one.
 *
 * These compare NAMES rather than counts, so a failure says which daemon is
 * stranded and in which table.
 */
describe('the three tables that say which daemons exist', () => {
  const daemonsOfPackages = APT_PACKAGES.flatMap((pkg) => pkg.daemons ?? []);

  it('can start every daemon a package installs', () => {
    const unstartable = daemonsOfPackages.filter((name) => !Object.hasOwn(DAEMONS, name));

    expect(unstartable).toEqual([]);
  });

  it('can stop every daemon it can start', () => {
    const unstoppable = Object.keys(DAEMONS).filter((name) => !isUnitName(name));

    expect(unstoppable).toEqual([]);
  });

  it('starts the agent on a device that carries it, opening 161', async () => {
    // The two tables are what the guards below check; this is the verb a player types.
    // A generated gateway plants `/usr/sbin/snmpd` beside the agent's pidfile precisely
    // so this resolves — a device advertising a port whose program it does not have
    // could not be controlled by the `systemctl` sitting on it.
    const { env, writes } = systemctlEnv({ installed: ['snmpd'] });

    const { exitCode } = await streamResult(
      await systemctl.execute(env, ['start', 'snmpd'], NO_FLAGS),
    );

    expect(writes).toEqual([{ path: '/var/run/snmpd.pid', content: 'snmpd:port=161' }]);
    expect(exitCode).toBe(0);
  });

  it('stops the agent, closing the door that needs no shell to walk through', async () => {
    // The only defence an owner has before the agent's own log exists: an SNMP write
    // takes no session and leaves no login, so turning the daemon off is the whole of
    // what `systemctl` can do about it.
    const { env, removes } = systemctlEnv({
      installed: ['snmpd'],
      running: { 'snmpd.pid': 'snmpd:port=161' },
    });

    const { exitCode } = await streamResult(
      await systemctl.execute(env, ['stop', 'snmpd'], NO_FLAGS),
    );

    expect(removes).toEqual(['/var/run/snmpd.pid']);
    expect(exitCode).toBe(0);
  });

  it('gives every door in the catalog a daemon a player can act on', () => {
    // A service whose pidfile names a daemon nobody can start is a door that
    // opens only where the world generated it already open.
    const stranded = Object.values(SERVICE_CATALOG)
      .map((spec) => daemonName(spec))
      .filter((name) => !Object.hasOwn(DAEMONS, name) || !isUnitName(name));

    expect(stranded).toEqual([]);
  });

  it('lets a player OBTAIN every daemon the catalog names', () => {
    // The guard above proves a unit exists. `systemctl` also refuses to start a daemon
    // whose binary is not on the box, so a unit no package ships is still a door nobody
    // can open — which is exactly what `snmpd` was: in DAEMONS and UNITS from the day
    // the catalog row landed, with nothing on any shelf to buy it with.
    //
    // `sshd` and `vsftpd` are the exemptions, and the only ones: they arrive with the
    // base image, which is why no package claims them.
    const unobtainable = Object.values(SERVICE_CATALOG)
      .map((spec) => daemonName(spec))
      .filter(
        (name) =>
          !SYSTEM_DAEMON_NAMES.some((preinstalled) => preinstalled === name) &&
          packageForBinary(name) === undefined,
      );

    expect(unobtainable).toEqual([]);
  });
});

describe('rotating the community an agent answers to', () => {
  /** The box as its owner left it: the agent running, a community already in force, and
   *  a new one typed into the world-readable config waiting to be picked up. */
  const NEWLINE = String.fromCharCode(10);

  const rotating = (line: string) =>
    systemctlEnv({
      installed: ['snmpd'],
      running: { 'snmpd.pid': 'snmpd:port=161' },
      snmpdConf: SNMPD_CONF_SEED + line,
      snmpdState: formatSnmpdState(md5('the-old-one')),
    });


  it("lands the rewrite as root's own file, at the permissions each one belongs at", async () => {
    // These are the DAEMON's files, not the shell's. Written with the caller's ownership
    // or default permissions, a rotation would quietly widen the box's own state to
    // whoever happened to type the command — and the root-only half is the one holding
    // the secret.
    const { env, landings } = rotating('rwcommunity hunter2' + NEWLINE);

    await streamResult(await systemctl.execute(env, ['restart', 'snmpd'], NO_FLAGS));

    expect(landings.find((landing) => landing.path === SNMPD_STATE_PATH)?.options).toEqual({
      permissions: SNMPD_STATE_PERMISSIONS,
      owner: 'root',
    });
    expect(landings.find((landing) => landing.path === SNMPD_CONF_PATH)?.options).toEqual({
      permissions: SNMPD_CONF_PERMISSIONS,
      owner: 'root',
    });
  });

  it('says so when the rewrite cannot land, rather than reporting a clean start', async () => {
    // The port is open by this point, so the agent really is up — but the community the
    // owner asked for is not in force. Reporting success would leave them believing they
    // had rotated it, still holding a string anybody's wordlist may already have.
    const { env } = systemctlEnv({
      installed: ['snmpd'],
      running: { 'snmpd.pid': 'snmpd:port=161' },
      snmpdConf: SNMPD_CONF_SEED + 'rwcommunity hunter2' + NEWLINE,
      snmpdState: formatSnmpdState(md5('the-old-one')),
      failWritesTo: SNMPD_STATE_PATH,
    });

    const { text, exitCode } = await streamResult(
      await systemctl.execute(env, ['restart', 'snmpd'], NO_FLAGS),
    );

    expect(exitCode).not.toBe(0);
    expect(text).toContain('snmpd');
  });

  it('takes the community out of the readable file and keeps only its hash', async () => {
    // Rotation is an administrative act on the box and never a move over the wire. The
    // owner writes the string where they can read it, the daemon takes it as it comes up,
    // and what stays behind is a hash — so the window in which the plaintext is legible
    // is the one between the edit and the restart, and nothing longer.
    const { env, writes } = rotating('rwcommunity hunter2\n');

    await streamResult(await systemctl.execute(env, ['restart', 'snmpd'], NO_FLAGS));

    expect(writes).toContainEqual({
      path: SNMPD_STATE_PATH,
      content: formatSnmpdState(md5('hunter2')),
    });
  });

  it('leaves the rest of the config exactly as its owner wrote it', async () => {
    // Only the one line is spent. A restart that rewrote the whole file would take the
    // read-only community and the contact with it, and the owner would find their own
    // edits reverted by a command that said nothing about them.
    const { env, writes } = rotating('rwcommunity hunter2\n');

    await streamResult(await systemctl.execute(env, ['restart', 'snmpd'], NO_FLAGS));
    const conf = writes.find((write) => write.path === SNMPD_CONF_PATH)?.content ?? '';

    expect(conf).not.toContain('hunter2');
    expect(conf).toContain('rocommunity public');
    expect(conf).toContain('syscontact netops@corp.local');
  });
});
