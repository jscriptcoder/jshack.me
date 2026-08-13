import { describe, expect, it } from 'vitest';
import { fetchWebPage } from './webPage';
import type { AccessLogFetch } from './types';
import { applyPatches, type Patch } from '../filesystem/applyPatches';
import type { Directory } from '../filesystem/types';
import { buildWorkstationBaseFs } from '../generation/workstationFs';
import { formatPidfileContent, readOpenPorts } from '../services/pidfile';
import { SERVICE_CATALOG } from '../services/serviceCatalog';
import {
  buildColdStartConnectivity,
  connectedWlan0,
  type ConnectedWlan0,
} from '../network/interfaces';
import { assignHomeNetwork } from '../network/homeNetwork';
import { generateHomeLan, type LanHost } from '../generation/generateHomeLan';
import { buildRemoteHostFs } from '../generation/remoteHostFs';
import { HTTP_DEFAULT_PORT, parseHttpUrl } from '../network/http';
import { mockNetworkViewFromConnectivity } from '../../test/factories/commandEnv';

/**
 * One page, fetched — the request behind `lynx <url>` and behind every link
 * followed inside the browser it opens.
 *
 * The outcomes are three rather than two because the reader treats them
 * differently, and the target's log agrees with that split: a page and a 404 both
 * mean the box ANSWERED, so both leave a line behind, while a host that was never
 * reached leaves none. A browser can render the first two and has nowhere to go on
 * the third.
 */

const PUBKEY = 'a'.repeat(64);
const ESSID = 'BEAN-THERE-WIFI';
const OWN_IP = assignHomeNetwork(PUBKEY, ESSID).localIp;

const onlineWlan0 = (): ConnectedWlan0 => {
  const cold = buildColdStartConnectivity(PUBKEY);
  const wlan0 = cold.interfaces.get('wlan0');
  if (wlan0 === undefined || wlan0.kind !== 'wireless') throw new Error('no wlan0 in cold start');
  const connected = {
    ...wlan0,
    association: { essid: ESSID, bssid: 'AA:BB:CC:DD:EE:FF' },
    ipv4: OWN_IP,
  };
  const reachable = connectedWlan0(
    mockNetworkViewFromConnectivity({
      interfaces: new Map(cold.interfaces).set('wlan0', connected),
    }),
  );
  if (reachable === null) throw new Error('expected a connected wlan0');
  return reachable;
};

const ownBox = (...patches: readonly Patch[]): Directory =>
  applyPatches(
    buildWorkstationBaseFs(PUBKEY, {
      machineName: 'workstation',
      username: 'alice',
      rootPassword: 'hunter2',
    }),
    patches,
  );

const WEB_SERVER_RUNNING: Patch = {
  path: '/var/run/nginx.pid',
  content: formatPidfileContent(SERVICE_CATALOG.http, HTTP_DEFAULT_PORT),
  owner: 'root',
};

const published = (path: string, content: string): Patch => ({
  path: `/var/www/html/${path}`,
  content,
  owner: 'root',
});

/** A generated NPC host on the LAN serving the web, with the port it listens on. */
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

/** An address on the player's own subnet that no generated host occupies. */
const unoccupiedIp = (): string => {
  const lan = generateHomeLan(ESSID);
  const taken = new Set([...lan.hosts.map((host) => host.ip), OWN_IP]);
  const free = Array.from({ length: 253 }, (_unused, index) => `${lan.subnet}.${index + 2}`).find(
    (ip) => !taken.has(ip),
  );
  if (free === undefined) throw new Error('expected a free address on the subnet');
  return free;
};

const fetchFrom = (tree: Directory, rawUrl: string) => {
  const url = parseHttpUrl(rawUrl);
  if (url === null) throw new Error(`test asked for an unparseable url: ${rawUrl}`);
  const logged: AccessLogFetch[] = [];
  const result = fetchWebPage({
    root: tree,
    program: 'lynx',
    url,
    wlan0: onlineWlan0(),
    appendAccessLog: async (fetched) => {
      logged.push(fetched);
    },
  });
  return { result, logged };
};

describe('fetching one page', () => {
  it('hands back what the box publishes at that path', () => {
    const tree = ownBox(WEB_SERVER_RUNNING, published('index.html', '<h1>mine</h1>'));

    expect(fetchFrom(tree, `http://${OWN_IP}/index.html`).result).toEqual({
      kind: 'page',
      content: '<h1>mine</h1>',
    });
  });

  it('serves a directory its index, so a bare address is a page', () => {
    const tree = ownBox(WEB_SERVER_RUNNING, published('index.html', '<h1>mine</h1>'));

    expect(fetchFrom(tree, `http://${OWN_IP}/`).result).toEqual({
      kind: 'page',
      content: '<h1>mine</h1>',
    });
  });

  it('records exactly one line on the box that answered, naming what was asked for', () => {
    const tree = ownBox(WEB_SERVER_RUNNING, published('notes.html', '<h1>notes</h1>'));

    const { logged } = fetchFrom(tree, `http://${OWN_IP}/notes.html`);

    expect(logged).toEqual([
      { essid: ESSID, target: OWN_IP, port: HTTP_DEFAULT_PORT, paths: ['/notes.html'], sourceIp: OWN_IP },
    ]);
  });

  // A 404 is an answer. The box was reached, it looked, and it said no — which is
  // exactly the kind of line a defender reading their log wants to see.
  it('reports a path the box does not publish as not found, and logs the miss anyway', () => {
    const tree = ownBox(WEB_SERVER_RUNNING, published('index.html', '<h1>mine</h1>'));

    const { result, logged } = fetchFrom(tree, `http://${OWN_IP}/nothing-here.html`);

    expect(result).toEqual({ kind: 'not_found' });
    expect(logged.map((line) => line.paths)).toEqual([['/nothing-here.html']]);
  });

  it('refuses a path that climbs out of what the server publishes, and calls it not found', () => {
    const tree = ownBox(WEB_SERVER_RUNNING, published('index.html', '<h1>mine</h1>'));

    // Naming the file rather than the traversal: /etc/passwd is real and readable on
    // every box, so what stops this is the document root and nothing else.
    expect(fetchFrom(tree, `http://${OWN_IP}/../../../etc/passwd`).result).toEqual({
      kind: 'not_found',
    });
  });

  it('leaves no trace on a host that never answered', () => {
    const { result, logged } = fetchFrom(ownBox(), `http://${unoccupiedIp()}/index.html`);

    expect(result.kind).toBe('unreachable');
    expect(logged).toEqual([]);
  });

  it('leaves no trace on a box that is there but serves no web', () => {
    // The player's own box, online but running nothing: reached as an address,
    // refused as a web server.
    const { result, logged } = fetchFrom(ownBox(), `http://${OWN_IP}/index.html`);

    expect(result.kind).toBe('unreachable');
    expect(logged).toEqual([]);
  });

  it('names the program in the failure, since every web tool shares this fetch', () => {
    const { result } = fetchFrom(ownBox(), `http://${unoccupiedIp()}/index.html`);

    if (result.kind !== 'unreachable') throw new Error('expected an unreachable host');
    expect(result.failure.lines.map((line) => line.content).join('\n')).toContain(
      'lynx: (6) Could not resolve host',
    );
  });

  it('reads a generated host on the LAN the same way it reads the player own box', () => {
    const { host, port } = webHostOnLan();

    const { result, logged } = fetchFrom(ownBox(), `http://${host.ip}:${port}/index.html`);

    expect(result.kind).toBe('page');
    expect(logged.map((line) => line.target)).toEqual([host.ip]);
  });
});
