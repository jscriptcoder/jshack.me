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

/** What each vendor calls its admin UI, which every page heads itself with. */
const PRODUCTS: Readonly<Record<FirmwareVendor, string>> = {
  cisco: 'Cisco Device Manager',
  mikrotik: 'WebFig',
  openwrt: 'LuCI',
  ddwrt: 'DD-WRT Control Panel',
  pfsense: 'pfSense webConfigurator',
  ubiquiti: 'EdgeOS',
};

/** How each web server's config reads: uhttpd's uci section, nginx's server block, and
 *  lighttpd's `key = value` lines for every other vendor. */
const SERVER_CONFIG_SHAPES: Partial<Record<FirmwareVendor, RegExp>> = {
  openwrt: /^config uhttpd 'main'\n(\t(list|option) \w+ '[^']+'\n)+$/,
  pfsense: /^server \{\n(\t[^\n]+;\n)+\}\n$/,
};
const LIGHTTPD_SHAPE = /^([\w.-]+ = [^\n]+\n)+$/;

const everyGateway = (): readonly Gateway[] => gatewaysOn(ALL_ESSIDS);

/** Why a page is not a document a browser would render as its author meant, or null. */
const malformation = (page: string): string | null => {
  if (!page.startsWith('<!DOCTYPE html>\n<html>\n<head>\n<title>')) return 'opens wrongly';
  if (!page.endsWith('</body>\n</html>\n')) return 'closes wrongly';
  const open: string[] = [];
  for (const [, closing, name = ''] of page.matchAll(/<(\/?)([a-z][a-z\d]*)[^>]*>/g)) {
    if (closing === '/') {
      if (open.pop() !== name) return `</${name}> closes nothing open`;
    } else {
      open.push(name);
    }
  }
  return open.length === 0 ? null : `leaves <${open.join('>, <')}> open`;
};

/** A page's tables, each as its heading cells and its rows of cells. */
const tablesIn = (page: string) =>
  [...page.matchAll(/<table>\n([\s\S]*?)\n<\/table>/g)].map(([, body = '']) => {
    const [heading = '', ...rows] = body.split('\n');
    const cells = (row: string, tag: string) =>
      [...row.matchAll(new RegExp(`<${tag}>(.*?)</${tag}>`, 'g'))].map(([, cell = '']) => cell);
    return { headings: cells(heading, 'th'), rows: rows.map((row) => cells(row, 'td')) };
  });

/** The value a settings table gives a setting, on any of the gateway's pages. */
const settingOn = (page: string, setting: string): string | undefined =>
  tablesIn(page)
    .flatMap(({ rows }) => rows)
    .find(([name]) => name === setting)?.[1];

const headingOf = (page: string): string => /<h2>(.*)<\/h2>/.exec(page)?.[1] ?? '';

/** A moment of the epoch as the admin UI prints it. */
const printed = (epochSeconds: number): string =>
  new Date(epochSeconds * 1000).toISOString().slice(0, 19).replace('T', ' ');

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

describe("what a gateway's admin pages say", () => {
  it('is well-formed HTML, headed with the vendor’s own product and the page’s title', () => {
    for (const gateway of everyGateway()) {
      const product = PRODUCTS[vendorOf(gateway)];
      for (const [name, page] of pagesOf(gateway)) {
        expect(malformation(page), `${gateway.name} ${name}`).toBeNull();
        const title = headingOf(page);
        expect(title, `${gateway.name} ${name}`).not.toBe('');
        expect(page, `${gateway.name} ${name}`).toContain(`<h1>${product}</h1>`);
        expect(page, `${gateway.name} ${name}`).toContain(
          `<title>${title} - ${gateway.host.hostname} - ${product}</title>`,
        );
      }
    }
  });

  it('names every link after the page it opens', () => {
    for (const gateway of everyGateway()) {
      const pages = pagesOf(gateway);
      for (const [name, page] of pages) {
        for (const [, target = '', text] of page.matchAll(/<a href="([^"]+)">([^<]*)<\/a>/g)) {
          expect(text, `${gateway.name} ${name} -> ${target}`).toBe(headingOf(pages.get(target) ?? ''));
        }
      }
    }
  });

  it('heads every column, and fills every row to the width of its heading', () => {
    for (const gateway of everyGateway()) {
      for (const [name, page] of pagesOf(gateway)) {
        for (const { headings, rows } of tablesIn(page)) {
          expect(headings.length, `${gateway.name} ${name}`).toBeGreaterThan(0);
          for (const heading of headings) expect(heading, `${gateway.name} ${name}`).not.toBe('');
          for (const row of rows) {
            expect(row.length, `${gateway.name} ${name}`).toBe(headings.length);
            for (const cell of row) expect(cell, `${gateway.name} ${name}`).not.toBe('');
          }
        }
      }
    }
  });

  it('states on its front page the name and address the box answers on', () => {
    for (const gateway of everyGateway()) {
      const front = pagesOf(gateway).get('index.html') ?? '';
      const serves = /^dhcp-range=(\S+)\.2,/m.exec(contentAt(gateway, '/etc/dnsmasq.conf'))?.[1];
      expect(settingOn(front, 'Hostname'), gateway.name).toBe(gateway.host.hostname);
      expect(settingOn(front, 'LAN address'), gateway.name).toBe(
        serves === undefined ? gateway.host.ip : `${serves}.1`,
      );
    }
  });

  it('lists each lease a router holds, until the moment its lease file says it runs out', () => {
    for (const gateway of everyGateway().filter(({ host }) => host.kind === 'router')) {
      const page = pagesOf(gateway).get('dhcp.html') ?? '';
      const [active, reserved] = tablesIn(page);
      expect(page, gateway.name).toMatch(/<h3>Active leases<\/h3>\n<table>[\s\S]*<h3>Static leases<\/h3>\n<table>/);
      const leases = contentAt(gateway, '/var/lib/misc/dnsmasq.leases').split('\n').filter((row) => row !== '');
      expect(active?.rows, gateway.name).toEqual(
        leases.map((row) => {
          const [expiry = '', mac = '', ip = '', hostname = ''] = row.split(' ');
          return [hostname, ip, mac, printed(Number(expiry))];
        }),
      );
      const reservations = [
        ...contentAt(gateway, '/etc/dnsmasq.conf').matchAll(/^dhcp-host=([^,]+),([^,]+),(\S+)$/gm),
      ].map(([, mac = '', ip = '', hostname = '']) => [hostname, ip, mac]);
      expect(reserved?.rows, gateway.name).toEqual(reservations);
    }
  });

  it("lists a switch's port as its MAC table does", () => {
    for (const gateway of everyGateway().filter(({ host }) => host.kind === 'switch')) {
      const [ports] = tablesIn(pagesOf(gateway).get('ports.html') ?? '');
      const rows = contentAt(gateway, '/var/lib/switch/mac-table')
        .split('\n')
        .filter((row) => /^gi/.test(row))
        .map((row) => {
          const [port = '', mac = '', vlan = '', ...description] = row.split(/\s+/);
          return [port, mac, vlan, description.join(' ')];
        });
      expect(ports?.rows, gateway.name).toEqual(rows);
    }
  });

  it('says a router forwards nothing and a switch denies what its ACL does, where it shows its firewall', () => {
    let shown = 0;
    for (const gateway of everyGateway()) {
      const page = pagesOf(gateway).get('firewall.html');
      if (page === undefined) continue;
      shown += 1;
      if (gateway.host.kind === 'router') {
        expect(headingOf(page), gateway.name).toBe('Port forwards');
        expect(page, gateway.name).toContain('<p>No port forwards are configured.</p>');
      } else {
        expect(headingOf(page), gateway.name).toBe('Access control');
        const denies = [...contentAt(gateway, '/etc/switch/acl.conf').matchAll(/^deny (\d+)$/gm)].map(
          ([, port = '']) => ['deny', 'tcp', port],
        );
        expect(tablesIn(page)[0]?.rows, gateway.name).toEqual(denies);
      }
    }
    expect(shown).toBeGreaterThan(0);
  });

  it('states on its system page what runs on the box, and where it is managed from', () => {
    let shown = 0;
    for (const gateway of everyGateway()) {
      const page = pagesOf(gateway).get('system.html');
      if (page === undefined) continue;
      shown += 1;
      const runsAgent = nodeAt(gateway, '/var/run/snmpd.pid') !== null;
      expect(headingOf(page), gateway.name).toBe('System');
      expect(settingOn(page, 'Hostname'), gateway.name).toBe(gateway.host.hostname);
      expect(settingOn(page, 'SSH'), gateway.name).toBe('enabled');
      expect(settingOn(page, 'SNMP agent'), gateway.name).toBe(runsAgent ? 'enabled' : 'disabled');
      expect(settingOn(page, 'Managed from'), gateway.name).toBe(
        gatewayAdminIp(gateway.essid, gateway.machineId),
      );
    }
    expect(shown).toBeGreaterThan(0);
  });

  it('gives some gateways on the LAN and some below it three pages and some four', () => {
    const counts = (keep: (gateway: Gateway) => boolean) =>
      [...new Set(everyGateway().filter(keep).map((gateway) => pagesOf(gateway).size))].sort();
    expect(counts((gateway) => gateway.onLan && !isAccessPoint(gateway))).toEqual([2, 3, 4]);
    expect(counts((gateway) => !gateway.onLan)).toEqual([2, 3, 4]);
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
      expect(config, gateway.name).toMatch(/(:| = )80\b/);
      // Each server's config in the shape that server reads.
      expect(config, gateway.name).toMatch(SERVER_CONFIG_SHAPES[vendor] ?? LIGHTTPD_SHAPE);
      expect(config, gateway.name).toContain('index.html');
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
