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
import { computeInnerGatewayId, computeApGatewayId } from '../identity/router';
import { parsePidfilePort } from '../services/pidfile';
import { bindFlags } from '../shell/bindFlags';
import { assignHomeNetwork } from '../network/homeNetwork';
import { buildColdStartConnectivity, type ConnectivityState } from '../network/interfaces';
import { asEpochMs, asMachineId, asPlayerKeyHex } from '../types';
import type { Directory } from '../filesystem/types';
import type {
  CommandResult,
  InnerGatewayAuthParams,
  PublicAuthParams,
  PublicAuthResult,
  PublicScanResolution,
  RemoteAuthParams,
  RemoteAuthResult,
  SameLanAuthParams,
  Session,
} from './types';
import type { OccupantProjection } from '../network/resolveOccupants';

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
  for (const host of generateHomeLan(ESSID).hosts) {
    if (host.kind !== 'machine') continue;
    const port = sshdPort(buildRemoteHostFs(ESSID, host));
    if (port === 22 && sshHost === undefined) sshHost = host;
    if (port === null && noSshHost === undefined) noSshHost = host;
  }
  if (sshHost === undefined || noSshHost === undefined)
    throw new Error('need an ssh + a non-ssh host');
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
    session: mockSession({
      id: 'su-root-1',
      machineId: asMachineId('skylab-deadbeef'),
      userType: 'root',
    }),
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
      network: mockNetworkView({
        isOnline: () => true,
        interfaces: () => [...cold.interfaces.values()],
      }),
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
    const authenticate = vi.fn<(params: RemoteAuthParams) => Promise<RemoteAuthResult>>(
      async () => ({
        ok: true,
        userType: 'root',
      }),
    );
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

  it('routes ssh to the .1 gateway to the OWN ROUTER — root session on computeApGatewayId, reachable on :22', async () => {
    const gateway = generateHomeLan(ESSID).hosts.find((host) => host.kind === 'router');
    if (gateway === undefined) throw new Error('no gateway on LAN');
    const authenticate = vi.fn<(params: RemoteAuthParams) => Promise<RemoteAuthResult>>(
      async () => ({
        ok: true,
        userType: 'root',
      }),
    );
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
      machineId: computeApGatewayId(ESSID),
      username: 'root',
      userType: 'root',
      kind: 'ssh',
    });
    expect(onPush.mock.calls[0]![0].machineId).not.toBe(hostMachineId(gateway, ESSID));
  });

  it('routes ssh to the INNER GATEWAY to its own router id — root session on computeInnerGatewayId, reachable on :22', async () => {
    const inner = generateHomeLan(ESSID).hosts.find(
      (host) => host.kind === 'router' && Number(host.ip.split('.')[3]) !== 1,
    );
    if (inner === undefined) throw new Error('no inner gateway on LAN');
    const octet = Number(inner.ip.split('.')[3]);
    const authenticate = vi.fn<(params: RemoteAuthParams) => Promise<RemoteAuthResult>>(async () => ({
      ok: true,
      userType: 'root',
    }));
    const onPush = vi.fn<(session: Session) => void>();

    const result = sync(
      await ssh.execute(sshEnv({ authenticate, onPush }), [`root@${inner.ip}`], new Map()),
    );

    // Reachable on :22 (the inner gateway's own sshd) — auth proceeds.
    expect(result.exitCode).toBe(0);
    expect(authenticate.mock.calls[0]![0]).toMatchObject({
      essid: ESSID,
      targetIp: inner.ip,
      username: 'root',
    });
    // The hop lands on the INNER GATEWAY's distinct id — never the edge router's
    // (would alias) nor a coordinate sibling id.
    expect(onPush.mock.calls[0]![0]).toMatchObject({
      machineId: computeInnerGatewayId(ESSID, octet),
      kind: 'ssh',
    });
    expect(onPush.mock.calls[0]![0].machineId).not.toBe(computeApGatewayId(ESSID));
    expect(onPush.mock.calls[0]![0].machineId).not.toBe(hostMachineId(inner, ESSID));
  });

  it('routes ssh to a SWITCH to its own inner-gateway id — root session on computeInnerGatewayId, reachable on :22', async () => {
    const device = generateHomeLan(ESSID).hosts.find((host) => host.kind === 'switch');
    if (device === undefined) throw new Error('no switch on LAN');
    const octet = Number(device.ip.split('.')[3]);
    const authenticate = vi.fn<(params: RemoteAuthParams) => Promise<RemoteAuthResult>>(async () => ({
      ok: true,
      userType: 'root',
    }));
    const onPush = vi.fn<(session: Session) => void>();

    const result = sync(
      await ssh.execute(sshEnv({ authenticate, onPush }), [`root@${device.ip}`], new Map()),
    );

    // Reachable on :22 (the switch's own sshd) — auth proceeds, like an inner gateway.
    expect(result.exitCode).toBe(0);
    expect(authenticate.mock.calls[0]![0]).toMatchObject({
      essid: ESSID,
      targetIp: device.ip,
      username: 'root',
    });
    // The hop lands on the switch's own octet-keyed inner-gateway id — never the
    // edge router's (would alias) nor a coordinate sibling id.
    expect(onPush.mock.calls[0]![0]).toMatchObject({
      machineId: computeInnerGatewayId(ESSID, octet),
      kind: 'ssh',
    });
    expect(onPush.mock.calls[0]![0].machineId).not.toBe(computeApGatewayId(ESSID));
    expect(onPush.mock.calls[0]![0].machineId).not.toBe(hostMachineId(device, ESSID));
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
    session: mockSession({
      id: 'su-root-1',
      machineId: asMachineId('bstation-cafef00d'),
      userType: 'root',
    }),
    now: () => asEpochMs(NOW),
    prompt: over.prompt ?? (async () => 'guestpw'),
    scan: mockScanApi({
      resolvePublic:
        over.resolvePublic ??
        (async () => ({ found: true, ports: [{ port: 22, service: 'ssh' }] })),
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
        sshPublicEnv({
          authenticatePublic: async () => ({ ok: false, error: 'host_unreachable' }),
        }),
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

/**
 * `ssh <user>@<LAN IP of a fellow occupant>` (Story 7) — same-WiFi connect. A PRIVATE
 * IP that matches a fetched occupant of the current ESSID routes server-side through
 * `env.ssh.authenticateSameLan`, landing a session on the OWNER's real workstation id.
 * The occupant fetch is the reachability check (no own-LAN regeneration), and it is
 * consulted BEFORE the generated-LAN path so an occupant wins an octet collision —
 * consistent with the nmap merge. A private IP that is NOT an occupant falls through to
 * the unchanged own-LAN generated path.
 */
const OCCUPANT_IP = '192.168.29.42';
const A_SAMELAN_MACHINE_ID = 'alice-rig-cafef00d';

const occupantAt = (ip: string): OccupantProjection => ({
  workstation_machine_id: A_SAMELAN_MACHINE_ID,
  localIp: ip,
  machineName: 'alice-rig',
});

type SameLanEnvOver = {
  readonly resolveOccupants?: (essid: string) => Promise<readonly OccupantProjection[]>;
  readonly authenticateSameLan?: (params: SameLanAuthParams) => Promise<PublicAuthResult>;
  readonly authenticate?: (params: RemoteAuthParams) => Promise<RemoteAuthResult>;
  readonly prompt?: () => Promise<string>;
  readonly onPush?: (session: Session) => void;
  readonly onCwd?: (path: string) => void;
};

const sshSameLanEnv = (over: SameLanEnvOver = {}) =>
  mockCommandEnv({
    identity: mockIdentity({ publicKeyHex: asPlayerKeyHex(PUBKEY) }),
    network: mockNetworkViewFromConnectivity(onlineConnectivity(ESSID)),
    session: mockSession({
      id: 'shell-1',
      machineId: asMachineId('bstation-cafef00d'),
      userType: 'root',
    }),
    now: () => asEpochMs(NOW),
    prompt: over.prompt ?? (async () => 'guestpw'),
    scan: mockScanApi({
      resolveOccupants: over.resolveOccupants ?? (async () => [occupantAt(OCCUPANT_IP)]),
    }),
    ssh: mockSshApi({
      // Keep the throwing default for `authenticate` unless a test wires it — the
      // collision test relies on the own-LAN path blowing up if (wrongly) taken.
      ...(over.authenticate ? { authenticate: over.authenticate } : {}),
      authenticateSameLan:
        over.authenticateSameLan ??
        (async () => ({ ok: true, userType: 'guest', machineId: A_SAMELAN_MACHINE_ID })),
    }),
    pushSession: over.onPush ?? (() => undefined),
    setCwd: over.onCwd ?? (() => undefined),
  });

describe('ssh to a fellow occupant on the same LAN (Story 7)', () => {
  it('resolves the ESSID occupants, authenticates same-LAN, and pushes a session on the owner real machine id', async () => {
    const resolveOccupants = vi.fn(async () => [occupantAt(OCCUPANT_IP)]);
    const authenticateSameLan = vi.fn<(params: SameLanAuthParams) => Promise<PublicAuthResult>>(
      async () => ({ ok: true, userType: 'guest', machineId: A_SAMELAN_MACHINE_ID }),
    );
    const onPush = vi.fn<(session: Session) => void>();
    const onCwd = vi.fn<(path: string) => void>();

    const result = sync(
      await ssh.execute(
        sshSameLanEnv({ resolveOccupants, authenticateSameLan, onPush, onCwd }),
        [`guest@${OCCUPANT_IP}`],
        new Map(),
      ),
    );

    expect(result.exitCode).toBe(0);
    expect(result.lines).toEqual([]);
    expect(resolveOccupants).toHaveBeenCalledWith(ESSID);
    expect(authenticateSameLan.mock.calls[0]![0]).toEqual({
      sessionId: 'ssh-guest-1700000000000',
      essid: ESSID,
      targetIp: OCCUPANT_IP,
      username: 'guest',
      password: 'guestpw',
      port: 22,
      parentSessionId: 'shell-1',
      sourceIp: selfIp,
    });
    // Session lands on the OWNER's real workstation id (the occupant's machine id).
    expect(onPush.mock.calls[0]![0]).toEqual({
      id: 'ssh-guest-1700000000000',
      playerKey: PUBKEY,
      machineId: A_SAMELAN_MACHINE_ID,
      username: 'guest',
      userType: 'guest',
      kind: 'ssh',
      createdAt: NOW,
    });
    expect(onCwd).toHaveBeenCalledWith('/home/guest');
  });

  it('carries the destination port to same-LAN auth', async () => {
    const authenticateSameLan = vi.fn<(params: SameLanAuthParams) => Promise<PublicAuthResult>>(
      async () => ({ ok: true, userType: 'guest', machineId: A_SAMELAN_MACHINE_ID }),
    );
    const bound = bindFlags([`guest@${OCCUPANT_IP}`, '-p', '2222'], ssh.flags ?? {});
    expect(bound.ok).toBe(true);
    if (!bound.ok) throw new Error(bound.error);

    await ssh.execute(sshSameLanEnv({ authenticateSameLan }), bound.positional, bound.flags);

    expect(authenticateSameLan.mock.calls[0]![0]).toMatchObject({ port: 2222 });
  });

  it('routes an occupant whose IP collides with a generated NPC to the same-LAN path (occupant wins)', async () => {
    // An occupant sits at the exact IP of one of B's generated sshd NPCs. The occupant
    // must win — the same-LAN path runs, never the own-LAN `authenticate`. `authenticate`
    // is left throwing (mock default) so taking the own-LAN branch would blow up.
    const npcIp = pickHosts().sshHost.ip;
    const authenticateSameLan = vi.fn<(params: SameLanAuthParams) => Promise<PublicAuthResult>>(
      async () => ({ ok: true, userType: 'guest', machineId: A_SAMELAN_MACHINE_ID }),
    );
    const onPush = vi.fn<(session: Session) => void>();

    const result = sync(
      await ssh.execute(
        sshSameLanEnv({
          resolveOccupants: async () => [occupantAt(npcIp)],
          authenticateSameLan,
          onPush,
        }),
        [`guest@${npcIp}`],
        new Map(),
      ),
    );

    expect(result.exitCode).toBe(0);
    expect(authenticateSameLan.mock.calls[0]![0]).toMatchObject({ targetIp: npcIp });
    // The session lands on the OCCUPANT's machine id, not the NPC's regenerated id.
    expect(onPush.mock.calls[0]![0]?.machineId).toBe(A_SAMELAN_MACHINE_ID);
  });

  it('falls through to the own-LAN generated path for a private IP that is not an occupant', async () => {
    // A NON-EMPTY occupant list that does NOT include the target: the private IP is a
    // generated sshd host, so it must take the unchanged own-LAN path (`authenticate`),
    // never the same-LAN front door — proving the occupant list is actually matched
    // against the target, not blindly routed.
    const { sshHost, noSshHost } = pickHosts();
    const authenticate = vi.fn<(params: RemoteAuthParams) => Promise<RemoteAuthResult>>(async () => ({
      ok: true,
      userType: 'root',
    }));
    const authenticateSameLan = vi.fn<(params: SameLanAuthParams) => Promise<PublicAuthResult>>(
      async () => ({ ok: true, userType: 'guest', machineId: A_SAMELAN_MACHINE_ID }),
    );
    const onPush = vi.fn<(session: Session) => void>();

    const result = sync(
      await ssh.execute(
        sshSameLanEnv({
          resolveOccupants: async () => [occupantAt(noSshHost.ip)],
          authenticate,
          authenticateSameLan,
          onPush,
        }),
        [`root@${sshHost.ip}`],
        new Map(),
      ),
    );

    expect(result.exitCode).toBe(0);
    expect(authenticateSameLan).not.toHaveBeenCalled();
    expect(authenticate).toHaveBeenCalledTimes(1);
    // The own-LAN path lands the session on the generated host's coordinate machine id.
    expect(onPush.mock.calls[0]![0]?.machineId).toBe(hostMachineId(sshHost, ESSID));
  });

  it('prompts (masked) for the account password before same-LAN auth', async () => {
    const prompt = vi.fn(async () => 'guestpw');
    await ssh.execute(sshSameLanEnv({ prompt }), [`guest@${OCCUPANT_IP}`], new Map());
    expect(prompt).toHaveBeenCalledWith({
      message: `guest@${OCCUPANT_IP}'s password: `,
      masked: true,
    });
  });

  it('surfaces Permission denied and pushes no session on bad credentials', async () => {
    const onPush = vi.fn<(session: Session) => void>();
    const result = sync(
      await ssh.execute(
        sshSameLanEnv({
          authenticateSameLan: async () => ({ ok: false, error: 'invalid_credentials' }),
          onPush,
        }),
        [`guest@${OCCUPANT_IP}`],
        new Map(),
      ),
    );
    expect(result.exitCode).toBe(255);
    expect(result.lines[0]?.content).toContain('Permission denied');
    expect(onPush).not.toHaveBeenCalled();
  });

  it('surfaces Connection refused and pushes no session when the box is dark/not listening', async () => {
    const onPush = vi.fn<(session: Session) => void>();
    const result = sync(
      await ssh.execute(
        sshSameLanEnv({
          authenticateSameLan: async () => ({ ok: false, error: 'host_unreachable' }),
          onPush,
        }),
        [`guest@${OCCUPANT_IP}`],
        new Map(),
      ),
    );
    expect(result.exitCode).toBe(255);
    expect(result.lines[0]?.content).toContain('Connection refused');
    expect(onPush).not.toHaveBeenCalled();
  });

  it('surfaces a Network error and pushes no session on a transport failure', async () => {
    const onPush = vi.fn<(session: Session) => void>();
    const result = sync(
      await ssh.execute(
        sshSameLanEnv({
          authenticateSameLan: async () => ({ ok: false, error: 'network_error' }),
          onPush,
        }),
        [`guest@${OCCUPANT_IP}`],
        new Map(),
      ),
    );
    expect(result.exitCode).toBe(255);
    expect(result.lines[0]?.content).toContain('Network error');
    expect(onPush).not.toHaveBeenCalled();
  });

  it('exits 130 and pushes no session when the same-LAN password prompt is cancelled', async () => {
    const authenticateSameLan = vi.fn<(params: SameLanAuthParams) => Promise<PublicAuthResult>>(
      async () => ({ ok: true, userType: 'guest', machineId: A_SAMELAN_MACHINE_ID }),
    );
    const onPush = vi.fn<(session: Session) => void>();
    const result = sync(
      await ssh.execute(
        sshSameLanEnv({
          prompt: async () => Promise.reject(new Error('aborted')),
          authenticateSameLan,
          onPush,
        }),
        [`guest@${OCCUPANT_IP}`],
        new Map(),
      ),
    );
    expect(result.exitCode).toBe(130);
    expect(result.lines).toEqual([]);
    expect(authenticateSameLan).not.toHaveBeenCalled();
    expect(onPush).not.toHaveBeenCalled();
  });
});

/**
 * `ssh user@<inner gateway IP>:<fwd port>` (Slice 5b.1b-ii) — log into the hidden
 * Layer-2 host THROUGH a NAT forward the player configured on their own inner
 * gateway. The forward lives on the gateway's server-side journal, so reachability
 * comes from `env.scan.resolveInnerGateway` (5b.1b-i, reused) and auth from
 * `env.ssh.authenticateInnerGateway`, which lands a session on the DEEP host behind
 * the forward. The gateway's own `:22` (port 22) stays the own-LAN path (5b.1a),
 * untouched.
 */
const DEEP_MACHINE_ID = 'iot-cam-deadbeef';
const INNER_GATEWAY = generateHomeLan(ESSID).hosts.find(
  (host) => host.kind === 'router' && Number(host.ip.split('.')[3]) !== 1,
);
if (INNER_GATEWAY === undefined) throw new Error('no inner gateway on LAN');
const INNER_IP = INNER_GATEWAY.ip;

const liveForward: PublicScanResolution = {
  found: true,
  ports: [
    { port: 22, service: 'ssh' },
    { port: 2222, service: 'ssh' },
  ],
};

type ForwardEnvOver = {
  readonly resolveInnerGateway?: (essid: string, target: string) => Promise<PublicScanResolution>;
  readonly authenticate?: (params: RemoteAuthParams) => Promise<RemoteAuthResult>;
  readonly authenticateInnerGateway?: (params: InnerGatewayAuthParams) => Promise<PublicAuthResult>;
  readonly prompt?: () => Promise<string>;
  readonly onPush?: (session: Session) => void;
  readonly onCwd?: (path: string) => void;
};

const sshForwardEnv = (over: ForwardEnvOver = {}) =>
  mockCommandEnv({
    identity: mockIdentity({ publicKeyHex: asPlayerKeyHex(PUBKEY) }),
    network: mockNetworkViewFromConnectivity(onlineConnectivity(ESSID)),
    session: mockSession({ id: 'su-root-1', machineId: asMachineId('skylab-deadbeef'), userType: 'root' }),
    now: () => asEpochMs(NOW),
    prompt: over.prompt ?? (async () => 'guestpw'),
    scan: mockScanApi({
      resolveInnerGateway: over.resolveInnerGateway ?? (async () => liveForward),
    }),
    ssh: mockSshApi({
      // The own-LAN gateway login (port 22) still uses this seam (5b.1a); provide it so
      // the port-22 test can assert the forward seam is NOT consulted.
      authenticate: over.authenticate ?? (async () => ({ ok: true, userType: 'root' })),
      authenticateInnerGateway:
        over.authenticateInnerGateway ??
        (async () => ({ ok: true, userType: 'guest', machineId: DEEP_MACHINE_ID })),
    }),
    pushSession: over.onPush ?? (() => undefined),
    setCwd: over.onCwd ?? (() => undefined),
  });

describe('ssh through an inner-gateway NAT forward (deep layer)', () => {
  it('routes a forwarded port to the deep host and lands the session on the deep host id', async () => {
    const authenticateInnerGateway = vi.fn<
      (params: InnerGatewayAuthParams) => Promise<PublicAuthResult>
    >(async () => ({ ok: true, userType: 'guest', machineId: DEEP_MACHINE_ID }));
    const onPush = vi.fn<(session: Session) => void>();
    const onCwd = vi.fn<(path: string) => void>();

    const result = sync(
      await ssh.execute(
        sshForwardEnv({ authenticateInnerGateway, onPush, onCwd }),
        [`guest@${INNER_IP}`],
        new Map([['-p', '2222']]),
      ),
    );

    expect(result.exitCode).toBe(0);
    expect(result.lines).toEqual([]);
    expect(authenticateInnerGateway.mock.calls[0]![0]).toEqual({
      sessionId: 'ssh-guest-1700000000000',
      essid: ESSID,
      target: INNER_IP,
      username: 'guest',
      password: 'guestpw',
      port: 2222,
      parentSessionId: 'su-root-1',
      sourceIp: selfIp,
    });
    // The hop lands on the DEEP host id the server returned — not the gateway's.
    expect(onPush.mock.calls[0]![0]).toEqual({
      id: 'ssh-guest-1700000000000',
      playerKey: PUBKEY,
      machineId: DEEP_MACHINE_ID,
      username: 'guest',
      userType: 'guest',
      kind: 'ssh',
      createdAt: NOW,
    });
    expect(onCwd).toHaveBeenCalledWith('/home/guest');
  });

  it('routes port 22 to the gateway through the own-LAN seam, never the forward seam', async () => {
    const authenticate = vi.fn<(params: RemoteAuthParams) => Promise<RemoteAuthResult>>(async () => ({
      ok: true,
      userType: 'root',
    }));
    const authenticateInnerGateway = vi.fn<
      (params: InnerGatewayAuthParams) => Promise<PublicAuthResult>
    >(async () => ({ ok: true, userType: 'guest', machineId: DEEP_MACHINE_ID }));

    const result = sync(
      await ssh.execute(
        sshForwardEnv({ authenticate, authenticateInnerGateway }),
        [`root@${INNER_IP}`],
        new Map(),
      ),
    );

    expect(result.exitCode).toBe(0);
    expect(authenticate).toHaveBeenCalledTimes(1);
    expect(authenticateInnerGateway).not.toHaveBeenCalled();
  });

  it('reports Connection refused when no live forward serves the asked port — without prompting', async () => {
    const prompt = vi.fn(async () => 'guestpw');
    const authenticateInnerGateway = vi.fn<
      (params: InnerGatewayAuthParams) => Promise<PublicAuthResult>
    >(async () => ({ ok: true, userType: 'guest', machineId: DEEP_MACHINE_ID }));

    const result = sync(
      await ssh.execute(
        sshForwardEnv({
          // Only the gateway's own :22 is up — no forward on :2222.
          resolveInnerGateway: async () => ({ found: true, ports: [{ port: 22, service: 'ssh' }] }),
          prompt,
          authenticateInnerGateway,
        }),
        [`guest@${INNER_IP}`],
        new Map([['-p', '2222']]),
      ),
    );

    expect(result.exitCode).toBe(255);
    expect(result.lines[0]?.content).toContain('Connection refused');
    expect(prompt).not.toHaveBeenCalled();
    expect(authenticateInnerGateway).not.toHaveBeenCalled();
  });

  it('refuses when the forwarded port is open but not ssh — without prompting', async () => {
    const prompt = vi.fn(async () => 'guestpw');
    const result = sync(
      await ssh.execute(
        sshForwardEnv({
          resolveInnerGateway: async () => ({
            found: true,
            ports: [{ port: 2222, service: 'http' }],
          }),
          prompt,
        }),
        [`guest@${INNER_IP}`],
        new Map([['-p', '2222']]),
      ),
    );

    expect(result.exitCode).toBe(255);
    expect(result.lines[0]?.content).toContain('Connection refused');
    expect(prompt).not.toHaveBeenCalled();
  });

  it('reports No route to host when the gateway is dark (host-down) — without prompting', async () => {
    const prompt = vi.fn(async () => 'guestpw');
    const result = sync(
      await ssh.execute(
        sshForwardEnv({ resolveInnerGateway: async () => ({ found: false, ports: [] }), prompt }),
        [`guest@${INNER_IP}`],
        new Map([['-p', '2222']]),
      ),
    );

    expect(result.exitCode).toBe(255);
    expect(result.lines[0]?.content).toContain('No route to host');
    expect(prompt).not.toHaveBeenCalled();
  });

  it('reports Permission denied and pushes no session on a wrong deep-host password', async () => {
    const onPush = vi.fn<(session: Session) => void>();
    const result = sync(
      await ssh.execute(
        sshForwardEnv({
          authenticateInnerGateway: async () => ({ ok: false, error: 'invalid_credentials' }),
          onPush,
        }),
        [`guest@${INNER_IP}`],
        new Map([['-p', '2222']]),
      ),
    );

    expect(result.exitCode).toBe(255);
    expect(result.lines[0]?.content).toContain('Permission denied');
    expect(onPush).not.toHaveBeenCalled();
  });

  it('reports Connection refused when the forward vanished server-side (host_unreachable)', async () => {
    const onPush = vi.fn<(session: Session) => void>();
    const result = sync(
      await ssh.execute(
        sshForwardEnv({
          authenticateInnerGateway: async () => ({ ok: false, error: 'host_unreachable' }),
          onPush,
        }),
        [`guest@${INNER_IP}`],
        new Map([['-p', '2222']]),
      ),
    );

    expect(result.exitCode).toBe(255);
    expect(result.lines[0]?.content).toContain('Connection refused');
    expect(onPush).not.toHaveBeenCalled();
  });

  it('reports a generic Network error for a transport failure (distinct from a refused port)', async () => {
    const onPush = vi.fn<(session: Session) => void>();
    const result = sync(
      await ssh.execute(
        sshForwardEnv({
          authenticateInnerGateway: async () => ({ ok: false, error: 'network_error' }),
          onPush,
        }),
        [`guest@${INNER_IP}`],
        new Map([['-p', '2222']]),
      ),
    );

    expect(result.exitCode).toBe(255);
    expect(result.lines[0]?.content).toContain('Network error');
    expect(onPush).not.toHaveBeenCalled();
  });
});
