import { describe, expect, it, vi } from 'vitest';
import { ssh } from './ssh';
import {
  mockCommandEnv,
  mockIdentity,
  mockNetworkView,
  mockNetworkViewFromConnectivity,
  mockSession,
  mockSshApi,
} from '../../test/factories/commandEnv';
import { generateHomeLan, type LanHost } from '../generation/generateHomeLan';
import { buildRemoteHostFs } from '../generation/remoteHostFs';
import { hostMachineId } from '../generation/remoteHostId';
import { parsePidfilePort } from '../services/pidfile';
import { bindFlags } from '../shell/bindFlags';
import { assignHomeNetwork } from '../network/homeNetwork';
import { buildColdStartConnectivity, type ConnectivityState } from '../network/interfaces';
import { asEpochMs, asMachineId, asPlayerKeyHex } from '../types';
import type { Directory } from '../filesystem/types';
import type { CommandResult, RemoteAuthParams, RemoteAuthResult, Session } from './types';

/**
 * `ssh user@host` — connect to a generated LAN host, authenticate the password
 * SERVER-side (the `env.ssh.authenticate` seam), and on success push the remote
 * session + move into its home. Reachability (host on the LAN? sshd on the asked
 * port?) is checked LOCALLY from the deterministic generated FS before prompting —
 * a down/closed host never asks for a password. Auth failures surface a realistic
 * message and push no session.
 */

const PUBKEY = 'a'.repeat(64);
const ESSID = 'BEAN-THERE-WIFI';
const NOW = 1700000000000;

/** wlan0 associated + addressed (online on `essid`), with the LAN IP the player
 *  would actually have been issued. */
const onlineConnectivity = (essid: string): ConnectivityState => {
  const cold = buildColdStartConnectivity(PUBKEY);
  const wlan0 = cold.interfaces.get('wlan0');
  if (wlan0 === undefined || wlan0.kind !== 'wireless') throw new Error('no wlan0');
  const { localIp } = assignHomeNetwork(PUBKEY, essid);
  const connected = { ...wlan0, association: { essid, bssid: 'AA:BB:CC:DD:EE:FF' }, ipv4: localIp };
  return { interfaces: new Map(cold.interfaces).set('wlan0', connected) };
};

const selfIp = assignHomeNetwork(PUBKEY, ESSID).localIp;

const sshdPort = (fs: Directory): number | null => {
  const varDir = fs.entries.get('var');
  if (varDir?.kind !== 'directory') return null;
  const run = varDir.entries.get('run');
  if (run?.kind !== 'directory') return null;
  const pid = run.entries.get('sshd.pid');
  return pid?.kind === 'file' ? parsePidfilePort(pid.content) : null;
};

/** Deterministic LAN hosts: one running sshd on :22, and one running no ssh. */
const pickHosts = (): { sshHost: LanHost; noSshHost: LanHost } => {
  let sshHost: LanHost | undefined;
  let noSshHost: LanHost | undefined;
  for (const host of generateHomeLan(PUBKEY, ESSID).hosts) {
    const port = sshdPort(buildRemoteHostFs(PUBKEY, ESSID, host));
    if (port === 22 && sshHost === undefined) sshHost = host;
    if (port === null && noSshHost === undefined) noSshHost = host;
  }
  if (sshHost === undefined || noSshHost === undefined) throw new Error('need an ssh + a non-ssh host');
  return { sshHost, noSshHost };
};

type EnvOver = {
  readonly authenticate?: (params: RemoteAuthParams) => Promise<RemoteAuthResult>;
  readonly prompt?: () => Promise<string>;
  readonly onPush?: (session: Session) => void;
  readonly onCwd?: (path: string) => void;
};

const sshEnv = (over: EnvOver = {}) =>
  mockCommandEnv({
    identity: mockIdentity({ publicKeyHex: asPlayerKeyHex(PUBKEY) }),
    network: mockNetworkViewFromConnectivity(onlineConnectivity(ESSID)),
    session: mockSession({ id: 'su-root-1', machineId: asMachineId('skylab-deadbeef'), userType: 'root' }),
    now: () => asEpochMs(NOW),
    prompt: over.prompt ?? (async () => 'hunter2'),
    ssh: mockSshApi({
      authenticate: over.authenticate ?? (async () => ({ ok: true, userType: 'root' })),
    }),
    pushSession: over.onPush ?? (() => undefined),
    setCwd: over.onCwd ?? (() => undefined),
  });

const sync = (result: CommandResult) => {
  if (result.kind !== 'sync') throw new Error('expected a sync result');
  return result;
};

describe('ssh', () => {
  it('errors with usage when no target is given', async () => {
    const result = sync(await ssh.execute(sshEnv(), [], new Map()));
    expect(result.exitCode).toBe(255);
    expect(result.lines[0]?.content.toLowerCase()).toContain('usage');
  });

  it('errors on a target without user@host', async () => {
    const result = sync(await ssh.execute(sshEnv(), ['192.168.50.5'], new Map()));
    expect(result.exitCode).toBe(255);
    expect(result.lines[0]?.kind).toBe('error');
  });

  it('errors with usage for an empty user (@host)', async () => {
    const result = sync(await ssh.execute(sshEnv(), ['@192.168.50.5'], new Map()));
    expect(result.exitCode).toBe(255);
    expect(result.lines[0]?.content.toLowerCase()).toContain('usage');
  });

  it('errors with usage for an empty host (user@)', async () => {
    const result = sync(await ssh.execute(sshEnv(), ['root@'], new Map()));
    expect(result.exitCode).toBe(255);
    expect(result.lines[0]?.content.toLowerCase()).toContain('usage');
  });

  it('reports the network unreachable when offline', async () => {
    const env = mockCommandEnv({
      identity: mockIdentity({ publicKeyHex: asPlayerKeyHex(PUBKEY) }),
      network: mockNetworkView({ isOnline: () => false, interfaces: () => [] }),
    });
    const result = sync(await ssh.execute(env, ['root@192.168.50.5'], new Map()));
    expect(result.exitCode).toBe(255);
    expect(result.lines[0]?.content).toContain('Network is unreachable');
  });

  it('reports the network unreachable when online but no wlan0 is present', async () => {
    const env = mockCommandEnv({
      identity: mockIdentity({ publicKeyHex: asPlayerKeyHex(PUBKEY) }),
      network: mockNetworkView({ isOnline: () => true, interfaces: () => [] }),
    });
    const result = sync(await ssh.execute(env, ['root@192.168.50.5'], new Map()));
    expect(result.exitCode).toBe(255);
    expect(result.lines[0]?.content).toContain('Network is unreachable');
  });

  it('reports the network unreachable when wlan0 is present but not associated', async () => {
    const cold = buildColdStartConnectivity(PUBKEY); // wlan0 exists but association is null
    const env = mockCommandEnv({
      identity: mockIdentity({ publicKeyHex: asPlayerKeyHex(PUBKEY) }),
      network: mockNetworkView({ isOnline: () => true, interfaces: () => [...cold.interfaces.values()] }),
    });
    const result = sync(await ssh.execute(env, ['root@192.168.50.5'], new Map()));
    expect(result.exitCode).toBe(255);
    expect(result.lines[0]?.content).toContain('Network is unreachable');
  });

  it('reports No route to host for an IP not on the LAN — without prompting', async () => {
    const prompt = vi.fn(async () => 'hunter2');
    const result = sync(await ssh.execute(sshEnv({ prompt }), ['root@10.0.0.5'], new Map()));
    expect(result.exitCode).toBe(255);
    expect(result.lines[0]?.content).toContain('No route to host');
    expect(prompt).not.toHaveBeenCalled();
  });

  it('reports Connection refused for a LAN host not running ssh — without prompting', async () => {
    const { noSshHost } = pickHosts();
    const prompt = vi.fn(async () => 'hunter2');
    const result = sync(await ssh.execute(sshEnv({ prompt }), [`root@${noSshHost.ip}`], new Map()));
    expect(result.exitCode).toBe(255);
    expect(result.lines[0]?.content).toContain('Connection refused');
    expect(prompt).not.toHaveBeenCalled();
  });

  // These two drive `-p` through the SHELL's real flag parser (`bindFlags` with
  // the command's own spec), the way the terminal does — the hand-built flag
  // maps below bypass it, so they can't catch a spec-key / read-key drift.
  it('parses -p through the shell flag parser (the spec key matches the dash form)', async () => {
    const { sshHost } = pickHosts();
    const bound = bindFlags([`root@${sshHost.ip}`, '-p', '22'], ssh.flags ?? {});
    expect(bound.ok).toBe(true);
    if (!bound.ok) throw new Error(bound.error);
    const result = sync(await ssh.execute(sshEnv(), bound.positional, bound.flags));
    // Port 22 matches the :22 host → it connects (the read key lines up too).
    expect(result.exitCode).toBe(0);
  });

  it('honours a shell-parsed -p 2222 against a :22 host (refused — not silently port 22)', async () => {
    const { sshHost } = pickHosts();
    const bound = bindFlags([`root@${sshHost.ip}`, '-p', '2222'], ssh.flags ?? {});
    expect(bound.ok).toBe(true);
    if (!bound.ok) throw new Error(bound.error);
    const result = sync(await ssh.execute(sshEnv(), bound.positional, bound.flags));
    // If execute read the wrong flag key it would default to :22 and CONNECT;
    // the refusal proves the parsed :2222 actually reached the port check.
    expect(result.exitCode).toBe(255);
    expect(result.lines[0]?.content).toContain('Connection refused');
  });

  it('honours -p: a host whose sshd is on :22 refuses a connection to :2222', async () => {
    const { sshHost } = pickHosts();
    const result = sync(
      await ssh.execute(sshEnv(), [`root@${sshHost.ip}`], new Map([['-p', '2222']])),
    );
    expect(result.exitCode).toBe(255);
    expect(result.lines[0]?.content).toContain('Connection refused');
  });

  it('falls back to port 22 for a non-numeric -p (connects to a :22 host)', async () => {
    const { sshHost } = pickHosts();
    const result = sync(
      await ssh.execute(sshEnv(), [`root@${sshHost.ip}`], new Map([['-p', 'abc']])),
    );
    expect(result.exitCode).toBe(0);
  });

  it('falls back to port 22 for a non-positive -p (connects to a :22 host)', async () => {
    const { sshHost } = pickHosts();
    const result = sync(
      await ssh.execute(sshEnv(), [`root@${sshHost.ip}`], new Map([['-p', '0']])),
    );
    expect(result.exitCode).toBe(0);
  });

  it('falls back to port 22 for a valueless bare -p (connects to a :22 host)', async () => {
    const { sshHost } = pickHosts();
    // A bare `-p` surfaces as `true` in the flag map; it must not become port 1.
    const result = sync(
      await ssh.execute(sshEnv(), [`root@${sshHost.ip}`], new Map([['-p', true]])),
    );
    expect(result.exitCode).toBe(0);
  });

  it('prompts (masked) for the account password before authenticating', async () => {
    const { sshHost } = pickHosts();
    const prompt = vi.fn(async () => 'hunter2');
    await ssh.execute(sshEnv({ prompt }), [`root@${sshHost.ip}`], new Map());
    expect(prompt).toHaveBeenCalledWith({
      message: `root@${sshHost.ip}'s password: `,
      masked: true,
    });
  });

  it('authenticates, pushes the remote session, and moves into the remote home (happy path)', async () => {
    const { sshHost } = pickHosts();
    const authenticate = vi.fn<(params: RemoteAuthParams) => Promise<RemoteAuthResult>>(async () => ({
      ok: true,
      userType: 'root',
    }));
    const onPush = vi.fn<(session: Session) => void>();
    const onCwd = vi.fn<(path: string) => void>();

    const result = sync(
      await ssh.execute(sshEnv({ authenticate, onPush, onCwd }), [`root@${sshHost.ip}`], new Map()),
    );

    expect(result.exitCode).toBe(0);
    expect(result.lines).toEqual([]); // a successful login prints nothing; the new prompt is the signal
    // Authenticated server-side with the exact params (no client userType claim).
    expect(authenticate.mock.calls[0]![0]).toEqual({
      sessionId: 'ssh-root-1700000000000',
      essid: ESSID,
      targetIp: sshHost.ip,
      username: 'root',
      password: 'hunter2',
      parentSessionId: 'su-root-1',
      sourceIp: selfIp,
    });
    // Pushed the SERVER-derived session onto the hop chain.
    expect(onPush).toHaveBeenCalledTimes(1);
    expect(onPush.mock.calls[0]![0]).toEqual({
      id: 'ssh-root-1700000000000',
      playerKey: PUBKEY,
      machineId: hostMachineId(sshHost, ESSID),
      username: 'root',
      userType: 'root',
      kind: 'ssh',
      createdAt: NOW,
    });
    // Landed in root's home.
    expect(onCwd).toHaveBeenCalledWith('/root');
  });

  it('lands a non-root login in /home/<user>', async () => {
    const { sshHost } = pickHosts();
    const onCwd = vi.fn<(path: string) => void>();
    const result = sync(
      await ssh.execute(
        sshEnv({ authenticate: async () => ({ ok: true, userType: 'user' }), onCwd }),
        [`admin@${sshHost.ip}`],
        new Map(),
      ),
    );
    expect(result.exitCode).toBe(0);
    expect(onCwd).toHaveBeenCalledWith('/home/admin');
  });

  it('reports Permission denied and pushes no session on bad credentials', async () => {
    const { sshHost } = pickHosts();
    const onPush = vi.fn<(session: Session) => void>();
    const result = sync(
      await ssh.execute(
        sshEnv({ authenticate: async () => ({ ok: false, error: 'invalid_credentials' }), onPush }),
        [`root@${sshHost.ip}`],
        new Map(),
      ),
    );
    expect(result.exitCode).toBe(255);
    expect(result.lines.some((line) => line.content.includes('Permission denied'))).toBe(true);
    expect(onPush).not.toHaveBeenCalled();
  });

  it('reports Connection refused when the server says the host is unreachable', async () => {
    const { sshHost } = pickHosts();
    const result = sync(
      await ssh.execute(
        sshEnv({ authenticate: async () => ({ ok: false, error: 'host_unreachable' }) }),
        [`root@${sshHost.ip}`],
        new Map(),
      ),
    );
    expect(result.exitCode).toBe(255);
    expect(result.lines[0]?.content).toContain('Connection refused');
  });

  it('reports a network error from the auth round-trip and pushes no session', async () => {
    const { sshHost } = pickHosts();
    const onPush = vi.fn<(session: Session) => void>();
    const result = sync(
      await ssh.execute(
        sshEnv({ authenticate: async () => ({ ok: false, error: 'network_error' }), onPush }),
        [`root@${sshHost.ip}`],
        new Map(),
      ),
    );
    expect(result.exitCode).toBe(255);
    expect(result.lines[0]?.content).toContain('Network error');
    expect(onPush).not.toHaveBeenCalled();
  });

  it('exits 130 and pushes no session when the password prompt is cancelled (Ctrl-C)', async () => {
    const { sshHost } = pickHosts();
    const onPush = vi.fn<(session: Session) => void>();
    const result = sync(
      await ssh.execute(
        sshEnv({ prompt: async () => Promise.reject(new Error('aborted')), onPush }),
        [`root@${sshHost.ip}`],
        new Map(),
      ),
    );
    expect(result.exitCode).toBe(130);
    expect(result.lines).toEqual([]);
    expect(onPush).not.toHaveBeenCalled();
  });
});
