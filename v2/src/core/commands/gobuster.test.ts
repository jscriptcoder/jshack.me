import { describe, expect, it } from 'vitest';
import { gobuster } from './gobuster';
import { commandRegistry } from './registry';
import type { CommandEnv, CommandResult } from './types';
import {
  mockCommandEnv,
  mockFsViewFromTree,
  mockIdentity,
  mockNetworkView,
  mockNetworkViewFromConnectivity,
  mockSession,
} from '../../test/factories/commandEnv';
import { generateHomeLan } from '../generation/generateHomeLan';
import { DEFAULT_DIRLIST, DIRLIST_PATH } from '../network/defaultDirlist';
import { applyPatches, type Patch } from '../filesystem/applyPatches';
import type { Directory, FilePermissions } from '../filesystem/types';
import { buildWorkstationBaseFs } from '../generation/workstationFs';
import { BINARY_STUB } from '../generation/binaries';
import { formatPidfileContent } from '../services/pidfile';
import { SERVICE_CATALOG } from '../services/serviceCatalog';
import { buildColdStartConnectivity, type ConnectivityState } from '../network/interfaces';
import { assignHomeNetwork } from '../network/homeNetwork';
import { HTTP_DEFAULT_PORT } from '../network/http';
import { asAbsPath, asMachineId, asPlayerKeyHex } from '../types';

/**
 * `gobuster <url>` walks a list of paths against a web server and reports the ones
 * that answer. It finds what a page never linked to, which is the whole reason it
 * exists — `curl` can only fetch a path the player already knows.
 *
 * The gate is the same one the credential layer rests on, moved to a different
 * domain: a path is found if and only if it is a WORD IN THE FILE and something is
 * served there. A path present on the box but missing from the list stays hidden,
 * and a word naming nothing is not reported.
 */

const PUBKEY = 'a'.repeat(64);
const ESSID = 'BEAN-THERE-WIFI';
const OWN_IP = assignHomeNetwork(PUBKEY, ESSID).localIp;

/** Readable by every tier, root-only write, never executed — a data file the
 *  player owns and curates, exactly like the password wordlist. */
const LIST_PERMS: FilePermissions = {
  read: ['root', 'user', 'guest'],
  write: ['root'],
  execute: [],
};

const onlineConnectivity = (essid: string): ConnectivityState => {
  const cold = buildColdStartConnectivity(PUBKEY);
  const wlan0 = cold.interfaces.get('wlan0');
  if (wlan0 === undefined || wlan0.kind !== 'wireless') throw new Error('no wlan0 in cold start');
  const connected = {
    ...wlan0,
    association: { essid, bssid: 'AA:BB:CC:DD:EE:FF' },
    ipv4: assignHomeNetwork(PUBKEY, essid).localIp,
  };
  return { interfaces: new Map(cold.interfaces).set('wlan0', connected) };
};

/** The player's own box as generated, plus any patches — applied through the SAME
 *  `applyPatches` the game uses, so a directory made with `mkdir` and a page written
 *  with `nano` reach the tree the way they really would. */
const ownBox = (...patches: readonly Patch[]): Directory =>
  applyPatches(
    buildWorkstationBaseFs(PUBKEY, {
      machineName: 'workstation',
      username: 'alice',
      rootPassword: 'hunter2',
    }),
    patches,
  );

/** What `nginx` leaves behind when it starts on the default port. */
const WEB_SERVER_RUNNING: Patch = {
  path: '/var/run/nginx.pid',
  content: formatPidfileContent(SERVICE_CATALOG.http, HTTP_DEFAULT_PORT),
  owner: 'root',
};

/** The path list `apt install gobuster` puts on the box, as the player holds it. */
const installedList = (...words: readonly string[]): Patch => ({
  path: '/usr/share/wordlists/dirlist.txt',
  content: words.join('\n'),
  owner: 'root',
  permissions: LIST_PERMS,
});

/** The binary `apt install gobuster` drops in `/usr/bin`, stamped world-executable
 *  exactly as apt stamps it — the registry gates every command on its binary being
 *  present and runnable, so a sweep reached by NAME needs the tool installed. */
const INSTALLED_BINARY: Patch = {
  path: '/usr/bin/gobuster',
  content: BINARY_STUB,
  owner: 'root',
  permissions: { read: ['root', 'user', 'guest'], write: ['root'], execute: ['root', 'user', 'guest'] },
};

/** A page published under the document root at `path`, relative to the web root. */
const publishedPage = (path: string, content: string): Patch => ({
  path: `/var/www/html${path}`,
  content,
  owner: 'root',
});

type Drained = {
  readonly text: string;
  readonly exitCode: number;
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

/** An online player standing on the given tree. */
const envOn = (tree: Directory, overrides: Partial<CommandEnv> = {}): CommandEnv =>
  mockCommandEnv({
    identity: mockIdentity({ publicKeyHex: asPlayerKeyHex(PUBKEY) }),
    network: mockNetworkViewFromConnectivity(onlineConnectivity(ESSID)),
    fs: mockFsViewFromTree(tree, { userType: 'user', cwd: () => asAbsPath('/') }),
    ...overrides,
  });

/** An address on the player's own subnet that no host occupies. */
const unoccupiedIp = (): string => {
  const lan = generateHomeLan(ESSID);
  const taken = new Set([...lan.hosts.map((host) => host.ip), OWN_IP]);
  const free = Array.from({ length: 253 }, (_unused, index) => `${lan.subnet}.${index + 2}`).find(
    (ip) => !taken.has(ip),
  );
  if (free === undefined) throw new Error('expected a free address on the subnet');
  return free;
};

/** `gobuster` run by an online player standing on the given own-box tree. */
const sweep = async (tree: Directory, ...args: readonly string[]): Promise<Drained> =>
  drain(await gobuster.execute(envOn(tree), args, new Map()));

describe('gobuster is a command the player can reach', () => {
  it('resolves by name, and what resolves is the sweep', async () => {
    const registered = commandRegistry.get('gobuster');
    if (registered === undefined) throw new Error('gobuster is not registered');

    const tree = ownBox(
      WEB_SERVER_RUNNING,
      INSTALLED_BINARY,
      installedList('hidden'),
      publishedPage('/hidden/index.html', 'staging notes'),
    );
    const { text } = await drain(
      await registered.execute(envOn(tree), [`http://${OWN_IP}`], new Map()),
    );

    // Asserted by BEHAVIOUR, not identity: the registry stores each command wrapped
    // in its binary/library gate, so the entry is deliberately not the same object
    // the module exports and `toBe` would compare two different things. Running it
    // proves what matters — the name reaches the sweep, through the gate a player
    // passes by installing the package.
    expect(text).toContain('/hidden/');
  });
});

describe('gobuster finds what the list names and the server serves', () => {
  it('reports a directory the player made and nothing linked to', async () => {
    const tree = ownBox(
      WEB_SERVER_RUNNING,
      installedList('hidden', 'admin', 'index.html'),
      publishedPage('/hidden/index.html', 'staging notes'),
    );

    const { text, exitCode } = await sweep(tree, `http://${OWN_IP}`);

    // A word naming a directory that holds an index is a hit, reported with the
    // trailing slash a real server would redirect to.
    expect(text).toContain('/hidden/');
    expect(exitCode).toBe(0);
  });

  it('stays silent about a page that is served but absent from the list', async () => {
    const tree = ownBox(
      WEB_SERVER_RUNNING,
      installedList('hidden', 'index.html'),
      publishedPage('/hidden/index.html', 'staging notes'),
      publishedPage('/unlisted.html', 'nobody guessed this'),
    );

    const { text } = await sweep(tree, `http://${OWN_IP}`);

    // The list is the sole gate. A file sitting in the document root that no word
    // names is not found, however readable it is — the same rule that makes a
    // password absent from the wordlist uncrackable however weak it looks.
    expect(text).not.toContain('unlisted.html');
  });

  it('stays silent about a word in the list that names nothing', async () => {
    const tree = ownBox(WEB_SERVER_RUNNING, installedList('admin', 'backup', 'index.html'));

    const { text } = await sweep(tree, `http://${OWN_IP}`);

    // Both halves of the gate matter: naming a path does not conjure it.
    expect(text).not.toContain('/admin');
    expect(text).not.toContain('/backup');
    // ...while the page that IS there, and IS named, comes back.
    expect(text).toContain('/index.html');
  });

  it('does not find a directory that holds no index', async () => {
    const tree = ownBox(WEB_SERVER_RUNNING, installedList('empty', 'index.html'), {
      path: '/var/www/html/empty',
      content: null,
      owner: 'root',
      nodeType: 'directory',
    });

    const { text } = await sweep(tree, `http://${OWN_IP}`);

    // A real server has nothing to return for a directory with no index, so
    // neither has this — a folder is a find only when something is served in it.
    expect(text).not.toContain('/empty');
  });
});

describe('gobuster grows with the list the player curates', () => {
  it('finds a path the shipped list misses once it has been appended', async () => {
    const HANDOVER = 'q3-handover';
    const withDefaults = ownBox(
      WEB_SERVER_RUNNING,
      installedList(...DEFAULT_DIRLIST),
      publishedPage(`/${HANDOVER}/index.html`, 'migration steps'),
    );
    const withAppended = ownBox(
      WEB_SERVER_RUNNING,
      installedList(...DEFAULT_DIRLIST, HANDOVER),
      publishedPage(`/${HANDOVER}/index.html`, 'migration steps'),
    );

    const shipped = await sweep(withDefaults, `http://${OWN_IP}`);
    const curated = await sweep(withAppended, `http://${OWN_IP}`);

    // The list is the progression. A default install cannot see this page at all;
    // the same page on the same box answers the moment the player adds its name —
    // the whole reason the tool reads the FILE and not the shipped constant.
    expect(shipped.text).not.toContain(HANDOVER);
    expect(curated.text).toContain(`/${HANDOVER}/`);
  });
});

describe('gobuster refuses in ways that stay honest', () => {
  it('refuses the connection when the host serves no web, rather than finding nothing', async () => {
    const tree = ownBox(installedList('index.html'));

    const { text, exitCode, kinds } = await sweep(tree, `http://${OWN_IP}`);

    // "Nothing there" and "unreachable" must not look alike: a sweep that reported
    // zero hits would say the server is empty, which is a different fact entirely.
    expect(text).toContain('Connection refused');
    expect(kinds).toContain('error');
    expect(exitCode).toBe(1);
  });

  it('refuses when the web server listens on a different port than the one asked for', async () => {
    const tree = ownBox(
      {
        path: '/var/run/nginx.pid',
        content: formatPidfileContent(SERVICE_CATALOG.http, 8080),
        owner: 'root',
      },
      installedList('index.html'),
    );

    const { text, exitCode } = await sweep(tree, `http://${OWN_IP}`);

    // The URL's port is honoured, not merely "is anything serving the web here" —
    // a sweep that answered on any port would report hits against a server that
    // never heard the request.
    expect(text).toContain('Connection refused');
    expect(exitCode).toBe(1);
  });

  it('refuses when the port asked for is open but serving something else', async () => {
    const tree = ownBox(
      {
        path: '/var/run/sshd.pid',
        content: formatPidfileContent(SERVICE_CATALOG.ssh, 22),
        owner: 'root',
      },
      installedList('index.html'),
    );

    const { text, exitCode } = await sweep(tree, `http://${OWN_IP}:22`);

    // An open port is not a web server. Sweeping sshd for pages would invent a
    // document root on a box that has none.
    expect(text).toContain('Connection refused');
    expect(exitCode).toBe(1);
  });

  it('names the missing list instead of reporting an empty server', async () => {
    const tree = ownBox(WEB_SERVER_RUNNING);

    const { text, exitCode } = await sweep(tree, `http://${OWN_IP}`);

    // Without a list there is nothing to try, and "0 found" would read as a server
    // with nothing on it rather than as a tool with nothing to ask.
    expect(text).toContain(`no wordlist at ${DIRLIST_PATH}`);
    expect(text).toContain('apt install gobuster');
    expect(exitCode).toBe(1);
  });

  it('says nothing about a path that climbs out of the document root', async () => {
    const tree = ownBox(WEB_SERVER_RUNNING, installedList('../../../etc/passwd', 'index.html'));

    const { text } = await sweep(tree, `http://${OWN_IP}`);

    // The traversal is refused, and refused SILENTLY: telling a sweeper their
    // climb was spotted is itself a hint, and a real box has /etc/passwd to lose.
    expect(text).not.toContain('passwd');
    expect(text).toContain('/index.html');
  });
});

describe('gobuster reads the document root as the server does', () => {
  it('finds a page only root can read, because a server serves under its own account', async () => {
    const tree = ownBox(
      WEB_SERVER_RUNNING,
      installedList('private.html'),
      {
        path: '/var/www/html/private.html',
        content: 'internal only',
        owner: 'root',
        permissions: { read: ['root'], write: ['root'], execute: [] },
      },
    );

    const { text } = await sweep(tree, `http://${OWN_IP}`);

    // The confinement is the DOCUMENT ROOT, not the file permissions: the sweeper
    // has no account on that box at all, and a web server hands out what it can
    // read itself. Reading as the caller's tier instead would hide published files.
    expect(text).toContain('/private.html');
  });
});

describe('gobuster refuses before it sweeps, and says which refusal it is', () => {
  it('asks for a url when given none', async () => {
    const { text, exitCode } = await sweep(ownBox(WEB_SERVER_RUNNING, installedList('index.html')));

    expect(text).toContain('usage: gobuster <url>');
    expect(exitCode).toBe(1);
  });

  it('rejects something that is not a url rather than treating it as a host', async () => {
    const tree = ownBox(WEB_SERVER_RUNNING, installedList('index.html'));

    const { text, exitCode } = await sweep(tree, 'not-a-url');

    expect(text).toContain('URL rejected: not-a-url');
    expect(exitCode).toBe(1);
  });

  it('says the network is unreachable when the player is offline', async () => {
    const tree = ownBox(WEB_SERVER_RUNNING, installedList('index.html'));

    const { text, exitCode } = await drain(
      await gobuster.execute(
        envOn(tree, { network: mockNetworkView() }),
        [`http://${OWN_IP}`],
        new Map(),
      ),
    );

    // Offline is its own fact. Falling through would report the host unresolvable,
    // which sends the player looking at the target instead of at their own wifi.
    expect(text).toContain('network is unreachable');
    expect(exitCode).toBe(1);
  });

  it('says a public address is out of reach rather than pretending it does not resolve', async () => {
    const tree = ownBox(WEB_SERVER_RUNNING, installedList('index.html'));

    const { text, exitCode } = await sweep(tree, 'http://203.0.113.7');

    // Cross-network sweeps have no server path yet. Named plainly: dressed as
    // "could not resolve host" it would read as a dead target, and a player would
    // spend the evening believing a live box was down.
    expect(text).toContain('only hosts on your own network');
    expect(text).not.toContain('Could not resolve host');
    expect(exitCode).toBe(1);
  });

  it('says it could not resolve an address no host on the LAN holds', async () => {
    const tree = ownBox(WEB_SERVER_RUNNING, installedList('index.html'));

    const { text, exitCode } = await sweep(tree, `http://${unoccupiedIp()}`);

    expect(text).toContain('Could not resolve host');
    expect(exitCode).toBe(1);
  });
});

describe('gobuster runs where the player stands', () => {
  it('sweeps from a machine that is not the player own workstation', async () => {
    const tree = ownBox(
      WEB_SERVER_RUNNING,
      installedList('hidden', 'index.html'),
      publishedPage('/hidden/index.html', 'staging notes'),
    );

    const { text, exitCode } = await drain(
      await gobuster.execute(
        envOn(tree, { session: mockSession({ machineId: asMachineId('a-box-they-took') }) }),
        [`http://${OWN_IP}`],
        new Map(),
      ),
    );

    // A player's own box is somewhere they operate FROM, not the only place the
    // toolchain exists. hydra shipped with a workstation-only gate and had to have
    // it lifted; this pins that the same refusal never grows here.
    expect(text).toContain('/hidden/');
    expect(exitCode).toBe(0);
  });
});

describe('gobuster reports what it swept', () => {
  it('names the target, the list and how much of it answered', async () => {
    const tree = ownBox(
      WEB_SERVER_RUNNING,
      installedList('hidden', 'admin', 'index.html'),
      publishedPage('/hidden/index.html', 'staging notes'),
    );

    const { text } = await sweep(tree, `http://${OWN_IP}`);

    expect(text).toContain('Gobuster dir mode');
    expect(text).toContain(`[+] Url:       http://${OWN_IP}`);
    expect(text).toContain(`[+] Wordlist:  ${DIRLIST_PATH}`);
    expect(text).toContain('[+] Words:     3');
    // Two of the three words answered, and the count says so — a player reading a
    // short list of hits needs to know how much was asked to judge what it means.
    expect(text).toContain('Finished. 2/3 paths found.');
  });

  it('lays the run out as a header, the hits, and a count', async () => {
    const PAGE = 'staging notes';
    const tree = ownBox(
      WEB_SERVER_RUNNING,
      installedList('hidden'),
      publishedPage('/hidden/index.html', PAGE),
    );

    const { text } = await sweep(tree, `http://${OWN_IP}`);

    // Pinned whole, blank lines included: the hits have to sit apart from the
    // header and the count, or a long run of them reads as one wall of text with
    // the summary buried at the bottom of it.
    expect(text.split('\n')).toEqual([
      'Gobuster dir mode',
      `[+] Url:       http://${OWN_IP}`,
      '[+] Wordlist:  /usr/share/wordlists/dirlist.txt',
      '[+] Words:     1',
      '',
      `/hidden/             (Status: 200) [Size: ${PAGE.length}]`,
      '',
      'Finished. 1/1 paths found.',
    ]);
  });

  it('reports the size of what came back, so a stub page reads as a stub', async () => {
    const PAGE = 'migration steps';
    const tree = ownBox(
      WEB_SERVER_RUNNING,
      installedList('hidden'),
      publishedPage('/hidden/index.html', PAGE),
    );

    const { text } = await sweep(tree, `http://${OWN_IP}`);

    expect(text).toContain(`[Size: ${PAGE.length}]`);
  });
});
