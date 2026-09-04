import { describe, expect, it, vi } from 'vitest';
import { scp } from './scp';
import { runFtpLine } from './ftpShell';
import {
  mockCommandEnv,
  mockFsViewFromTree,
  mockFtpApi,
  mockIdentity,
  mockNetworkViewFromConnectivity,
  mockPatchApi,
  mockScanApi,
  mockScpApi,
  mockSession,
} from '../../test/factories/commandEnv';
import { buildDirectory, buildFile } from '../../test/factories/filesystem';
import { generateHomeLan, type LanHost } from '../generation/generateHomeLan';
import { buildRemoteHostFs } from '../generation/remoteHostFs';
import { hostMachineId } from '../generation/remoteHostId';
import { parsePidfilePort } from '../services/pidfile';
import { assignHomeNetwork } from '../network/homeNetwork';
import { buildColdStartConnectivity, type ConnectivityState } from '../network/interfaces';
import { asAbsPath, asEpochMs, asMachineId, asPlayerKeyHex } from '../types';
import type { AbsPath } from '../types';
import type { Directory } from '../filesystem/types';
import type {
  CommandResult,
  PatchApi,
  PatchResult,
  PublicAuthResult,
  PublicDoorAuthParams,
  RemoteAuthParams,
  RemoteAuthResult,
  ScpReadResult,
  Session,
} from './types';

/**
 * `scp <local> <user>@<host>:<path>` — carrying one file onto a box you hold.
 *
 * The session it runs under is TRANSIENT: created for the transfer and ended when
 * the command returns, whichever way it went. That is not a style choice — the
 * write gate insists on an active session row on the target, so create → write →
 * end is the only shape that can write at all, and a row outliving the command
 * would be a door left open by a command that has already printed its last line.
 *
 * The trace this leaves is a LOGIN and nothing else. No line names the file, which
 * is what separates this door from ftp's: ftp is easier to open and itemises every
 * byte, scp needs a credential you already earned and takes the file in silence.
 */

const PUBKEY = 'a'.repeat(64);
const ESSID = 'BEAN-THERE-WIFI';
const NOW = 1700000000000;
const SOURCE = '/root/passwords.txt';
const WORDS = 'hunter2\nletmein\ncorrectbatteryhorse\n';
const REMOTE_DEST = '/usr/share/wordlists/passwords.txt';
const REMOTE_SOURCE = '/etc/passwd';
const PASSWD = 'root:x:0:0::/root:/bin/bash\nguest:x:1000:1000::/home/guest:/bin/sh\n';

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

const sshdPort = (fs: Directory): number | null => {
  const varDir = fs.entries.get('var');
  if (varDir?.kind !== 'directory') return null;
  const run = varDir.entries.get('run');
  if (run?.kind !== 'directory') return null;
  const pid = run.entries.get('sshd.pid');
  return pid?.kind === 'file' ? parsePidfilePort(pid.content) : null;
};

/** One generated host serving sshd on :22 and one serving no ssh at all — the
 *  second is what proves a door that is shut takes no credential. */
const pickHosts = (): { readonly sshHost: LanHost; readonly noSshHost: LanHost } => {
  let sshHost: LanHost | undefined;
  let noSshHost: LanHost | undefined;
  for (const host of generateHomeLan(ESSID).hosts) {
    if (host.kind !== 'machine') continue;
    const port = sshdPort(buildRemoteHostFs(ESSID, host));
    if (port === 22 && sshHost === undefined) sshHost = host;
    if (port === null && noSshHost === undefined) noSshHost = host;
  }
  if (sshHost === undefined || noSshHost === undefined) {
    throw new Error('need an ssh-serving and a non-serving host');
  }
  return { sshHost, noSshHost };
};

/** A LAN whose generated population happens to include a box serving ssh on a
 *  non-standard port — the alt-port roll is per-host, so the default ESSID's
 *  hosts are all on :22 and cannot prove `-p` reaches anything. */
const ALT_PORT_ESSID = 'PRETTY-FLY-FOR-A-WIFI';

const altPortHost = (): { readonly host: LanHost; readonly port: number } => {
  for (const host of generateHomeLan(ALT_PORT_ESSID).hosts) {
    if (host.kind !== 'machine') continue;
    const port = sshdPort(buildRemoteHostFs(ALT_PORT_ESSID, host));
    if (port !== null && port !== 22) return { host, port };
  }
  throw new Error('need a host serving ssh off :22');
};

/** The box the player is STANDING on: tools run where you stand, so this is the
 *  tree the local half of the transfer reads. */
const originTree = (): Directory =>
  buildDirectory({
    root: buildDirectory(
      {
        'passwords.txt': buildFile(WORDS, { owner: 'root' }),
        notes: buildDirectory({}, { owner: 'root' }),
      },
      { owner: 'root' },
    ),
  });

type EnvOver = {
  readonly authenticate?: (params: RemoteAuthParams) => Promise<RemoteAuthResult>;
  readonly write?: (
    session: Session,
    path: AbsPath,
    content: string,
    options?: { readonly isNew?: boolean },
  ) => Promise<PatchResult>;
  /** The read of the TARGET — its journal replayed over its generated base, at the
   *  tier the credential bought. Stubbed here; the composition it stands for is the
   *  one ftp's binding already ships. */
  readonly read?: (session: Session, path: AbsPath) => Promise<ScpReadResult>;
  /** The write onto the box the player is STANDING on — where a taken file lands,
   *  and the player's own write, exactly as if they had typed it. */
  readonly localWrite?: PatchApi['write'];
  /** The OTHER door's ledger, wired into this door's env on purpose: "scp records
   *  nothing" is only a test if the recorder it could have reached is watching. */
  readonly recordTransfer?: (transfer: {
    readonly direction: 'upload' | 'download';
    readonly path: AbsPath;
    readonly bytes: number;
  }) => void;
  readonly signal?: AbortSignal;
  readonly end?: (sessionId: string) => void;
  readonly prompt?: (opts: { message: string; masked: boolean }) => Promise<string>;
  readonly tree?: Directory;
  /** Only the alt-port case needs a different network: whether any generated host
   *  serves ssh off :22 is a per-ESSID roll, and this one's LAN has no such box. */
  readonly essid?: string;
  /** Off-network by default-override: a cold start has no association to read an
   *  ESSID from, which is the state a transfer must refuse outright. */
  readonly connectivity?: ConnectivityState;
};

const scpEnv = (over: EnvOver = {}) =>
  mockCommandEnv({
    identity: mockIdentity({ publicKeyHex: asPlayerKeyHex(PUBKEY) }),
    network: mockNetworkViewFromConnectivity(
      over.connectivity ?? onlineConnectivity(over.essid ?? ESSID),
    ),
    session: mockSession({
      id: 'su-root-1',
      machineId: asMachineId('skylab-deadbeef'),
      username: 'alice',
      userType: 'root',
    }),
    fs: mockFsViewFromTree(over.tree ?? originTree(), {
      userType: 'root',
      cwd: asAbsPath('/root'),
    }),
    now: () => asEpochMs(NOW),
    prompt: over.prompt ?? (async () => 'hunter2'),
    patches: mockPatchApi({ write: over.localWrite ?? (async () => ({ ok: true })) }),
    ftp: mockFtpApi({ recordTransfer: over.recordTransfer ?? (() => undefined) }),
    signal: over.signal ?? new AbortController().signal,
    scp: mockScpApi({
      authenticate: over.authenticate ?? (async () => ({ ok: true, userType: 'root' })),
      write: over.write ?? (async () => ({ ok: true })),
      read: over.read ?? (async () => ({ ok: true, content: PASSWD })),
      end: over.end ?? (() => undefined),
    }),
  });

/** What the player ends up seeing, however it was delivered. Only the path that
 *  reaches the network streams — an answer with nothing pending has nothing to
 *  announce — and the terminal renders both the same, so the tests read both the
 *  same. */
const drain = async (
  result: CommandResult,
): Promise<{ readonly lines: readonly string[]; readonly exitCode: number }> => {
  if (result.kind === 'sync') {
    return { lines: result.lines.map((line) => line.content), exitCode: result.exitCode };
  }
  if (result.kind !== 'async') throw new Error('expected lines, not a mode change');
  const lines: string[] = [];
  for await (const line of result.lines) lines.push(line.content);
  return { lines, exitCode: await result.exitCode() };
};

const upload = (host: LanHost, dest = REMOTE_DEST): readonly string[] => [
  SOURCE,
  `root@${host.ip}:${dest}`,
];

/** The mirror: the remote operand comes FIRST, and which operand names a host is the
 *  whole of how the two directions tell themselves apart. */
const download = (
  host: LanHost,
  destination = './',
  source = REMOTE_SOURCE,
): readonly string[] => [`root@${host.ip}:${source}`, destination];

describe('scp', () => {
  it('carries a file to a host typed as a NAME, onto the same box', async () => {
    const { sshHost } = pickHosts();
    const write = vi.fn<NonNullable<EnvOver['write']>>(async () => ({ ok: true }));

    const { exitCode } = await drain(
      await scp.execute(
        scpEnv({ write }),
        [SOURCE, `root@${sshHost.hostname}:${REMOTE_DEST}`],
        new Map(),
      ),
    );

    expect(exitCode).toBe(0);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0]![0]).toMatchObject({
      machineId: hostMachineId(sshHost, ESSID),
    });
  });

  it('carries a file onto the target and reports the transfer once it has landed', async () => {
    const { sshHost } = pickHosts();
    const write = vi.fn<NonNullable<EnvOver['write']>>(async () => ({ ok: true }));
    const env = scpEnv({ write });

    const { lines, exitCode } = await drain(await scp.execute(env, upload(sshHost), new Map()));

    expect(write).toHaveBeenCalledTimes(1);
    const [session, path, content] = write.mock.calls[0]!;
    expect(path).toBe(REMOTE_DEST);
    expect(content).toBe(WORDS);
    // The write is stamped with the account the credential bought, on the box the
    // server resolved — the client never picks either.
    expect(session).toMatchObject({
      machineId: hostMachineId(sshHost, ESSID),
      username: 'root',
      userType: 'root',
      kind: 'scp',
    });
    // Announce while the round-trip is pending, then ONE completed line. A live
    // progress bar is what an append-only terminal cannot honestly draw.
    expect(lines).toEqual([
      `Connecting to ${sshHost.ip}...`,
      `passwords.txt   100%  ${WORDS.length} bytes`,
    ]);
    expect(exitCode).toBe(0);
  });

  it('ends the session it opened once the file has landed', async () => {
    const { sshHost } = pickHosts();
    const end = vi.fn<(sessionId: string) => void>();
    const authenticate = vi.fn<(params: RemoteAuthParams) => Promise<RemoteAuthResult>>(async () => ({
      ok: true,
      userType: 'root',
    }));
    const env = scpEnv({ end, authenticate });

    await drain(await scp.execute(env, upload(sshHost), new Map()));

    expect(end).toHaveBeenCalledTimes(1);
    expect(end).toHaveBeenCalledWith(authenticate.mock.calls[0]![0].sessionId);
  });

  it('ends the session even when the tier refuses the write, leaving no file behind', async () => {
    const { sshHost } = pickHosts();
    const end = vi.fn<(sessionId: string) => void>();
    const write = vi.fn<NonNullable<EnvOver['write']>>(async () => ({
      ok: false,
      error: 'permission_denied',
    }));
    const env = scpEnv({ end, write });

    const { lines, exitCode } = await drain(await scp.execute(env, upload(sshHost), new Map()));

    expect(lines).toContain(`scp: ${REMOTE_DEST}: Permission denied`);
    expect(lines).not.toContain(`passwords.txt   100%  ${WORDS.length} bytes`);
    expect(exitCode).toBe(1);
    // A single atomic write, so a refusal moved nothing — and the row it opened is
    // still closed behind it.
    expect(write).toHaveBeenCalledTimes(1);
    expect(end).toHaveBeenCalledTimes(1);
  });

  it('reports a refused credential and opens no session to end', async () => {
    const { sshHost } = pickHosts();
    const end = vi.fn<(sessionId: string) => void>();
    const write = vi.fn<NonNullable<EnvOver['write']>>(async () => ({ ok: true }));
    const env = scpEnv({
      end,
      write,
      authenticate: async () => ({ ok: false, error: 'invalid_credentials' }),
    });

    const { lines, exitCode } = await drain(await scp.execute(env, upload(sshHost), new Map()));

    expect(lines).toContain('Permission denied (password).');
    expect(exitCode).toBe(1);
    expect(write).not.toHaveBeenCalled();
    expect(end).not.toHaveBeenCalled();
  });

  it('validates the source before connecting, so a typo never reaches the target', async () => {
    const { sshHost } = pickHosts();
    const authenticate = vi.fn<(params: RemoteAuthParams) => Promise<RemoteAuthResult>>(async () => ({
      ok: true,
      userType: 'root',
    }));
    const prompt = vi.fn<NonNullable<EnvOver['prompt']>>(async () => 'hunter2');
    const env = scpEnv({ authenticate, prompt });

    const { lines, exitCode } = await drain(
      await scp.execute(env, ['/root/nope.txt', `root@${sshHost.ip}:${REMOTE_DEST}`], new Map()),
    );

    expect(lines).toEqual(['scp: /root/nope.txt: No such file or directory']);
    expect(exitCode).toBe(1);
    // Nothing was typed and nothing was sent: the target's log has no reason to
    // record a visit that never happened.
    expect(prompt).not.toHaveBeenCalled();
    expect(authenticate).not.toHaveBeenCalled();
  });

  it('refuses a directory as the source until recursive copies exist', async () => {
    const { sshHost } = pickHosts();
    const env = scpEnv();

    const { lines, exitCode } = await drain(
      await scp.execute(env, ['/root/notes', `root@${sshHost.ip}:${REMOTE_DEST}`], new Map()),
    );

    expect(lines).toEqual(['scp: /root/notes: Is a directory']);
    expect(exitCode).toBe(1);
  });

  it('refuses a host whose sshd is not running without asking for a password', async () => {
    const { noSshHost } = pickHosts();
    const prompt = vi.fn<NonNullable<EnvOver['prompt']>>(async () => 'hunter2');
    const authenticate = vi.fn<(params: RemoteAuthParams) => Promise<RemoteAuthResult>>(async () => ({
      ok: true,
      userType: 'root',
    }));
    const env = scpEnv({ prompt, authenticate });

    const { lines, exitCode } = await drain(await scp.execute(env, upload(noSshHost), new Map()));

    expect(lines).toEqual([`scp: connect to host ${noSshHost.ip} port 22: Connection refused`]);
    expect(exitCode).toBe(1);
    expect(prompt).not.toHaveBeenCalled();
    expect(authenticate).not.toHaveBeenCalled();
  });

  it('reaches a host whose sshd listens on the port -p names', async () => {
    const { host: altHost, port } = altPortHost();
    const write = vi.fn<NonNullable<EnvOver['write']>>(async () => ({ ok: true }));
    const env = scpEnv({ write, essid: ALT_PORT_ESSID });

    const { exitCode } = await drain(
      await scp.execute(env, upload(altHost), new Map([['-p', String(port)]])),
    );

    expect(exitCode).toBe(0);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('refuses a port the target is not serving ssh on', async () => {
    const { sshHost } = pickHosts();
    const authenticate = vi.fn<(params: RemoteAuthParams) => Promise<RemoteAuthResult>>(async () => ({
      ok: true,
      userType: 'root',
    }));
    const env = scpEnv({ authenticate });

    const { lines, exitCode } = await drain(
      await scp.execute(env, upload(sshHost), new Map([['-p', '9999']])),
    );

    expect(lines).toEqual([`scp: connect to host ${sshHost.ip} port 9999: Connection refused`]);
    expect(exitCode).toBe(1);
    expect(authenticate).not.toHaveBeenCalled();
  });

  it('falls back to the port the target is serving when -p carries no usable value', async () => {
    const { sshHost } = pickHosts();
    const write = vi.fn<NonNullable<EnvOver['write']>>(async () => ({ ok: true }));
    const env = scpEnv({ write });

    const { exitCode } = await drain(
      await scp.execute(env, upload(sshHost), new Map([['-p', 'not-a-port']])),
    );

    expect(exitCode).toBe(0);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('sends the typed password and lets the server decide the tier', async () => {
    const { sshHost } = pickHosts();
    const authenticate = vi.fn<(params: RemoteAuthParams) => Promise<RemoteAuthResult>>(async () => ({
      ok: true,
      userType: 'user',
    }));
    const write = vi.fn<NonNullable<EnvOver['write']>>(async () => ({ ok: true }));
    const env = scpEnv({ authenticate, write, prompt: async () => 'letmein' });

    await drain(await scp.execute(env, upload(sshHost), new Map()));

    expect(authenticate.mock.calls[0]![0]).toMatchObject({
      essid: ESSID,
      targetIp: sshHost.ip,
      username: 'root',
      password: 'letmein',
    });
    // Server-derived, never a client claim: the tier that came back is the tier the
    // write is stamped with.
    expect(write.mock.calls[0]![0]).toMatchObject({ userType: 'user' });
  });

  it('takes nothing and opens nothing when the password prompt is abandoned', async () => {
    const { sshHost } = pickHosts();
    const end = vi.fn<(sessionId: string) => void>();
    const write = vi.fn<NonNullable<EnvOver['write']>>(async () => ({ ok: true }));
    const authenticate = vi.fn<(params: RemoteAuthParams) => Promise<RemoteAuthResult>>(async () => ({
      ok: true,
      userType: 'root',
    }));
    const env = scpEnv({
      end,
      write,
      authenticate,
      prompt: async () => {
        throw new Error('aborted');
      },
    });

    const { lines, exitCode } = await drain(await scp.execute(env, upload(sshHost), new Map()));

    expect(exitCode).toBe(130);
    // Silently: an abandoned prompt is not an error to report back, and the player
    // is already looking at their own shell.
    expect(lines).toEqual([]);
    expect(authenticate).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(end).not.toHaveBeenCalled();
  });

  it('reports the two operands it needs when the destination names no remote host', async () => {
    const env = scpEnv();

    const { lines, exitCode } = await drain(
      await scp.execute(env, [SOURCE, '/tmp/passwords.txt'], new Map()),
    );

    expect(lines).toEqual(['usage: scp [-p port] <local-file> <user>@<host>:<path>']);
    expect(exitCode).toBe(1);
  });

  it.each([
    ['no operands at all', []],
    ['a source with nowhere to put it', [SOURCE]],
    ['an account with no host', ['pw.txt', 'root@:/root/pw.txt']],
    ['a host with no account', ['pw.txt', '@192.168.1.5:/root/pw.txt']],
    ['a destination with no path', ['pw.txt', 'root@192.168.1.5:']],
    ['a host with no path separator', ['pw.txt', 'root@192.168.1.5']],
  ])('reports usage for %s, sending nothing anywhere', async (_case, args) => {
    const authenticate = vi.fn<(params: RemoteAuthParams) => Promise<RemoteAuthResult>>(async () => ({
      ok: true,
      userType: 'root',
    }));
    const env = scpEnv({ authenticate });

    const { lines, exitCode } = await drain(await scp.execute(env, args, new Map()));

    expect(lines).toEqual(['usage: scp [-p port] <local-file> <user>@<host>:<path>']);
    expect(exitCode).toBe(1);
    expect(authenticate).not.toHaveBeenCalled();
  });

  it('splits the destination into the account, the host and the path it names', async () => {
    const { sshHost } = pickHosts();
    const authenticate = vi.fn<(params: RemoteAuthParams) => Promise<RemoteAuthResult>>(async () => ({
      ok: true,
      userType: 'user',
    }));
    const write = vi.fn<NonNullable<EnvOver['write']>>(async () => ({ ok: true }));
    const env = scpEnv({ authenticate, write });

    await drain(
      await scp.execute(env, [SOURCE, `deploy@${sshHost.ip}:/home/deploy/list.txt`], new Map()),
    );

    expect(authenticate.mock.calls[0]![0]).toMatchObject({
      targetIp: sshHost.ip,
      username: 'deploy',
    });
    expect(write.mock.calls[0]![1]).toBe('/home/deploy/list.txt');
    // The row it opens names the account it was opened for, so a transfer that
    // outlives its command is traceable in the sessions table rather than anonymous.
    expect(authenticate.mock.calls[0]![0].sessionId).toContain('deploy');
  });

  it('reads a path with no leading slash from the home of the account it logged in as', async () => {
    const { sshHost } = pickHosts();
    const read = vi.fn<NonNullable<EnvOver['read']>>(async () => ({ ok: true, content: PASSWD }));
    const env = scpEnv({ read });

    await drain(
      await scp.execute(env, download(sshHost, '/root/stolen.txt', 'notes.txt'), new Map()),
    );

    // Where a login would have put them. The tier that decides which directory that
    // is comes back with the credential, so the remote half of the command line
    // cannot be resolved until the session exists.
    expect(read.mock.calls[0]![1]).toBe('/root/notes.txt');
  });

  it('resolves a relative remote path against the home the tier that came back names', async () => {
    const { sshHost } = pickHosts();
    const read = vi.fn<NonNullable<EnvOver['read']>>(async () => ({ ok: true, content: PASSWD }));
    const env = scpEnv({ read, authenticate: async () => ({ ok: true, userType: 'user' }) });

    await drain(
      await scp.execute(
        env,
        [`deploy@${sshHost.ip}:notes.txt`, '/root/stolen.txt'],
        new Map(),
      ),
    );

    // Not `/root`: an ordinary account lives under `/home`, and guessing otherwise
    // would read a path only root has.
    expect(read.mock.calls[0]![1]).toBe('/home/deploy/notes.txt');
  });

  it('carries a file to a relative remote path from that same home', async () => {
    const { sshHost } = pickHosts();
    const write = vi.fn<NonNullable<EnvOver['write']>>(async () => ({ ok: true }));
    const env = scpEnv({ write });

    await drain(await scp.execute(env, upload(sshHost, 'list.txt'), new Map()));

    // One rule, both directions: the remote half means the same thing whichever
    // end of the command line it is typed at.
    expect(write.mock.calls[0]![1]).toBe('/root/list.txt');
  });

  it('says the round-trip failed rather than blaming the tier when a carried file never arrives', async () => {
    const { sshHost } = pickHosts();
    const end = vi.fn<(sessionId: string) => void>();
    const env = scpEnv({ end, write: async () => ({ ok: false, error: 'network_error' }) });

    const { lines, exitCode } = await drain(await scp.execute(env, upload(sshHost), new Map()));

    // A write that never reached the far side is OURS, exactly as a read that never
    // did is — and `Permission denied` would send the player hunting a tier problem
    // they do not have.
    expect(lines).toContain('Connection closed by remote host.');
    expect(lines).not.toContain(`scp: ${REMOTE_DEST}: Permission denied`);
    expect(exitCode).toBe(1);
    expect(end).toHaveBeenCalledTimes(1);
  });

  it('tells the target where the transfer came from, so the login line names an address', async () => {
    const { sshHost } = pickHosts();
    const authenticate = vi.fn<(params: RemoteAuthParams) => Promise<RemoteAuthResult>>(async () => ({
      ok: true,
      userType: 'root',
    }));
    const env = scpEnv({ authenticate });

    await drain(await scp.execute(env, upload(sshHost), new Map()));

    // The defender's only lead on a silent door. Reported here because on the
    // player's own LAN it is the one address the target could have seen.
    expect(authenticate.mock.calls[0]![0].sourceIp).toBe(assignHomeNetwork(PUBKEY, ESSID).localIp);
  });

  it('names the account and host it is asking a password for', async () => {
    const { sshHost } = pickHosts();
    const prompt = vi.fn<NonNullable<EnvOver['prompt']>>(async () => 'hunter2');
    const env = scpEnv({ prompt });

    await drain(await scp.execute(env, upload(sshHost), new Map()));

    expect(prompt).toHaveBeenCalledWith({
      message: `root@${sshHost.ip}'s password: `,
      masked: true,
    });
  });

  it('refuses an address that is nobody on this network', async () => {
    const authenticate = vi.fn<(params: RemoteAuthParams) => Promise<RemoteAuthResult>>(async () => ({
      ok: true,
      userType: 'root',
    }));
    const env = scpEnv({ authenticate });

    const { lines, exitCode } = await drain(
      await scp.execute(env, [SOURCE, `root@192.168.99.99:${REMOTE_DEST}`], new Map()),
    );

    expect(lines).toEqual(['scp: connect to host 192.168.99.99 port 22: No route to host']);
    expect(exitCode).toBe(1);
    expect(authenticate).not.toHaveBeenCalled();
  });

  it('refuses to transfer anything while the machine is off the network', async () => {
    const { sshHost } = pickHosts();
    const env = scpEnv({ connectivity: buildColdStartConnectivity(PUBKEY) });

    const { lines, exitCode } = await drain(await scp.execute(env, upload(sshHost), new Map()));

    expect(lines).toEqual(['scp: Network is unreachable']);
    expect(exitCode).toBe(1);
  });

  it('refuses while associated to an access point that has issued no address', async () => {
    const { sshHost } = pickHosts();
    // Associated but unaddressed: there is an ESSID to name and still no way to
    // reach anyone, which is a different failure from never having joined.
    const associated = onlineConnectivity(ESSID);
    const wlan0 = associated.interfaces.get('wlan0');
    if (wlan0 === undefined || wlan0.kind !== 'wireless') throw new Error('no wlan0');
    const env = scpEnv({
      connectivity: {
        interfaces: new Map(associated.interfaces).set('wlan0', { ...wlan0, ipv4: null }),
      },
    });

    const { lines, exitCode } = await drain(await scp.execute(env, upload(sshHost), new Map()));

    expect(lines).toEqual(['scp: Network is unreachable']);
    expect(exitCode).toBe(1);
  });

  it.each([
    ['zero', '0'],
    ['negative', '-22'],
    ['fractional', '22.5'],
  ])('treats a %s -p as no port at all and uses the one being served', async (_case, value) => {
    const { sshHost } = pickHosts();
    const write = vi.fn<NonNullable<EnvOver['write']>>(async () => ({ ok: true }));
    const env = scpEnv({ write });

    const { exitCode } = await drain(
      await scp.execute(env, upload(sshHost), new Map([['-p', value]])),
    );

    expect(exitCode).toBe(0);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('uses the served port when -p is given with no value', async () => {
    const { sshHost } = pickHosts();
    const write = vi.fn<NonNullable<EnvOver['write']>>(async () => ({ ok: true }));
    const env = scpEnv({ write });

    const { exitCode } = await drain(
      await scp.execute(env, upload(sshHost), new Map([['-p', true]])),
    );

    expect(exitCode).toBe(0);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('reports a transfer that could not reach the far side without claiming a password was wrong', async () => {
    const { sshHost } = pickHosts();
    const end = vi.fn<(sessionId: string) => void>();
    const env = scpEnv({ end, authenticate: async () => ({ ok: false, error: 'network_error' }) });

    const { lines, exitCode } = await drain(await scp.execute(env, upload(sshHost), new Map()));

    expect(lines).toContain(`scp: connect to host ${sshHost.ip} port 22: Connection refused`);
    expect(lines).not.toContain('Permission denied (password).');
    expect(exitCode).toBe(1);
    expect(end).not.toHaveBeenCalled();
  });

  describe('taking a file off the target', () => {
    it('lands the file under its own name when the destination names a directory', async () => {
      const { sshHost } = pickHosts();
      const localWrite = vi.fn<PatchApi['write']>(async () => ({ ok: true }));
      const read = vi.fn<NonNullable<EnvOver['read']>>(async () => ({
        ok: true,
        content: PASSWD,
      }));
      const end = vi.fn<(sessionId: string) => void>();
      const env = scpEnv({ localWrite, read, end });

      const { lines, exitCode } = await drain(
        await scp.execute(env, download(sshHost), new Map()),
      );

      // Read at the session's tier, off the machine the server resolved.
      expect(read).toHaveBeenCalledTimes(1);
      const [session, remotePath] = read.mock.calls[0]!;
      expect(remotePath).toBe(REMOTE_SOURCE);
      expect(session).toMatchObject({
        machineId: hostMachineId(sshHost, ESSID),
        username: 'root',
        kind: 'scp',
      });
      // `./` is the directory the player is standing in, so the file arrives beside
      // them wearing the name it had on the box it came from.
      expect(localWrite).toHaveBeenCalledTimes(1);
      expect(localWrite.mock.calls[0]![0]).toBe('/root/passwd');
      expect(localWrite.mock.calls[0]![1]).toBe(PASSWD);
      expect(lines).toEqual([
        `Connecting to ${sshHost.ip}...`,
        `passwd   100%  ${PASSWD.length} bytes`,
      ]);
      expect(exitCode).toBe(0);
      expect(end).toHaveBeenCalledTimes(1);
    });

    it('lands the file at the exact path the destination names', async () => {
      const { sshHost } = pickHosts();
      const localWrite = vi.fn<PatchApi['write']>(async () => ({ ok: true }));
      const env = scpEnv({ localWrite });

      const { exitCode } = await drain(
        await scp.execute(env, download(sshHost, '/root/stolen.txt'), new Map()),
      );

      expect(localWrite.mock.calls[0]![0]).toBe('/root/stolen.txt');
      expect(localWrite.mock.calls[0]![1]).toBe(PASSWD);
      expect(exitCode).toBe(0);
    });

    it('refuses a remote path the tier cannot read exactly as one that is not there', async () => {
      const { sshHost } = pickHosts();
      const sealed = await drain(
        await scp.execute(
          scpEnv({ read: async () => ({ ok: false, error: 'permission_denied' }) }),
          download(sshHost, './', '/root/.ssh/id_rsa'),
          new Map(),
        ),
      );
      const absent = await drain(
        await scp.execute(
          scpEnv({ read: async () => ({ ok: false, error: 'not_found' }) }),
          download(sshHost, './', '/root/.ssh/id_rsa'),
          new Map(),
        ),
      );

      // Identical, deliberately: telling them apart maps out a stranger's box from
      // outside the tier that is allowed to see it — the same argument ftp's `cd`
      // makes about the box it is standing on.
      expect(sealed).toEqual(absent);
      expect(sealed.lines).toContain('scp: /root/.ssh/id_rsa: No such file or directory');
      expect(sealed.exitCode).toBe(1);
    });

    it('names a remote directory rather than reporting it missing', async () => {
      const { sshHost } = pickHosts();
      const env = scpEnv({ read: async () => ({ ok: false, error: 'is_directory' }) });

      const { lines, exitCode } = await drain(
        await scp.execute(env, download(sshHost, './', '/etc'), new Map()),
      );

      // A directory is neither missing nor sealed: the tier that reached it could
      // have listed it anyway, so naming it costs nothing and makes the absent `-r`
      // legible instead of mysterious.
      expect(lines).toContain('scp: /etc: not a regular file');
      expect(exitCode).toBe(1);
    });

    it('says the round-trip failed rather than claiming the file is gone', async () => {
      const { sshHost } = pickHosts();
      const localWrite = vi.fn<PatchApi['write']>(async () => ({ ok: true }));
      const env = scpEnv({ localWrite, read: async () => ({ ok: false, error: 'network_error' }) });

      const { lines, exitCode } = await drain(
        await scp.execute(env, download(sshHost), new Map()),
      );

      // Ours, not the target's. A player told the file is missing stops looking for
      // something that is probably still there.
      expect(lines).toContain('Connection closed by remote host.');
      expect(lines).not.toContain(`scp: ${REMOTE_SOURCE}: No such file or directory`);
      expect(exitCode).toBe(1);
      expect(localWrite).not.toHaveBeenCalled();
    });

    it('ends the session whether the file came back or not', async () => {
      const { sshHost } = pickHosts();
      const end = vi.fn<(sessionId: string) => void>();
      const env = scpEnv({ end, read: async () => ({ ok: false, error: 'not_found' }) });

      await drain(await scp.execute(env, download(sshHost), new Map()));

      expect(end).toHaveBeenCalledTimes(1);
    });

    it('reports a refused local write, lands nothing, and still closes the row', async () => {
      const { sshHost } = pickHosts();
      const end = vi.fn<(sessionId: string) => void>();
      const localWrite = vi.fn<PatchApi['write']>(async () => ({
        ok: false,
        error: 'permission_denied',
      }));
      const env = scpEnv({ end, localWrite });

      const { lines, exitCode } = await drain(
        await scp.execute(env, download(sshHost, '/root/stolen.txt'), new Map()),
      );

      expect(lines).toContain('scp: /root/stolen.txt: Permission denied');
      expect(lines).not.toContain(`passwd   100%  ${PASSWD.length} bytes`);
      expect(exitCode).toBe(1);
      expect(end).toHaveBeenCalledTimes(1);
    });

    it('says the round-trip failed rather than blaming the tier when the landing never happens', async () => {
      const { sshHost } = pickHosts();
      const env = scpEnv({ localWrite: async () => ({ ok: false, error: 'network_error' }) });

      const { lines, exitCode } = await drain(
        await scp.execute(env, download(sshHost, '/root/stolen.txt'), new Map()),
      );

      // The bytes came back and then could not be persisted. Naming that a
      // permission problem points the player at their own tier, which was never in
      // question — they had already read the file.
      expect(lines).toContain('Connection closed by remote host.');
      expect(lines).not.toContain('scp: /root/stolen.txt: Permission denied');
      expect(exitCode).toBe(1);
    });

    it('lands nothing and still closes the row when interrupted after the file is read', async () => {
      const { sshHost } = pickHosts();
      const controller = new AbortController();
      const localWrite = vi.fn<PatchApi['write']>(async () => ({ ok: true }));
      const end = vi.fn<(sessionId: string) => void>();
      const env = scpEnv({
        end,
        localWrite,
        signal: controller.signal,
        read: async () => {
          controller.abort();
          return { ok: true, content: PASSWD };
        },
      });

      const { lines, exitCode } = await drain(
        await scp.execute(env, download(sshHost), new Map()),
      );

      // The bytes were in hand and are dropped: a file half-taken is a file the
      // player did not ask for. The row still closes — an abandoned command must
      // not leave a door open behind it.
      expect(localWrite).not.toHaveBeenCalled();
      expect(end).toHaveBeenCalledTimes(1);
      expect(exitCode).toBe(130);
      expect(lines).toEqual([`Connecting to ${sshHost.ip}...`]);
    });

    it('sends nothing and still closes the row when interrupted before the transfer starts', async () => {
      const { sshHost } = pickHosts();
      const controller = new AbortController();
      const write = vi.fn<NonNullable<EnvOver['write']>>(async () => ({ ok: true }));
      const end = vi.fn<(sessionId: string) => void>();
      const env = scpEnv({
        end,
        write,
        signal: controller.signal,
        authenticate: async () => {
          controller.abort();
          return { ok: true, userType: 'root' };
        },
      });

      const { exitCode } = await drain(await scp.execute(env, upload(sshHost), new Map()));

      expect(write).not.toHaveBeenCalled();
      expect(end).toHaveBeenCalledTimes(1);
      expect(exitCode).toBe(130);
    });

    it('refuses a destination with nowhere to land before it connects', async () => {
      const { sshHost } = pickHosts();
      const authenticate = vi.fn<(params: RemoteAuthParams) => Promise<RemoteAuthResult>>(
        async () => ({ ok: true, userType: 'root' }),
      );
      const prompt = vi.fn<NonNullable<EnvOver['prompt']>>(async () => 'hunter2');
      const env = scpEnv({ authenticate, prompt });

      const { lines, exitCode } = await drain(
        await scp.execute(env, download(sshHost, '/nope/passwd'), new Map()),
      );

      // The player's own mistake, on their own box — and it must not cost them a
      // line in somebody else's log, which is the rule the upload's source check
      // already follows.
      expect(lines).toEqual(['scp: /nope/passwd: No such file or directory']);
      expect(exitCode).toBe(1);
      expect(prompt).not.toHaveBeenCalled();
      expect(authenticate).not.toHaveBeenCalled();
    });

    it('refuses to copy between two remote hosts', async () => {
      const { sshHost } = pickHosts();
      const authenticate = vi.fn<(params: RemoteAuthParams) => Promise<RemoteAuthResult>>(
        async () => ({ ok: true, userType: 'root' }),
      );
      const env = scpEnv({ authenticate });

      const { lines, exitCode } = await drain(
        await scp.execute(
          env,
          [`root@${sshHost.ip}:${REMOTE_SOURCE}`, `root@192.168.1.9:/root/passwd`],
          new Map(),
        ),
      );

      // Two hosts is two transient sessions in one command; until that exists the
      // operand rule has no answer, and guessing one would move a file somewhere
      // nobody asked for.
      expect(lines).toEqual(['usage: scp [-p port] <local-file> <user>@<host>:<path>']);
      expect(exitCode).toBe(1);
      expect(authenticate).not.toHaveBeenCalled();
    });

    it('takes the file without the record ftp leaves behind for the same theft', async () => {
      const { sshHost } = pickHosts();
      const record = vi.fn();
      const remoteTree = buildDirectory({
        etc: buildDirectory({ passwd: buildFile(PASSWD, { owner: 'root' }) }, { owner: 'root' }),
      });
      const ftpEnv = mockCommandEnv({
        fs: mockFsViewFromTree(originTree(), { userType: 'root', cwd: asAbsPath('/root') }),
        patches: mockPatchApi({ write: async () => ({ ok: true }) }),
        ftp: mockFtpApi({
          fs: mockFsViewFromTree(remoteTree, { userType: 'root', cwd: asAbsPath('/') }),
          recordTransfer: record,
        }),
      });

      await runFtpLine(ftpEnv, `get ${REMOTE_SOURCE}`);

      expect(record).toHaveBeenCalledWith({
        direction: 'download',
        path: REMOTE_SOURCE,
        bytes: PASSWD.length,
      });

      // The same file, off the same box, through the other door — with the SAME
      // ledger watching, so silence here is measured rather than assumed. Two doors,
      // two costs: ftp is easier to open and itemises every byte; scp needs a
      // credential you already earned and takes the file without a word.
      const { exitCode } = await drain(
        await scp.execute(
          scpEnv({ recordTransfer: record }),
          download(sshHost, '/root/stolen.txt'),
          new Map(),
        ),
      );

      expect(exitCode).toBe(0);
      expect(record).toHaveBeenCalledTimes(1);
    });
  });

  /**
   * The same transfer, against somebody else's machine. A public address names an
   * ACCESS POINT rather than a box, so which machine sits behind the port its owner
   * forwarded is not derivable here — the server resolves it, and the session lands
   * on the id it names. What the door insists on is that the forward is answered by
   * SSHD: scp reaches exactly what ssh reaches, and a forward onto a stranger's ftp
   * daemon is not a door this command can open.
   */
  describe('across the network', () => {
    const THEIR_PUBLIC_IP = '203.0.113.7';
    const THEIR_BOX = 'workstation-a1b2c3d4';
    const FORWARD = 2222;

    type PublicOver = EnvOver & {
      readonly ports?: readonly { readonly port: number; readonly service: string }[];
      readonly found?: boolean;
      readonly authenticatePublic?: (params: PublicDoorAuthParams) => Promise<PublicAuthResult>;
    };

    const publicEnv = (over: PublicOver = {}) => {
      const base = scpEnv(over);
      return mockCommandEnv({
        ...base,
        scan: mockScanApi({
          resolvePublic: async () => ({
            found: over.found ?? true,
            ports: over.ports ?? [{ port: FORWARD, service: 'ssh' }],
          }),
        }),
        scp: mockScpApi({
          ...base.scp,
          authenticatePublic:
            over.authenticatePublic ??
            (async () => ({ ok: true, userType: 'root', machineId: THEIR_BOX })),
        }),
      });
    };

    const carryAcross = (dest = REMOTE_DEST): readonly string[] => [
      SOURCE,
      `root@${THEIR_PUBLIC_IP}:${dest}`,
    ];

    const takeAcross = (destination = './', source = REMOTE_SOURCE): readonly string[] => [
      `root@${THEIR_PUBLIC_IP}:${source}`,
      destination,
    ];

    const forwarded = new Map([['-p', String(FORWARD)]]);

    it('carries a file onto the box behind the forward, on the machine the server names', async () => {
      const write = vi.fn<NonNullable<EnvOver['write']>>(async () => ({ ok: true }));
      const authenticatePublic = vi.fn<
        (params: PublicDoorAuthParams) => Promise<PublicAuthResult>
      >(async () => ({ ok: true, userType: 'root', machineId: THEIR_BOX }));
      const env = publicEnv({ write, authenticatePublic });

      const { lines, exitCode } = await drain(
        await scp.execute(env, carryAcross(), forwarded),
      );

      expect(authenticatePublic.mock.calls[0]![0]).toMatchObject({
        target: THEIR_PUBLIC_IP,
        port: FORWARD,
        username: 'root',
        password: 'hunter2',
      });
      // The client cannot know which box a stranger's port reaches, so the write is
      // stamped with the id that came back rather than one resolved here.
      expect(write.mock.calls[0]![0]).toMatchObject({ machineId: THEIR_BOX, kind: 'scp' });
      expect(write.mock.calls[0]![1]).toBe(REMOTE_DEST);
      expect(write.mock.calls[0]![2]).toBe(WORDS);
      expect(lines).toEqual([
        `Connecting to ${THEIR_PUBLIC_IP}...`,
        `passwords.txt   100%  ${WORDS.length} bytes`,
      ]);
      expect(exitCode).toBe(0);
    });

    it('takes a file off the box behind the forward and lands it where the player stands', async () => {
      const read = vi.fn<NonNullable<EnvOver['read']>>(async () => ({ ok: true, content: PASSWD }));
      const localWrite = vi.fn<PatchApi['write']>(async () => ({ ok: true }));
      const env = publicEnv({ read, localWrite });

      const { lines, exitCode } = await drain(await scp.execute(env, takeAcross(), forwarded));

      expect(read.mock.calls[0]![0]).toMatchObject({ machineId: THEIR_BOX, kind: 'scp' });
      expect(read.mock.calls[0]![1]).toBe(REMOTE_SOURCE);
      expect(localWrite.mock.calls[0]![0]).toBe('/root/passwd');
      expect(localWrite.mock.calls[0]![1]).toBe(PASSWD);
      expect(lines).toEqual([
        `Connecting to ${THEIR_PUBLIC_IP}...`,
        `passwd   100%  ${PASSWD.length} bytes`,
      ]);
      expect(exitCode).toBe(0);
    });

    it('names the box the transfer is being run from, so the target learns where it came from', async () => {
      const authenticatePublic = vi.fn<
        (params: PublicDoorAuthParams) => Promise<PublicAuthResult>
      >(async () => ({ ok: true, userType: 'root', machineId: THEIR_BOX }));

      await drain(
        await scp.execute(publicEnv({ authenticatePublic }), carryAcross(), forwarded),
      );

      // Without it the server can only derive the address the player OWNS, which
      // stops being true the moment the transfer is run from a box they took.
      expect(authenticatePublic.mock.calls[0]![0].callerMachineId).toBe('skylab-deadbeef');
    });

    it('refuses a forward answered by another daemon without asking for a password', async () => {
      const prompt = vi.fn<NonNullable<EnvOver['prompt']>>(async () => 'hunter2');
      const authenticatePublic = vi.fn<
        (params: PublicDoorAuthParams) => Promise<PublicAuthResult>
      >(async () => ({ ok: true, userType: 'root', machineId: THEIR_BOX }));
      const env = publicEnv({
        prompt,
        authenticatePublic,
        ports: [{ port: FORWARD, service: 'ftp' }],
      });

      const { lines, exitCode } = await drain(await scp.execute(env, carryAcross(), forwarded));

      // A forward names ONE internal port. Handing a password to a daemon that
      // could never have accepted it spends the credential for nothing.
      expect(lines).toEqual([
        `scp: connect to host ${THEIR_PUBLIC_IP} port ${FORWARD}: Connection refused`,
      ]);
      expect(exitCode).toBe(1);
      expect(prompt).not.toHaveBeenCalled();
      expect(authenticatePublic).not.toHaveBeenCalled();
    });

    it('opens on the forward that answers ssh, even when their box publishes others', async () => {
      const authenticatePublic = vi.fn<
        (params: PublicDoorAuthParams) => Promise<PublicAuthResult>
      >(async () => ({ ok: true, userType: 'root', machineId: THEIR_BOX }));
      const env = publicEnv({
        authenticatePublic,
        ports: [
          { port: 2121, service: 'ftp' },
          { port: FORWARD, service: 'ssh' },
        ],
      });

      const { exitCode } = await drain(await scp.execute(env, carryAcross(), forwarded));

      // One published forward being a different door must not close the one asked for.
      expect(exitCode).toBe(0);
      expect(authenticatePublic.mock.calls[0]![0].port).toBe(FORWARD);
    });

    it('refuses a port their box does not forward, even while it forwards ssh elsewhere', async () => {
      const prompt = vi.fn<NonNullable<EnvOver['prompt']>>(async () => 'hunter2');
      const env = publicEnv({ prompt, ports: [{ port: FORWARD, service: 'ssh' }] });

      const { lines, exitCode } = await drain(
        await scp.execute(env, carryAcross(), new Map([['-p', '2121']])),
      );

      // The door has to answer on the port that was KNOCKED on. A stranger serving
      // ssh somewhere else on their gateway is not an invitation to the port the
      // player named.
      expect(lines).toEqual([`scp: connect to host ${THEIR_PUBLIC_IP} port 2121: Connection refused`]);
      expect(exitCode).toBe(1);
      expect(prompt).not.toHaveBeenCalled();
    });

    it('refuses an address that answers nothing without asking for a password', async () => {
      const prompt = vi.fn<NonNullable<EnvOver['prompt']>>(async () => 'hunter2');
      const env = publicEnv({ prompt, found: false });

      const { lines, exitCode } = await drain(await scp.execute(env, carryAcross(), forwarded));

      expect(lines).toEqual([
        `scp: connect to host ${THEIR_PUBLIC_IP} port ${FORWARD}: No route to host`,
      ]);
      expect(exitCode).toBe(1);
      expect(prompt).not.toHaveBeenCalled();
    });

    it('knocks on the ssh port when the player names none', async () => {
      const authenticatePublic = vi.fn<
        (params: PublicDoorAuthParams) => Promise<PublicAuthResult>
      >(async () => ({ ok: true, userType: 'root', machineId: THEIR_BOX }));
      const env = publicEnv({ authenticatePublic, ports: [{ port: 22, service: 'ssh' }] });

      await drain(await scp.execute(env, carryAcross(), new Map()));

      // 22, because the transfer rides sshd — the same port a login would use.
      expect(authenticatePublic.mock.calls[0]![0].port).toBe(22);
    });

    it.each([
      ['a bare flag', true as const],
      ['a word', 'twentytwo'],
      ['zero', '0'],
      ['a negative', '-22'],
    ])('falls back to the ssh port when -p carries %s', async (_case, value) => {
      const authenticatePublic = vi.fn<
        (params: PublicDoorAuthParams) => Promise<PublicAuthResult>
      >(async () => ({ ok: true, userType: 'root', machineId: THEIR_BOX }));
      const env = publicEnv({ authenticatePublic, ports: [{ port: 22, service: 'ssh' }] });

      await drain(await scp.execute(env, carryAcross(), new Map([['-p', value]])));

      expect(authenticatePublic.mock.calls[0]![0].port).toBe(22);
    });

    it('ends the row it opened on a stranger box, whichever way the transfer went', async () => {
      const landed = vi.fn<(sessionId: string) => void>();
      const refused = vi.fn<(sessionId: string) => void>();

      await drain(await scp.execute(publicEnv({ end: landed }), carryAcross(), forwarded));
      await drain(
        await scp.execute(
          publicEnv({ end: refused, write: async () => ({ ok: false, error: 'permission_denied' }) }),
          carryAcross(),
          forwarded,
        ),
      );

      // A row on somebody else's box outliving the command that opened it is a door
      // held ajar on a machine its owner can end but the visitor has walked away from.
      expect(landed).toHaveBeenCalledTimes(1);
      expect(refused).toHaveBeenCalledTimes(1);
    });

    it('reports a refused credential across the network and opens no row to end', async () => {
      const end = vi.fn<(sessionId: string) => void>();
      const write = vi.fn<NonNullable<EnvOver['write']>>(async () => ({ ok: true }));
      const env = publicEnv({
        end,
        write,
        authenticatePublic: async () => ({ ok: false, error: 'invalid_credentials' }),
      });

      const { lines, exitCode } = await drain(await scp.execute(env, carryAcross(), forwarded));

      expect(lines).toContain('Permission denied (password).');
      expect(exitCode).toBe(1);
      expect(write).not.toHaveBeenCalled();
      expect(end).not.toHaveBeenCalled();
    });

    it('validates the local half first, so a typo never reaches a stranger log', async () => {
      const prompt = vi.fn<NonNullable<EnvOver['prompt']>>(async () => 'hunter2');
      const authenticatePublic = vi.fn<
        (params: PublicDoorAuthParams) => Promise<PublicAuthResult>
      >(async () => ({ ok: true, userType: 'root', machineId: THEIR_BOX }));
      const env = publicEnv({ prompt, authenticatePublic });

      const { lines, exitCode } = await drain(
        await scp.execute(
          env,
          ['/root/nope.txt', `root@${THEIR_PUBLIC_IP}:${REMOTE_DEST}`],
          forwarded,
        ),
      );

      expect(lines).toEqual(['scp: /root/nope.txt: No such file or directory']);
      expect(exitCode).toBe(1);
      expect(prompt).not.toHaveBeenCalled();
      expect(authenticatePublic).not.toHaveBeenCalled();
    });
  });
});
