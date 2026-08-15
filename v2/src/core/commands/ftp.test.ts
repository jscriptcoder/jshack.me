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
  mockPatchApi,
  mockScanApi,
  mockSession,
} from '../../test/factories/commandEnv';
import { buildDirectory, buildFile } from '../../test/factories/filesystem';
import { applyPatches, type Patch } from '../filesystem/applyPatches';
import { defaultFilePermissions } from '../filesystem/defaultPermissions';
import { generateHomeLan, type LanHost } from '../generation/generateHomeLan';
import { buildRemoteHostFs } from '../generation/remoteHostFs';
import { hostMachineId } from '../generation/remoteHostId';
import { readOpenPorts } from '../services/pidfile';
import { assignHomeNetwork } from '../network/homeNetwork';
import { buildColdStartConnectivity, type ConnectivityState } from '../network/interfaces';
import { asAbsPath, asEpochMs, asMachineId, asPlayerKeyHex } from '../types';
import type { AbsPath, UserType } from '../types';
import type {
  CommandResult,
  FtpPublicAuthParams,
  FtpTransfer,
  PublicAuthResult,
  RemoteAuthParams,
  RemoteAuthResult,
  Session,
} from './types';

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

  /**
   * The same door, on somebody else's machine. A public IP names an ACCESS POINT, so
   * the player knocks on the port its owner forwarded — reachability comes from the
   * server (nothing about a stranger's box is derivable locally) and the login lands
   * on the real machine id behind the forward.
   */
  describe('across the network', () => {
    const THEIR_PUBLIC_IP = '203.0.113.7';
    const THEIR_BOX = 'workstation-a1b2c3d4';

    type PublicOver = {
      readonly ports?: readonly { readonly port: number; readonly service: string }[];
      readonly found?: boolean;
      readonly authenticatePublic?: (
        params: FtpPublicAuthParams,
      ) => Promise<PublicAuthResult>;
      readonly onEnter?: (session: Session) => void;
    };

    const publicEnv = (over: PublicOver = {}) => {
      const base = ftpEnv({ ...(over.onEnter === undefined ? {} : { onEnter: over.onEnter }) });
      return mockCommandEnv({
        ...base,
        scan: mockScanApi({
          resolvePublic: async () => ({
            found: over.found ?? true,
            ports: over.ports ?? [{ port: 2121, service: 'ftp' }],
          }),
        }),
        ftp: mockFtpApi({
          ...base.ftp,
          authenticatePublic:
            over.authenticatePublic ??
            (async () => ({ ok: true, userType: 'guest', machineId: THEIR_BOX })),
        }),
      });
    };

    it('reaches the door behind a forward and holds the session on the box it opened', async () => {
      const entered = vi.fn();
      const authenticatePublic = vi.fn<(params: FtpPublicAuthParams) => Promise<PublicAuthResult>>(
        async () => ({ ok: true, userType: 'guest', machineId: THEIR_BOX }),
      );
      const env = publicEnv({ onEnter: entered, authenticatePublic });

      const result = await ftp.execute(
        env,
        [THEIR_PUBLIC_IP, 'guest'],
        new Map([['-p', '2121']]),
      );

      expect(linesOf(result)).toContain('230 Login successful');
      expect(authenticatePublic.mock.calls[0]![0]).toMatchObject({
        target: THEIR_PUBLIC_IP,
        port: 2121,
        username: 'guest',
        password: 'hunter2',
      });
      // The session lands on the machine id the SERVER resolved behind the forward —
      // the client has no way to know which box a stranger's port reaches.
      expect(entered.mock.calls[0]![0]).toMatchObject({
        machineId: THEIR_BOX,
        userType: 'guest',
        kind: 'ftp',
      });
    });

    it('names the box the player is standing on, so the target learns where the visit came from', async () => {
      const authenticatePublic = vi.fn<(params: FtpPublicAuthParams) => Promise<PublicAuthResult>>(
        async () => ({ ok: true, userType: 'guest', machineId: THEIR_BOX }),
      );

      await ftp.execute(
        publicEnv({ authenticatePublic }),
        [THEIR_PUBLIC_IP, 'guest'],
        new Map([['-p', '2121']]),
      );

      // Without it the server can only derive the address the player OWNS, which is a
      // lie the moment they are attacking from somebody else's box.
      expect(authenticatePublic.mock.calls[0]![0].callerMachineId).toBe('skylab-deadbeef');
    });

    it('knocks on the ftp port when the player names none', async () => {
      const authenticatePublic = vi.fn<(params: FtpPublicAuthParams) => Promise<PublicAuthResult>>(
        async () => ({ ok: true, userType: 'guest', machineId: THEIR_BOX }),
      );

      await ftp.execute(
        publicEnv({ authenticatePublic, ports: [{ port: 21, service: 'ftp' }] }),
        [THEIR_PUBLIC_IP, 'guest'],
        new Map(),
      );

      // 21, not ssh's 22: the default belongs to the door being opened.
      expect(authenticatePublic.mock.calls[0]![0].port).toBe(21);
    });

    it('falls back to the ftp port when -p carries nothing usable', async () => {
      const authenticatePublic = vi.fn<(params: FtpPublicAuthParams) => Promise<PublicAuthResult>>(
        async () => ({ ok: true, userType: 'guest', machineId: THEIR_BOX }),
      );
      const ports = [{ port: 21, service: 'ftp' }];

      // A bare `-p`, then a word where a number belongs. A typo must land on the
      // door's own port rather than knocking on NaN.
      await ftp.execute(
        publicEnv({ authenticatePublic, ports }),
        [THEIR_PUBLIC_IP, 'guest'],
        new Map([['-p', true]]),
      );
      await ftp.execute(
        publicEnv({ authenticatePublic, ports }),
        [THEIR_PUBLIC_IP, 'guest'],
        new Map([['-p', 'twentyone']]),
      );
      // `0` is not a port, and neither is a negative one.
      await ftp.execute(
        publicEnv({ authenticatePublic, ports }),
        [THEIR_PUBLIC_IP, 'guest'],
        new Map([['-p', '0']]),
      );
      await ftp.execute(
        publicEnv({ authenticatePublic, ports }),
        [THEIR_PUBLIC_IP, 'guest'],
        new Map([['-p', '-1']]),
      );

      expect(authenticatePublic.mock.calls.map(([params]) => params.port)).toEqual([21, 21, 21, 21]);
    });

    it('knocks only on the port the player named, even when their box publishes others', async () => {
      const authenticatePublic = vi.fn<(params: FtpPublicAuthParams) => Promise<PublicAuthResult>>(
        async () => ({ ok: true, userType: 'guest', machineId: THEIR_BOX }),
      );
      const env = publicEnv({
        authenticatePublic,
        ports: [
          { port: 2222, service: 'ssh' },
          { port: 2121, service: 'ftp' },
        ],
      });

      await ftp.execute(env, [THEIR_PUBLIC_IP, 'guest'], new Map([['-p', '2121']]));

      // One published forward being a different door must not close the one asked for.
      expect(authenticatePublic.mock.calls[0]![0].port).toBe(2121);
    });

    it('refuses a port their box answers nothing on, even though it serves ftp elsewhere', async () => {
      const authenticatePublic = vi.fn<(params: FtpPublicAuthParams) => Promise<PublicAuthResult>>();
      const env = publicEnv({ authenticatePublic, ports: [{ port: 21, service: 'ftp' }] });

      const result = await ftp.execute(env, [THEIR_PUBLIC_IP, 'guest'], new Map([['-p', '2121']]));

      // A forward names ONE port. Their :21 being open says nothing about their :2121,
      // which from outside is simply not published.
      expect(linesOf(result)).toContain('Connection refused');
      expect(authenticatePublic).not.toHaveBeenCalled();
    });

    it('holds nothing when the player aborts at a cross-network password prompt', async () => {
      const entered = vi.fn();
      const authenticatePublic = vi.fn<(params: FtpPublicAuthParams) => Promise<PublicAuthResult>>();
      const base = publicEnv({ onEnter: entered, authenticatePublic });
      const env = mockCommandEnv({
        ...base,
        prompt: async () => {
          throw new Error('aborted');
        },
      });

      const result = await ftp.execute(env, [THEIR_PUBLIC_IP, 'guest'], new Map([['-p', '2121']]));

      expect(sync(result).exitCode).toBe(130);
      // Nothing was sent, so there is nothing to hold — and nothing for the far side
      // to have recorded either.
      expect(authenticatePublic).not.toHaveBeenCalled();
      expect(entered).not.toHaveBeenCalled();
    });

    it('refuses when the port the player named is answered by something other than ftp', async () => {
      const authenticatePublic = vi.fn<(params: FtpPublicAuthParams) => Promise<PublicAuthResult>>();
      const env = publicEnv({ authenticatePublic, ports: [{ port: 2121, service: 'ssh' }] });

      const result = await ftp.execute(env, [THEIR_PUBLIC_IP, 'guest'], new Map([['-p', '2121']]));

      expect(linesOf(result)).toContain('Connection refused');
      // Nothing was typed at a door that isn't there — a password sent to a stranger's
      // sshd is a password handed over for nothing.
      expect(authenticatePublic).not.toHaveBeenCalled();
    });

    it('reports no route to a public address the world answers for nobody', async () => {
      const authenticatePublic = vi.fn<(params: FtpPublicAuthParams) => Promise<PublicAuthResult>>();
      const env = publicEnv({ authenticatePublic, found: false });

      const result = await ftp.execute(env, [THEIR_PUBLIC_IP, 'guest'], new Map([['-p', '2121']]));

      expect(linesOf(result)).toContain('No route to host');
      expect(authenticatePublic).not.toHaveBeenCalled();
    });

    it('refuses a cracked credential the far side rejects, holding no session', async () => {
      const entered = vi.fn();
      const env = publicEnv({
        onEnter: entered,
        authenticatePublic: async () => ({ ok: false, error: 'invalid_credentials' }),
      });

      const result = await ftp.execute(env, [THEIR_PUBLIC_IP, 'guest'], new Map([['-p', '2121']]));

      expect(linesOf(result)).toContain('530 Login incorrect');
      expect(entered).not.toHaveBeenCalled();
    });
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
    guest: buildDirectory(
      {
        // Readable by the tier that logs in, or a `get` of it would be testing the
        // refusal rather than the transfer.
        'remote-loot.txt': buildFile('theirs', { perms: { read: ['root', 'user', 'guest'] } }),
      },
      { owner: 'guest' },
    ),
  }),
  // Sealed above the guest tier, so the same path answers differently to two
  // credentials — the only way a test can tell "the tier decided" from "the door
  // decided".
  vault: buildDirectory(
    { 'sealed.txt': buildFile('classified', { perms: { read: ['root', 'user'] } }) },
    { owner: 'root', perms: { read: ['root', 'user'], execute: ['root', 'user'] } },
  ),
});

const ORIGIN_TREE = buildDirectory({
  home: buildDirectory({
    alice: buildDirectory(
      {
        'origin-notes.txt': buildFile('mine'),
        // Readable by the tier the player is standing at, or a `put` of it would be
        // testing the origin read's refusal rather than the transfer.
        'origin-drop.txt': buildFile('take this', {
          perms: { read: ['root', 'user', 'guest'] },
        }),
        // Root's own, so the origin half has something the player genuinely cannot
        // send — the mirror of the remote file the credential cannot take.
        'origin-sealed.txt': buildFile('not yours', { perms: { read: ['root'] } }),
      },
      { owner: 'alice' },
    ),
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

/**
 * Two machines that can both be WRITTEN to: each `write` lands a real `Patch` in its
 * own journal, and every line is answered by an env rebuilt over those journals
 * applied — which is what the UI does per command. A transfer is then proved by
 * finding the file afterwards rather than by watching the call that claimed to send
 * it, on whichever machine was supposed to receive it.
 *
 * The two journals are held apart on purpose: a `get` that wrote to the remote, or a
 * `put` that wrote to the origin, would be a transfer that never crossed anything —
 * and one shared journal could not tell either apart from success.
 */
const transferEnv = (
  over: {
    readonly remoteTier?: UserType;
    readonly refuseWrite?: boolean;
    readonly refuseRemoteWrite?: boolean;
    readonly onRecord?: (transfer: FtpTransfer) => void;
  } = {},
) => {
  const remote = movableCwd(REMOTE_HOME);
  const origin = movableCwd(ORIGIN_HOME);
  let journal: readonly Patch[] = [];
  let remoteJournal: readonly Patch[] = [];
  const writes: { path: string; isNew: boolean | undefined }[] = [];
  const remoteWrites: { path: string; isNew: boolean | undefined }[] = [];

  const originFs = () =>
    mockFsViewFromTree(applyPatches(ORIGIN_TREE, journal), {
      userType: 'user',
      cwd: origin.read,
    });

  const remoteFs = () =>
    mockFsViewFromTree(applyPatches(REMOTE_TREE, remoteJournal), {
      userType: over.remoteTier ?? 'guest',
      cwd: remote.read,
    });

  const buildEnv = () =>
    mockCommandEnv({
      session: mockSession({ username: 'alice', userType: 'user' }),
      fs: originFs(),
      setCwd: origin.set,
      patches: {
        ...mockPatchApi(),
        write: async (path, content, options) => {
          if (over.refuseWrite === true) return { ok: false, error: 'permission_denied' };
          writes.push({ path, isNew: options?.isNew });
          // Owner and permissions stamped the way the real adapter stamps them, so
          // the file the next command reads is the one production would have stored.
          journal = [
            ...journal,
            { path, content, owner: 'alice', permissions: defaultFilePermissions('user') },
          ];
          return { ok: true };
        },
      },
      ftp: mockFtpApi({
        fs: remoteFs(),
        setCwd: remote.set,
        // The remote write is the SERVER's decision in production — L1 on the session
        // row, then L2 at the tier the credential bought. Here it is a stub, which is
        // exactly why the tier claim itself belongs to the wire-check and not to this
        // file: what these tests prove is what the command does with either answer.
        write: async (path, content, options) => {
          if (over.refuseRemoteWrite === true) return { ok: false, error: 'no_session' };
          remoteWrites.push({ path, isNew: options?.isNew });
          remoteJournal = [
            ...remoteJournal,
            {
              path,
              content,
              owner: 'guest',
              permissions: defaultFilePermissions(over.remoteTier ?? 'guest'),
            },
          ];
          return { ok: true };
        },
        ...(over.onRecord === undefined ? {} : { recordTransfer: over.onRecord }),
      }),
    });

  return {
    run: (line: string) => runFtpLine(buildEnv(), line),
    originFs,
    remoteFs,
    writes: (): readonly { path: string; isNew: boolean | undefined }[] => writes,
    remoteWrites: (): readonly { path: string; isNew: boolean | undefined }[] => remoteWrites,
  };
};

const LOOT = '/home/guest/remote-loot.txt';

describe('taking a file from the ftp> prompt', () => {
  it('lands the remote file on the origin machine, where the shell can read it', async () => {
    const { run, originFs } = transferEnv();

    const taken = await run('get /home/guest/remote-loot.txt');

    expect(linesOf(taken)).toContain('226 Transfer complete.');
    // The file being THERE is the claim. A `get` that only printed a success line
    // would satisfy any assertion made on its own output.
    expect(originFs().read(asAbsPath('/home/alice/remote-loot.txt'))).toEqual({
      ok: true,
      content: 'theirs',
    });
  });

  it('says how many bytes arrived, and where they came from', async () => {
    const { run } = transferEnv();

    const taken = linesOf(await run(`get ${LOOT}`));

    // Both machines named on the transfer line: the whole hazard of this prompt is
    // not knowing which box you just touched.
    expect(taken).toContain(`local: /home/alice/remote-loot.txt remote: ${LOOT}`);
    expect(taken).toContain('6 bytes received.');
  });

  it('lands the file where lcd left the player, not where the shell was when ftp ran', async () => {
    const { run, originFs } = transferEnv();

    await run('lcd /tmp');
    await run(`get ${LOOT}`);

    expect(originFs().read(asAbsPath('/tmp/remote-loot.txt'))).toEqual({
      ok: true,
      content: 'theirs',
    });
    expect(originFs().read(asAbsPath('/home/alice/remote-loot.txt'))).toEqual({
      ok: false,
      error: 'not_found',
    });
  });

  it('takes the local name when given one, rather than the remote basename', async () => {
    const { run, originFs } = transferEnv();

    await run(`get ${LOOT} loot-copy.txt`);

    expect(originFs().read(asAbsPath('/home/alice/loot-copy.txt'))).toEqual({
      ok: true,
      content: 'theirs',
    });
  });

  it('overwrites an origin file that is already there, and the byte count shows it', async () => {
    const { run, originFs } = transferEnv();

    const taken = linesOf(await run(`get ${LOOT} origin-notes.txt`));

    // 'mine' (4 bytes) becomes 'theirs' (6) — the count is what makes an overwrite
    // visible, which is why it is printed rather than a bare success.
    expect(originFs().read(asAbsPath('/home/alice/origin-notes.txt'))).toEqual({
      ok: true,
      content: 'theirs',
    });
    expect(taken).toContain('6 bytes received.');
  });

  it('marks a file it created as new, and an overwrite as not', async () => {
    const { run, writes } = transferEnv();

    await run(`get ${LOOT}`);
    await run(`get ${LOOT} origin-notes.txt`);

    // The journal has to know which rows it invented: a `rm` of a file `get` created
    // must delete the row, while a `rm` of one it overwrote must leave a tombstone
    // or the original would come back from the base filesystem.
    expect(writes()).toEqual([
      { path: '/home/alice/remote-loot.txt', isNew: true },
      { path: '/home/alice/origin-notes.txt', isNew: undefined },
    ]);
  });

  it('refuses a remote file the tier cannot read, and writes nothing locally', async () => {
    const sealed = transferEnv();
    const asUser = transferEnv({ remoteTier: 'user' });

    const refused = await sealed.run('get /vault/sealed.txt');
    await asUser.run('get /vault/sealed.txt');

    expect(linesOf(refused)).toContain('550 Failed to open file.');
    expect(sync(refused).exitCode).not.toBe(0);
    expect(sealed.originFs().read(asAbsPath('/home/alice/sealed.txt'))).toEqual({
      ok: false,
      error: 'not_found',
    });
    // The absence above means something only because the very same line DOES land
    // the file one tier up — otherwise it would pass against a `get` that never worked.
    expect(asUser.originFs().read(asAbsPath('/home/alice/sealed.txt'))).toEqual({
      ok: true,
      content: 'classified',
    });
  });

  it('refuses a remote file that is not there with the same answer a sealed one gets', async () => {
    const { run } = transferEnv();

    // Telling "no such file" from "not for you" apart would map out a stranger's box
    // from outside the tier allowed to see it — the same reason `cd` collapses them.
    expect(linesOf(await run('get /vault/nothing-here.txt'))).toContain(
      '550 Failed to open file.',
    );
  });

  it('asks for the file rather than guessing when get is given none', async () => {
    const { run, writes } = transferEnv();

    expect(linesOf(await run('get'))).toContain('usage: get remote-file [local-file]');
    expect(writes()).toEqual([]);
  });

  it('reports a local write the origin refused instead of claiming the transfer worked', async () => {
    const { run } = transferEnv({ refuseWrite: true });

    const refused = await run(`get ${LOOT}`);

    expect(linesOf(refused)).toContain('local: /home/alice/remote-loot.txt: Permission denied');
    // The bytes crossed and then had nowhere to go. Announcing 226 anyway would tell
    // a player they hold a file that is not on their disk.
    expect(linesOf(refused)).not.toContain('226 Transfer complete.');
    expect(sync(refused).exitCode).not.toBe(0);
  });

  it('tells the box what left it, naming the remote path and the byte count', async () => {
    const recorded = vi.fn();
    const { run } = transferEnv({ onRecord: recorded });

    // The local name is the player's business; the REMOTE path is what the owner's
    // log has to name, or a defender reading it learns nothing about their own box.
    await run(`get ${LOOT} somewhere-else.txt`);

    expect(recorded).toHaveBeenCalledWith({ direction: 'download', path: LOOT, bytes: 6 });
  });

  it('records nothing when the file never left — refused, or with nowhere to land', async () => {
    const afterRefusedRead = vi.fn();
    const afterRefusedWrite = vi.fn();

    await transferEnv({ onRecord: afterRefusedRead }).run('get /vault/sealed.txt');
    await transferEnv({ onRecord: afterRefusedWrite, refuseWrite: true }).run(`get ${LOOT}`);

    // A download line for a file the player does not hold is a false entry in
    // someone else's evidence — the one thing this log must never carry.
    expect(afterRefusedRead).not.toHaveBeenCalled();
    expect(afterRefusedWrite).not.toHaveBeenCalled();
  });

  it('names get in help, so a player can find the reason they logged in', async () => {
    const { run } = transferEnv();

    expect(linesOf(await run('help'))).toContain('get');
  });
});

const DROP = '/home/alice/origin-drop.txt';

describe('leaving a file at the ftp> prompt', () => {
  it('lands the origin file on the REMOTE machine, where that box can read it', async () => {
    const { run, remoteFs, originFs } = transferEnv();

    const sent = await run(`put ${DROP}`);

    expect(linesOf(sent)).toContain('226 Transfer complete.');
    // The file being on the OTHER box is the claim — and the origin keeping its own
    // copy is half of it, or `put` would be a move dressed as a copy.
    expect(remoteFs().read(asAbsPath('/home/guest/origin-drop.txt'))).toEqual({
      ok: true,
      content: 'take this',
    });
    expect(originFs().read(asAbsPath(DROP))).toEqual({ ok: true, content: 'take this' });
  });

  it('says how many bytes went, and names both machines', async () => {
    const { run } = transferEnv();

    const sent = linesOf(await run(`put ${DROP}`));

    expect(sent).toContain(`local: ${DROP} remote: /home/guest/origin-drop.txt`);
    expect(sent).toContain('9 bytes sent.');
  });

  it('lands the file where cd left the session, not where the login started', async () => {
    const { run, remoteFs } = transferEnv();

    await run('cd /etc');
    await run(`put ${DROP}`);

    expect(remoteFs().read(asAbsPath('/etc/origin-drop.txt'))).toEqual({
      ok: true,
      content: 'take this',
    });
    expect(remoteFs().read(asAbsPath('/home/guest/origin-drop.txt'))).toEqual({
      ok: false,
      error: 'not_found',
    });
  });

  it('takes the remote name when given one, rather than the origin basename', async () => {
    const { run, remoteFs } = transferEnv();

    await run(`put ${DROP} /etc/cron.d/backdoor`);

    expect(remoteFs().read(asAbsPath('/etc/cron.d/backdoor'))).toEqual({
      ok: true,
      content: 'take this',
    });
  });

  it('overwrites a remote file that is already there, and the byte count shows it', async () => {
    const { run, remoteFs } = transferEnv();

    // 'theirs' (6 bytes) becomes 'take this' (9) — the same rule `get` follows on the
    // origin, in the direction where it is someone else's file being replaced.
    const sent = linesOf(await run(`put ${DROP} remote-loot.txt`));

    expect(remoteFs().read(asAbsPath('/home/guest/remote-loot.txt'))).toEqual({
      ok: true,
      content: 'take this',
    });
    expect(sent).toContain('9 bytes sent.');
  });

  it('marks a file it created as new, and an overwrite as not', async () => {
    const { run, remoteWrites } = transferEnv();

    await run(`put ${DROP}`);
    await run(`put ${DROP} remote-loot.txt`);

    // The remote's journal has to know which rows it invented, for the same reason
    // the origin's does: a `rm` of a file `put` created must delete the row, while a
    // `rm` of one it overwrote must leave a tombstone or the box's original comes back.
    expect(remoteWrites()).toEqual([
      { path: '/home/guest/origin-drop.txt', isNew: true },
      { path: '/home/guest/remote-loot.txt', isNew: undefined },
    ]);
  });

  it('refuses an origin file the player cannot read, and sends nothing', async () => {
    const { run, remoteWrites, remoteFs } = transferEnv();

    const refused = await run('put /home/alice/origin-sealed.txt');

    expect(linesOf(refused)).toContain('550 Failed to open file.');
    expect(sync(refused).exitCode).not.toBe(0);
    expect(remoteWrites()).toEqual([]);
    expect(remoteFs().read(asAbsPath('/home/guest/origin-sealed.txt'))).toEqual({
      ok: false,
      error: 'not_found',
    });
  });

  it('refuses an origin file that is not there with the same answer', async () => {
    const { run, remoteWrites } = transferEnv();

    expect(linesOf(await run('put /home/alice/imaginary.txt'))).toContain(
      '550 Failed to open file.',
    );
    expect(remoteWrites()).toEqual([]);
  });

  it('reports a remote refusal as 553 instead of claiming the transfer worked', async () => {
    const { run, remoteFs } = transferEnv({ refuseRemoteWrite: true });

    const refused = await run(`put ${DROP}`);

    // The tier is the server's call, and its refusal arrives as one answer whether the
    // session is gone or the credential simply cannot write there — so the line must be
    // true of both, and 226 must not be printed for bytes that never landed.
    expect(linesOf(refused)).toContain(
      '553 Could not create file: /home/guest/origin-drop.txt: Permission denied',
    );
    expect(linesOf(refused)).not.toContain('226 Transfer complete.');
    expect(sync(refused).exitCode).not.toBe(0);
    expect(remoteFs().read(asAbsPath('/home/guest/origin-drop.txt'))).toEqual({
      ok: false,
      error: 'not_found',
    });
  });

  it('tells the box what ARRIVED on it, naming the remote path and the byte count', async () => {
    const recorded = vi.fn();
    const { run } = transferEnv({ onRecord: recorded });

    await run(`put ${DROP} /etc/cron.d/backdoor`);

    // The direction is what makes the line legible to a defender: a file appearing on
    // their machine is a different event from one leaving it.
    expect(recorded).toHaveBeenCalledWith({
      direction: 'upload',
      path: asAbsPath('/etc/cron.d/backdoor'),
      bytes: 9,
    });
  });

  it('records nothing when the file never arrived — unreadable, or refused on the far side', async () => {
    const afterRefusedRead = vi.fn();
    const afterRefusedWrite = vi.fn();

    await transferEnv({ onRecord: afterRefusedRead }).run('put /home/alice/origin-sealed.txt');
    await transferEnv({ onRecord: afterRefusedWrite, refuseRemoteWrite: true }).run(`put ${DROP}`);

    // An UPLOAD line for a file that is not on the box is a false entry in someone
    // else's evidence — and here it would frame the player for a change they never made.
    expect(afterRefusedRead).not.toHaveBeenCalled();
    expect(afterRefusedWrite).not.toHaveBeenCalled();
  });

  it('asks for the file rather than guessing when put is given none', async () => {
    const { run, remoteWrites } = transferEnv();

    expect(linesOf(await run('put'))).toContain('usage: put local-file [remote-file]');
    expect(remoteWrites()).toEqual([]);
  });

  it('names put in help, beside the direction a player already found', async () => {
    const { run } = transferEnv();

    expect(linesOf(await run('help'))).toContain('put');
  });
});
