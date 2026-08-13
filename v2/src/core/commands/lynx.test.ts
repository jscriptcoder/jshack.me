import { describe, expect, it } from 'vitest';
import { lynx } from './lynx';
import type { AccessLogFetch, CommandResult } from './types';
import {
  mockCommandEnv,
  mockFsViewFromTree,
  mockIdentity,
  mockNetworkView,
  mockNetworkViewFromConnectivity,
} from '../../test/factories/commandEnv';
import { applyPatches, type Patch } from '../filesystem/applyPatches';
import type { Directory } from '../filesystem/types';
import { buildWorkstationBaseFs } from '../generation/workstationFs';
import { formatPidfileContent } from '../services/pidfile';
import { SERVICE_CATALOG } from '../services/serviceCatalog';
import { buildColdStartConnectivity, type ConnectivityState } from '../network/interfaces';
import { assignHomeNetwork } from '../network/homeNetwork';
import { generateHomeLan, type LanHost } from '../generation/generateHomeLan';
import { buildRemoteHostFs } from '../generation/remoteHostFs';
import { readOpenPorts } from '../services/pidfile';
import { createFsView } from '../filesystem/fsView';
import { HTTP_DEFAULT_PORT } from '../network/http';
import { asAbsPath, asPlayerKeyHex } from '../types';

/**
 * `lynx <url>` reads a page instead of its source. The fetch is `curl`'s — same
 * resolution, same port check, same trace on the target — and what is different is
 * where the answer goes: a page that came back opens a browser screen, and every
 * way of NOT coming back is reported in the terminal, because a browser that opens
 * on a failure has nothing to show.
 */

const PUBKEY = 'a'.repeat(64);
const ESSID = 'BEAN-THERE-WIFI';

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

const run = async (...args: readonly string[]): Promise<CommandResult> =>
  lynx.execute(onlineEnv(), args, new Map());

/** What the terminal printed, for the runs that never reach a browser — including
 *  the line KINDS, so a failure that is styled as an error can be told from one
 *  that prints quietly as ordinary output. */
const reported = (
  result: CommandResult,
): {
  readonly text: string;
  readonly exitCode: number;
  readonly kinds: readonly string[];
} => {
  if (result.kind !== 'sync') throw new Error('expected a message in the terminal');
  return {
    text: result.lines.map((line) => line.content).join('\n'),
    exitCode: result.exitCode,
    kinds: result.lines.map((line) => line.kind),
  };
};

/** The page the browser opened on, or a failure if it never opened. */
const opened = (result: CommandResult): { readonly url: string; readonly content: string } => {
  if (result.kind !== 'mode_change' || result.mode.kind !== 'lynx') {
    throw new Error('expected the browser to open');
  }
  return { url: result.mode.url, content: result.mode.content };
};

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

/** A reachable LAN host whose open port is NOT a web server. */
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

/** A port `host` has nothing listening on — so a refusal there is about the PORT
 *  and not about the host being unreachable. */
const closedPortOn = (host: LanHost, serving: number): number => {
  const open = new Set(readOpenPorts(buildRemoteHostFs(ESSID, host)).map((entry) => entry.port));
  const closed = Array.from({ length: 100 }, (_unused, index) => serving + index + 1).find(
    (port) => !open.has(port),
  );
  if (closed === undefined) throw new Error('expected a closed port on the host');
  return closed;
};

/** The page a generated host actually serves. */
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

describe('lynx opens a browser on a page that came back', () => {
  it('hands the browser the page a LAN host serves, and the address it was read from', async () => {
    const { host, port } = webHostOnLan();

    const page = opened(await run(`http://${host.ip}:${port}/index.html`));

    expect(page.content).toBe(servedPage(host));
    expect(page.url).toBe(`http://${host.ip}:${port}/index.html`);
  });

  it('reads the page a directory stands for, as a browser asking for the root does', async () => {
    const { host, port } = webHostOnLan();

    expect(opened(await run(`http://${host.ip}:${port}`)).content).toBe(servedPage(host));
  });
});

describe('lynx refuses in the terminal rather than opening on nothing', () => {
  it('asks for a url when given none', async () => {
    const { text, exitCode } = reported(await run());

    expect(text).toContain('usage: lynx <url>');
    expect(exitCode).toBe(1);
  });

  it('rejects something that is not an http url', async () => {
    const { text, exitCode } = reported(await run('192.168.1.5'));

    expect(text).toBe('lynx: (3) URL rejected: 192.168.1.5');
    expect(exitCode).toBe(1);
  });

  it('says the network is unreachable when the player is offline', async () => {
    const offline = mockCommandEnv({
      identity: mockIdentity({ publicKeyHex: asPlayerKeyHex(PUBKEY) }),
      network: mockNetworkView(),
    });

    const { text, exitCode } = reported(await lynx.execute(offline, ['http://1.2.3.4'], new Map()));

    expect(text).toContain('unreachable');
    expect(exitCode).toBe(1);
  });

  it('cannot resolve an address nothing on the network answers to', async () => {
    const { text, exitCode } = reported(await run(`http://${unoccupiedIp()}`));

    expect(text).toContain('Could not resolve host');
    expect(exitCode).toBe(1);
  });

  it('is refused by a host that is up but serves no web', async () => {
    const { host } = sshHostOnLan();

    const { text, exitCode, kinds } = reported(await run(`http://${host.ip}`));

    expect(text).toContain('Connection refused');
    expect(exitCode).toBe(1);
    // Styled as a failure, not printed as if it were a page.
    expect(kinds).toEqual(['error']);
  });

  it('is refused on a port the web server is not on, however well it serves elsewhere', async () => {
    const { host, port } = webHostOnLan();

    const { text } = reported(await run(`http://${host.ip}:${closedPortOn(host, port)}`));

    expect(text).toContain('Connection refused');
  });

  it('is refused by a port that is open for something that is not a web server', async () => {
    // The port answers and the host is up — but ssh is behind it, and a text
    // browser asking it for a page gets nowhere.
    const { host, port } = sshHostOnLan();

    const { text } = reported(await run(`http://${host.ip}:${port}`));

    expect(text).toContain('Connection refused');
  });

  it('reports a missing page as a 404 instead of browsing an empty screen', async () => {
    const { host, port } = webHostOnLan();

    const { text, exitCode } = reported(await run(`http://${host.ip}:${port}/nothing-here`));

    expect(text).toContain('404');
    expect(exitCode).toBe(1);
  });

  it('reads nothing above the document root, however the path is written', async () => {
    const { host, port } = webHostOnLan();

    const { text, exitCode } = reported(
      await run(`http://${host.ip}:${port}/../../etc/passwd`),
    );

    // A traversal that was SPOTTED says only what a missing file says — telling the
    // caller it was noticed is itself a hint.
    expect(text).toContain('404');
    expect(exitCode).toBe(1);
  });

  it('says cross-network browsing is not here yet rather than pretending to fetch', async () => {
    const { text, exitCode } = reported(await run('http://203.0.113.7'));

    expect(text).toContain('own network');
    expect(exitCode).toBe(1);
  });
});

describe('lynx leaves the same trace on the box it read', () => {
  const runReporting = async (
    ...args: readonly string[]
  ): Promise<{ readonly result: CommandResult; readonly logged: readonly AccessLogFetch[] }> => {
    const logged: AccessLogFetch[] = [];
    const env = mockCommandEnv({
      identity: mockIdentity({ publicKeyHex: asPlayerKeyHex(PUBKEY) }),
      network: mockNetworkViewFromConnectivity(onlineConnectivity(ESSID)),
      log: {
        appendAuthLog: async () => undefined,
        appendAccessLog: async (fetch) => {
          logged.push(fetch);
        },
      },
    });
    return { result: await lynx.execute(env, args, new Map()), logged };
  };

  it('is indistinguishable from a curl of the same path', async () => {
    const { host, port } = webHostOnLan();

    const { logged } = await runReporting(`http://${host.ip}:${port}/index.html`);

    expect(logged).toEqual([
      {
        essid: ESSID,
        target: host.ip,
        port,
        paths: ['/index.html'],
        sourceIp: assignHomeNetwork(PUBKEY, ESSID).localIp,
      },
    ]);
  });

  it('records one line for one page, whether or not the page was there', async () => {
    const { host, port } = webHostOnLan();

    const { logged } = await runReporting(`http://${host.ip}:${port}/nothing-here`);

    expect(logged).toHaveLength(1);
    expect(logged[0]!.paths).toEqual(['/nothing-here']);
  });

  it('writes nothing when nothing answered', async () => {
    const { host } = sshHostOnLan();

    const { logged } = await runReporting(`http://${host.ip}`);

    expect(logged).toEqual([]);
  });
});

describe('lynx against the player own address', () => {
  const OWN_IP = assignHomeNetwork(PUBKEY, ESSID).localIp;

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

  const publishedPage = (content: string): Patch => ({
    path: '/var/www/html/index.html',
    content,
    owner: 'root',
  });

  const browseOwn = async (tree: Directory, ...args: readonly string[]): Promise<CommandResult> =>
    lynx.execute(
      mockCommandEnv({
        identity: mockIdentity({ publicKeyHex: asPlayerKeyHex(PUBKEY) }),
        network: mockNetworkViewFromConnectivity(onlineConnectivity(ESSID)),
        fs: mockFsViewFromTree(tree, { userType: 'user', cwd: () => asAbsPath('/') }),
      }),
      args,
      new Map(),
    );

  it('reads the page the player just wrote, not a generated one', async () => {
    // The player's own tree is the LIVE one, which is what makes an edit visible: a
    // generated stand-in would show a page this box never published.
    const tree = ownBox(WEB_SERVER_RUNNING, publishedPage('<h1>mine</h1>'));

    expect(opened(await browseOwn(tree, `http://${OWN_IP}`)).content).toBe('<h1>mine</h1>');
  });

  it('answers to its loopback names as readily as to its leased address', async () => {
    const tree = ownBox(WEB_SERVER_RUNNING, publishedPage('<h1>mine</h1>'));

    for (const loopback of ['localhost', '127.0.0.1']) {
      expect(opened(await browseOwn(tree, `http://${loopback}`)).content).toBe('<h1>mine</h1>');
    }
  });

  it('tells the box a loopback read came from loopback, against its leased address', async () => {
    const logged: AccessLogFetch[] = [];
    const env = mockCommandEnv({
      identity: mockIdentity({ publicKeyHex: asPlayerKeyHex(PUBKEY) }),
      network: mockNetworkViewFromConnectivity(onlineConnectivity(ESSID)),
      fs: mockFsViewFromTree(ownBox(WEB_SERVER_RUNNING), {
        userType: 'user',
        cwd: () => asAbsPath('/'),
      }),
      log: {
        appendAuthLog: async () => undefined,
        appendAccessLog: async (fetch) => {
          logged.push(fetch);
        },
      },
    });

    await lynx.execute(env, ['http://localhost'], new Map());

    // The server finds the machine by the address it LEASED; `localhost` names no
    // machine to anyone but this box.
    expect(logged).toEqual([
      { essid: ESSID, target: OWN_IP, port: HTTP_DEFAULT_PORT, paths: ['/'], sourceIp: '127.0.0.1' },
    ]);
  });

  it('serves a page the reader could never have opened as a file', async () => {
    // The web server reads its own document root under its own account, and the
    // reader has no account on that box at all — so the confinement is the
    // document root, not the file permissions. A root-only page still publishes.
    const rootOnly: Patch = {
      path: '/var/www/html/index.html',
      content: '<h1>published anyway</h1>',
      owner: 'root',
      permissions: { read: ['root'], write: ['root'], execute: [] },
    };

    const page = opened(await browseOwn(ownBox(WEB_SERVER_RUNNING, rootOnly), `http://${OWN_IP}`));

    expect(page.content).toBe('<h1>published anyway</h1>');
  });

  it('is refused by the player own box while no web server is running', async () => {
    const { text, exitCode } = reported(await browseOwn(ownBox(), `http://${OWN_IP}`));

    expect(text).toContain('Connection refused');
    expect(exitCode).toBe(1);
  });
});
