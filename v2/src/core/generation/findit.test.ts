import { describe, expect, it } from 'vitest';
import { FINDIT_NETWORK } from './findit';
import { materializeApGatewayFs } from '../network/materializeRouterFs';
import { readOpenPorts } from '../services/pidfile';
import { SERVICE_CATALOG } from '../services/serviceCatalog';
import { canBoot } from '../boot/bootFiles';
import { createFsView } from '../filesystem/fsView';
import { parseDpkgVersions, readDpkgStatus } from '../packages/dpkgStatus';
import { ALL_GENERATED_PASSWORDS, UNCRACKABLE_PASSWORDS } from './passwordPools';
import { md5 } from './md5';
import { asAbsPath } from '../types';
import type { Directory } from '../filesystem/types';

/**
 * findit.io is a box like any other: reached at its public address, it is a machine
 * with a filesystem, running what a web host runs, and hardened the way a real one is.
 * Nothing about it is soft on purpose — it falls, if it falls, the way every box does.
 */

const finditBox = (): Directory =>
  materializeApGatewayFs({ essid: FINDIT_NETWORK }, []);

const read = (tree: Directory, path: string): string | null => {
  const result = createFsView(tree, { userType: 'root' }).read(asAbsPath(path));
  return result.ok ? result.content : null;
};

describe('the box findit.io runs on', () => {
  it('comes up', () => {
    expect(canBoot(finditBox()).ok).toBe(true);
  });

  it('runs a web server and a way to log in, and nothing else', () => {
    const open = readOpenPorts(finditBox()).map(({ port, service }) => ({ port, service }));
    expect(open).toEqual(
      expect.arrayContaining([
        { port: 80, service: SERVICE_CATALOG.http.service },
        { port: 22, service: SERVICE_CATALOG.ssh.service },
      ]),
    );
    expect(open).toHaveLength(2);
  });

  it('keeps a root account whose password no wordlist holds', () => {
    const passwd = read(finditBox(), '/etc/passwd') ?? '';
    const root = passwd.split('\n').find((line) => line.startsWith('root:'));
    const hash = root?.split(':')[1];
    expect(UNCRACKABLE_PASSWORDS.map(md5)).toContain(hash);
  });

  it('keeps no other account a password could open', () => {
    const passwd = read(finditBox(), '/etc/passwd') ?? '';
    const hashes = passwd
      .split('\n')
      .filter((line) => line !== '' && !line.startsWith('root:'))
      .map((line) => line.split(':')[1]);
    const generated = new Set(ALL_GENERATED_PASSWORDS.map(md5));
    expect(hashes.filter((hash) => hash !== undefined && generated.has(hash))).toEqual([]);
  });

  it('lists the packages behind what it runs, so a scan can read their versions', () => {
    const versions = parseDpkgVersions(readDpkgStatus(finditBox()));
    expect(versions.has(SERVICE_CATALOG.http.package)).toBe(true);
    expect(versions.has(SERVICE_CATALOG.ssh.package)).toBe(true);
  });

  it('publishes a search form that documents itself', () => {
    const page = read(finditBox(), '/var/www/html/index.html') ?? '';
    expect(page).toContain('<title>findit.io</title>');
    expect(page).toContain('<form action="/" method="GET">');
    expect(page).toMatch(/<input type="text" name="q"[^>]*>/);
  });

  it('keeps the logs its two daemons write to', () => {
    const tree = finditBox();
    expect(read(tree, '/var/log/access.log')).toBe('');
    expect(read(tree, '/var/log/auth.log')).toBe('');
  });

  it('is named findit', () => {
    expect(read(finditBox(), '/etc/hostname')?.trim()).toBe('findit');
  });
});
