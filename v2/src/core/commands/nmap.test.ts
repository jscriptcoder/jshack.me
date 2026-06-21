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
} from '../../test/factories/commandEnv';
import { buildDirectory, buildFile } from '../../test/factories/filesystem';
import { assignHomeNetwork } from '../network/homeNetwork';
import { generateHomeLan, type LanHost } from '../generation/generateHomeLan';
import { buildRemoteHostFs } from '../generation/remoteHostFs';
import { seedRouterHostname } from '../generation/routerFs';
import type { Directory } from '../filesystem/types';
import { buildColdStartConnectivity, type ConnectivityState } from '../network/interfaces';
import { asPlayerKeyHex } from '../types';

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
  // BEAN-THERE-WIFI): subnet 192.168.29 (ESSID-seeded), hosts at .1 (gateway/router),
  // .25, .70, .188 (self), .209, .245 — every other octet is empty.

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

    // .25 and .70 are inside [20, 80]; .1, .154, .209, .245 are not.
    expect(text).toContain('192.168.29.25');
    expect(text).toContain('192.168.29.70');
    expect(text).not.toContain('192.168.29.1 '); // gateway (.1) excluded
    expect(text).not.toContain('192.168.29.188');
    expect(text).not.toContain('192.168.29.209');
    expect(text).toContain('2 hosts up');
  });

  it('includes hosts sitting exactly on the range boundaries', async () => {
    // .25 == start and .70 == end must both be included (inclusive bounds).
    const { text } = await drain(await nmap.execute(onlineEnv(), ['192.168.29.25-70'], new Map()));

    expect(text).toContain('192.168.29.25');
    expect(text).toContain('192.168.29.70');
    expect(text).toContain('2 hosts up');
  });

  it('includes the gateway when the range covers .1', async () => {
    const { text } = await drain(await nmap.execute(onlineEnv(), ['192.168.29.1-30'], new Map()));

    expect(text).toContain('192.168.29.1');
    expect(text).toContain('router');
    expect(text).toContain('192.168.29.25');
    expect(text).not.toContain('192.168.29.70');
    expect(text).toContain('2 hosts up');
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
      await nmap.execute(onlineEnv(), ['192.168.29.25'], new Map()),
    );

    expect(exitCode).toBe(0);
    expect(text).toContain('Starting Nmap scan — 192.168.29.25');
    expect(text).toContain('Nmap scan report for desktop-25 (192.168.29.25)');
    expect(text).toContain('Host is up.');
    expect(text).toContain('1 host up');
  });

  it('accepts an A-A range, scanning the single octet it covers', async () => {
    // start === end must be a valid range (legacy allows it), not a usage error.
    const { text, exitCode } = await drain(
      await nmap.execute(onlineEnv(), ['192.168.29.25-25'], new Map()),
    );

    expect(exitCode).toBe(0);
    expect(text).toContain('192.168.29.25');
    expect(text).toContain('desktop-25');
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
      await nmap.execute(onlineEnv(), ['192.168.29.30'], new Map()),
    );

    expect(exitCode).toBe(0);
    expect(text).toContain('Host seems down.');
    expect(text).toContain('0 hosts up');
    expect(text).not.toContain('desktop-25');
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
