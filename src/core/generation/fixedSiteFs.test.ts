import { describe, expect, it } from 'vitest';
import { CHAINIT_NETWORK, EMAILIT_NETWORK, FINDIT_NETWORK } from './fixedSites.js';
import { CHAINIT_FRONT_PAGE } from '../chainit/pages.js';
import { TALKIT_FRONT_PAGE } from '../talkit/pages.js';
import { MAIL_SPOOL_DIR, ROOT_DIR } from './baseFs.js';
import { filterTreeForSession } from '../patches/readFilter.js';
import { materializeApGatewayFs } from '../network/materializeRouterFs.js';
import { readOpenPorts, readRunningProcesses } from '../services/pidfile.js';
import { SERVICE_CATALOG } from '../services/serviceCatalog.js';
import { canBoot } from '../boot/bootFiles.js';
import { createFsView } from '../filesystem/fsView.js';
import { parseDpkgVersions, readDpkgStatus } from '../packages/dpkgStatus.js';
import { md5 } from './md5.js';
import { asAbsPath } from '../types.js';
import type { Directory, FileNode } from '../filesystem/types.js';
import { ALL_GENERATED_PASSWORDS, UNCRACKABLE_PASSWORDS } from '../../test/passwords.js';

/**
 * A fixed site is a box like any other: reached at its public address, it is a machine
 * with a filesystem, running what a web host runs, and hardened the way a real one is.
 * Nothing about it is soft on purpose — it falls, if it falls, the way every box does.
 */

const siteBox = (key: string): Directory => materializeApGatewayFs({ essid: key }, []);

const finditBox = (): Directory => siteBox(FINDIT_NETWORK);

const read = (tree: Directory, path: string): string | null => {
  const result = createFsView(tree, { userType: 'root' }).read(asAbsPath(path));
  return result.ok ? result.content : null;
};

describe.each([
  ['findit.io', 'findit'],
  ['hackademy.io', 'hackademy'],
  ['mapit.io', 'mapit'],
  ['emailit.io', 'emailit'],
  ['chainit.io', 'chainit'],
  ['talkit.io', 'talkit'],
])('the box %s runs on', (key, hostname) => {
  const box = (): Directory => siteBox(key);

  it('comes up', () => {
    expect(canBoot(box()).ok).toBe(true);
  });

  it('runs a web server and a way to log in, and nothing else', () => {
    const open = readOpenPorts(box()).map(({ port, service }) => ({ port, service }));
    expect(open).toEqual(
      expect.arrayContaining([
        { port: 80, service: SERVICE_CATALOG.http.service },
        { port: 22, service: SERVICE_CATALOG.ssh.service },
      ]),
    );
    expect(open).toHaveLength(2);
  });

  it('serves the web with nginx, whichever program a generated host would draw', () => {
    // A fixed site is one box the whole world knows, and it stays the server its admin
    // set up: the 50/50 between nginx and apache2 is for the hosts the world generates.
    const web = readRunningProcesses(box()).find(
      (running) => running.kind === 'service' && running.spec === SERVICE_CATALOG.http,
    );
    expect(web).toMatchObject({ program: 'nginx', package: 'nginx' });
  });

  it('keeps a root account whose password no wordlist holds', () => {
    const passwd = read(box(), '/etc/passwd') ?? '';
    const root = passwd.split('\n').find((line) => line.startsWith('root:'));
    const hash = root?.split(':')[1];
    expect(UNCRACKABLE_PASSWORDS.map(md5)).toContain(hash);
  });

  it('keeps no other account a password could open', () => {
    const passwd = read(box(), '/etc/passwd') ?? '';
    const hashes = passwd
      .split('\n')
      .filter((line) => line !== '' && !line.startsWith('root:'))
      .map((line) => line.split(':')[1]);
    const generated = new Set(ALL_GENERATED_PASSWORDS.map(md5));
    expect(hashes.filter((hash) => hash !== undefined && generated.has(hash))).toEqual([]);
  });

  it('lists the packages behind what it runs, so a scan can read their versions', () => {
    const versions = parseDpkgVersions(readDpkgStatus(box()));
    expect(versions.has(SERVICE_CATALOG.http.package)).toBe(true);
    expect(versions.has(SERVICE_CATALOG.ssh.package)).toBe(true);
  });

  it('keeps the logs its two daemons and its firewall write to, empty', () => {
    const tree = box();
    expect(read(tree, '/var/log/access.log')).toBe('');
    expect(read(tree, '/var/log/auth.log')).toBe('');
    expect(read(tree, '/var/log/kern.log')).toBe('');
  });

  it('is named for itself, on its own domain', () => {
    expect(read(box(), '/etc/hostname')?.trim()).toBe(hostname);
    expect(read(box(), '/etc/hosts')).toContain(`127.0.1.1\t${hostname}.${key} ${hostname}\n`);
  });
});

describe('the fixed sites, side by side', () => {
  const rootHash = (key: string): string | undefined =>
    (read(siteBox(key), '/etc/passwd') ?? '')
      .split('\n')
      .find((line) => line.startsWith('root:'))
      ?.split(':')[1];

  it('keep a root password each, so rooting one opens nothing on the other', () => {
    const hashes = [
      'findit.io',
      'hackademy.io',
      'mapit.io',
      'emailit.io',
      'chainit.io',
      'talkit.io',
    ].map(rootHash);
    expect(new Set(hashes).size).toBe(hashes.length);
  });
});

describe("chainit.io's box", () => {
  it("serves the explorer's front page, a file a root can deface like any other", () => {
    expect(read(siteBox(CHAINIT_NETWORK), '/var/www/html/index.html')).toBe(CHAINIT_FRONT_PAGE);
  });

  it('keeps no ledger on its disk, since the ledger is never a file', () => {
    expect(read(siteBox(CHAINIT_NETWORK), '/var/www/html/address')).toBeNull();
  });
});

describe("talkit.io's box", () => {
  it("serves the forum's front page, a file a root can deface like any other", () => {
    expect(read(siteBox('talkit.io'), '/var/www/html/index.html')).toBe(TALKIT_FRONT_PAGE);
  });

  it.each(['threads', 'thread'])(
    'keeps no %s page on its disk, since what players wrote is never a file',
    (path) => {
      expect(read(siteBox('talkit.io'), `/var/www/html/${path}`)).toBeNull();
    },
  );
});

const nodeAt = (tree: Directory, path: string): FileNode | undefined =>
  createFsView(tree, { userType: 'root' }).stat(asAbsPath(path)) ?? undefined;

describe("the room emailit.io's box keeps for its mail", () => {
  it('has an empty spool that only root may list', () => {
    expect(nodeAt(siteBox(EMAILIT_NETWORK), '/var/mail')).toMatchObject({
      kind: 'directory',
      owner: 'root',
      perms: MAIL_SPOOL_DIR,
      entries: new Map(),
    });
  });

  it('has an empty /etc/emailit that only root may enter', () => {
    expect(nodeAt(siteBox(EMAILIT_NETWORK), '/etc/emailit')).toMatchObject({
      kind: 'directory',
      owner: 'root',
      perms: ROOT_DIR,
      entries: new Map(),
    });
  });

  it.each(['user', 'guest'] as const)('is not there for a %s session', (tier) => {
    const pruned = filterTreeForSession(siteBox(EMAILIT_NETWORK), tier);

    expect(nodeAt(pruned, '/var/mail')).toBeUndefined();
    expect(nodeAt(pruned, '/etc/emailit')).toBeUndefined();
  });

  it.each(['findit.io', 'hackademy.io', 'mapit.io'])('is kept on %s by nobody', (key) => {
    expect(nodeAt(siteBox(key), '/var/mail')).toBeUndefined();
    expect(nodeAt(siteBox(key), '/etc/emailit')).toBeUndefined();
  });
});

describe('the front page findit.io serves', () => {
  it('publishes a search form that documents itself', () => {
    const page = read(finditBox(), '/var/www/html/index.html') ?? '';
    expect(page).toContain('<title>findit.io</title>');
    expect(page).toContain('<form action="/" method="GET">');
    expect(page).toMatch(/<input type="text" name="q"[^>]*>/);
  });
});
