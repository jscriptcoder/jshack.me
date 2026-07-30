import { describe, expect, it } from 'vitest';
import { curl } from './curl';
import type { CommandResult } from './types';
import {
  mockCommandEnv,
  mockIdentity,
  mockNetworkView,
  mockNetworkViewFromConnectivity,
} from '../../test/factories/commandEnv';
import { buildColdStartConnectivity, type ConnectivityState } from '../network/interfaces';
import { assignHomeNetwork } from '../network/homeNetwork';
import { generateHomeLan, type LanHost } from '../generation/generateHomeLan';
import { buildRemoteHostFs } from '../generation/remoteHostFs';
import { readOpenPorts } from '../services/pidfile';
import { createFsView } from '../filesystem/fsView';
import { HTTP_DEFAULT_PORT } from '../network/http';
import { asAbsPath, asPlayerKeyHex } from '../types';

/**
 * `curl <url>` fetches over HTTP — the one door that opens without a credential.
 * On the player's own LAN it resolves the target host, checks something is
 * actually listening on the requested port, and returns the file beneath that
 * host's `/var/www/html`. Nothing outside the web root is reachable, however the
 * request path is written.
 */

const PUBKEY = 'a'.repeat(64);
const ESSID = 'BEAN-THERE-WIFI';

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

const onlineEnv = () =>
  mockCommandEnv({
    identity: mockIdentity({ publicKeyHex: asPlayerKeyHex(PUBKEY) }),
    network: mockNetworkViewFromConnectivity(onlineConnectivity(ESSID)),
  });

type Drained = {
  readonly text: string;
  readonly exitCode: number;
  /** The line KINDS, so a test can tell a failure that is styled as an error from
   *  one that quietly prints as ordinary output. */
  readonly kinds: readonly string[];
};

const drain = async (result: CommandResult): Promise<Drained> => {
  if (result.kind === 'sync') {
    return {
      text: result.lines.map((line) => line.content).join('\n'),
      exitCode: result.exitCode,
      kinds: result.lines.map((line) => line.kind),
    };
  }
  if (result.kind !== 'async') throw new Error('expected sync or async result');
  const lines = [];
  for await (const line of result.lines) lines.push(line);
  return {
    text: lines.map((line) => line.content).join('\n'),
    exitCode: await result.exitCode(),
    kinds: lines.map((line) => line.kind),
  };
};

/** Run `curl` with `args` against an online player, collecting whatever it emits. */
const run = async (...args: readonly string[]): Promise<Drained> =>
  drain(await curl.execute(onlineEnv(), args, new Map()));

/** A generated NPC host on the LAN that serves the web, with the port it listens
 *  on — deterministic, so the test names a real target rather than assuming one. */
const webHostOnLan = (): { readonly host: LanHost; readonly port: number } => {
  for (const host of generateHomeLan(ESSID).hosts) {
    if (host.kind !== 'machine') continue;
    const web = readOpenPorts(buildRemoteHostFs(ESSID, host)).find(
      (entry) => entry.service === 'http',
    );
    if (web !== undefined) return { host, port: web.port };
  }
  throw new Error('expected a generated web host on the LAN');
};

/** A generated NPC host on the LAN running ssh, with the port it listens on — a
 *  reachable host whose open port is NOT a web server. */
const sshHostOnLan = (): { readonly host: LanHost; readonly port: number } => {
  for (const host of generateHomeLan(ESSID).hosts) {
    if (host.kind !== 'machine') continue;
    const ports = readOpenPorts(buildRemoteHostFs(ESSID, host));
    const ssh = ports.find((entry) => entry.service === 'ssh');
    const web = ports.find((entry) => entry.service === 'http');
    if (ssh !== undefined && web === undefined) return { host, port: ssh.port };
  }
  throw new Error('expected a generated ssh-but-not-web host on the LAN');
};

/** A generated web host listening on the DEFAULT port, and one on an alternate —
 *  so the tests can tell "the URL's port was honoured" from "any port would do". */
const webHostOnPort = (wanted: (port: number) => boolean): LanHost => {
  for (const host of generateHomeLan(ESSID).hosts) {
    if (host.kind !== 'machine') continue;
    const web = readOpenPorts(buildRemoteHostFs(ESSID, host)).find(
      (entry) => entry.service === 'http',
    );
    if (web !== undefined && wanted(web.port)) return host;
  }
  throw new Error('expected a generated web host on a matching port');
};

/** The page a generated host actually serves — the expected fetch body. */
const servedPage = (host: LanHost): string => {
  const read = createFsView(buildRemoteHostFs(ESSID, host), { userType: 'root' }).read(
    asAbsPath('/var/www/html/index.html'),
  );
  if (!read.ok) throw new Error('expected a served page');
  return read.content;
};

/** An address on the player's own subnet that no host occupies. */
const unoccupiedIp = (): string => {
  const lan = generateHomeLan(ESSID);
  const taken = new Set(lan.hosts.map((host) => host.ip));
  const free = Array.from({ length: 253 }, (_unused, index) => `${lan.subnet}.${index + 2}`).find(
    (ip) => !taken.has(ip),
  );
  if (free === undefined) throw new Error('expected a free address on the subnet');
  return free;
};

describe('curl', () => {
  it('returns the page a host on the LAN serves', async () => {
    const { host, port } = webHostOnLan();

    const { text, exitCode } = await run(`http://${host.ip}:${port}`);

    expect(exitCode).toBe(0);
    expect(text).toContain('<html>');
    expect(text).toContain(host.hostname); // the page names the host serving it
  });

  describe('nothing outside the document root is reachable', () => {
    it('refuses to climb out of the web root, however the path is written', async () => {
      const { host, port } = webHostOnLan();
      // Every one of these resolves to a real, readable file on the target — the
      // box has an /etc/passwd, and the fetch reads as the server's own account —
      // so only the document root confines them. A leak here would hand over
      // credentials to a caller with no session on the box at all.
      const escapes = [
        '/../../etc/passwd',
        '/../../../etc/passwd',
        '/..%2f..%2fetc/passwd',
        '/./../etc/passwd',
      ];

      for (const escape of escapes) {
        const { text, exitCode } = await run(`http://${host.ip}:${port}${escape}`);

        expect(exitCode).not.toBe(0);
        expect(text).not.toContain('root:');
        expect(text).not.toContain('/bin/bash');
      }
    });

    it('returns 404 for a path the web root does not hold', async () => {
      const { host, port } = webHostOnLan();

      const { text, exitCode } = await run(`http://${host.ip}:${port}/nothing-here.html`);

      expect(exitCode).not.toBe(0);
      expect(text).toContain('404');
    });
  });

  describe('reaching the target', () => {
    it('refuses the connection when nothing listens on the port', async () => {
      const { host } = webHostOnLan();

      const { text, exitCode } = await run(`http://${host.ip}:9999`);

      expect(exitCode).not.toBe(0);
      expect(text).toContain('Connection refused');
    });

    it('refuses the connection when the port serves something other than a web server', async () => {
      // A reachable host with an open port is not a web server: pointing curl at
      // sshd must fail rather than serving a page the host does not publish.
      const { host, port } = sshHostOnLan();

      const { text, exitCode } = await run(`http://${host.ip}:${port}`);

      expect(exitCode).not.toBe(0);
      expect(text).toContain('Connection refused');
    });

    it('serves the web port of a host that runs ssh as well', async () => {
      // A box with several services must serve the RIGHT one: it is enough that the
      // web port is among what is open, not that everything open is a web server.
      const both = generateHomeLan(ESSID).hosts.find((host) => {
        if (host.kind !== 'machine') return false;
        const ports = readOpenPorts(buildRemoteHostFs(ESSID, host));
        return (
          ports.some((entry) => entry.service === 'http') &&
          ports.some((entry) => entry.service === 'ssh')
        );
      });
      if (both === undefined) throw new Error('expected a host running both ssh and http');
      const web = readOpenPorts(buildRemoteHostFs(ESSID, both)).find(
        (entry) => entry.service === 'http',
      );
      if (web === undefined) throw new Error('expected a web port');

      const { text, exitCode } = await run(`http://${both.ip}:${web.port}`);

      expect(exitCode).toBe(0);
      expect(text).toContain('<html>');
    });

    it('cannot resolve an address no host on the LAN holds', async () => {
      const { text, exitCode } = await run(`http://${unoccupiedIp()}`);

      expect(exitCode).not.toBe(0);
      expect(text).toContain('Could not resolve host');
    });
  });

  describe('the URL names the port', () => {
    it('reaches a host serving on the default port when the URL omits one', async () => {
      const host = webHostOnPort((port) => port === HTTP_DEFAULT_PORT);

      const { text, exitCode } = await run(`http://${host.ip}`);

      expect(exitCode).toBe(0);
      expect(text).toContain('<html>');
    });

    it('does not reach a host serving on a non-standard port when the URL omits one', async () => {
      // The port in the URL has to matter: a box publishing on :8080 is not
      // published on :80, and finding that port is part of the recon.
      const host = webHostOnPort((port) => port !== HTTP_DEFAULT_PORT);

      const { text, exitCode } = await run(`http://${host.ip}`);

      expect(exitCode).not.toBe(0);
      expect(text).toContain('Connection refused');
    });
  });

  describe('response headers', () => {
    it('prints the status line and headers before the body under -i', async () => {
      const { host, port } = webHostOnLan();

      const { text, exitCode } = await drain(
        await curl.execute(onlineEnv(), [`http://${host.ip}:${port}`], new Map([['-i', true]])),
      );

      // The exact wire order: status line, headers, ONE blank line, then the body.
      // The blank line is what separates headers from content — without it a client
      // would read the first line of HTML as another header.
      const page = servedPage(host);
      expect(exitCode).toBe(0);
      expect(text.split('\n').slice(0, 4)).toEqual([
        'HTTP/1.1 200 OK',
        'Server: nginx',
        `Content-Length: ${page.length}`,
        '',
      ]);
      expect(text).toContain(page.split('\n')[0]);
    });

    it('prints the body alone without -i', async () => {
      const { host, port } = webHostOnLan();

      const { text, kinds } = await run(`http://${host.ip}:${port}`);

      expect(text).not.toContain('HTTP/1.1');
      expect(text).not.toContain('Content-Length');
      expect(text).toBe(servedPage(host));
      // A fetched page is ordinary output, not error-styled.
      expect(new Set(kinds)).toEqual(new Set(['text']));
    });
  });

  describe('rejects what it cannot fetch', () => {
    it('reports usage when given no URL', async () => {
      const { text, exitCode, kinds } = await run();

      expect(exitCode).toBe(1);
      expect(text).toContain('usage');
      expect(kinds).toEqual(['error']); // styled as a failure, not printed as output
    });

    it('rejects a URL it cannot parse, naming what it refused', async () => {
      for (const bad of ['not-a-url', 'http://', 'ftp://192.168.1.5', 'http://host:0']) {
        const { text, exitCode, kinds } = await run(bad);

        expect(exitCode).toBe(1);
        // Echoing the rejected URL is the whole value of the message — a bare
        // "rejected" leaves the player guessing which part was wrong.
        expect(text).toContain(bad);
        expect(kinds).toEqual(['error']);
      }
    });
  });

  describe('needs a network to reach anything over', () => {
    const fetchWith = async (network: Parameters<typeof mockCommandEnv>[0]) =>
      drain(
        await curl.execute(
          mockCommandEnv({
            identity: mockIdentity({ publicKeyHex: asPlayerKeyHex(PUBKEY) }),
            ...network,
          }),
          ['http://192.168.1.5'],
          new Map(),
        ),
      );

    it('refuses while offline even with a fully associated, addressed wlan0', async () => {
      // Force offline while presenting an interface that would otherwise pass every
      // later check: only the isOnline() gate can reject this, which is what proves
      // the gate is load-bearing rather than shadowed by the wlan0 checks below.
      const conn = onlineConnectivity(ESSID);

      const { text, exitCode } = await fetchWith({
        network: mockNetworkView({
          isOnline: () => false,
          interfaces: () => [...conn.interfaces.values()],
        }),
      });

      expect(exitCode).toBe(1);
      expect(text).toContain('unreachable');
    });

    it('refuses when wlan0 holds an address but is associated with nothing', async () => {
      // The mirror of the case below: an address without an association is still no
      // network, and each half of that pair has to be checked on its own.
      const cold = buildColdStartConnectivity(PUBKEY);
      const wlan0 = cold.interfaces.get('wlan0');
      if (wlan0 === undefined || wlan0.kind !== 'wireless') throw new Error('no wlan0');
      const addressedOnly = { ...wlan0, association: null, ipv4: '192.168.29.7' };

      const { text, exitCode } = await fetchWith({
        network: mockNetworkViewFromConnectivity({
          interfaces: new Map(cold.interfaces).set('wlan0', addressedOnly),
        }),
      });

      expect(exitCode).toBe(1);
      expect(text).toContain('unreachable');
    });

    it('refuses when online but wlan0 is not associated with a network', async () => {
      // Associated is not the same as online, and neither implies the other: an
      // unassociated interface has no LAN to resolve a host against.
      const cold = buildColdStartConnectivity(PUBKEY);

      const { text, exitCode } = await fetchWith({
        network: mockNetworkViewFromConnectivity(cold),
      });

      expect(exitCode).toBe(1);
      expect(text).toContain('unreachable');
    });

    it('refuses when wlan0 is associated but holds no address', async () => {
      // An address is a server-issued lease. Associated without one means the join
      // never completed, so there is no subnet to resolve against.
      const cold = buildColdStartConnectivity(PUBKEY);
      const wlan0 = cold.interfaces.get('wlan0');
      if (wlan0 === undefined || wlan0.kind !== 'wireless') throw new Error('no wlan0');
      const associatedOnly = {
        ...wlan0,
        association: { essid: ESSID, bssid: 'AA:BB:CC:DD:EE:FF' },
        ipv4: null,
      };

      const { text, exitCode } = await fetchWith({
        network: mockNetworkViewFromConnectivity({
          interfaces: new Map(cold.interfaces).set('wlan0', associatedOnly),
        }),
      });

      expect(exitCode).toBe(1);
      expect(text).toContain('unreachable');
    });

    it('refuses when there is no wlan0 at all', async () => {
      const { text, exitCode } = await fetchWith({
        network: mockNetworkView({ isOnline: () => true, interfaces: () => [] }),
      });

      expect(exitCode).toBe(1);
      expect(text).toContain('unreachable');
    });
  });
});
