import { describe, expect, it } from 'vitest';
import { FINDIT_NETWORK } from './fixedSites.js';
import { materializeApGatewayFs } from '../network/materializeRouterFs.js';
import { readOpenPorts, readRunningProcesses } from '../services/pidfile.js';
import { SERVICE_CATALOG } from '../services/serviceCatalog.js';
import { canBoot } from '../boot/bootFiles.js';
import { createFsView } from '../filesystem/fsView.js';
import { parseDpkgVersions, readDpkgStatus } from '../packages/dpkgStatus.js';
import { ALL_GENERATED_PASSWORDS, UNCRACKABLE_PASSWORDS } from './passwordPools.js';
import { md5 } from './md5.js';
import { asAbsPath } from '../types.js';
import type { Directory } from '../filesystem/types.js';

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
    expect(rootHash('findit.io')).not.toBe(rootHash('hackademy.io'));
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
