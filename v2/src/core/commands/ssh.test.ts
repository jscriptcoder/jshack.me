import { describe, expect, it, vi } from 'vitest';
import { ssh } from './ssh';
import {
  mockCommandEnv,
  mockIdentity,
  mockNetworkView,
  mockNetworkViewFromConnectivity,
  mockScanApi,
  mockSession,
  mockSshApi,
} from '../../test/factories/commandEnv';
import { generateHomeLan, type LanHost } from '../generation/generateHomeLan';
import { buildRemoteHostFs } from '../generation/remoteHostFs';
import { hostMachineId } from '../generation/remoteHostId';
import { computeRouterId } from '../identity/router';
import { parsePidfilePort } from '../services/pidfile';
import { bindFlags } from '../shell/bindFlags';
import { assignHomeNetwork } from '../network/homeNetwork';
import { buildColdStartConnectivity, type ConnectivityState } from '../network/interfaces';
import { asEpochMs, asMachineId, asPlayerKeyHex } from '../types';
import type { Directory } from '../filesystem/types';
import type {
  CommandResult,
  PublicAuthParams,
  PublicAuthResult,
  PublicScanResolution,
  RemoteAuthParams,
  RemoteAuthResult,
  Session,
} from './types';

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

/** Deterministic LAN MACHINE hosts: one running sshd on :22, and one running no
 *  ssh. Excludes the `.1` gateway — the router routes to its own journal-backed
 *  machine id (covered by its own test), not the generic-sibling path. */
const pickHosts = (): { sshHost: LanHost; noSshHost: LanHost } => {
  let sshHost: LanHost | undefined;
  let noSshHost: LanHost | undefined;
  for (const host of generateHomeLan(PUBKEY, ESSID).hosts) {
    if (host.kind !== 'machine') continue;
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

  it('routes ssh to the .1 gateway to the OWN ROUTER — root session on computeRouterId, reachable on :22', async () => {
    const gateway = generateHomeLan(PUBKEY, ESSID).hosts.find((host) => host.kind === 'router');
    if (gateway === undefined) throw new Error('no gateway on LAN');
    const authenticate = vi.fn<(params: RemoteAuthParams) => Promise<RemoteAuthResult>>(async () => ({
      ok: true,
      userType: 'root',
    }));
    const onPush = vi.fn<(session: Session) => void>();

    const result = sync(
      await ssh.execute(sshEnv({ authenticate, onPush }), [`root@${gateway.ip}`], new Map()),
    );

    // Reachable on :22 (the router's seeded sshd) — auth proceeds, not "Connection refused".
    expect(result.exitCode).toBe(0);
    expect(authenticate.mock.calls[0]![0]).toMatchObject({
      essid: ESSID,
      targetIp: gateway.ip,
      username: 'root',
    });
    // The hop lands on the ROUTER's journal-backed id, NOT the gateway's coordinate
    // sibling id — so the router journal (the `nano rules.v4` edit) materializes.
    expect(onPush.mock.calls[0]![0]).toMatchObject({
      machineId: computeRouterId(PUBKEY),
      username: 'root',
      userType: 'root',
      kind: 'ssh',
    });
    expect(onPush.mock.calls[0]![0].machineId).not.toBe(hostMachineId(gateway, ESSID));
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

/**
 * `ssh <user>@<public IP>` (Story 2, slice 2b) — cross-player login. A public IP
 * isn't on the player's own LAN, so it routes server-side: reachability comes from
 * `env.scan.resolvePublic` (Story 1b's registry resolution, reused) and auth from
 * `env.ssh.authenticatePublic`, which lands a session on the OWNER's REAL
 * workstation id (the name in that id drives the prompt hostname). The own-LAN path
 * is untouched.
 */
const PUBLIC_IP = '203.0.113.7';
const A_MACHINE_ID = 'skylab-deadbeef';

type PublicEnvOver = {
  readonly resolvePublic?: (target: string) => Promise<PublicScanResolution>;
  readonly authenticatePublic?: (params: PublicAuthParams) => Promise<PublicAuthResult>;
  readonly prompt?: () => Promise<string>;
  readonly onPush?: (session: Session) => void;
  readonly onCwd?: (path: string) => void;
};

const sshPublicEnv = (over: PublicEnvOver = {}) =>
  mockCommandEnv({
    identity: mockIdentity({ publicKeyHex: asPlayerKeyHex(PUBKEY) }),
    network: mockNetworkViewFromConnectivity(onlineConnectivity(ESSID)),
    session: mockSession({ id: 'su-root-1', machineId: asMachineId('bstation-cafef00d'), userType: 'root' }),
    now: () => asEpochMs(NOW),
    prompt: over.prompt ?? (async () => 'guestpw'),
    scan: mockScanApi({
      resolvePublic:
        over.resolvePublic ?? (async () => ({ found: true, ports: [{ port: 22, service: 'ssh' }] })),
    }),
    ssh: mockSshApi({
      authenticatePublic:
        over.authenticatePublic ??
        (async () => ({ ok: true, userType: 'guest', machineId: A_MACHINE_ID })),
    }),
    pushSession: over.onPush ?? (() => undefined),
    setCwd: over.onCwd ?? (() => undefined),
  });

describe('ssh to a public IP (cross-player)', () => {
  it('resolves the public IP, authenticates cross-player, and pushes a session on the owner real machine id', async () => {
    const authenticatePublic = vi.fn<(params: PublicAuthParams) => Promise<PublicAuthResult>>(
      async () => ({ ok: true, userType: 'guest', machineId: A_MACHINE_ID }),
    );
    const onPush = vi.fn<(session: Session) => void>();
    const onCwd = vi.fn<(path: string) => void>();

    const result = sync(
      await ssh.execute(
        sshPublicEnv({ authenticatePublic, onPush, onCwd }),
        [`guest@${PUBLIC_IP}`],
        new Map(),
      ),
    );

    expect(result.exitCode).toBe(0);
    expect(result.lines).toEqual([]);
    expect(authenticatePublic.mock.calls[0]![0]).toEqual({
      sessionId: 'ssh-guest-1700000000000',
      target: PUBLIC_IP,
      username: 'guest',
      password: 'guestpw',
      port: 22,
      parentSessionId: 'su-root-1',
      sourceIp: selfIp,
    });
    // Session lands on the OWNER's real workstation id — its name drives the prompt.
    expect(onPush.mock.calls[0]![0]).toEqual({
      id: 'ssh-guest-1700000000000',
      playerKey: PUBKEY,
      machineId: A_MACHINE_ID,
      username: 'guest',
      userType: 'guest',
      kind: 'ssh',
      createdAt: NOW,
    });
    expect(onCwd).toHaveBeenCalledWith('/home/guest');
  });

  it('carries the destination port to cross-player auth so the server can route by port', async () => {
    // A forwarded port: the public scan shows :2222, so reachability passes and the
    // command must hand the SERVER port 2222 (not silently 22) — that's how the
    // server routes the login to the right machine behind the NAT.
    const authenticatePublic = vi.fn<(params: PublicAuthParams) => Promise<PublicAuthResult>>(
      async () => ({ ok: true, userType: 'guest', machineId: A_MACHINE_ID }),
    );
    const bound = bindFlags([`guest@${PUBLIC_IP}`, '-p', '2222'], ssh.flags ?? {});
    expect(bound.ok).toBe(true);
    if (!bound.ok) throw new Error(bound.error);

    await ssh.execute(
      sshPublicEnv({
        authenticatePublic,
        resolvePublic: async () => ({ found: true, ports: [{ port: 2222, service: 'ssh' }] }),
      }),
      bound.positional,
      bound.flags,
    );

    expect(authenticatePublic.mock.calls[0]![0]).toMatchObject({ port: 2222 });
  });

  it('routes a public IP through resolvePublic (the registry), not the own-LAN host path', async () => {
    const resolvePublic = vi.fn(async () => ({
      found: true,
      ports: [{ port: 22, service: 'ssh' }],
    }));
    await ssh.execute(sshPublicEnv({ resolvePublic }), [`guest@${PUBLIC_IP}`], new Map());
    expect(resolvePublic).toHaveBeenCalledWith(PUBLIC_IP);
  });

  it('reports No route to host for an unregistered public IP — without prompting', async () => {
    const prompt = vi.fn(async () => 'guestpw');
    const result = sync(
      await ssh.execute(
        sshPublicEnv({ resolvePublic: async () => ({ found: false, ports: [] }), prompt }),
        [`guest@${PUBLIC_IP}`],
        new Map(),
      ),
    );
    expect(result.exitCode).toBe(255);
    expect(result.lines[0]?.content).toContain('No route to host');
    expect(prompt).not.toHaveBeenCalled();
  });

  it('reports Connection refused when the owner box runs no ssh on the asked port — without prompting', async () => {
    const prompt = vi.fn(async () => 'guestpw');
    const result = sync(
      await ssh.execute(
        sshPublicEnv({
          resolvePublic: async () => ({ found: true, ports: [{ port: 80, service: 'http' }] }),
          prompt,
        }),
        [`guest@${PUBLIC_IP}`],
        new Map(),
      ),
    );
    expect(result.exitCode).toBe(255);
    expect(result.lines[0]?.content).toContain('Connection refused');
    expect(prompt).not.toHaveBeenCalled();
  });

  it('refuses when the asked port is open but the service is not ssh — without prompting', async () => {
    const prompt = vi.fn(async () => 'guestpw');
    const result = sync(
      await ssh.execute(
        sshPublicEnv({
          // Port 22 is open but serving http, not ssh — only an ssh service connects.
          resolvePublic: async () => ({ found: true, ports: [{ port: 22, service: 'http' }] }),
          prompt,
        }),
        [`guest@${PUBLIC_IP}`],
        new Map(),
      ),
    );
    expect(result.exitCode).toBe(255);
    expect(result.lines[0]?.content).toContain('Connection refused');
    expect(prompt).not.toHaveBeenCalled();
  });

  it('prompts (masked) for the account password before cross-player auth', async () => {
    const prompt = vi.fn(async () => 'guestpw');
    await ssh.execute(sshPublicEnv({ prompt }), [`guest@${PUBLIC_IP}`], new Map());
    expect(prompt).toHaveBeenCalledWith({
      message: `guest@${PUBLIC_IP}'s password: `,
      masked: true,
    });
  });

  it('connects to ssh even when the owner box also exposes other (non-ssh) ports', async () => {
    const authenticatePublic = vi.fn<(params: PublicAuthParams) => Promise<PublicAuthResult>>(
      async () => ({ ok: true, userType: 'guest', machineId: A_MACHINE_ID }),
    );
    const result = sync(
      await ssh.execute(
        sshPublicEnv({
          // A real box runs more than ssh — the asked ssh port must connect even
          // alongside an http port (matches ANY ssh port, not requires ALL ssh).
          resolvePublic: async () => ({
            found: true,
            ports: [
              { port: 80, service: 'http' },
              { port: 22, service: 'ssh' },
            ],
          }),
          authenticatePublic,
        }),
        [`guest@${PUBLIC_IP}`],
        new Map(),
      ),
    );
    expect(result.exitCode).toBe(0);
    expect(authenticatePublic).toHaveBeenCalled();
  });

  it('honours -p against the resolved ports (ssh on :2222 connects with -p 2222)', async () => {
    const authenticatePublic = vi.fn<(params: PublicAuthParams) => Promise<PublicAuthResult>>(
      async () => ({ ok: true, userType: 'guest', machineId: A_MACHINE_ID }),
    );
    const bound = bindFlags([`guest@${PUBLIC_IP}`, '-p', '2222'], ssh.flags ?? {});
    if (!bound.ok) throw new Error(bound.error);
    const result = sync(
      await ssh.execute(
        sshPublicEnv({
          resolvePublic: async () => ({ found: true, ports: [{ port: 2222, service: 'ssh' }] }),
          authenticatePublic,
        }),
        bound.positional,
        bound.flags,
      ),
    );
    expect(result.exitCode).toBe(0);
    expect(authenticatePublic).toHaveBeenCalled();
  });

  it('refuses the default :22 when the owner ssh is only on :2222', async () => {
    const result = sync(
      await ssh.execute(
        sshPublicEnv({
          resolvePublic: async () => ({ found: true, ports: [{ port: 2222, service: 'ssh' }] }),
        }),
        [`guest@${PUBLIC_IP}`],
        new Map(),
      ),
    );
    expect(result.exitCode).toBe(255);
    expect(result.lines[0]?.content).toContain('Connection refused');
  });

  it('reports Permission denied and pushes no session on bad cross-player credentials', async () => {
    const onPush = vi.fn<(session: Session) => void>();
    const result = sync(
      await ssh.execute(
        sshPublicEnv({
          authenticatePublic: async () => ({ ok: false, error: 'invalid_credentials' }),
          onPush,
        }),
        [`guest@${PUBLIC_IP}`],
        new Map(),
      ),
    );
    expect(result.exitCode).toBe(255);
    expect(result.lines.some((line) => line.content.includes('Permission denied'))).toBe(true);
    expect(onPush).not.toHaveBeenCalled();
  });

  it('reports Connection refused when cross-player auth says host_unreachable', async () => {
    const result = sync(
      await ssh.execute(
        sshPublicEnv({ authenticatePublic: async () => ({ ok: false, error: 'host_unreachable' }) }),
        [`guest@${PUBLIC_IP}`],
        new Map(),
      ),
    );
    expect(result.exitCode).toBe(255);
    expect(result.lines[0]?.content).toContain('Connection refused');
  });

  it('reports a network error from the cross-player auth round-trip and pushes no session', async () => {
    const onPush = vi.fn<(session: Session) => void>();
    const result = sync(
      await ssh.execute(
        sshPublicEnv({
          authenticatePublic: async () => ({ ok: false, error: 'network_error' }),
          onPush,
        }),
        [`guest@${PUBLIC_IP}`],
        new Map(),
      ),
    );
    expect(result.exitCode).toBe(255);
    expect(result.lines[0]?.content).toContain('Network error');
    expect(onPush).not.toHaveBeenCalled();
  });

  it('exits 130 and pushes no session when the cross-player password prompt is cancelled', async () => {
    const onPush = vi.fn<(session: Session) => void>();
    const result = sync(
      await ssh.execute(
        sshPublicEnv({ prompt: async () => Promise.reject(new Error('aborted')), onPush }),
        [`guest@${PUBLIC_IP}`],
        new Map(),
      ),
    );
    expect(result.exitCode).toBe(130);
    expect(result.lines).toEqual([]);
    expect(onPush).not.toHaveBeenCalled();
  });
});
