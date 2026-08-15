import { describe, expect, it, vi } from 'vitest';
import { ftp } from './ftp';
import { runFtpLine } from './ftpShell';
import {
  mockCommandEnv,
  mockFsViewFromTree,
  mockFtpApi,
  mockIdentity,
  mockNetworkView,
  mockNetworkViewFromConnectivity,
  mockSession,
} from '../../test/factories/commandEnv';
import { buildDirectory, buildFile } from '../../test/factories/filesystem';
import { generateHomeLan, type LanHost } from '../generation/generateHomeLan';
import { buildRemoteHostFs } from '../generation/remoteHostFs';
import { hostMachineId } from '../generation/remoteHostId';
import { readOpenPorts } from '../services/pidfile';
import { assignHomeNetwork } from '../network/homeNetwork';
import { buildColdStartConnectivity, type ConnectivityState } from '../network/interfaces';
import { asAbsPath, asEpochMs, asMachineId, asPlayerKeyHex } from '../types';
import type { AbsPath, UserType } from '../types';
import type { CommandResult, RemoteAuthParams, RemoteAuthResult, Session } from './types';

/**
 * `ftp <host>` — the second door. It authenticates against the SAME `/etc/passwd`
 * `ssh` does, through the same server endpoint, and the tier that comes back is the
 * tier the credential carries. What differs is where the player ends up: an ftp
 * login is a PARALLEL session held alongside the shell they are standing in, not a
 * hop stacked on top of it, so the hop chain and the cwd are untouched and `quit`
 * hands the same shell back.
 */

const PUBKEY = 'a'.repeat(64);
const ESSID = 'BEAN-THERE-WIFI';
const NOW = 1700000000000;

const onlineConnectivity = (essid: string): ConnectivityState => {
  const cold = buildColdStartConnectivity(PUBKEY);
  const wlan0 = cold.interfaces.get('wlan0');
  if (wlan0 === undefined || wlan0.kind !== 'wireless') throw new Error('no wlan0');
  const { localIp } = assignHomeNetwork(PUBKEY, essid);
  return {
    interfaces: new Map(cold.interfaces).set('wlan0', {
      ...wlan0,
      association: { essid, bssid: 'AA:BB:CC:DD:EE:FF' },
      ipv4: localIp,
    }),
  };
};

/** A generated host that runs the ftp daemon, and one that does not — only some
 *  roll it, which is the whole point of a second door. */
const pickHosts = (): { readonly ftpHost: LanHost; readonly noFtpHost: LanHost } => {
  let ftpHost: LanHost | undefined;
  let noFtpHost: LanHost | undefined;
  for (const host of generateHomeLan(ESSID).hosts) {
    if (host.kind !== 'machine') continue;
    const serves = readOpenPorts(buildRemoteHostFs(ESSID, host)).some(
      (open) => open.service === 'ftp',
    );
    if (serves && ftpHost === undefined) ftpHost = host;
    if (!serves && noFtpHost === undefined) noFtpHost = host;
  }
  if (ftpHost === undefined || noFtpHost === undefined) {
    throw new Error('need an ftp-serving and a non-serving host');
  }
  return { ftpHost, noFtpHost };
};

type EnvOver = {
  readonly authenticate?: (params: RemoteAuthParams) => Promise<RemoteAuthResult>;
  readonly prompt?: (opts: { message: string; masked: boolean }) => Promise<string>;
  readonly onEnter?: (session: Session) => void;
  readonly onLeave?: () => void;
  readonly onPush?: (session: Session) => void;
  readonly onCwd?: (path: string) => void;
};

const ftpEnv = (over: EnvOver = {}) =>
  mockCommandEnv({
    identity: mockIdentity({ publicKeyHex: asPlayerKeyHex(PUBKEY) }),
    network: mockNetworkViewFromConnectivity(onlineConnectivity(ESSID)),
    session: mockSession({
      id: 'su-root-1',
      machineId: asMachineId('skylab-deadbeef'),
      username: 'alice',
      userType: 'root',
    }),
    now: () => asEpochMs(NOW),
    // Distinct answers per prompt: a Name and a Password that read the same would
    // let the two be swapped without a test noticing.
    prompt: over.prompt ?? (async ({ masked }) => (masked ? 'hunter2' : 'alice')),
    ftp: mockFtpApi({
      authenticate: over.authenticate ?? (async () => ({ ok: true, userType: 'guest' })),
      enter: over.onEnter ?? (() => undefined),
      leave: over.onLeave ?? (() => undefined),
    }),
    pushSession: over.onPush ?? (() => undefined),
    setCwd: over.onCwd ?? (() => undefined),
  });

const sync = (result: CommandResult) => {
  if (result.kind !== 'sync') throw new Error('expected a sync result');
  return result;
};

const linesOf = (result: CommandResult): string =>
  sync(result)
    .lines.map((line) => line.content)
    .join('\n');

describe('ftp', () => {
  it('lets the player in and holds the session alongside the shell, moving nothing', async () => {
    const { ftpHost } = pickHosts();
    const entered = vi.fn();
    const pushed = vi.fn();
    const moved = vi.fn();
    const env = ftpEnv({ onEnter: entered, onPush: pushed, onCwd: moved });

    const result = await ftp.execute(env, [ftpHost.ip], new Map());

    expect(linesOf(result)).toContain('230 Login successful');
    expect(sync(result).exitCode).toBe(0);
    // The session lands on the TARGET's machine id at the tier the server derived —
    // the client never claims one.
    expect(entered.mock.calls[0]![0]).toMatchObject({
      machineId: hostMachineId(ftpHost, ESSID),
      username: 'alice',
      userType: 'guest',
      kind: 'ftp',
    });
    // Parallel, not pushed: the hop chain and the cwd are exactly as they were.
    expect(pushed).not.toHaveBeenCalled();
    expect(moved).not.toHaveBeenCalled();
  });

  it('sends the password to the server and never decides the tier itself', async () => {
    const { ftpHost } = pickHosts();
    const authenticate = vi.fn<(params: RemoteAuthParams) => Promise<RemoteAuthResult>>(async () => ({
      ok: true,
      userType: 'user',
    }));
    const env = ftpEnv({
      authenticate,
      prompt: async ({ masked }) => (masked ? 'letmein' : 'guest'),
    });

    await ftp.execute(env, [ftpHost.ip], new Map());

    expect(authenticate.mock.calls[0]![0]).toMatchObject({
      essid: ESSID,
      targetIp: ftpHost.ip,
      username: 'guest',
      password: 'letmein',
    });
  });

  it('takes the account from the command line when given one, asking only for the password', async () => {
    const { ftpHost } = pickHosts();
    const prompt = vi.fn<(opts: { message: string; masked: boolean }) => Promise<string>>(
      async () => 'hunter2',
    );
    const authenticate = vi.fn<(params: RemoteAuthParams) => Promise<RemoteAuthResult>>(async () => ({
      ok: true,
      userType: 'guest',
    }));
    const env = ftpEnv({ prompt, authenticate });

    await ftp.execute(env, [ftpHost.ip, 'guest'], new Map());

    expect(prompt).toHaveBeenCalledTimes(1);
    expect(prompt.mock.calls[0]![0].masked).toBe(true);
    expect(authenticate.mock.calls[0]![0].username).toBe('guest');
  });

  it('refuses a bad credential with 530 and holds no session', async () => {
    const { ftpHost } = pickHosts();
    const entered = vi.fn();
    const env = ftpEnv({
      authenticate: async () => ({ ok: false, error: 'invalid_credentials' }),
      onEnter: entered,
    });

    const result = await ftp.execute(env, [ftpHost.ip], new Map());

    expect(linesOf(result)).toContain('530 Login incorrect');
    expect(sync(result).exitCode).not.toBe(0);
    expect(entered).not.toHaveBeenCalled();
  });

  it('greets with the daemon banner before asking for anything', async () => {
    const { ftpHost } = pickHosts();

    const greeting = linesOf(await ftp.execute(ftpEnv(), [ftpHost.ip], new Map()));

    expect(greeting).toContain(`Connected to ${ftpHost.ip}.`);
    expect(greeting).toContain('220 (vsFTPd 3.0.3)');
  });

  it('tells the target which address the connection came from, never leaving it to guess', async () => {
    const { ftpHost } = pickHosts();
    const authenticate = vi.fn<(params: RemoteAuthParams) => Promise<RemoteAuthResult>>(async () => ({
      ok: true,
      userType: 'guest',
    }));

    await ftp.execute(ftpEnv({ authenticate }), [ftpHost.ip], new Map());

    // The defender's log line is evidence. It has to name the machine that really
    // knocked — the player's own wlan0 address here, not a null the server fills in.
    expect(authenticate.mock.calls[0]![0].sourceIp).toBe(assignHomeNetwork(PUBKEY, ESSID).localIp);
    // The id the session is minted with is what `quit` later ends server-side, so an
    // empty one would leave the row open forever.
    expect(authenticate.mock.calls[0]![0].sessionId).toMatch(/^ftp-alice-\d+$/);
  });

  it('does not blame the password when the server could not be reached', async () => {
    const { ftpHost } = pickHosts();
    const env = ftpEnv({ authenticate: async () => ({ ok: false, error: 'network_error' }) });

    const failure = linesOf(await ftp.execute(env, [ftpHost.ip], new Map()));

    // "530 Login incorrect" would send the player hunting for a credential that was
    // never the problem.
    expect(failure).not.toContain('530');
    expect(failure).toContain('Connection refused');
  });

  it('refuses to connect at all while the machine is offline', async () => {
    const prompt = vi.fn(async () => 'hunter2');
    const env = mockCommandEnv({
      identity: mockIdentity({ publicKeyHex: asPlayerKeyHex(PUBKEY) }),
      network: mockNetworkView({ isOnline: () => false, interfaces: () => [] }),
      prompt,
    });

    expect(linesOf(await ftp.execute(env, ['192.168.220.25'], new Map()))).toContain(
      'Network is unreachable',
    );
    // A password typed at a machine with no network is a password typed at nothing.
    expect(prompt).not.toHaveBeenCalled();
  });

  it('refuses while the radio is up but joined to nothing', async () => {
    const prompt = vi.fn(async () => 'hunter2');
    // Online, but no association: there is no ESSID to resolve a LAN from, so there
    // is no host to reach — a distinct state from being offline entirely.
    const env = mockCommandEnv({
      identity: mockIdentity({ publicKeyHex: asPlayerKeyHex(PUBKEY) }),
      network: mockNetworkViewFromConnectivity(buildColdStartConnectivity(PUBKEY)),
      prompt,
    });

    expect(linesOf(await ftp.execute(env, ['192.168.220.25'], new Map()))).toContain(
      'Network is unreachable',
    );
    expect(prompt).not.toHaveBeenCalled();
  });

  it('holds no session when the player aborts at the password prompt', async () => {
    const { ftpHost } = pickHosts();
    const entered = vi.fn();
    const authenticate = vi.fn(async () => ({ ok: true, userType: 'guest' }) as RemoteAuthResult);
    const env = ftpEnv({
      prompt: async ({ masked }) => {
        if (masked) throw new DOMException('prompt cancelled', 'AbortError');
        return 'alice';
      },
      authenticate,
      onEnter: entered,
    });

    const result = await ftp.execute(env, [ftpHost.ip], new Map());

    expect(sync(result).exitCode).toBe(130);
    expect(authenticate).not.toHaveBeenCalled();
    expect(entered).not.toHaveBeenCalled();
  });

  it('refuses a host running no ftp daemon before asking for anything', async () => {
    const { noFtpHost } = pickHosts();
    const prompt = vi.fn(async () => 'hunter2');
    const authenticate = vi.fn(async () => ({ ok: true, userType: 'guest' }) as RemoteAuthResult);
    const env = ftpEnv({ prompt, authenticate });

    const result = await ftp.execute(env, [noFtpHost.ip], new Map());

    expect(linesOf(result)).toContain('Connection refused');
    // No door, no password typed at it — a prompt would leak that the box exists.
    expect(prompt).not.toHaveBeenCalled();
    expect(authenticate).not.toHaveBeenCalled();
  });

  it('reports no route to a target that is not a host on the LAN', async () => {
    const env = ftpEnv();

    expect(linesOf(await ftp.execute(env, ['192.168.99.99'], new Map()))).toContain(
      'No route to host',
    );
  });

  it('needs a host to connect to', async () => {
    expect(linesOf(await ftp.execute(ftpEnv(), [], new Map()))).toContain('usage:');
  });
});

describe('the ftp> prompt', () => {
  const shellEnv = (over: EnvOver = {}) => ftpEnv(over);

  it('says goodbye on quit and drops the session', async () => {
    const left = vi.fn();

    const result = await runFtpLine(shellEnv({ onLeave: left }), 'quit');

    expect(linesOf(result)).toContain('221 Goodbye');
    expect(left).toHaveBeenCalledTimes(1);
  });

  it('treats bye as quit — both are how a real client is left', async () => {
    const left = vi.fn();

    const result = await runFtpLine(shellEnv({ onLeave: left }), 'bye');

    expect(linesOf(result)).toContain('221 Goodbye');
    expect(left).toHaveBeenCalledTimes(1);
  });

  it('lists the commands it actually has', async () => {
    const listing = linesOf(await runFtpLine(shellEnv(), 'help'));

    expect(listing).toContain('quit');
    expect(listing).toContain('help');
  });

  it('refuses a shell command instead of running it', async () => {
    const left = vi.fn();

    // `cat` is a real command of the OUTER shell. At `ftp>` it must not reach it:
    // falling through would run it against the machine the player is standing on
    // while they believe they are looking at the remote.
    const result = await runFtpLine(shellEnv({ onLeave: left }), 'cat /etc/passwd');

    expect(linesOf(result)).toContain('?Invalid command');
    expect(sync(result).exitCode).not.toBe(0);
    expect(left).not.toHaveBeenCalled();
  });

  it('ignores an empty line rather than complaining at it', async () => {
    const result = await runFtpLine(shellEnv(), '   ');

    expect(sync(result).lines).toEqual([]);
    expect(sync(result).exitCode).toBe(0);
  });
});

/**
 * Two machines are in the room and the prompt has to keep them apart: the remote
 * one the credential bought, and the origin the player never left. The fixtures
 * below make them disagree about everything they can — different entries, different
 * starting directories — because a mix-up that answers the same either way is a
 * mix-up no test can see.
 */
const REMOTE_TREE = buildDirectory({
  etc: buildDirectory({ passwd: buildFile('root:x:0:0::/root:/bin/bash\n') }),
  home: buildDirectory({
    guest: buildDirectory({ 'remote-loot.txt': buildFile('theirs') }, { owner: 'guest' }),
  }),
  // Sealed above the guest tier, so the same path answers differently to two
  // credentials — the only way a test can tell "the tier decided" from "the door
  // decided".
  vault: buildDirectory(
    { 'sealed.txt': buildFile('classified') },
    { owner: 'root', perms: { read: ['root', 'user'], execute: ['root', 'user'] } },
  ),
});

const ORIGIN_TREE = buildDirectory({
  home: buildDirectory({
    alice: buildDirectory({ 'origin-notes.txt': buildFile('mine') }, { owner: 'alice' }),
  }),
  tmp: buildDirectory({ 'origin-scratch.txt': buildFile('scratch') }),
});

const REMOTE_HOME = asAbsPath('/home/guest');
const ORIGIN_HOME = asAbsPath('/home/alice');

/** A cwd that can move — the UI's signal in miniature, so `cd` and `lcd` are
 *  observed through what the NEXT command sees rather than through a spy. */
const movableCwd = (start: AbsPath) => {
  let current = start;
  return {
    read: (): AbsPath => current,
    set: (path: AbsPath): void => {
      current = path;
    },
  };
};

const browsingEnv = (over: { readonly remoteTier?: UserType } = {}) => {
  const remote = movableCwd(REMOTE_HOME);
  const origin = movableCwd(ORIGIN_HOME);
  const env = mockCommandEnv({
    session: mockSession({ username: 'alice', userType: 'user' }),
    fs: mockFsViewFromTree(ORIGIN_TREE, { userType: 'user', cwd: origin.read }),
    setCwd: origin.set,
    ftp: mockFtpApi({
      fs: mockFsViewFromTree(REMOTE_TREE, {
        userType: over.remoteTier ?? 'guest',
        cwd: remote.read,
      }),
      setCwd: remote.set,
    }),
  });
  return { env, remote, origin };
};

describe('looking around from the ftp> prompt', () => {
  it('answers ls from the remote machine and lls from the box the player is standing on', async () => {
    const { env } = browsingEnv();

    const remoteListing = linesOf(await runFtpLine(env, 'ls'));
    const originListing = linesOf(await runFtpLine(env, 'lls'));

    expect(remoteListing).toContain('remote-loot.txt');
    expect(remoteListing).not.toContain('origin-notes.txt');
    expect(originListing).toContain('origin-notes.txt');
    expect(originListing).not.toContain('remote-loot.txt');
  });

  it('reports the remote directory to pwd and the origin one to lpwd', async () => {
    const { env } = browsingEnv();

    expect(linesOf(await runFtpLine(env, 'pwd'))).toContain('/home/guest');
    expect(linesOf(await runFtpLine(env, 'pwd'))).not.toContain('/home/alice');
    expect(linesOf(await runFtpLine(env, 'lpwd'))).toContain('/home/alice');
    expect(linesOf(await runFtpLine(env, 'lpwd'))).not.toContain('/home/guest');
  });

  it('moves only the remote directory on cd, leaving the origin where it was', async () => {
    const { env } = browsingEnv();

    const moved = await runFtpLine(env, 'cd /etc');

    expect(linesOf(moved)).toContain('250 Directory successfully changed.');
    expect(linesOf(await runFtpLine(env, 'ls'))).toContain('passwd');
    expect(linesOf(await runFtpLine(env, 'pwd'))).toContain('/etc');
    // The origin never moved: the player is standing where they were the whole time.
    expect(linesOf(await runFtpLine(env, 'lpwd'))).toContain('/home/alice');
    expect(linesOf(await runFtpLine(env, 'lls'))).toContain('origin-notes.txt');
  });

  it('moves only the origin directory on lcd, leaving the remote where it was', async () => {
    const { env } = browsingEnv();

    const moved = await runFtpLine(env, 'lcd /tmp');

    expect(linesOf(moved)).toContain('/tmp');
    expect(linesOf(await runFtpLine(env, 'lls'))).toContain('origin-scratch.txt');
    expect(linesOf(await runFtpLine(env, 'lpwd'))).toContain('/tmp');
    // The remote never moved.
    expect(linesOf(await runFtpLine(env, 'pwd'))).toContain('/home/guest');
    expect(linesOf(await runFtpLine(env, 'ls'))).toContain('remote-loot.txt');
  });

  it('refuses a remote directory that is not there, and stays where it was', async () => {
    const { env } = browsingEnv();

    const refused = await runFtpLine(env, 'cd /nowhere');

    expect(linesOf(refused)).toContain('550 Failed to change directory.');
    expect(sync(refused).exitCode).not.toBe(0);
    expect(linesOf(await runFtpLine(env, 'pwd'))).toContain('/home/guest');
  });

  it('lets the tier the credential bought decide what the remote shows, not the door', async () => {
    const asGuest = await runFtpLine(browsingEnv().env, 'ls /vault');
    const asUser = await runFtpLine(browsingEnv({ remoteTier: 'user' }).env, 'ls /vault');

    // The same path, the same command, two credentials — and only the second one
    // sees it. Refused exactly as it would be over ssh, because it IS that refusal.
    expect(linesOf(asGuest)).toContain('Permission denied');
    expect(sync(asGuest).exitCode).not.toBe(0);
    expect(linesOf(asUser)).toContain('sealed.txt');
    expect(sync(asUser).exitCode).toBe(0);
  });

  it('takes the listing flags the shell takes, on both machines', async () => {
    const { env } = browsingEnv();

    // -l is the shape a real client's listing arrives in; proving it on BOTH sides
    // stops one arm from quietly parsing a flag as a path.
    expect(linesOf(await runFtpLine(env, 'ls -l'))).toContain('remote-loot.txt');
    expect(linesOf(await runFtpLine(env, 'ls -l'))).toContain('-rw');
    expect(linesOf(await runFtpLine(env, 'lls -l'))).toContain('origin-notes.txt');
    expect(linesOf(await runFtpLine(env, 'lls -l'))).toContain('-rw');
  });

  it('names both directions in help, so a player can find the machine they are on', async () => {
    const listing = linesOf(await runFtpLine(browsingEnv().env, 'help'));

    expect(listing).toContain('lls');
    expect(listing).toContain('lcd');
    expect(listing).toContain('lpwd');
  });

  it('answers ? the way a real client does, with the same listing help gives', async () => {
    const { env } = browsingEnv();

    expect(linesOf(await runFtpLine(env, '?'))).toBe(linesOf(await runFtpLine(env, 'help')));
  });

  it('reads a line the way a player types it, spacing and all', async () => {
    const { env } = browsingEnv();

    // Leading space and a doubled gap are what hands produce; neither may swallow
    // the command or turn the argument into an empty path pointing at the cwd.
    expect(linesOf(await runFtpLine(env, '  ls  /etc'))).toContain('passwd');
    expect(linesOf(await runFtpLine(env, '  ls  /etc'))).not.toContain('remote-loot.txt');
  });

  it('asks for the directory rather than guessing when cd is given none', async () => {
    const { env } = browsingEnv();

    const remote = await runFtpLine(env, 'cd');
    const origin = await runFtpLine(env, 'lcd');

    expect(linesOf(remote)).toContain('usage: cd remote-directory');
    expect(linesOf(origin)).toContain('usage: lcd local-directory');
    // Neither machine moved on the way to being told off.
    expect(linesOf(await runFtpLine(env, 'pwd'))).toContain('/home/guest');
    expect(linesOf(await runFtpLine(env, 'lpwd'))).toContain('/home/alice');
  });
});
