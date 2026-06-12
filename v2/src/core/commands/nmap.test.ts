import { describe, expect, it, vi } from 'vitest';
import { nmap } from './nmap';
import { commandRegistry } from './registry';
import type { CommandResult } from './types';
import {
  mockCommandEnv,
  mockFsViewFromTree,
  mockIdentity,
  mockNetworkView,
  mockNetworkViewFromConnectivity,
} from '../../test/factories/commandEnv';
import { buildDirectory, buildFile } from '../../test/factories/filesystem';
import { assignHomeNetwork } from '../network/homeNetwork';
import { generateHomeLan, type LanHost } from '../generation/generateHomeLan';
import { buildRemoteHostFs } from '../generation/remoteHostFs';
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
      network: mockNetworkView({ isOnline: () => false, interfaces: () => [...conn.interfaces.values()] }),
    });

    const result = await nmap.execute(env, ['192.168.188.0/24'], new Map());
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

    const result = await nmap.execute(env, ['192.168.188.0/24'], new Map());
    if (result.kind !== 'sync') throw new Error('expected sync result');

    expect(result.exitCode).toBe(1);
    expect(result.lines[0]?.content).toContain('unreachable');
  });

  it('errors when online but wlan0 is not associated with a network', async () => {
    // wlan0 exists but carries no association ⇒ no ESSID ⇒ no LAN to derive.
    const cold = buildColdStartConnectivity(PUBKEY);
    const env = mockCommandEnv({
      identity: mockIdentity({ publicKeyHex: asPlayerKeyHex(PUBKEY) }),
      network: mockNetworkView({ isOnline: () => true, interfaces: () => [...cold.interfaces.values()] }),
    });

    const result = await nmap.execute(env, ['192.168.188.0/24'], new Map());
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
  // BEAN-THERE-WIFI): subnet 192.168.188, hosts at .1 (gateway/router), .25, .70,
  // .154 (self), .209, .245 — every other octet is empty.

  it('scanning the whole range lists every host on the LAN', async () => {
    const { text, exitCode } = await drain(
      await nmap.execute(onlineEnv(), ['192.168.188.0-254'], new Map()),
    );

    expect(exitCode).toBe(0);
    expect(text).toContain('192.168.188.1'); // gateway
    expect(text).toContain('router');
    expect(text).toContain('192.168.188.154'); // self
    expect(text).toContain('iphone-154');
    const lan = generateHomeLan(PUBKEY, 'BEAN-THERE-WIFI');
    expect(text).toContain(`${lan.hosts.length} hosts up`);
  });

  it('a range lists only the hosts whose last octet falls inside it', async () => {
    const { text } = await drain(
      await nmap.execute(onlineEnv(), ['192.168.188.20-80'], new Map()),
    );

    // .25 and .70 are inside [20, 80]; .1, .154, .209, .245 are not.
    expect(text).toContain('192.168.188.25');
    expect(text).toContain('192.168.188.70');
    expect(text).not.toContain('192.168.188.1 '); // gateway (.1) excluded
    expect(text).not.toContain('192.168.188.154');
    expect(text).not.toContain('192.168.188.209');
    expect(text).toContain('2 hosts up');
  });

  it('includes hosts sitting exactly on the range boundaries', async () => {
    // .25 == start and .70 == end must both be included (inclusive bounds).
    const { text } = await drain(
      await nmap.execute(onlineEnv(), ['192.168.188.25-70'], new Map()),
    );

    expect(text).toContain('192.168.188.25');
    expect(text).toContain('192.168.188.70');
    expect(text).toContain('2 hosts up');
  });

  it('includes the gateway when the range covers .1', async () => {
    const { text } = await drain(
      await nmap.execute(onlineEnv(), ['192.168.188.1-30'], new Map()),
    );

    expect(text).toContain('192.168.188.1');
    expect(text).toContain('router');
    expect(text).toContain('192.168.188.25');
    expect(text).not.toContain('192.168.188.70');
    expect(text).toContain('2 hosts up');
  });

  it('reports zero hosts for a valid range with nothing in it', async () => {
    const { text, exitCode } = await drain(
      await nmap.execute(onlineEnv(), ['192.168.188.100-120'], new Map()),
    );

    expect(exitCode).toBe(0);
    expect(text).toContain('0 hosts up');
    expect(text).not.toContain('192.168.188.154');
  });

  it('echoes the scanned range in the banner', async () => {
    const { text } = await drain(
      await nmap.execute(onlineEnv(), ['192.168.188.20-80'], new Map()),
    );

    expect(text).toContain('192.168.188.20-80');
  });

  it('accepts the inclusive upper octet 254', async () => {
    const { exitCode } = await drain(
      await nmap.execute(onlineEnv(), ['192.168.188.1-254'], new Map()),
    );

    expect(exitCode).toBe(0);
  });

  it('rejects a range whose octet exceeds 254', async () => {
    const result = await nmap.execute(onlineEnv(), ['192.168.188.1-255'], new Map());
    if (result.kind !== 'sync') throw new Error('expected sync result');

    expect(result.exitCode).toBe(1);
    expect(result.lines[0]?.content.toLowerCase()).toContain('usage');
  });

  it('rejects a start octet that exceeds 254', async () => {
    const result = await nmap.execute(onlineEnv(), ['192.168.188.255-255'], new Map());
    if (result.kind !== 'sync') throw new Error('expected sync result');

    expect(result.exitCode).toBe(1);
    expect(result.lines[0]?.content.toLowerCase()).toContain('usage');
  });

  it('rejects a range where the start is greater than the end', async () => {
    const result = await nmap.execute(onlineEnv(), ['192.168.188.80-20'], new Map());
    if (result.kind !== 'sync') throw new Error('expected sync result');

    expect(result.exitCode).toBe(1);
    expect(result.lines[0]?.content.toLowerCase()).toContain('usage');
  });

  it('rejects CIDR notation as a usage error', async () => {
    const result = await nmap.execute(onlineEnv(), ['192.168.188.0/24'], new Map());
    if (result.kind !== 'sync') throw new Error('expected sync result');

    expect(result.exitCode).toBe(1);
    expect(result.lines[0]?.content.toLowerCase()).toContain('usage');
  });

  it('reports a single host that is up', async () => {
    const { text, exitCode } = await drain(
      await nmap.execute(onlineEnv(), ['192.168.188.25'], new Map()),
    );

    expect(exitCode).toBe(0);
    expect(text).toContain('Starting Nmap scan — 192.168.188.25');
    expect(text).toContain('Nmap scan report for desktop-25 (192.168.188.25)');
    expect(text).toContain('Host is up.');
    expect(text).toContain('1 host up');
  });

  it('accepts an A-A range, scanning the single octet it covers', async () => {
    // start === end must be a valid range (legacy allows it), not a usage error.
    const { text, exitCode } = await drain(
      await nmap.execute(onlineEnv(), ['192.168.188.25-25'], new Map()),
    );

    expect(exitCode).toBe(0);
    expect(text).toContain('192.168.188.25');
    expect(text).toContain('desktop-25');
    expect(text).toContain('1 hosts up');
  });

  it('accepts the inclusive upper octet 254 for a single IP', async () => {
    // .254 is the last scannable host octet (.255 is broadcast); parsing it is
    // valid even when no host sits there.
    const { text, exitCode } = await drain(
      await nmap.execute(onlineEnv(), ['192.168.188.254'], new Map()),
    );

    expect(exitCode).toBe(0);
    expect(text).toContain('Host seems down.');
  });

  it('reports a single host that is down when no host sits on that octet', async () => {
    const { text, exitCode } = await drain(
      await nmap.execute(onlineEnv(), ['192.168.188.30'], new Map()),
    );

    expect(exitCode).toBe(0);
    expect(text).toContain('Host seems down.');
    expect(text).toContain('0 hosts up');
    expect(text).not.toContain('desktop-25');
  });

  it('rejects a single IP whose octet exceeds 254', async () => {
    const result = await nmap.execute(onlineEnv(), ['192.168.188.255'], new Map());
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
 * for PUBKEY + BEAN-THERE-WIFI is `iphone-154` at 192.168.188.154 (= wlan0.ipv4).
 */
describe('nmap — self-host open ports (slice 1)', () => {
  const SELF_IP = '192.168.188.154';

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
      scan: { record },
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
      scan: { record },
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
