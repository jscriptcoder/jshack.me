import { describe, expect, it, vi } from 'vitest';
import { scp } from './scp';
import {
  mockCommandEnv,
  mockFsViewFromTree,
  mockIdentity,
  mockNetworkViewFromConnectivity,
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
import type { Directory } from '../filesystem/types';
import type {
  CommandResult,
  PatchResult,
  RemoteAuthParams,
  RemoteAuthResult,
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
    path: ReturnType<typeof asAbsPath>,
    content: string,
    options?: { readonly isNew?: boolean },
  ) => Promise<PatchResult>;
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
    scp: mockScpApi({
      authenticate: over.authenticate ?? (async () => ({ ok: true, userType: 'root' })),
      write: over.write ?? (async () => ({ ok: true })),
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

describe('scp', () => {
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
});
