import { describe, expect, it, vi } from 'vitest';
import { nmap } from './nmap';
import { commandRegistry } from './registry';
import type { CommandResult, ScanApi } from './types';
import {
  mockCommandEnv,
  mockFsViewFromTree,
  mockIdentity,
  mockNetworkView,
  mockNetworkViewFromConnectivity,
  mockScanApi,
  mockSession,
} from '../../test/factories/commandEnv';
import { buildDirectory, buildFile } from '../../test/factories/filesystem';
import { assignHomeNetwork } from '../network/homeNetwork';
import { generateHomeLan, type LanHost } from '../generation/generateHomeLan';
import { buildRemoteHostFs } from '../generation/remoteHostFs';
import { seedRouterHostname } from '../generation/routerFs';
import { machineIdForLanHost } from '../generation/lanHostIdentity';
import { generateDeepLayer } from '../generation/generateDeepLayer';
import { computeDeepGatewayId } from '../identity/router';
import type { Directory } from '../filesystem/types';
import { buildColdStartConnectivity, type ConnectivityState } from '../network/interfaces';
import { asMachineId, asPlayerKeyHex } from '../types';

/**
 * `nmap <target>` host-discovery (generator epic, Story 2). Online on a home LAN
 * the player scans either a single IP (`x.y.z.w`) or a legacy range (`x.y.z.A-B`):
 * a range streams the discovery table for the hosts whose last octet falls inside
 * it; a single IP reports whether that one host is up. Offline — or before
 * `apt install nmap` — it errors and lists nothing. A target on a different
 * subnet than the player's own LAN is out of range (foreign subnets deferred).
 */

const PUBKEY = 'a'.repeat(64);

/** A connectivity state with wlan0 associated + addressed (online on `essid`),
 *  re-deriving the same LAN IP the player would actually have been issued. */
const onlineConnectivity = (essid: string): ConnectivityState => {
  const cold = buildColdStartConnectivity(PUBKEY);
  const wlan0 = cold.interfaces.get('wlan0');
  if (wlan0 === undefined || wlan0.kind !== 'wireless') throw new Error('no wlan0 in cold start');
  const { localIp } = assignHomeNetwork(PUBKEY, essid);
  const connected = { ...wlan0, association: { essid, bssid: 'AA:BB:CC:DD:EE:FF' }, ipv4: localIp };
  return { interfaces: new Map(cold.interfaces).set('wlan0', connected) };
};

const onlineEnv = (essid = 'BEAN-THERE-WIFI') =>
  mockCommandEnv({
    identity: mockIdentity({ publicKeyHex: asPlayerKeyHex(PUBKEY) }),
    network: mockNetworkViewFromConnectivity(onlineConnectivity(essid)),
  });

const drain = async (result: CommandResult): Promise<{ text: string; exitCode: number }> => {
  if (result.kind !== 'async') throw new Error('expected async result');
  const lines: string[] = [];
  for await (const line of result.lines) lines.push(line.content);
  return { text: lines.join('\n'), exitCode: await result.exitCode() };
};

describe('nmap', () => {
  it('reports command-not-found with an apt hint before install (registry gate)', async () => {
    // The default mock FS has no /usr/bin/nmap, so the binary gate fires first.
    const gated = commandRegistry.get('nmap');
    if (gated === undefined) throw new Error('nmap not registered');

    const result = await gated.execute(mockCommandEnv(), ['192.168.0.0/24'], new Map());
    if (result.kind !== 'sync') throw new Error('expected sync result');

    expect(result.exitCode).toBe(127);
    expect(result.lines[0]?.content).toContain('apt install nmap');
  });

  it('refuses to scan while offline even if wlan0 looks associated (isOnline is the gate)', async () => {
    // Force offline while presenting a fully associated + addressed wlan0: only
    // the isOnline() gate can reject this, proving it is not bypassed.
    const conn = onlineConnectivity('BEAN-THERE-WIFI');
    const env = mockCommandEnv({
      identity: mockIdentity({ publicKeyHex: asPlayerKeyHex(PUBKEY) }),
      network: mockNetworkView({
        isOnline: () => false,
        interfaces: () => [...conn.interfaces.values()],
      }),
    });

    const result = await nmap.execute(env, ['192.168.29.0/24'], new Map());
    if (result.kind !== 'sync') throw new Error('expected sync result');

    expect(result.exitCode).toBe(1);
    expect(result.lines[0]?.kind).toBe('error');
    expect(result.lines[0]?.content).toContain('unreachable');
  });

  it('errors when online but no wlan0 interface is present', async () => {
    const env = mockCommandEnv({
      identity: mockIdentity({ publicKeyHex: asPlayerKeyHex(PUBKEY) }),
      network: mockNetworkView({ isOnline: () => true, interfaces: () => [] }),
    });

    const result = await nmap.execute(env, ['192.168.29.0/24'], new Map());
    if (result.kind !== 'sync') throw new Error('expected sync result');

    expect(result.exitCode).toBe(1);
    expect(result.lines[0]?.content).toContain('unreachable');
  });

  it('errors when online but wlan0 is not associated with a network', async () => {
    // wlan0 exists but carries no association ⇒ no ESSID ⇒ no LAN to derive.
    const cold = buildColdStartConnectivity(PUBKEY);
    const env = mockCommandEnv({
      identity: mockIdentity({ publicKeyHex: asPlayerKeyHex(PUBKEY) }),
      network: mockNetworkView({
        isOnline: () => true,
        interfaces: () => [...cold.interfaces.values()],
      }),
    });

    const result = await nmap.execute(env, ['192.168.29.0/24'], new Map());
    if (result.kind !== 'sync') throw new Error('expected sync result');

    expect(result.exitCode).toBe(1);
    expect(result.lines[0]?.content).toContain('unreachable');
  });

  it('requires a target argument', async () => {
    const result = await nmap.execute(onlineEnv(), [], new Map());
    if (result.kind !== 'sync') throw new Error('expected sync result');

    expect(result.exitCode).toBe(1);
    expect(result.lines[0]?.content.toLowerCase()).toContain('usage');
  });

  // The LAN scanned for these tests (assignHomeNetwork golden for PUBKEY +
  // BEAN-THERE-WIFI): subnet 192.168.29 (ESSID-seeded), hosts at .1 (edge gateway,
  // router), .25 (inner gateway, also a router), .30, .70, .80 (switch), .188 (self),
  // .209, .245 — every other octet is empty.

  it('scanning the whole range lists every host on the LAN', async () => {
    const { text, exitCode } = await drain(
      await nmap.execute(onlineEnv(), ['192.168.29.0-254'], new Map()),
    );

    expect(exitCode).toBe(0);
    expect(text).toContain('192.168.29.1'); // gateway
    expect(text).toContain('router');
    expect(text).toContain('192.168.29.188'); // self
    expect(text).toContain('iphone-188');
    const lan = generateHomeLan(PUBKEY, 'BEAN-THERE-WIFI');
    expect(text).toContain(`${lan.hosts.length} hosts up`);
  });

  it('a range lists only the hosts whose last octet falls inside it', async () => {
    const { text } = await drain(await nmap.execute(onlineEnv(), ['192.168.29.20-80'], new Map()));

    // .25, .30, .70 and the switch at .80 are inside [20, 80]; .1, .188, .209,
    // .245 are not.
    expect(text).toContain('192.168.29.25');
    expect(text).toContain('192.168.29.30');
    expect(text).toContain('192.168.29.70');
    expect(text).toContain('192.168.29.80'); // the switch is a scannable host
    expect(text).not.toContain('192.168.29.1 '); // gateway (.1) excluded
    expect(text).not.toContain('192.168.29.188');
    expect(text).not.toContain('192.168.29.209');
    expect(text).toContain('4 hosts up');
  });

  it('includes hosts sitting exactly on the range boundaries', async () => {
    // .25 == start and .70 == end must both be included (inclusive bounds); .30
    // sits between them.
    const { text } = await drain(await nmap.execute(onlineEnv(), ['192.168.29.25-70'], new Map()));

    expect(text).toContain('192.168.29.25');
    expect(text).toContain('192.168.29.30');
    expect(text).toContain('192.168.29.70');
    expect(text).toContain('3 hosts up');
  });

  it('includes the gateway when the range covers .1', async () => {
    const { text } = await drain(await nmap.execute(onlineEnv(), ['192.168.29.1-30'], new Map()));

    expect(text).toContain('192.168.29.1');
    expect(text).toContain('router');
    expect(text).toContain('192.168.29.25'); // inner gateway
    expect(text).toContain('192.168.29.30');
    expect(text).not.toContain('192.168.29.70');
    expect(text).toContain('3 hosts up');
  });

  it('reports zero hosts for a valid range with nothing in it', async () => {
    const { text, exitCode } = await drain(
      await nmap.execute(onlineEnv(), ['192.168.29.100-120'], new Map()),
    );

    expect(exitCode).toBe(0);
    expect(text).toContain('0 hosts up');
    expect(text).not.toContain('192.168.29.188');
  });

  it('echoes the scanned range in the banner', async () => {
    const { text } = await drain(await nmap.execute(onlineEnv(), ['192.168.29.20-80'], new Map()));

    expect(text).toContain('192.168.29.20-80');
  });

  it('accepts the inclusive upper octet 254', async () => {
    const { exitCode } = await drain(
      await nmap.execute(onlineEnv(), ['192.168.29.1-254'], new Map()),
    );

    expect(exitCode).toBe(0);
  });

  it('rejects a range whose octet exceeds 254', async () => {
    const result = await nmap.execute(onlineEnv(), ['192.168.29.1-255'], new Map());
    if (result.kind !== 'sync') throw new Error('expected sync result');

    expect(result.exitCode).toBe(1);
    expect(result.lines[0]?.content.toLowerCase()).toContain('usage');
  });

  it('rejects a start octet that exceeds 254', async () => {
    const result = await nmap.execute(onlineEnv(), ['192.168.29.255-255'], new Map());
    if (result.kind !== 'sync') throw new Error('expected sync result');

    expect(result.exitCode).toBe(1);
    expect(result.lines[0]?.content.toLowerCase()).toContain('usage');
  });

  it('rejects a range where the start is greater than the end', async () => {
    const result = await nmap.execute(onlineEnv(), ['192.168.29.80-20'], new Map());
    if (result.kind !== 'sync') throw new Error('expected sync result');

    expect(result.exitCode).toBe(1);
    expect(result.lines[0]?.content.toLowerCase()).toContain('usage');
  });

  it('rejects CIDR notation as a usage error', async () => {
    const result = await nmap.execute(onlineEnv(), ['192.168.29.0/24'], new Map());
    if (result.kind !== 'sync') throw new Error('expected sync result');

    expect(result.exitCode).toBe(1);
    expect(result.lines[0]?.content.toLowerCase()).toContain('usage');
  });

  it('reports a single host that is up', async () => {
    const { text, exitCode } = await drain(
      await nmap.execute(onlineEnv(), ['192.168.29.70'], new Map()),
    );

    expect(exitCode).toBe(0);
    expect(text).toContain('Starting Nmap scan — 192.168.29.70');
    expect(text).toContain('Nmap scan report for workstation-70 (192.168.29.70)');
    expect(text).toContain('Host is up.');
    expect(text).toContain('1 host up');
  });

  it('accepts an A-A range, scanning the single octet it covers', async () => {
    // start === end must be a valid range (legacy allows it), not a usage error.
    const { text, exitCode } = await drain(
      await nmap.execute(onlineEnv(), ['192.168.29.70-70'], new Map()),
    );

    expect(exitCode).toBe(0);
    expect(text).toContain('192.168.29.70');
    expect(text).toContain('workstation-70');
    expect(text).toContain('1 hosts up');
  });

  it('accepts the inclusive upper octet 254 for a single IP', async () => {
    // .254 is the last scannable host octet (.255 is broadcast); parsing it is
    // valid even when no host sits there.
    const { text, exitCode } = await drain(
      await nmap.execute(onlineEnv(), ['192.168.29.254'], new Map()),
    );

    expect(exitCode).toBe(0);
    expect(text).toContain('Host seems down.');
  });

  it('reports a single host that is down when no host sits on that octet', async () => {
    const { text, exitCode } = await drain(
      await nmap.execute(onlineEnv(), ['192.168.29.50'], new Map()),
    );

    expect(exitCode).toBe(0);
    expect(text).toContain('Host seems down.');
    expect(text).toContain('0 hosts up');
    expect(text).not.toContain('Host is up.');
  });

  it('rejects a single IP whose octet exceeds 254', async () => {
    const result = await nmap.execute(onlineEnv(), ['192.168.29.255'], new Map());
    if (result.kind !== 'sync') throw new Error('expected sync result');

    expect(result.exitCode).toBe(1);
    expect(result.lines[0]?.content.toLowerCase()).toContain('usage');
  });

  it('treats a range on a foreign subnet as out of range', async () => {
    const result = await nmap.execute(onlineEnv(), ['10.0.0.1-254'], new Map());
    if (result.kind !== 'sync') throw new Error('expected sync result');

    expect(result.exitCode).toBe(1);
    expect(result.lines[0]?.content.toLowerCase()).toContain('out of range');
  });

  it('treats a single IP on a foreign subnet as out of range', async () => {
    const result = await nmap.execute(onlineEnv(), ['10.0.0.25'], new Map());
    if (result.kind !== 'sync') throw new Error('expected sync result');

    expect(result.exitCode).toBe(1);
    expect(result.lines[0]?.content.toLowerCase()).toContain('out of range');
  });
});

/**
 * Scanning your OWN host shows the open ports it advertises — read from the live
 * `/var/run/*.pid` files (the source of truth a running `sshd` writes). `env.fs`
 * is always the current machine, so this is the player's own host only; other
 * hosts get port detail from their generated FS in a later slice. The self host
 * for PUBKEY + BEAN-THERE-WIFI is `iphone-188` at 192.168.29.188 (= wlan0.ipv4).
 * (subnet 192.168.29 is ESSID-seeded; the self octet is per-identity.)
 */
describe('nmap — self-host open ports (slice 1)', () => {
  const SELF_IP = '192.168.29.188';

  /** An online env whose `/var/run` holds the given pidfiles (name → content). */
  const envWithVarRun = (pidfiles: Readonly<Record<string, string>>) => {
    const run = buildDirectory(
      Object.fromEntries(
        Object.entries(pidfiles).map(([name, content]) => [
          name,
          buildFile(content, { owner: 'root' }),
        ]),
      ),
    );
    const tree = buildDirectory({ var: buildDirectory({ run }) });
    return mockCommandEnv({
      identity: mockIdentity({ publicKeyHex: asPlayerKeyHex(PUBKEY) }),
      network: mockNetworkViewFromConnectivity(onlineConnectivity('BEAN-THERE-WIFI')),
      fs: mockFsViewFromTree(tree, { userType: 'user' }),
    });
  };

  it('lists 22/tcp open ssh when sshd is running on the player’s own host', async () => {
    const env = envWithVarRun({ 'sshd.pid': 'sshd:port=22' });

    const { text, exitCode } = await drain(await nmap.execute(env, [SELF_IP], new Map()));

    expect(exitCode).toBe(0);
    expect(text).toContain('Host is up.');
    // Exact columns so the header layout and the open-port row are both pinned.
    expect(text).toContain('PORT     STATE SERVICE');
    expect(text).toContain('22/tcp   open  ssh');
  });

  it('reflects the pidfile’s actual port (sshd on a non-standard port)', async () => {
    const env = envWithVarRun({ 'sshd.pid': 'sshd:port=2222' });

    const { text } = await drain(await nmap.execute(env, [SELF_IP], new Map()));

    expect(text).toContain('2222/tcp open');
  });

  it('shows no open ports on the own host when sshd is not running (empty /var/run)', async () => {
    const env = envWithVarRun({});

    const { text } = await drain(await nmap.execute(env, [SELF_IP], new Map()));

    expect(text).toContain('Host is up.');
    expect(text).not.toContain('PORT');
    expect(text).not.toContain('22/tcp');
  });

  /** The ssh port the GENERATOR gives `host`, or null when it runs no ssh. Lets
   *  the dispatch tests find a deterministic remote ssh / non-ssh host. */
  const generatedSshdPort = (host: LanHost): number | null => {
    const fs: Directory = buildRemoteHostFs(PUBKEY, 'BEAN-THERE-WIFI', host);
    const varDir = fs.entries.get('var');
    const runDir = varDir?.kind === 'directory' ? varDir.entries.get('run') : undefined;
    const node = runDir?.kind === 'directory' ? runDir.entries.get('sshd.pid') : undefined;
    return node?.kind === 'file' ? Number(node.content.split('=')[1]) : null;
  };

  const remoteHosts = (): readonly LanHost[] =>
    generateHomeLan(PUBKEY, 'BEAN-THERE-WIFI').hosts.filter((host) => host.ip !== SELF_IP);

  it('shows a remote host’s OWN generated ssh port, not the workstation’s', async () => {
    const sshHost = remoteHosts().find((host) => generatedSshdPort(host) !== null);
    if (sshHost === undefined) throw new Error('expected a generated ssh host on the LAN');
    const port = generatedSshdPort(sshHost);

    // The workstation runs sshd on a DISTINCT port (:9999); scanning the remote
    // must show the REMOTE's port (from its generated FS), never the workstation's.
    const env = envWithVarRun({ 'sshd.pid': 'sshd:port=9999' });

    const { text } = await drain(await nmap.execute(env, [sshHost.ip], new Map()));

    expect(text).toContain(`${port}/tcp`);
    expect(text).toContain('ssh');
    expect(text).not.toContain('9999/tcp');
  });

  it('shows no ports for a remote host the generator gives no service', async () => {
    const bareHost = remoteHosts().find((host) => generatedSshdPort(host) === null);
    if (bareHost === undefined) throw new Error('expected a generated non-ssh host on the LAN');

    // The workstation itself IS running sshd — proving its services are not
    // attributed to a different host.
    const env = envWithVarRun({ 'sshd.pid': 'sshd:port=22' });

    const { text } = await drain(await nmap.execute(env, [bareHost.ip], new Map()));

    expect(text).toContain('Host is up.');
    expect(text).not.toContain('PORT');
  });

  it('falls back to the service default port when the pidfile content is malformed', async () => {
    // A recognised pidfile (sshd.pid) with unparseable content still reports the
    // service as up, on its default port (22).
    const env = envWithVarRun({ 'sshd.pid': 'corrupted-content' });

    const { text } = await drain(await nmap.execute(env, [SELF_IP], new Map()));

    expect(text).toContain('22/tcp');
    expect(text).toContain('ssh');
  });

  it('ignores a /var/run entry that is not a known service pidfile', async () => {
    const env = envWithVarRun({ 'mystery.pid': 'mystery:port=99' });

    const { text } = await drain(await nmap.execute(env, [SELF_IP], new Map()));

    expect(text).toContain('Host is up.');
    expect(text).not.toContain('PORT');
    expect(text).not.toContain('99/tcp');
  });

  it('ignores a recognised pidfile path that is a directory, not a file (no crash)', async () => {
    const tree = buildDirectory({
      var: buildDirectory({ run: buildDirectory({ 'sshd.pid': buildDirectory({}) }) }),
    });
    const env = mockCommandEnv({
      identity: mockIdentity({ publicKeyHex: asPlayerKeyHex(PUBKEY) }),
      network: mockNetworkViewFromConnectivity(onlineConnectivity('BEAN-THERE-WIFI')),
      fs: mockFsViewFromTree(tree, { userType: 'user' }),
    });

    const { text } = await drain(await nmap.execute(env, [SELF_IP], new Map()));

    expect(text).toContain('Host is up.');
    expect(text).not.toContain('PORT');
    expect(text).not.toContain('22/tcp');
  });

  it('shows no ports (and does not crash) when /var/run does not exist', async () => {
    const env = mockCommandEnv({
      identity: mockIdentity({ publicKeyHex: asPlayerKeyHex(PUBKEY) }),
      network: mockNetworkViewFromConnectivity(onlineConnectivity('BEAN-THERE-WIFI')),
      fs: mockFsViewFromTree(buildDirectory({}), { userType: 'user' }),
    });

    const { text } = await drain(await nmap.execute(env, [SELF_IP], new Map()));

    expect(text).toContain('Host is up.');
    expect(text).not.toContain('PORT');
  });

  it('reads no ports from a malformed /var tree (var or run not a directory, or run missing)', async () => {
    const trees: readonly Directory[] = [
      buildDirectory({ var: buildFile('not a dir') }), // /var is a file
      buildDirectory({ var: buildDirectory({}) }), // /var dir, no /var/run
      buildDirectory({ var: buildDirectory({ run: buildFile('not a dir') }) }), // /var/run is a file
    ];
    for (const tree of trees) {
      const env = mockCommandEnv({
        identity: mockIdentity({ publicKeyHex: asPlayerKeyHex(PUBKEY) }),
        network: mockNetworkViewFromConnectivity(onlineConnectivity('BEAN-THERE-WIFI')),
        fs: mockFsViewFromTree(tree, { userType: 'user' }),
      });

      const { text } = await drain(await nmap.execute(env, [SELF_IP], new Map()));

      expect(text).toContain('Host is up.');
      expect(text).not.toContain('PORT');
    }
  });
});

/**
 * A scan leaves a trace: nmap fires the server-internal scan-logging action
 * (`env.scan.record`) for any real online scan, handing it the essid, the raw
 * target, and the LAN source IP. The server resolves the touched hosts and writes
 * each one's /var/log/kern.log itself. No scan happened ⇒ no record (offline,
 * foreign subnet, or unparseable target).
 */
describe('nmap — scan logging (3a)', () => {
  const ESSID = 'BEAN-THERE-WIFI';
  const subnet = generateHomeLan(PUBKEY, ESSID).subnet;

  const envWithScan = (record: () => Promise<void>) =>
    mockCommandEnv({
      identity: mockIdentity({ publicKeyHex: asPlayerKeyHex(PUBKEY) }),
      network: mockNetworkViewFromConnectivity(onlineConnectivity(ESSID)),
      scan: mockScanApi({ record }),
    });

  it('records a range scan with the essid, raw target, and LAN source IP', async () => {
    const record = vi.fn(async () => undefined);
    const target = `${subnet}.1-254`;

    await drain(await nmap.execute(envWithScan(record), [target], new Map()));

    expect(record).toHaveBeenCalledWith({
      essid: ESSID,
      target,
      sourceIp: assignHomeNetwork(PUBKEY, ESSID).localIp,
    });
  });

  it('records a single-IP scan too (the raw target is passed through)', async () => {
    const record = vi.fn(async () => undefined);
    const target = `${subnet}.5`;

    await drain(await nmap.execute(envWithScan(record), [target], new Map()));

    expect(record).toHaveBeenCalledWith({
      essid: ESSID,
      target,
      sourceIp: assignHomeNetwork(PUBKEY, ESSID).localIp,
    });
  });

  it('does not record when offline (no scan happened)', async () => {
    const record = vi.fn(async () => undefined);
    const conn = onlineConnectivity(ESSID);
    const env = mockCommandEnv({
      identity: mockIdentity({ publicKeyHex: asPlayerKeyHex(PUBKEY) }),
      network: mockNetworkView({
        isOnline: () => false,
        interfaces: () => [...conn.interfaces.values()],
      }),
      scan: mockScanApi({ record }),
    });

    await nmap.execute(env, [`${subnet}.1-254`], new Map());

    expect(record).not.toHaveBeenCalled();
  });

  it('does not record a foreign-subnet target (out of range, no scan)', async () => {
    const record = vi.fn(async () => undefined);

    await nmap.execute(envWithScan(record), ['10.0.0.1-254'], new Map());

    expect(record).not.toHaveBeenCalled();
  });
});

/**
 * A public IP is a CROSS-PLAYER target (Story 1, slice 1a): rather than scanning
 * the player's own LAN, `nmap <public IP>` resolves the target server-side against
 * the public-IP registry (another identity's registered network) via
 * `env.scan.resolvePublic`. The real round-trip IS the latency, so there is no
 * fake per-row pacing. A public-prefixed RANGE is not a cross-player scan — only a
 * single public IP routes to the resolver; everything else stays the LAN path.
 */
describe('nmap — cross-player public-IP scan (slice 1a)', () => {
  const PUBLIC_IP = '203.0.113.7';

  const envWithResolve = (resolvePublic: ScanApi['resolvePublic']) =>
    mockCommandEnv({
      identity: mockIdentity({ publicKeyHex: asPlayerKeyHex(PUBKEY) }),
      network: mockNetworkViewFromConnectivity(onlineConnectivity('BEAN-THERE-WIFI')),
      scan: mockScanApi({ resolvePublic }),
    });

  it('resolves a public IP server-side and reports the host up when found', async () => {
    const resolvePublic = vi.fn(async () => ({ found: true, ports: [] }));

    const { text, exitCode } = await drain(
      await nmap.execute(envWithResolve(resolvePublic), [PUBLIC_IP], new Map()),
    );

    expect(exitCode).toBe(0);
    expect(resolvePublic).toHaveBeenCalledWith(PUBLIC_IP);
    // Exact output (the public-IP scan is fully deterministic — no host list), so
    // the report lines AND their blank-line spacing are both pinned.
    expect(text).toBe(
      [
        'Starting Nmap scan — 203.0.113.7',
        '',
        'Nmap scan report for 203.0.113.7',
        'Host is up.',
        '',
        'Nmap done — 1 host up',
      ].join('\n'),
    );
  });

  it("renders the owner's resolved open ports as the PORT/STATE/SERVICE table", async () => {
    // A non-default port proves the table reflects the OWNER's real pidfile record
    // resolved server-side, not a hardcoded 22 or a local regeneration.
    const resolvePublic = vi.fn(async () => ({
      found: true,
      ports: [{ port: 2222, service: 'ssh' }],
    }));

    const { text, exitCode } = await drain(
      await nmap.execute(envWithResolve(resolvePublic), [PUBLIC_IP], new Map()),
    );

    expect(exitCode).toBe(0);
    expect(text).toBe(
      [
        'Starting Nmap scan — 203.0.113.7',
        '',
        'Nmap scan report for 203.0.113.7',
        'Host is up.',
        '',
        'PORT     STATE SERVICE',
        '2222/tcp open  ssh',
        '',
        'Nmap done — 1 host up',
      ].join('\n'),
    );
  });

  it('reports the host down when the public IP is not registered', async () => {
    const resolvePublic = vi.fn(async () => ({ found: false, ports: [] }));

    const { text, exitCode } = await drain(
      await nmap.execute(envWithResolve(resolvePublic), [PUBLIC_IP], new Map()),
    );

    expect(exitCode).toBe(0);
    expect(text).toBe(
      [
        'Starting Nmap scan — 203.0.113.7',
        '',
        'Host seems down.',
        '',
        'Nmap done — 0 hosts up',
      ].join('\n'),
    );
    expect(text).not.toContain('Host is up.');
  });

  it('does not fire the own-LAN scan logger for a public-IP scan', async () => {
    const record = vi.fn(async () => undefined);
    const resolvePublic = vi.fn(async () => ({ found: true, ports: [] }));
    const env = mockCommandEnv({
      identity: mockIdentity({ publicKeyHex: asPlayerKeyHex(PUBKEY) }),
      network: mockNetworkViewFromConnectivity(onlineConnectivity('BEAN-THERE-WIFI')),
      scan: mockScanApi({ record, resolvePublic }),
    });

    await drain(await nmap.execute(env, [PUBLIC_IP], new Map()));

    expect(record).not.toHaveBeenCalled();
  });

  it('does not resolve a public IP while offline (the online gate still applies)', async () => {
    const resolvePublic = vi.fn(async () => ({ found: true, ports: [] }));
    const conn = onlineConnectivity('BEAN-THERE-WIFI');
    const env = mockCommandEnv({
      identity: mockIdentity({ publicKeyHex: asPlayerKeyHex(PUBKEY) }),
      network: mockNetworkView({
        isOnline: () => false,
        interfaces: () => [...conn.interfaces.values()],
      }),
      scan: mockScanApi({ resolvePublic }),
    });

    const result = await nmap.execute(env, [PUBLIC_IP], new Map());
    if (result.kind !== 'sync') throw new Error('expected sync result');

    expect(result.exitCode).toBe(1);
    expect(resolvePublic).not.toHaveBeenCalled();
  });

  it('treats a public-prefixed RANGE as a normal (out-of-range) LAN target, not a cross-player scan', async () => {
    const resolvePublic = vi.fn(async () => ({ found: true, ports: [] }));

    const result = await nmap.execute(
      envWithResolve(resolvePublic),
      ['203.0.113.1-254'],
      new Map(),
    );
    if (result.kind !== 'sync') throw new Error('expected sync result');

    expect(result.exitCode).toBe(1);
    expect(result.lines[0]?.content.toLowerCase()).toContain('out of range');
    expect(resolvePublic).not.toHaveBeenCalled();
  });
});

/**
 * Scanning the `.1` gateway from inside your OWN LAN resolves your REAL router
 * (Story 5.1.4): a distinct journal-backed box that always runs its own sshd:22,
 * NOT the cosmetic NPC gateway the generator used to roll there. The port view
 * comes from the single `scanResult` total function at the `sameLAN` vantage — the
 * same function the public-IP (`external`) scan uses — so the two can never drift.
 * `sameLAN` shows only the router's own ports and never the NAT forward table, so
 * a forward configured for the public side can never leak into the LAN-side view.
 */
/**
 * Same-LAN occupant merge: a player connected to ESSID X sees FELLOW occupants of X as
 * real hosts on their own `nmap`, merged over the generated NPC siblings. The occupant
 * list is fetched server-side (`env.scan.resolveOccupants`, self already excluded) and
 * overlaid: on an octet collision the real occupant wins and the NPC is dropped. A
 * single-IP scan of an occupant reports it up under its real machine name; A's services
 * are NOT fabricated from the viewer's seed.
 */
describe('nmap — same-LAN occupant merge', () => {
  const ESSID = 'BEAN-THERE-WIFI';
  const baseLan = generateHomeLan(PUBKEY, ESSID);

  type Occupant = { workstation_machine_id: string; localIp: string; machineName: string };

  const envWithOccupants = (resolveOccupants: () => Promise<readonly Occupant[]>) =>
    mockCommandEnv({
      identity: mockIdentity({ publicKeyHex: asPlayerKeyHex(PUBKEY) }),
      network: mockNetworkViewFromConnectivity(onlineConnectivity(ESSID)),
      scan: mockScanApi({ resolveOccupants }),
    });

  /** The IP of a generated NPC the world gives an sshd — its FS (and thus ports)
   *  key on the host IP alone, so an occupant placed here would fabricate this port
   *  unless the merge suppresses it. */
  const SELF_IP = assignHomeNetwork(PUBKEY, ESSID).localIp;
  const sshNpcIp = (): string => {
    const host = baseLan.hosts.find((candidate) => {
      if (candidate.kind !== 'machine' || candidate.ip === SELF_IP) return false;
      const fs: Directory = buildRemoteHostFs(PUBKEY, ESSID, candidate);
      const varDir = fs.entries.get('var');
      const runDir = varDir?.kind === 'directory' ? varDir.entries.get('run') : undefined;
      return runDir?.kind === 'directory' && runDir.entries.has('sshd.pid');
    });
    if (host === undefined) throw new Error('expected a generated ssh host on the LAN');
    return host.ip;
  };

  it('lists a fellow occupant as a host at its LAN IP under its real machine name', async () => {
    // .42 is an empty octet in PUBKEY's generated LAN (occupied: .1/.25/.70/.188/.209/.245).
    const resolveOccupants = vi.fn(async () => [
      { workstation_machine_id: 'skylab-aaaa', localIp: '192.168.29.42', machineName: 'alice-rig' },
    ]);

    const { text, exitCode } = await drain(
      await nmap.execute(envWithOccupants(resolveOccupants), ['192.168.29.0-254'], new Map()),
    );

    expect(exitCode).toBe(0);
    expect(text).toContain('192.168.29.42');
    expect(text).toContain('alice-rig');
    // The occupant is ADDED on top of the generated LAN (self iphone-188 still present).
    expect(text).toContain('192.168.29.188');
    expect(text).toContain(`${baseLan.hosts.length + 1} hosts up`);
    // The fetch is keyed on the player's currently-associated ESSID.
    expect(resolveOccupants).toHaveBeenCalledWith(ESSID);
  });

  it('drops the generated NPC on an octet collision — the occupant wins', async () => {
    // .25 is the generated `desktop-25`; an occupant there must REPLACE it.
    const resolveOccupants = vi.fn(async () => [
      { workstation_machine_id: 'skylab-aaaa', localIp: '192.168.29.25', machineName: 'alice-rig' },
    ]);

    const { text } = await drain(
      await nmap.execute(envWithOccupants(resolveOccupants), ['192.168.29.0-254'], new Map()),
    );

    expect(text).toContain('alice-rig');
    expect(text).not.toContain('desktop-25');
    // No net host added — the NPC was replaced, not appended.
    expect(text).toContain(`${baseLan.hosts.length} hosts up`);
  });

  it('leaves the generated LAN unchanged when there are no fellow occupants', async () => {
    const { text } = await drain(
      await nmap.execute(
        envWithOccupants(async () => []),
        ['192.168.29.0-254'],
        new Map(),
      ),
    );

    expect(text).toContain(`${baseLan.hosts.length} hosts up`);
  });

  it('reports a single occupant IP up under its real machine name', async () => {
    const { text, exitCode } = await drain(
      await nmap.execute(
        envWithOccupants(async () => [
          {
            workstation_machine_id: 'skylab-aaaa',
            localIp: '192.168.29.42',
            machineName: 'alice-rig',
          },
        ]),
        ['192.168.29.42'],
        new Map(),
      ),
    );

    expect(exitCode).toBe(0);
    expect(text).toContain('Nmap scan report for alice-rig (192.168.29.42)');
    expect(text).toContain('Host is up.');
  });

  it("does not fabricate an occupant's ports from the viewer's own seed", async () => {
    // Place the occupant on an octet where a generated NPC runs sshd. Because NPC
    // filesystems key on the host IP alone, scanning here WOULD surface a fabricated
    // ssh port if the merge let the occupant fall through to the generator.
    const ip = sshNpcIp();
    const { text } = await drain(
      await nmap.execute(
        envWithOccupants(async () => [
          { workstation_machine_id: 'skylab-aaaa', localIp: ip, machineName: 'alice-rig' },
        ]),
        [ip],
        new Map(),
      ),
    );

    expect(text).toContain(`Nmap scan report for alice-rig (${ip})`);
    expect(text).toContain('Host is up.');
    expect(text).not.toContain('PORT');
    expect(text).not.toContain('22/tcp');
  });

  it('does not fetch occupants for a cross-player public-IP scan (own-LAN merge only)', async () => {
    const resolveOccupants = vi.fn(async () => []);
    const env = mockCommandEnv({
      identity: mockIdentity({ publicKeyHex: asPlayerKeyHex(PUBKEY) }),
      network: mockNetworkViewFromConnectivity(onlineConnectivity(ESSID)),
      scan: mockScanApi({ resolveOccupants, resolvePublic: async () => ({ found: true, ports: [] }) }),
    });

    await drain(await nmap.execute(env, ['203.0.113.7'], new Map()));

    expect(resolveOccupants).not.toHaveBeenCalled();
  });
});

/**
 * Scanning an INNER GATEWAY (a second router deeper in your own LAN) resolves
 * SERVER-side at the upstream (`external`) vantage (Story 5b): the player sits
 * upstream of it, so a NAT forward to the deep layer behind it is visible — and
 * that forward lives on the gateway's journal, not the client's static world, so
 * its ports can't be read locally the way the edge `.1` or a sibling's are. Only a
 * SINGLE-IP scan routes to the resolver; a range still just lists the host, and the
 * edge `.1` stays the client-side `sameLAN` scan.
 */
describe('nmap — own-LAN inner-gateway scan (5b.1b-i)', () => {
  const ESSID = 'BEAN-THERE-WIFI';
  const lan = generateHomeLan(PUBKEY, ESSID);

  const innerGatewayOf = (essid: string): LanHost => {
    const gateway = generateHomeLan(PUBKEY, essid).hosts.find(
      (host) => host.kind === 'router' && Number(host.ip.split('.')[3]) !== 1,
    );
    if (gateway === undefined) throw new Error('no inner gateway on LAN');
    return gateway;
  };
  const INNER = innerGatewayOf(ESSID);

  const envWithInnerGateway = (
    resolveInnerGateway: ScanApi['resolveInnerGateway'],
    record: ScanApi['record'] = async () => undefined,
  ) =>
    mockCommandEnv({
      identity: mockIdentity({ publicKeyHex: asPlayerKeyHex(PUBKEY) }),
      network: mockNetworkViewFromConnectivity(onlineConnectivity(ESSID)),
      scan: mockScanApi({ resolveInnerGateway, record }),
    });

  it('resolves a single-IP scan of an inner gateway server-side, rendering its own port plus a forward', async () => {
    const resolveInnerGateway = vi.fn(async () => ({
      found: true,
      ports: [
        { port: 22, service: 'ssh' },
        { port: 2222, service: 'ssh' },
      ],
    }));

    const { text, exitCode } = await drain(
      await nmap.execute(envWithInnerGateway(resolveInnerGateway), [INNER.ip], new Map()),
    );

    expect(exitCode).toBe(0);
    expect(resolveInnerGateway).toHaveBeenCalledWith(ESSID, INNER.ip);
    // Exact output (the inner-gateway scan is a deterministic server round-trip — no
    // host list), so the report lines, the port table, AND their spacing are pinned.
    expect(text).toBe(
      [
        `Starting Nmap scan — ${INNER.ip}`,
        '',
        `Nmap scan report for ${INNER.hostname} (${INNER.ip})`,
        'Host is up.',
        '',
        'PORT     STATE SERVICE',
        '22/tcp   open  ssh',
        '2222/tcp open  ssh',
        '',
        'Nmap done — 1 host up',
      ].join('\n'),
    );
  });

  const switchOf = (essid: string): LanHost => {
    const device = generateHomeLan(PUBKEY, essid).hosts.find((host) => host.kind === 'switch');
    if (device === undefined) throw new Error('no switch on LAN');
    return device;
  };
  const SWITCH = switchOf(ESSID);

  it('resolves a single-IP scan of a SWITCH server-side too — it routes like an inner gateway', async () => {
    // A switch is the second inner-gateway device type, so a single-IP scan of it
    // takes the same upstream server round-trip. It forwards nothing, so the server
    // resolves only its own sshd:22 (dark downstream) — no extra forwarded port.
    const resolveInnerGateway = vi.fn(async () => ({
      found: true,
      ports: [{ port: 22, service: 'ssh' }],
    }));

    const { text, exitCode } = await drain(
      await nmap.execute(envWithInnerGateway(resolveInnerGateway), [SWITCH.ip], new Map()),
    );

    expect(exitCode).toBe(0);
    expect(resolveInnerGateway).toHaveBeenCalledWith(ESSID, SWITCH.ip);
    expect(text).toContain(`Nmap scan report for ${SWITCH.hostname} (${SWITCH.ip})`);
    expect(text).toContain('22/tcp   open  ssh');
  });

  it('reports the inner gateway down when the server resolves nothing (e.g. bricked)', async () => {
    const resolveInnerGateway = vi.fn(async () => ({ found: false, ports: [] }));

    const { text, exitCode } = await drain(
      await nmap.execute(envWithInnerGateway(resolveInnerGateway), [INNER.ip], new Map()),
    );

    expect(exitCode).toBe(0);
    expect(text).toBe(
      [
        `Starting Nmap scan — ${INNER.ip}`,
        '',
        'Host seems down.',
        '',
        'Nmap done — 0 hosts up',
      ].join('\n'),
    );
    expect(text).not.toContain('Host is up.');
  });

  it('does NOT route the edge .1 router through the inner-gateway resolver (it stays the client-side sameLAN scan)', async () => {
    const resolveInnerGateway = vi.fn(async () => ({ found: true, ports: [] }));

    const { text } = await drain(
      await nmap.execute(envWithInnerGateway(resolveInnerGateway), [`${lan.subnet}.1`], new Map()),
    );

    expect(resolveInnerGateway).not.toHaveBeenCalled();
    expect(text).toContain('22/tcp   open  ssh');
  });

  it('does NOT route a range covering the inner gateway through the resolver (a range lists hosts only)', async () => {
    const resolveInnerGateway = vi.fn(async () => ({ found: true, ports: [] }));

    await drain(
      await nmap.execute(envWithInnerGateway(resolveInnerGateway), [`${lan.subnet}.1-30`], new Map()),
    );

    expect(resolveInnerGateway).not.toHaveBeenCalled();
  });

  it('still fires the own-LAN scan record (kern.log trace) for an inner-gateway scan', async () => {
    const record = vi.fn(async () => undefined);
    const resolveInnerGateway = vi.fn(async () => ({
      found: true,
      ports: [{ port: 22, service: 'ssh' }],
    }));

    await drain(
      await nmap.execute(envWithInnerGateway(resolveInnerGateway, record), [INNER.ip], new Map()),
    );

    expect(record).toHaveBeenCalledWith({
      essid: ESSID,
      target: INNER.ip,
      sourceIp: assignHomeNetwork(PUBKEY, ESSID).localIp,
    });
  });
});

describe('nmap — own router (.1) sameLAN scan (5.1.4)', () => {
  // For PUBKEY + XFINITY-1234 the COSMETIC gateway (the old buildRemoteHostFs path)
  // rolls sshd on :2222, while the REAL router always runs sshd on :22 — so a .1
  // scan showing :22 (and not :2222) proves it resolves the router, not the gateway.
  const ROUTER_ESSID = 'XFINITY-1234';
  const routerSubnet = generateHomeLan(PUBKEY, ROUTER_ESSID).subnet;
  const ROUTER_IP = `${routerSubnet}.1`;

  it('reports the real router’s own 22/tcp ssh, not the cosmetic gateway’s port', async () => {
    const { text, exitCode } = await drain(
      await nmap.execute(onlineEnv(ROUTER_ESSID), [ROUTER_IP], new Map()),
    );

    expect(exitCode).toBe(0);
    // The full report is pinned: the router runs sshd on :22 (its real seeded
    // service), NOT the :2222 the cosmetic gateway used to roll on this LAN — so a
    // 2222/tcp row appearing here would mean the old buildRemoteHostFs path leaked.
    expect(text).toBe(
      [
        `Starting Nmap scan — ${ROUTER_IP}`,
        '',
        // The router carries its owner-seeded name (Story 6.0), not a generic "gateway".
        `Nmap scan report for ${seedRouterHostname(PUBKEY)} (${ROUTER_IP})`,
        'Host is up.',
        '',
        'PORT     STATE SERVICE',
        '22/tcp   open  ssh',
        '',
        'Nmap done — 1 host up',
      ].join('\n'),
    );
  });
});

/**
 * Reachability-pivot: with an active shell on an inner gateway, the gateway's
 * downstream deep `/24` becomes scannable directly — no NAT forward needed,
 * because you are standing on the segment. The vantage is the active session's
 * machine: nmap scans the deep layer only when that session sits on an inner
 * gateway; from home (or any non-gateway box) the deep `/24` stays out of range.
 * The deep hosts are deterministic NPCs, so this resolves CLIENT-side — no server
 * round-trip, unlike the upstream inner-gateway forward-scan above.
 */
describe('nmap — reachability-pivot from an inner gateway (5b.2)', () => {
  const ESSID = 'BEAN-THERE-WIFI';
  const lan = generateHomeLan(PUBKEY, ESSID);
  const findHost = (predicate: (host: LanHost) => boolean): LanHost => {
    const host = lan.hosts.find(predicate);
    if (host === undefined) throw new Error('host not found on golden LAN');
    return host;
  };
  const octetOf = (host: LanHost): number => Number(host.ip.split('.')[3]);

  const INNER = findHost((host) => host.kind === 'router' && octetOf(host) !== 1);
  const EDGE = findHost((host) => host.kind === 'router' && octetOf(host) === 1);
  const SIBLING = findHost((host) => host.kind === 'machine');
  const SWITCH = findHost((host) => host.kind === 'switch');

  const idOf = (host: LanHost): string => machineIdForLanHost(host, PUBKEY, ESSID);
  const DEEP = generateDeepLayer(PUBKEY, ESSID, { machineId: idOf(INNER), kind: 'router' });
  // The switch fronts its OWN deep layer (keyed by its machine_id), disjoint from the router's.
  const SWITCH_DEEP = generateDeepLayer(PUBKEY, ESSID, { machineId: idOf(SWITCH), kind: 'switch' });
  const deepHostOctet = octetOf(DEEP.host);
  // An address with no host on it — distinct from BOTH the NPC and the child gateway.
  const deepChildOctet = DEEP.childGateway ? octetOf(DEEP.childGateway) : -1;
  const deepDownOctet = [2, 3, 4, 5].find(
    (octet) => octet !== deepHostOctet && octet !== deepChildOctet,
  );
  const deepDownIp = `${DEEP.subnet}.${deepDownOctet ?? 2}`;

  /** Online on the home ESSID with the active session sitting on `machineId`. An
   *  optional `fs` stands in for that machine's journal-replayed tree — a switch
   *  pivot reads its live `/etc/switch/acl.conf` from here. */
  const vantageEnv = (
    machineId: string,
    opts: { readonly record?: ScanApi['record']; readonly fs?: Directory } = {},
  ) =>
    mockCommandEnv({
      identity: mockIdentity({ publicKeyHex: asPlayerKeyHex(PUBKEY) }),
      network: mockNetworkViewFromConnectivity(onlineConnectivity(ESSID)),
      session: mockSession({ machineId: asMachineId(machineId) }),
      scan: mockScanApi(opts.record ? { record: opts.record } : {}),
      ...(opts.fs ? { fs: mockFsViewFromTree(opts.fs) } : {}),
    });

  /** A switch session's filesystem whose `/etc/switch/acl.conf` denies the given
   *  ports — the slice of the journal-replayed switch tree the pivot scan reads. */
  const switchFsDenying = (...ports: readonly number[]): Directory =>
    buildDirectory({
      etc: buildDirectory({
        switch: buildDirectory({
          'acl.conf': buildFile(ports.map((port) => `deny ${port}`).join('\n')),
        }),
      }),
    });

  it('scans the downstream deep host directly when the shell is on the inner gateway', async () => {
    const { text, exitCode } = await drain(
      await nmap.execute(vantageEnv(idOf(INNER)), [DEEP.host.ip], new Map()),
    );

    expect(exitCode).toBe(0);
    expect(text).toContain(`Nmap scan report for ${DEEP.host.hostname} (${DEEP.host.ip})`);
    expect(text).toContain('Host is up.');
    // The deep host is a reachable target by design — sshd:22 is forced on.
    expect(text).toContain('22/tcp   open  ssh');
    expect(text).toContain('Nmap done — 1 host up');
  });

  it('lists the NPC AND the deeper child gateway in a range scan of the inner router’s deep /24', async () => {
    const child = DEEP.childGateway;
    expect(child).not.toBeNull();
    if (child === null) return;

    const { text, exitCode } = await drain(
      await nmap.execute(vantageEnv(idOf(INNER)), [`${DEEP.subnet}.1-254`], new Map()),
    );

    expect(exitCode).toBe(0);
    // The terminal NPC...
    expect(text).toContain(DEEP.host.ip);
    expect(text).toContain(DEEP.host.hostname);
    expect(text).toContain('machine');
    // ...and the child gateway — the door to the next layer down.
    expect(text).toContain(child.ip);
    expect(text).toContain(child.hostname);
    expect(text).toContain('router');
    expect(text).toContain('Nmap done — 2 hosts up');
  });

  it('scans the child gateway directly — a reachable router on :22', async () => {
    const child = DEEP.childGateway;
    expect(child).not.toBeNull();
    if (child === null) return;

    const { text, exitCode } = await drain(
      await nmap.execute(vantageEnv(idOf(INNER)), [child.ip], new Map()),
    );

    expect(exitCode).toBe(0);
    expect(text).toContain(`Nmap scan report for ${child.hostname} (${child.ip})`);
    expect(text).toContain('Host is up.');
    expect(text).toContain('22/tcp   open  ssh');
    expect(text).toContain('Nmap done — 1 host up');
  });

  it('reports a deep-subnet address with no host as down', async () => {
    const { text, exitCode } = await drain(
      await nmap.execute(vantageEnv(idOf(INNER)), [deepDownIp], new Map()),
    );

    expect(exitCode).toBe(0);
    expect(text).toContain('Host seems down.');
    expect(text).toContain('Nmap done — 0 hosts up');
    expect(text).not.toContain('Host is up.');
  });

  it('keeps the deep /24 out of range from home (no active hop)', async () => {
    // The default session sits on the player's own workstation, not a gateway.
    const result = await nmap.execute(
      mockCommandEnv({
        identity: mockIdentity({ publicKeyHex: asPlayerKeyHex(PUBKEY) }),
        network: mockNetworkViewFromConnectivity(onlineConnectivity(ESSID)),
      }),
      [DEEP.host.ip],
      new Map(),
    );
    if (result.kind !== 'sync') throw new Error('expected sync result');

    expect(result.exitCode).toBe(1);
    expect(result.lines[0]?.content).toContain('out of range');
  });

  it('still scans the upstream home /24 from the gateway vantage (deep branch falls through)', async () => {
    const { text, exitCode } = await drain(
      await nmap.execute(vantageEnv(idOf(INNER)), [`${lan.subnet}.1-30`], new Map()),
    );

    expect(exitCode).toBe(0);
    // The home LAN is unchanged from this vantage: .1/.25/.30 all still list.
    expect(text).toContain(`${lan.subnet}.30`);
    expect(text).toContain(`${lan.subnet}.25`);
    expect(text).toContain('3 hosts up');
  });

  it('does NOT pivot from the edge .1 router — only an inner gateway exposes a deep layer', async () => {
    const result = await nmap.execute(vantageEnv(idOf(EDGE)), [DEEP.host.ip], new Map());
    if (result.kind !== 'sync') throw new Error('expected sync result');

    expect(result.exitCode).toBe(1);
    expect(result.lines[0]?.content).toContain('out of range');
  });

  it('does NOT pivot from an ordinary sibling host (not a gateway at all)', async () => {
    const result = await nmap.execute(vantageEnv(idOf(SIBLING)), [DEEP.host.ip], new Map());
    if (result.kind !== 'sync') throw new Error('expected sync result');

    expect(result.exitCode).toBe(1);
    expect(result.lines[0]?.content).toContain('out of range');
  });

  it('does NOT pivot a non-gateway session onto a deep /24 keyed off its OWN id', async () => {
    // The vantage keys the deep layer off the SESSION's machine_id, so the only thing
    // guarding against a non-gateway pivot is the gateway filter + the child-id match.
    // A sibling's own would-be deep host must stay out of range — only a real inner
    // gateway or a real deep child gateway is ever a pivot vantage.
    const siblingDeep = generateDeepLayer(PUBKEY, ESSID, { machineId: idOf(SIBLING), kind: 'router' });

    const result = await nmap.execute(vantageEnv(idOf(SIBLING)), [siblingDeep.host.ip], new Map());
    if (result.kind !== 'sync') throw new Error('expected sync result');

    expect(result.exitCode).toBe(1);
    expect(result.lines[0]?.content).toContain('out of range');
  });

  it('pivots from a SWITCH onto its OWN deep /24 — a segment the router never fronts', async () => {
    const { text, exitCode } = await drain(
      await nmap.execute(vantageEnv(idOf(SWITCH)), [SWITCH_DEEP.host.ip], new Map()),
    );

    expect(exitCode).toBe(0);
    expect(text).toContain(`Nmap scan report for ${SWITCH_DEEP.host.hostname} (${SWITCH_DEEP.host.ip})`);
    expect(text).toContain('Host is up.');
    // The deep host is a reachable target by design — sshd:22 is forced on — and the
    // switch's default ACL denies nothing on it, so :22 is open.
    expect(text).toContain('22/tcp   open  ssh');
    expect(text).toContain('Nmap done — 1 host up');
  });

  it('does NOT see the ROUTER’s deep /24 from a SWITCH vantage — disjoint segments', async () => {
    // A switch pivots to ITS layer (the next index), not the router's. The router's
    // deep host is on a different /24, so from the switch it is out of range.
    const result = await nmap.execute(vantageEnv(idOf(SWITCH)), [DEEP.host.ip], new Map());
    if (result.kind !== 'sync') throw new Error('expected sync result');

    expect(result.exitCode).toBe(1);
    expect(result.lines[0]?.content).toContain('out of range');
  });

  it('does NOT see the SWITCH’s deep /24 from a ROUTER vantage — disjoint segments', async () => {
    const result = await nmap.execute(vantageEnv(idOf(INNER)), [SWITCH_DEEP.host.ip], new Map());
    if (result.kind !== 'sync') throw new Error('expected sync result');

    expect(result.exitCode).toBe(1);
    expect(result.lines[0]?.content).toContain('out of range');
  });

  it('hides a deep port the switch ACL denies, and re-opens it when the deny line is gone', async () => {
    // The switch's `/etc/switch/acl.conf` filters its downstream: a denied port is
    // absent from the pivot scan even though the deep host runs it (sshd:22 is forced).
    const denied = await drain(
      await nmap.execute(
        vantageEnv(idOf(SWITCH), { fs: switchFsDenying(22) }),
        [SWITCH_DEEP.host.ip],
        new Map(),
      ),
    );

    expect(denied.text).toContain('Host is up.');
    expect(denied.text).not.toContain('22/tcp');

    // env.fs is the journal-replayed switch tree, so deleting the `deny 22` line (here:
    // an acl.conf that no longer lists it) re-opens the port on the next pivot scan.
    const opened = await drain(
      await nmap.execute(
        vantageEnv(idOf(SWITCH), { fs: switchFsDenying(8080) }),
        [SWITCH_DEEP.host.ip],
        new Map(),
      ),
    );

    expect(opened.text).toContain('22/tcp   open  ssh');
  });

  it('leaves no deep-layer trace — the pivot scan does not record a kern.log line', async () => {
    const record = vi.fn(async () => undefined);

    await drain(await nmap.execute(vantageEnv(idOf(INNER), { record }), [DEEP.host.ip], new Map()));

    expect(record).not.toHaveBeenCalled();
  });
});

/**
 * Chain pivot to Layer 3: once the player reaches the L2 CHILD GATEWAY (the door
 * discovered in 5b.4a, entered via a NAT forward on the inner router), the session
 * sits on that deep gateway — and the layer behind IT becomes scannable the same way
 * the inner router's L2 was. The deep layer is keyed by the fronting gateway's
 * machine_id, so the child gateway fronts its own L3 segment; that L3 is TERMINAL
 * (no further child), the bound that keeps the chain finite. From any shallower
 * vantage the L3 /24 is out of range — strictly one layer down per hop.
 */
describe('nmap — chain pivot to L3 from a deep child gateway (5b.4b)', () => {
  const ESSID = 'BEAN-THERE-WIFI';
  const lan = generateHomeLan(PUBKEY, ESSID);
  const octetOf = (host: LanHost): number => Number(host.ip.split('.')[3]);
  const findHost = (predicate: (host: LanHost) => boolean): LanHost => {
    const host = lan.hosts.find(predicate);
    if (host === undefined) throw new Error('host not found on golden LAN');
    return host;
  };

  const INNER = findHost((host) => host.kind === 'router' && octetOf(host) !== 1);
  const INNER_ID = machineIdForLanHost(INNER, PUBKEY, ESSID);

  // L2 behind the inner router, and the child gateway (the chain door) it hangs.
  const L2 = generateDeepLayer(PUBKEY, ESSID, { machineId: INNER_ID, kind: 'router' });
  const CHILD = L2.childGateway;
  if (CHILD === null) throw new Error('the inner router deep layer hangs no child gateway');
  const CHILD_ID = computeDeepGatewayId(PUBKEY, INNER_ID, octetOf(CHILD));

  // L3 hangs behind the child gateway, keyed by ITS id, and is TERMINAL (no L4 child).
  const L3 = generateDeepLayer(
    PUBKEY,
    ESSID,
    { machineId: CHILD_ID, kind: 'router' },
    { hangsChild: false },
  );

  const vantageEnv = (machineId: string) =>
    mockCommandEnv({
      identity: mockIdentity({ publicKeyHex: asPlayerKeyHex(PUBKEY) }),
      network: mockNetworkViewFromConnectivity(onlineConnectivity(ESSID)),
      session: mockSession({ machineId: asMachineId(machineId) }),
    });

  it('lists the L3 terminal NPC — and nothing deeper — when the shell is on the L2 child gateway', async () => {
    const { text, exitCode } = await drain(
      await nmap.execute(vantageEnv(CHILD_ID), [`${L3.subnet}.1-254`], new Map()),
    );

    expect(exitCode).toBe(0);
    expect(text).toContain(L3.host.ip);
    expect(text).toContain(L3.host.hostname);
    // Terminal: exactly one host (the NPC). A second router here would mean the chain
    // failed to stop — the depth bound is what makes this "1 hosts up".
    expect(text).toContain('Nmap done — 1 hosts up');
  });

  it('scans the L3 terminal NPC directly on :22 from the child-gateway vantage', async () => {
    const { text, exitCode } = await drain(
      await nmap.execute(vantageEnv(CHILD_ID), [L3.host.ip], new Map()),
    );

    expect(exitCode).toBe(0);
    expect(text).toContain(`Nmap scan report for ${L3.host.hostname} (${L3.host.ip})`);
    expect(text).toContain('Host is up.');
    expect(text).toContain('22/tcp   open  ssh');
    expect(text).toContain('Nmap done — 1 host up');
  });

  it('keeps the L3 /24 out of range from the L1 inner-gateway vantage (one layer down per hop)', async () => {
    // From the inner gateway you scan L2, not L3 — L3 sits on a different /24, so it is
    // out of range until you stand on the child gateway.
    const result = await nmap.execute(vantageEnv(INNER_ID), [L3.host.ip], new Map());
    if (result.kind !== 'sync') throw new Error('expected sync result');

    expect(result.exitCode).toBe(1);
    expect(result.lines[0]?.content).toContain('out of range');
  });

  it('keeps the L3 /24 out of range from home (no pivot vantage)', async () => {
    const result = await nmap.execute(
      mockCommandEnv({
        identity: mockIdentity({ publicKeyHex: asPlayerKeyHex(PUBKEY) }),
        network: mockNetworkViewFromConnectivity(onlineConnectivity(ESSID)),
      }),
      [L3.host.ip],
      new Map(),
    );
    if (result.kind !== 'sync') throw new Error('expected sync result');

    expect(result.exitCode).toBe(1);
    expect(result.lines[0]?.content).toContain('out of range');
  });
});

/**
 * Variable network depth: the chain length is seeded per home (`seedNetworkDepth`),
 * and a gateway at chain position P fronts a child-bearing layer only while P < depth.
 * So a shallow (depth-1) home's inner router fronts a single terminal layer, while a
 * deep (depth-3) home runs two nested child gateways — and a pivot scan reveals exactly
 * the layer the vantage's seeded position dictates, recovered by walking the chain.
 */
describe('nmap — variable network depth (5b.4c-i)', () => {
  const ESSID = 'BEAN-THERE-WIFI';
  const octetOf = (host: LanHost): number => Number(host.ip.split('.')[3]);

  // Fixture keys captured from `seedNetworkDepth` for this essid: an all-zero key seeds
  // a depth-1 home, `03` repeated seeds a depth-3 home whose WHOLE gateway chain is
  // routers — every layer hangs a router child, so the chain runs three gateways deep (a
  // switch would cap it short). The canonical 'a'×64 is depth 2, exercised by the 5b.2 /
  // 5b.4b suites above.
  const DEPTH1_KEY = '0'.repeat(64);
  const DEPTH3_KEY = '03'.repeat(32);

  const innerRouterOf = (key: string): LanHost => {
    const host = generateHomeLan(key, ESSID).hosts.find(
      (candidate) => candidate.kind === 'router' && octetOf(candidate) !== 1,
    );
    if (host === undefined) throw new Error('no inner router on the generated LAN');
    return host;
  };

  const vantageEnv = (key: string, machineId: string) =>
    mockCommandEnv({
      identity: mockIdentity({ publicKeyHex: asPlayerKeyHex(key) }),
      network: mockNetworkViewFromConnectivity(onlineConnectivity(ESSID)),
      session: mockSession({ machineId: asMachineId(machineId) }),
    });

  it('depth-1 home: the inner router fronts a TERMINAL layer — pivot-scan lists only the NPC, no child gateway', async () => {
    const inner = innerRouterOf(DEPTH1_KEY);
    const innerId = machineIdForLanHost(inner, DEPTH1_KEY, ESSID);
    const front = { machineId: innerId, kind: 'router' as const };
    // The NPC is depth-independent; the child gateway a depth-≥2 home WOULD hang must be
    // absent from a depth-1 scan — the layer stops here.
    const terminal = generateDeepLayer(DEPTH1_KEY, ESSID, front, { hangsChild: false });
    const wouldBeChild = generateDeepLayer(DEPTH1_KEY, ESSID, front, { hangsChild: true }).childGateway;
    if (wouldBeChild === null) throw new Error('expected a would-be child gateway to assert absence of');

    const { text, exitCode } = await drain(
      await nmap.execute(vantageEnv(DEPTH1_KEY, innerId), [`${terminal.subnet}.1-254`], new Map()),
    );

    expect(exitCode).toBe(0);
    expect(text).toContain(terminal.host.ip);
    expect(text).toContain('Nmap done — 1 hosts up');
    expect(text).not.toContain(wouldBeChild.ip);
  });

  it('depth-3 home: from the L2 child gateway, pivot-scan lists the L3 NPC AND a deeper L3 child gateway', async () => {
    const inner = innerRouterOf(DEPTH3_KEY);
    const innerId = machineIdForLanHost(inner, DEPTH3_KEY, ESSID);
    const l2 = generateDeepLayer(DEPTH3_KEY, ESSID, { machineId: innerId, kind: 'router' });
    const l2child = l2.childGateway;
    if (l2child === null) throw new Error('a depth-3 home must hang an L2 child gateway');
    const l2childId = computeDeepGatewayId(DEPTH3_KEY, innerId, octetOf(l2child));
    const l3 = generateDeepLayer(DEPTH3_KEY, ESSID, { machineId: l2childId, kind: 'router' });
    const l3child = l3.childGateway;
    if (l3child === null) throw new Error('a depth-3 home must hang an L3 child gateway behind the L2 child');

    const { text, exitCode } = await drain(
      await nmap.execute(vantageEnv(DEPTH3_KEY, l2childId), [`${l3.subnet}.1-254`], new Map()),
    );

    expect(exitCode).toBe(0);
    expect(text).toContain(l3.host.ip);
    expect(text).toContain(l3child.ip);
    expect(text).toContain('Nmap done — 2 hosts up');
  });

  it('depth-3 home: the L3 child gateway (position 3) fronts a TERMINAL L4 — the chain walk recovers position 3', async () => {
    const inner = innerRouterOf(DEPTH3_KEY);
    const innerId = machineIdForLanHost(inner, DEPTH3_KEY, ESSID);
    const l2 = generateDeepLayer(DEPTH3_KEY, ESSID, { machineId: innerId, kind: 'router' });
    const l2child = l2.childGateway;
    if (l2child === null) throw new Error('a depth-3 home must hang an L2 child gateway');
    const l2childId = computeDeepGatewayId(DEPTH3_KEY, innerId, octetOf(l2child));
    const l3 = generateDeepLayer(DEPTH3_KEY, ESSID, { machineId: l2childId, kind: 'router' });
    const l3child = l3.childGateway;
    if (l3child === null) throw new Error('a depth-3 home must hang an L3 child gateway');
    const l3childId = computeDeepGatewayId(DEPTH3_KEY, l2childId, octetOf(l3child));
    const front = { machineId: l3childId, kind: 'router' as const };
    const l4 = generateDeepLayer(DEPTH3_KEY, ESSID, front, { hangsChild: false });
    const wouldBeL4Child = generateDeepLayer(DEPTH3_KEY, ESSID, front, { hangsChild: true }).childGateway;
    if (wouldBeL4Child === null) throw new Error('expected a would-be L4 child gateway to assert absence of');

    const { text, exitCode } = await drain(
      await nmap.execute(vantageEnv(DEPTH3_KEY, l3childId), [`${l4.subnet}.1-254`], new Map()),
    );

    expect(exitCode).toBe(0);
    expect(text).toContain(l4.host.ip);
    expect(text).toContain('Nmap done — 1 hosts up');
    expect(text).not.toContain(wouldBeL4Child.ip);
  });
});

/**
 * A deep gateway seeded as a SWITCH (5b.4d) is a chain leaf: it forwards nothing but
 * fronts its own deep /24. Rooted through a forward on its parent, it becomes a pivot
 * vantage like any gateway — but, being a switch, it ACL-filters its downstream. A port
 * its live /etc/switch/acl.conf denies is absent from the pivot scan, and deleting the
 * deny line re-opens it. Same mechanic as the L1 switch (5b.3b), one layer deeper —
 * proving the chain walk resolves a DEEP switch as a switch vantage, not a router.
 */
describe('nmap — pivot from a deep SWITCH child gateway, ACL-filtered (5b.4d)', () => {
  // '02'×32 seeds a depth-3 home whose inner router's first deep child is a SWITCH (a
  // chain leaf), so the switch sits one layer down — reached + rooted through a forward.
  const KEY = '02'.repeat(32);
  const ESSID = 'BEAN-THERE-WIFI';
  const octetOf = (host: LanHost): number => Number(host.ip.split('.')[3]);

  const inner = generateHomeLan(KEY, ESSID).hosts.find(
    (host) => host.kind === 'router' && octetOf(host) !== 1,
  );
  if (inner === undefined) throw new Error('no inner router on the deep-switch LAN');
  const INNER_ID = machineIdForLanHost(inner, KEY, ESSID);
  const switchChild = generateDeepLayer(
    KEY,
    ESSID,
    { machineId: INNER_ID, kind: 'router' },
    { hangsChild: true },
  ).childGateway;
  if (switchChild === null || switchChild.kind !== 'switch') {
    throw new Error('the inner router hangs no switch child');
  }
  const SWITCH_ID = computeDeepGatewayId(KEY, INNER_ID, octetOf(switchChild));
  // The deep layer the switch itself fronts — its own /24, keyed by the switch's id.
  const SWITCH_DEEP = generateDeepLayer(KEY, ESSID, { machineId: SWITCH_ID, kind: 'switch' });

  const vantageEnv = (machineId: string, fs?: Directory) =>
    mockCommandEnv({
      identity: mockIdentity({ publicKeyHex: asPlayerKeyHex(KEY) }),
      network: mockNetworkViewFromConnectivity(onlineConnectivity(ESSID)),
      session: mockSession({ machineId: asMachineId(machineId) }),
      ...(fs ? { fs: mockFsViewFromTree(fs) } : {}),
    });

  const switchFsDenying = (...ports: readonly number[]): Directory =>
    buildDirectory({
      etc: buildDirectory({
        switch: buildDirectory({
          'acl.conf': buildFile(ports.map((port) => `deny ${port}`).join('\n')),
        }),
      }),
    });

  it('pivots from the deep switch onto its OWN deep /24 (a reachable NPC on :22)', async () => {
    const { text, exitCode } = await drain(
      await nmap.execute(vantageEnv(SWITCH_ID), [SWITCH_DEEP.host.ip], new Map()),
    );

    expect(exitCode).toBe(0);
    expect(text).toContain(
      `Nmap scan report for ${SWITCH_DEEP.host.hostname} (${SWITCH_DEEP.host.ip})`,
    );
    expect(text).toContain('22/tcp   open  ssh');
    expect(text).toContain('Nmap done — 1 host up');
  });

  it('hides a deep port the switch ACL denies, and re-opens it when the deny line is gone', async () => {
    const denied = await drain(
      await nmap.execute(
        vantageEnv(SWITCH_ID, switchFsDenying(22)),
        [SWITCH_DEEP.host.ip],
        new Map(),
      ),
    );

    expect(denied.text).toContain('Host is up.');
    expect(denied.text).not.toContain('22/tcp');

    // env.fs is the journal-replayed switch tree, so an acl.conf that no longer denies 22
    // (the player deleted the line via nano) re-opens the port on the next pivot scan.
    const opened = await drain(
      await nmap.execute(
        vantageEnv(SWITCH_ID, switchFsDenying(8080)),
        [SWITCH_DEEP.host.ip],
        new Map(),
      ),
    );

    expect(opened.text).toContain('22/tcp   open  ssh');
  });
});
