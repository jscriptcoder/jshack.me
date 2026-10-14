import { describe, expect, it } from 'vitest';
import { fetchWebPage } from './webPage.js';
import type { AccessLogFetch, OccupantFetchParams, OccupantFetchResult } from './types.js';
import { applyPatches, type Patch } from '../filesystem/applyPatches.js';
import type { Directory } from '../filesystem/types.js';
import { buildWorkstationBaseFs } from '../generation/workstationFs.js';
import { formatPidfileContent, readOpenPorts } from '../services/pidfile.js';
import { SERVICE_CATALOG } from '../services/serviceCatalog.js';
import { assignHomeNetwork } from '../network/homeNetwork.js';
import { generateHomeLan, type LanHost } from '../generation/generateHomeLan.js';
import { buildRemoteHostFs } from '../generation/remoteHostFs.js';
import { HTTP_DEFAULT_PORT, parseHttpUrl } from '../network/http.js';
import { lanZoneName } from '../network/resolveName.js';
import { machineIdForLanHost } from '../generation/lanTopology.js';
import { vantageOf, type Vantage } from '../network/vantage.js';
import { asMachineId } from '../types.js';
import { mockNetworkViewFromConnectivity, mockSession } from '../../test/factories/commandEnv.js';
import { buildColdStartConnectivity } from '../network/interfaces.js';

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

/** The player at home on BEAN-THERE-WIFI — the vantage the browser stands at, derived
 *  the way the command derives it, so the test reaches what a typed address would. */
const homeVantage = (): Vantage => {
  const cold = buildColdStartConnectivity(PUBKEY);
  const wlan0 = cold.interfaces.get('wlan0');
  if (wlan0 === undefined || wlan0.kind !== 'wireless') throw new Error('no wlan0 in cold start');
  const connected = {
    ...wlan0,
    association: { essid: ESSID, bssid: 'AA:BB:CC:DD:EE:FF' },
    ipv4: OWN_IP,
  };
  const vantage = vantageOf(
    mockSession({ essid: null }),
    mockNetworkViewFromConnectivity({
      interfaces: new Map(cold.interfaces).set('wlan0', connected),
    }),
  );
  if (vantage === null) throw new Error('expected a home vantage');
  return vantage;
};

/** The box the browser runs on — its own workstation at home. */
const CALLER = asMachineId('own-workstation');

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

/** Nobody else on the WiFi: what the server answers about an address no occupant holds. */
const NOBODY_THERE: OccupantFetchResult = { ok: false, error: 'host_unreachable' };

const fetchFrom = async (
  tree: Directory,
  rawUrl: string,
  occupantAnswer: OccupantFetchResult = NOBODY_THERE,
) => {
  const url = parseHttpUrl(rawUrl);
  if (url === null) throw new Error(`test asked for an unparseable url: ${rawUrl}`);
  const logged: AccessLogFetch[] = [];
  const asked: OccupantFetchParams[] = [];
  const result = await fetchWebPage({
    root: tree,
    program: 'lynx',
    url,
    vantage: homeVantage(),
    callerMachineId: CALLER,
    appendAccessLog: async (fetched) => {
      logged.push(fetched);
    },
    fetchOccupant: async (params) => {
      asked.push(params);
      return occupantAnswer;
    },
  });
  return { result, logged, asked };
};

describe('fetching one page', () => {
  it('hands back what the box publishes at that path', async () => {
    const tree = ownBox(WEB_SERVER_RUNNING, published('index.html', '<h1>mine</h1>'));

    expect((await fetchFrom(tree, `http://${OWN_IP}/index.html`)).result).toEqual({
      kind: 'page',
      content: '<h1>mine</h1>',
      server: 'nginx',
    });
  });

  it('serves a directory its index, so a bare address is a page', async () => {
    const tree = ownBox(WEB_SERVER_RUNNING, published('index.html', '<h1>mine</h1>'));

    expect((await fetchFrom(tree, `http://${OWN_IP}/`)).result).toEqual({
      kind: 'page',
      content: '<h1>mine</h1>',
      server: 'nginx',
    });
  });

  it('records exactly one line on the box that answered, naming what was asked for', async () => {
    const tree = ownBox(WEB_SERVER_RUNNING, published('notes.html', '<h1>notes</h1>'));

    const { logged } = await fetchFrom(tree, `http://${OWN_IP}/notes.html`);

    expect(logged).toEqual([
      {
        essid: ESSID,
        target: OWN_IP,
        port: HTTP_DEFAULT_PORT,
        paths: ['/notes.html'],
        callerMachineId: CALLER,
      },
    ]);
  });

  // A 404 is an answer. The box was reached, it looked, and it said no — which is
  // exactly the kind of line a defender reading their log wants to see.
  it('reports a path the box does not publish as not found, and logs the miss anyway', async () => {
    const tree = ownBox(WEB_SERVER_RUNNING, published('index.html', '<h1>mine</h1>'));

    const { result, logged } = await fetchFrom(tree, `http://${OWN_IP}/nothing-here.html`);

    expect(result).toEqual({ kind: 'not_found' });
    expect(logged.map((line) => line.paths)).toEqual([['/nothing-here.html']]);
  });

  it('refuses a path that climbs out of what the server publishes, and calls it not found', async () => {
    const tree = ownBox(WEB_SERVER_RUNNING, published('index.html', '<h1>mine</h1>'));

    // Naming the file rather than the traversal: /etc/passwd is real and readable on
    // every box, so what stops this is the document root and nothing else.
    expect((await fetchFrom(tree, `http://${OWN_IP}/../../../etc/passwd`)).result).toEqual({
      kind: 'not_found',
    });
  });

  it('leaves no trace on a host that never answered', async () => {
    const { result, logged } = await fetchFrom(ownBox(), `http://${unoccupiedIp()}/index.html`);

    expect(result.kind).toBe('unreachable');
    expect(logged).toEqual([]);
  });

  it('leaves no trace on a box that is there but serves no web', async () => {
    // The player's own box, online but running nothing: reached as an address,
    // refused as a web server.
    const { result, logged } = await fetchFrom(ownBox(), `http://${OWN_IP}/index.html`);

    expect(result.kind).toBe('unreachable');
    expect(logged).toEqual([]);
  });

  it('names the program in the failure, since every web tool shares this fetch', async () => {
    const { result } = await fetchFrom(ownBox(), `http://${unoccupiedIp()}/index.html`);

    if (result.kind !== 'unreachable') throw new Error('expected an unreachable host');
    expect(result.failure.lines.map((line) => line.content).join('\n')).toContain(
      'lynx: (6) Could not resolve host',
    );
  });

  it('asks the server for a generated host on the LAN, which serves it from the box as it stands', async () => {
    // Somebody may have rewritten its pages, stopped its web server or bricked it, and
    // the journal that says so is the server's alone.
    const { host, port } = webHostOnLan();
    const served: OccupantFetchResult = { ok: true, content: '<h1>owned</h1>', server: 'nginx' };

    const { result, asked, logged } = await fetchFrom(
      ownBox(),
      `http://${host.ip}:${port}/index.html`,
      served,
    );

    expect(result).toEqual({ kind: 'page', content: '<h1>owned</h1>', server: 'nginx' });
    expect(asked).toEqual([
      { essid: ESSID, target: host.ip, port, path: '/index.html', callerMachineId: CALLER },
    ]);
    expect(logged).toEqual([]);
  });
});

describe('fetching a page by the name the network gives a host', () => {
  it('reaches a LAN host by its .lan name, and the box logs the address it was leased', async () => {
    // An intranet page links its neighbours by name, so a followed link written that
    // way must land on the same box `curl` reaches by that name.
    const { host, port } = webHostOnLan();
    const byName = await fetchFrom(ownBox(), `http://${host.hostname}.${lanZoneName(ESSID)}:${port}/`);

    expect(byName.asked.map((asked) => asked.target)).toEqual([host.ip]);
  });

  it('cannot resolve a name the network does not hold, and says the name as typed', async () => {
    const { result, logged } = await fetchFrom(ownBox(), `http://nobody-here.${lanZoneName(ESSID)}/`);

    if (result.kind !== 'unreachable') throw new Error('expected an unreachable host');
    expect(result.failure.lines.map((line) => line.content)).toEqual([
      `lynx: (6) Could not resolve host: nobody-here.${lanZoneName(ESSID)}`,
    ]);
    expect(logged).toEqual([]);
  });
});

describe('fetching a page off a fellow occupant of the network', () => {
  // A player's box is on no generated LAN: it is built from their journal, which only
  // the server holds. So an address nothing here answers to is asked of the server.
  const THEIR_PAGE = '<h1>welcome to nebuchadnezzar</h1>';
  const served: OccupantFetchResult = { ok: true, content: THEIR_PAGE, server: 'apache2' };

  it('hands back the page their box serves at an address no generated box holds', async () => {
    const neighbour = unoccupiedIp();

    const { result, asked } = await fetchFrom(
      ownBox(),
      `http://${neighbour}:8080/status.html`,
      served,
    );

    expect(result).toEqual({ kind: 'page', content: THEIR_PAGE, server: 'apache2' });
    expect(asked).toEqual([
      {
        essid: ESSID,
        target: neighbour,
        port: 8080,
        path: '/status.html',
        callerMachineId: CALLER,
      },
    ]);
  });

  it('leaves the line to the server, which records the visit on the box it served from', async () => {
    const { logged } = await fetchFrom(ownBox(), `http://${unoccupiedIp()}/`, served);

    expect(logged).toEqual([]);
  });

  it('reports a path their box does not publish as not found', async () => {
    const { result } = await fetchFrom(ownBox(), `http://${unoccupiedIp()}/nothing.html`, {
      ok: false,
      error: 'not_found',
    });

    expect(result).toEqual({ kind: 'not_found' });
  });

  it('is refused by a box that is there and serves no web on that port', async () => {
    const neighbour = unoccupiedIp();

    const { result } = await fetchFrom(ownBox(), `http://${neighbour}:8080/`, {
      ok: false,
      error: 'connection_refused',
    });

    if (result.kind !== 'unreachable') throw new Error('expected an unreachable host');
    expect(result.failure.lines.map((line) => line.content)).toEqual([
      `lynx: (7) Failed to connect to ${neighbour} port 8080: Connection refused`,
    ]);
  });

  it.each(['host_unreachable', 'network_error'] as const)(
    'cannot resolve the address when the server answers %s',
    async (error) => {
      const neighbour = unoccupiedIp();

      const { result } = await fetchFrom(ownBox(), `http://${neighbour}/`, { ok: false, error });

      if (result.kind !== 'unreachable') throw new Error('expected an unreachable host');
      expect(result.failure.lines.map((line) => line.content)).toEqual([
        `lynx: (6) Could not resolve host: ${neighbour}`,
      ]);
    },
  );

  it('never asks the server about the player’s own box at home', async () => {
    const tree = ownBox(WEB_SERVER_RUNNING, published('index.html', '<h1>mine</h1>'));

    const own = await fetchFrom(tree, `http://${OWN_IP}/`, served);
    const loopback = await fetchFrom(tree, 'http://localhost/', served);

    expect(own.asked).toEqual([]);
    expect(loopback.asked).toEqual([]);
    expect(own.result).toEqual({ kind: 'page', content: '<h1>mine</h1>', server: 'nginx' });
  });

  it('takes a refusal by a box it reads for itself as final, and asks nobody', async () => {
    // The player's own box, running no web server: it is there, so the address is not
    // somebody else's to answer for.
    const { result, asked } = await fetchFrom(ownBox(), `http://${OWN_IP}/`, served);

    expect(result.kind).toBe('unreachable');
    expect(asked).toEqual([]);
  });
});

describe('fetching from a shell on a box the network generates', () => {
  // The tree a shell holds there is the one the server pruned to the session's tier, not
  // what the box's web server serves, so the box answers for itself through the server.
  const { host, port } = webHostOnLan();
  const HOP = asMachineId(machineIdForLanHost(host, ESSID));
  const served: OccupantFetchResult = { ok: true, content: '<h1>owned</h1>', server: 'nginx' };

  const fetchOnHop = async (rawUrl: string) => {
    const url = parseHttpUrl(rawUrl);
    if (url === null) throw new Error(`test asked for an unparseable url: ${rawUrl}`);
    const asked: OccupantFetchParams[] = [];
    const logged: AccessLogFetch[] = [];
    const vantage = vantageOf(
      mockSession({ essid: ESSID, machineId: HOP }),
      mockNetworkViewFromConnectivity(buildColdStartConnectivity(PUBKEY)),
    );
    if (vantage === null) throw new Error('expected a hop vantage');
    const result = await fetchWebPage({
      root: ownBox(WEB_SERVER_RUNNING, published('index.html', '<h1>pruned copy</h1>')),
      program: 'curl',
      url,
      vantage,
      callerMachineId: HOP,
      appendAccessLog: async (fetched) => {
        logged.push(fetched);
      },
      fetchOccupant: async (params) => {
        asked.push(params);
        return served;
      },
    });
    return { result, asked, logged };
  };

  it.each([
    ['loopback', 'http://localhost/', '127.0.0.1'],
    ['its own address', `http://${host.ip}:${port}/`, host.ip],
  ])('asks the server for the box itself by %s', async (_label, rawUrl, target) => {
    const { result, asked, logged } = await fetchOnHop(rawUrl);

    expect(result).toEqual({ kind: 'page', content: '<h1>owned</h1>', server: 'nginx' });
    expect(asked.map((params) => params.target)).toEqual([target]);
    expect(logged).toEqual([]);
  });
});
