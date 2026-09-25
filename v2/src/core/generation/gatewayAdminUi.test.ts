import { describe, expect, it } from 'vitest';
import { gatewayAdminIp } from './gatewayHistory';
import { md5 } from './md5';
import { ALL_GENERATED_PASSWORDS } from './passwordPools';
import { createFsView } from '../filesystem/fsView';
import { asAbsPath } from '../types';
import type { FileNode } from '../filesystem/types';
import { FIRMWARE_VENDORS, type FirmwareVendor } from '../packages/packageVersions';
import {
  ALL_ESSIDS,
  filesUnder,
  gatewaysOn,
  softwareVersionsIn,
  type Gateway,
} from '../../test/worldContent';

/**
 * A gateway's admin UI, as a player who is on the box finds it: the vendor's pages in
 * its web root, and the server config that keeps them on the loopback.
 */

const IPV4 = /\b\d{1,3}(?:\.\d{1,3}){3}\b/g;
const LOOPBACK = '127.0.0.1';
/** The most characters one signed write carries, which is what a fetched copy costs. */
const CARRY_CAP = 8192;
const PASSWORD_WORDS: ReadonlySet<string> = new Set(ALL_GENERATED_PASSWORDS);

/** Where each vendor's firmware keeps its admin pages. Never under `/var/www`, which
 *  anyone off the box may read: these pages are for the box's own admin. */
const WEB_ROOTS: Readonly<Record<FirmwareVendor, string>> = {
  cisco: '/usr/share/cisco/www',
  mikrotik: '/usr/share/mikrotik/www',
  openwrt: '/www',
  ddwrt: '/www',
  pfsense: '/usr/local/www',
  ubiquiti: '/usr/share/ubiquiti/www',
};

/** Where each vendor's web server keeps the config that says where it listens. */
const SERVER_CONFIGS: Readonly<Record<FirmwareVendor, string>> = {
  cisco: '/etc/lighttpd/lighttpd.conf',
  mikrotik: '/etc/lighttpd/lighttpd.conf',
  openwrt: '/etc/config/uhttpd',
  ddwrt: '/etc/lighttpd/lighttpd.conf',
  pfsense: '/var/etc/nginx-webConfigurator.conf',
  ubiquiti: '/etc/lighttpd/lighttpd.conf',
};

const everyGateway = (): readonly Gateway[] => gatewaysOn(ALL_ESSIDS);

const view = (gateway: Gateway, userType: 'root' | 'guest' = 'root') =>
  createFsView(gateway.tree, { userType });

const nodeAt = (gateway: Gateway, path: string): FileNode | null =>
  view(gateway).stat(asAbsPath(path));

const contentAt = (gateway: Gateway, path: string): string => {
  const node = nodeAt(gateway, path);
  return node?.kind === 'file' ? node.content : '';
};

const vendorOf = (gateway: Gateway): FirmwareVendor => {
  const vendor = /^Package: (\w+)-firmware$/m.exec(contentAt(gateway, '/var/lib/dpkg/status'))?.[1];
  const known = FIRMWARE_VENDORS.find((candidate) => candidate === vendor);
  if (known === undefined) throw new Error(`${gateway.name} runs no known firmware`);
  return known;
};

const isAccessPoint = (gateway: Gateway): boolean => gateway.onLan && gateway.host.ip.endsWith('.1');

/** The admin pages, by file name. */
const pagesOf = (gateway: Gateway): ReadonlyMap<string, string> => {
  const root = nodeAt(gateway, WEB_ROOTS[vendorOf(gateway)]);
  if (root?.kind !== 'directory') throw new Error(`${gateway.name} keeps no admin pages`);
  return filesUnder(root);
};

const linksIn = (page: string): readonly string[] =>
  [...page.matchAll(/href="([^"]+)"/g)].map(([, target]) => target ?? '');

/** Every address the gateway's own network files state. */
const addressesItKnows = (gateway: Gateway): ReadonlySet<string> =>
  new Set(
    ['/var/lib/misc/dnsmasq.leases', '/etc/dnsmasq.conf', '/var/lib/switch/mac-table'].flatMap(
      (path) =>
        contentAt(gateway, path)
          .split('\n')
          .filter((line) => !line.startsWith('dhcp-range='))
          .flatMap((line) => line.match(IPV4) ?? []),
    ),
  );

/** What the gateway holds beyond the skeleton every gateway shares: what it knows of
 *  its network, root's history and backups, its rotated logs and its admin pages. The
 *  web server's config is not counted, any more than the agent's is: it is the daemon's
 *  own configuration, not something the box has accumulated. */
const contentFilesOf = (gateway: Gateway): readonly string[] => {
  const under = (path: string): readonly string[] => {
    const node = nodeAt(gateway, path);
    if (node === null) return [];
    return node.kind === 'file' ? [path] : [...filesUnder(node).keys()].map((name) => `${path}/${name}`);
  };
  const logs = nodeAt(gateway, '/var/log');
  if (logs?.kind !== 'directory') throw new Error(`${gateway.name} has no /var/log`);
  const rotated = [...filesUnder(logs).keys()]
    .filter((name) => name.endsWith('.1'))
    .map((name) => `/var/log/${name}`);
  return [
    ...under('/var/lib/misc'),
    ...under('/var/lib/switch'),
    ...under('/etc/dnsmasq.conf'),
    ...under('/root'),
    ...rotated,
    ...under(WEB_ROOTS[vendorOf(gateway)]),
  ];
};

describe("a gateway's admin pages", () => {
  it('keeps them in its vendor’s web root, where anyone on the box may read them', () => {
    for (const gateway of everyGateway()) {
      const root = WEB_ROOTS[vendorOf(gateway)];
      for (const name of pagesOf(gateway).keys()) {
        expect(name, gateway.name).toMatch(/^[a-z]+\.html$/);
        expect(view(gateway, 'guest').read(asAbsPath(`${root}/${name}`)).ok, `${gateway.name} ${name}`).toBe(true);
      }
    }
  });

  it('publishes nothing where a reader off the box could fetch it', () => {
    for (const gateway of everyGateway()) {
      expect(nodeAt(gateway, '/var/www'), gateway.name).toBeNull();
    }
  });

  it('keeps two on the access point, which every occupant carries, and two to four elsewhere', () => {
    for (const gateway of everyGateway()) {
      const count = pagesOf(gateway).size;
      if (isAccessPoint(gateway)) {
        expect(count, gateway.name).toBe(2);
      } else {
        expect(count, gateway.name).toBeGreaterThanOrEqual(2);
        expect(count, gateway.name).toBeLessThanOrEqual(4);
      }
    }
  });

  it('links from the front page to every other page, and from each back to it, with no dead link', () => {
    for (const gateway of everyGateway()) {
      const pages = pagesOf(gateway);
      const front = pages.get('index.html');
      expect(front, gateway.name).toBeDefined();
      expect(new Set(linksIn(front ?? '')), gateway.name).toEqual(
        new Set([...pages.keys()].filter((name) => name !== 'index.html')),
      );
      for (const [name, page] of pages) {
        for (const target of linksIn(page)) {
          expect(pages.has(target), `${gateway.name} ${name} links ${target}`).toBe(true);
        }
        if (name !== 'index.html') expect(linksIn(page), `${gateway.name} ${name}`).toContain('index.html');
      }
    }
  });

  it("shows what the gateway serves: every lease a router holds, the host on a switch's port", () => {
    for (const gateway of everyGateway()) {
      const shown = [...pagesOf(gateway).values()].join('\n');
      const rows =
        gateway.host.kind === 'router'
          ? contentAt(gateway, '/var/lib/misc/dnsmasq.leases').split('\n').filter((row) => row !== '')
          : contentAt(gateway, '/var/lib/switch/mac-table').split('\n').filter((row) => /^gi/.test(row));
      expect(rows.length, gateway.name).toBeGreaterThan(0);
      for (const row of rows) {
        const mac = /[0-9a-f]{2}(?::[0-9a-f]{2}){5}/.exec(row)?.[0] ?? '';
        const ip = row.match(IPV4)?.[0] ?? '';
        expect(shown, `${gateway.name} shows ${mac}`).toContain(mac);
        expect(shown, `${gateway.name} shows ${ip}`).toContain(ip);
      }
    }
  });

  it('names no host but its own, its admin and the hosts its network files list', () => {
    for (const gateway of everyGateway()) {
      const known = new Set([
        gateway.host.ip,
        gatewayAdminIp(gateway.essid, gateway.machineId),
        ...addressesItKnows(gateway),
      ]);
      const serves = /^dhcp-range=(\S+)\.2,/m.exec(contentAt(gateway, '/etc/dnsmasq.conf'))?.[1];
      if (serves !== undefined) known.add(`${serves}.1`);
      for (const [name, page] of pagesOf(gateway)) {
        for (const address of page.match(IPV4) ?? []) {
          expect(known.has(address), `${gateway.name} ${name} names ${address}`).toBe(true);
        }
      }
    }
  });

  it('shows no secret the box accepts, and no word a password is drawn from', () => {
    for (const gateway of everyGateway()) {
      const hashes = [
        /^root:([^:]+):/m.exec(contentAt(gateway, '/etc/passwd'))?.[1],
        /^rwcommunity\s+(\S+)/m.exec(contentAt(gateway, '/var/lib/snmp/snmpd.conf'))?.[1],
      ].filter((hash) => hash !== undefined);
      for (const [name, page] of pagesOf(gateway)) {
        for (const word of page.split(/[\s'"<>=,/()]+/)) {
          expect(hashes, `${gateway.name} ${name}: ${word}`).not.toContain(md5(word));
          expect(PASSWORD_WORDS.has(word), `${gateway.name} ${name}: ${word}`).toBe(false);
        }
      }
    }
  });

  it('names no software version', () => {
    for (const gateway of everyGateway()) {
      for (const [name, page] of pagesOf(gateway)) {
        expect(softwareVersionsIn(page), `${gateway.name} ${name}`).toEqual([]);
      }
    }
  });

  it('fits each page in the single write that saves a fetched copy', () => {
    for (const gateway of everyGateway()) {
      for (const [name, page] of pagesOf(gateway)) {
        expect(JSON.stringify(page).length, `${gateway.name} ${name}`).toBeLessThanOrEqual(CARRY_CAP);
      }
    }
  });

  it('differs from gateway to gateway', () => {
    const fronts = everyGateway().map((gateway) => pagesOf(gateway).get('index.html'));
    expect(new Set(fronts).size).toBe(fronts.length);
  });
});

describe("a gateway's admin web server", () => {
  it('listens on the loopback alone, serving the web root the pages are in', () => {
    for (const gateway of everyGateway()) {
      const vendor = vendorOf(gateway);
      const config = contentAt(gateway, SERVER_CONFIGS[vendor]);
      expect(config, gateway.name).toContain(WEB_ROOTS[vendor]);
      const addresses = config.match(IPV4) ?? [];
      expect(addresses.length, gateway.name).toBeGreaterThan(0);
      for (const address of addresses) expect(address, gateway.name).toBe(LOOPBACK);
    }
  });

  it('runs as no new daemon, so the box answers on the ports it always did', () => {
    for (const gateway of everyGateway()) {
      const run = nodeAt(gateway, '/var/run');
      if (run?.kind !== 'directory') throw new Error(`${gateway.name} has no /var/run`);
      for (const pidfile of run.entries.keys()) {
        expect(['sshd.pid', 'snmpd.pid'], `${gateway.name} runs ${pidfile}`).toContain(pidfile);
      }
    }
  });
});

describe('how much a gateway holds', () => {
  it('holds five to ten files of its own on the access point, and eight to fifteen elsewhere', () => {
    for (const gateway of everyGateway()) {
      const count = contentFilesOf(gateway).length;
      const [fewest, most] = isAccessPoint(gateway) ? [5, 10] : [8, 15];
      expect(count, gateway.name).toBeGreaterThanOrEqual(fewest);
      expect(count, gateway.name).toBeLessThanOrEqual(most);
    }
  });
});
