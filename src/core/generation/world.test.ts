import { describe, expect, it } from 'vitest';
import { siteAddress } from './publisher.js';
import { isPublicIp } from './ip.js';
import { FINDIT_DOMAIN, FINDIT_NETWORK } from './finditNetwork.js';
import { siteServer } from './siteServer.js';
import { resolveLanHostIdentity } from './lanHostIdentity.js';
import { createFsView } from '../filesystem/fsView.js';
import { walkTree } from '../filesystem/walkTree.js';
import { asAbsPath } from '../types.js';
import {
  DECLARED_NETWORKS,
  networkAt,
  PLACELESS_FIRST_OCTET,
  publicAddress,
  REGION_FIRST_OCTETS,
  type DeclaredNetwork,
} from './world.js';
import { generateHomeLan } from './generateHomeLan.js';
import { buildApGatewayBaseFs } from './routerFs.js';
import { resolveLanName } from '../network/resolveName.js';
import { crackableEssidPool } from './generateWifi.js';
import { TOWN_HOMES } from './pools/townHomes.js';
import { relationsTo } from './relations.js';
import { indexedWeb } from '../findit/webIndex.js';

/**
 * The world reaches past Ridgemont. Millbrook is a village of its own, with its own block
 * of public addresses, whose institutions put their websites on the internet the way
 * Ridgemont's do. Nobody stands on its wifi yet, so the internet is the only way there.
 */

/** The page at `file` beneath the web root of the box `domain`'s network serves the web
 *  from, or `undefined` when that site keeps no such page. */
const pageAt = (domain: string, file: string): string | undefined => {
  const address = siteAddress(domain);
  if (address === undefined) throw new Error(`nobody holds ${domain}`);
  const key = networkAt(address);
  if (key === undefined) throw new Error(`nothing answers at ${address}`);
  const server = siteServer(key);
  if (server === undefined) throw new Error(`${key} serves no site`);
  const read = createFsView(resolveLanHostIdentity(server, key).baseFs, {
    userType: 'root',
  }).read(asAbsPath(`/var/www/html/${file}`));
  return read.ok ? read.content : undefined;
};

/** The front page served at `domain`. */
const homepageAt = (domain: string): string => {
  const homepage = pageAt(domain, 'index.html');
  if (homepage === undefined) throw new Error(`${domain} has no front page`);
  return homepage;
};

/** Every link a page holds out of its own site, as its address and the words it is
 *  written under, in the order the page holds them. */
const outboundLinksIn = (page: string): readonly (readonly [string, string])[] =>
  [...page.matchAll(/<a href="(http:\/\/[^"]+)">([^<]*)<\/a>/g)].map(
    ([, href, label]) => [href ?? '', label ?? ''] as const,
  );

/** What a front page says about itself in its `<meta name="description">`. */
const descriptionOf = (homepage: string): string =>
  homepage.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? '';

/** Every file under the web root of the box `key` serves its site from, by path. */
const servedFiles = (key: string): readonly (readonly [string, string])[] => {
  const server = siteServer(key);
  if (server === undefined) throw new Error(`${key} serves no site`);
  const fs = createFsView(resolveLanHostIdentity(server, key).baseFs, { userType: 'root' });
  return walkTree(fs, asAbsPath('/var/www'), (path, node) =>
    node.kind === 'file' ? [[path, node.content] as const] : [],
  );
};

/** Every network the world declares in Millbrook. */
const millbrook = (): readonly DeclaredNetwork[] =>
  DECLARED_NETWORKS.filter((network) => network.town === 'Millbrook');

describe('Millbrook', () => {
  it("answers the council's domain at an address in its region's block", () => {
    expect(siteAddress('millbrook.gov')).toMatch(/^87\.\d{1,3}\.\d{1,3}\.\d{1,3}$/);
  });

  it.each([
    ['millbrook.gov', 'Millbrook Town Council'],
    ['millbrookpd.gov', 'Millbrook Police Department'],
    ['millbrooklibrary.org', 'Millbrook Public Library'],
  ])('serves %s under the name of the institution that holds it', (domain, name) => {
    expect(homepageAt(domain)).toContain(`<title>${name}</title>`);
  });

  it('describes each institution the way its kind of place describes itself', () => {
    expect(descriptionOf(homepageAt('millbrook.gov'))).toContain('public services');
    expect(descriptionOf(homepageAt('millbrookpd.gov'))).toContain('public services');
    expect(descriptionOf(homepageAt('millbrooklibrary.org'))).toContain(
      'visitor information for the people of Millbrook.',
    );
  });

  it('gives every network an address in its region block that a player can reach', () => {
    for (const network of millbrook()) {
      const address = publicAddress(network.key) ?? '';
      expect(address, network.key).toMatch(/^87\.\d{1,3}\.\d{1,3}\.\d{1,3}$/);
      const fourth = Number(address.split('.')[3]);
      expect(fourth, network.key).toBeGreaterThanOrEqual(2);
      expect(fourth, network.key).toBeLessThanOrEqual(254);
      expect(isPublicIp(address), network.key).toBe(true);
    }
  });

  it('keeps every network under the key, name, domain and address it was declared with', () => {
    // A key, a name or an address that moved would strand every journal, bookmark and note
    // a player holds about the network, so the declaration only ever grows.
    expect(
      millbrook().map((network) => [
        network.key,
        network.essid,
        network.place,
        network.site?.domain,
        publicAddress(network.key),
      ]),
    ).toEqual([
      ['r0/t1/n0', 'TOWN-HALL-WIFI', 'the town hall', 'millbrook.gov', '87.98.0.2'],
      ['r0/t1/n1', 'MILLBROOK-PD', 'the police station', 'millbrookpd.gov', '87.98.97.142'],
      ['r0/t1/n2', 'LIBRARY-PUBLIC', 'the public library', 'millbrooklibrary.org', '87.98.195.29'],
      ['r0/t1/n3', 'TIPSY-TEAPOT', 'Tipsy Teapot', 'tipsyteapot.com', '87.98.36.169'],
      ['r0/t1/n4', 'HARVEST-MARKET', 'Harvest Market', 'harvestmarket.com', '87.98.134.56'],
      [
        'r0/t1/n5',
        'GREENLEAF-GROCERS',
        'Greenleaf Grocers',
        'greenleafgrocers.com',
        '87.98.231.196',
      ],
      ['r0/t1/n6', 'CORNER-PANTRY', 'Corner Pantry', 'cornerpantry.com', '87.98.73.83'],
      [
        'r0/t1/n7',
        'KEYSTONE-LOGISTICS',
        'Keystone Logistics',
        'keystonelogistics.com',
        '87.98.170.223',
      ],
      [
        'r0/t1/n8',
        'PINNACLE-IT-SOLUTIONS',
        'Pinnacle IT Solutions',
        'pinnacleitsolutions.com',
        '87.98.12.110',
      ],
      ['r0/t1/n9', 'KOWALSKI-WIFI', "the Kowalskis' house", undefined, '87.98.109.250'],
      ['r0/t1/n10', 'THE-HARGREAVES', "the Hargreaves' house", undefined, '87.98.207.137'],
      ['r0/t1/n11', 'GARDEN-FLAT', 'the garden flat', undefined, '87.98.49.24'],
      ['r0/t1/n12', 'ROSE-COTTAGE', 'Rose Cottage', undefined, '87.98.146.164'],
      ['r0/t1/n13', 'PEAR-TREE-HOUSE', 'Pear Tree House', undefined, '87.98.244.51'],
      ['r0/t1/n14', 'OKONKWO-FAMILY', 'the Okonkwo family home', undefined, '87.98.85.191'],
    ]);
  });

  it('scatters its networks across its block rather than numbering them in a row', () => {
    const slots = millbrook().map((network) => {
      const [, , third, fourth] = (publicAddress(network.key) ?? '').split('.').map(Number);
      return (third ?? 0) * 256 + (fourth ?? 0);
    });
    for (const slot of slots) {
      expect(slots.filter((other) => Math.abs(other - slot) <= 1)).toEqual([slot]);
    }
  });

  it('keeps 3 to 6 businesses of its own on the internet, each under its own name', () => {
    const businesses = millbrook().filter((network) =>
      ['cafe', 'retail', 'corporate'].includes(network.category),
    );
    expect(businesses.length).toBeGreaterThanOrEqual(3);
    expect(businesses.length).toBeLessThanOrEqual(6);
    for (const business of businesses) {
      expect(business.site?.name).toBe(business.place);
      expect(business.site?.domain).toMatch(/^[a-z0-9]+\.com$/);
      expect(homepageAt(business.site?.domain ?? '')).toContain(
        `<title>${business.site?.name}</title>`,
      );
    }
    const essids = millbrook().map((network) => network.essid);
    expect(new Set(essids).size).toBe(essids.length);
  });

  it('gives no two networks in the world the same address or the same domain', () => {
    const addresses = [
      ...DECLARED_NETWORKS.flatMap((network) => publicAddress(network.key) ?? []),
      siteAddress(FINDIT_DOMAIN),
    ];
    const domains = [
      ...DECLARED_NETWORKS.flatMap((network) => network.site?.domain ?? []),
      FINDIT_DOMAIN,
    ];
    expect(new Set(addresses).size).toBe(addresses.length);
    expect(new Set(domains).size).toBe(domains.length);
  });

  it('finds each network again behind the address it answers at', () => {
    for (const network of millbrook()) {
      expect(networkAt(publicAddress(network.key) ?? '')).toBe(network.key);
    }
  });

  it('names its machines under the zone of the wifi they stand on', () => {
    const council = millbrook().find((network) => network.site?.domain === 'millbrook.gov');
    const machine = generateHomeLan(council?.key ?? '').hosts.find(
      (host) => host.kind === 'machine',
    );
    expect(resolveLanName(council?.key ?? '', machine?.hostname ?? '')?.fqdn).toBe(
      `${machine?.hostname}.town-hall-wifi.lan`,
    );
  });

  it('never writes the key it is known by into any file on its gateway or its machines', () => {
    for (const network of millbrook()) {
      const slug = network.key.replaceAll('/', '-');
      const machines = generateHomeLan(network.key)
        .hosts.filter((host) => host.kind === 'machine')
        .map((host) => ({
          name: host.hostname,
          fs: resolveLanHostIdentity(host, network.key).baseFs,
        }));
      const boxes = [{ name: 'gateway', fs: buildApGatewayBaseFs(network.key) }, ...machines];
      for (const box of boxes) {
        const fs = createFsView(box.fs, { userType: 'root' });
        for (const [path, content] of walkTree(fs, asAbsPath('/'), (filePath, node) =>
          node.kind === 'file' ? [[filePath, node.content] as const] : [],
        )) {
          expect(content, `${network.key} ${box.name} ${path}`).not.toContain(network.key);
          expect(content, `${network.key} ${box.name} ${path}`).not.toContain(slug);
        }
      }
    }
  });

  it('never calls itself Ridgemont on any page its sites serve', () => {
    const millbrookSites = millbrook().filter((network) => network.site !== undefined);
    expect(millbrookSites.length).toBeGreaterThan(0);
    for (const network of millbrookSites) {
      for (const [path, content] of servedFiles(network.key)) {
        expect(content, `${network.key} ${path}`).not.toContain('Ridgemont');
      }
    }
  });
});

describe("Millbrook's town directory", () => {
  /** The council's directory page, which every other test here reads. */
  const directory = (): string => {
    const page = pageAt('millbrook.gov', 'directory.html');
    if (page === undefined) throw new Error('millbrook.gov keeps no directory');
    return page;
  };

  it('is linked from every page of the council site a reader can browse', () => {
    const council = millbrook().find((network) => network.site?.domain === 'millbrook.gov');
    const browsable = servedFiles(council?.key ?? '').filter(([, content]) =>
      content.includes('<a href="/">Home</a>'),
    );
    expect(browsable.length).toBeGreaterThan(1);
    for (const [path, content] of browsable) {
      expect(content, path).toContain('<a href="/directory.html">Town directory</a>');
    }
    expect(directory()).toContain('<h1>Town directory</h1>');
  });

  it('introduces the institutions as those of its own town', () => {
    expect(directory()).toContain('<p>The public bodies of Millbrook,');
  });

  it("is kept on the council's public site, never on another box of its network", () => {
    const council = millbrook().find((network) => network.site?.domain === 'millbrook.gov');
    const key = council?.key ?? '';
    const server = siteServer(key);
    const others = generateHomeLan(key).hosts.filter(
      (host) => host.kind === 'machine' && host.ip !== server?.ip,
    );
    const webBoxes = others.filter((host) =>
      createFsView(resolveLanHostIdentity(host, key).baseFs, { userType: 'root' })
        .read(asAbsPath('/var/www/html/index.html')).ok,
    );
    expect(webBoxes.length).toBeGreaterThan(0);
    for (const host of webBoxes) {
      const read = createFsView(resolveLanHostIdentity(host, key).baseFs, {
        userType: 'root',
      }).read(asAbsPath('/var/www/html/directory.html'));
      expect(read.ok, host.hostname).toBe(false);
    }
  });

  it("links every one of the town's institutions under its own name", () => {
    expect(outboundLinksIn(directory())).toEqual([
      ['http://millbrook.gov/', 'Millbrook Town Council'],
      ['http://millbrookpd.gov/', 'Millbrook Police Department'],
      ['http://millbrooklibrary.org/', 'Millbrook Public Library'],
    ]);
  });

  it('leads every link to the front page of the institution it names', () => {
    for (const [href, label] of outboundLinksIn(directory())) {
      const domain = new URL(href).hostname;
      expect(homepageAt(domain), href).toContain(`<title>${label}</title>`);
    }
  });

  it("names no network but the town's own institutions", () => {
    const listed = ['millbrook.gov', 'millbrookpd.gov', 'millbrooklibrary.org'];
    const page = directory();
    for (const network of DECLARED_NETWORKS) {
      if (network.site !== undefined && listed.includes(network.site.domain)) continue;
      expect(page, network.key).not.toContain(network.essid);
      if (network.site === undefined) continue;
      expect(page, network.key).not.toContain(network.site.domain);
      expect(page, network.key).not.toContain(network.site.name);
    }
  });

  it("is kept by the town's council alone", () => {
    const others = DECLARED_NETWORKS.flatMap((network) =>
      network.site === undefined || network.site.domain === 'millbrook.gov'
        ? []
        : [network.site.domain],
    );
    expect(others).toContain('ridgemont.gov');
    for (const domain of others) {
      expect(pageAt(domain, 'directory.html'), domain).toBeUndefined();
      expect(homepageAt(domain), domain).not.toContain('Town directory');
    }
  });
});

/** The most homes a village can keep, which the pool must be able to fill. */
const VILLAGE_HOMES_MOST = 8;

/** Millbrook's homes: the networks there that nobody publishes from. */
const homes = (): readonly DeclaredNetwork[] =>
  millbrook().filter((network) => network.category === 'residential');

describe("Millbrook's homes", () => {
  it('keeps 4 to 8 homes, declared after every business so no earlier key moves', () => {
    const networks = millbrook();
    const count = homes().length;
    expect(count).toBeGreaterThanOrEqual(4);
    expect(count).toBeLessThanOrEqual(8);
    expect(networks.slice(-count)).toEqual(homes());
    expect(networks.map((network) => network.key)).toEqual(
      networks.map((_, index) => `r0/t1/n${index}`),
    );
  });

  it('names every home under a wifi and a place of its own', () => {
    const essids = DECLARED_NETWORKS.map((network) => network.essid);
    expect(new Set(essids).size).toBe(essids.length);
    for (const home of homes()) {
      expect(home.essid).toMatch(/^[A-Z0-9]+(-[A-Z0-9]+)*$/);
      expect(home.place).not.toBe('');
    }
  });

  it('publishes nothing from a home: no site, no domain, no place in the directory', () => {
    const directory = pageAt('millbrook.gov', 'directory.html') ?? '';
    for (const home of homes()) {
      expect(home.site, home.key).toBeUndefined();
      expect(home.directory, home.key).toBeUndefined();
      expect(directory, home.key).not.toContain(home.essid);
      expect(directory, home.key).not.toContain(home.place);
    }
    const homeAddresses = homes().map((home) => publicAddress(home.key));
    for (const network of DECLARED_NETWORKS) {
      if (network.site === undefined) continue;
      expect(homeAddresses, network.site.domain).not.toContain(siteAddress(network.site.domain));
    }
  });

  it('draws every home from a pool of distinct wifi names, each with a place of its own', () => {
    const essids = TOWN_HOMES.map(([essid]) => essid);
    expect(essids.length).toBeGreaterThanOrEqual(VILLAGE_HOMES_MOST);
    expect(new Set(essids).size).toBe(essids.length);
    for (const [essid, place] of TOWN_HOMES) {
      expect(essid).toMatch(/^[A-Z0-9]+(-[A-Z0-9]+)*$/);
      expect(crackableEssidPool, essid).not.toContain(essid);
      expect(place.trim(), essid).not.toBe('');
    }
  });

  it('broadcasts no home to a wifi scan in Ridgemont', () => {
    for (const home of homes()) {
      expect(crackableEssidPool, home.key).not.toContain(home.essid);
    }
  });
});

/**
 * Nothing in the world is out of reach. A network is found on findit, by standing in
 * Ridgemont, on its town's directory, or by a lead kept on a network found one of those
 * ways. One that none of them reach could never be played.
 */
describe('the reach of the world', () => {
  it('leaves no network that nothing leads to', async () => {
    const web = await indexedWeb({
      findPatchesForMachines: async () => ({ data: [], error: null }),
      siteAt: async () => null,
    });
    const searchable = new Set(web.map((page) => page.address));
    const inDirectory = new Set(
      DECLARED_NETWORKS.flatMap((network) => network.directory ?? []).map((site) => site.domain),
    );
    const found = new Set(
      DECLARED_NETWORKS.filter(
        (network) =>
          network.town === 'Ridgemont' ||
          (network.site !== undefined &&
            (searchable.has(network.site.domain) || inDirectory.has(network.site.domain))),
      ).map((network) => network.key),
    );

    const unreached = DECLARED_NETWORKS.filter(
      (network) =>
        !found.has(network.key) &&
        !relationsTo(network.key).some((relation) => found.has(relation.source)),
    ).map((network) => network.essid);

    expect(homes().length).toBeGreaterThan(0);
    expect(unreached).toEqual([]);
  });
});

describe('Ridgemont', () => {
  it('still serves its own people on the sites that speak of them', () => {
    expect(descriptionOf(homepageAt('ridgemontlibrary.org'))).toContain(
      'visitor information for the people of Ridgemont.',
    );
  });
});

/** Every landmark: the catalog's networks, all of them standing in Ridgemont. */
const landmarks = (): readonly DeclaredNetwork[] =>
  DECLARED_NETWORKS.filter((network) => network.town === 'Ridgemont');

/** An address's four octets, as numbers. */
const octetsOf = (address: string | undefined): readonly number[] =>
  (address ?? '').split('.').map(Number);

describe("Ridgemont's addresses", () => {
  it('answers every landmark but a corporation inside its own block of the region', () => {
    const local = landmarks().filter((network) => network.category !== 'corporate');
    expect(local.length).toBeGreaterThan(0);
    for (const network of local) {
      const address = publicAddress(network.key);
      expect(address, network.key).toMatch(/^87\.1\.\d{1,3}\.\d{1,3}$/);
      expect(isPublicIp(address ?? ''), network.key).toBe(true);
    }
  });

  it('answers findit and every corporation in the placeless block', () => {
    const corporations = landmarks().filter((network) => network.category === 'corporate');
    expect(corporations).toHaveLength(20);
    for (const key of [FINDIT_NETWORK, ...corporations.map((network) => network.key)]) {
      const address = publicAddress(key);
      expect(address, key).toMatch(/^193\.\d{1,3}\.\d{1,3}\.\d{1,3}$/);
      expect(isPublicIp(address ?? ''), key).toBe(true);
    }
  });

  it('keeps findit and the landmarks at the addresses they were given', () => {
    // An address that moved would strand every note, log line and script a player holds
    // about the network, so the catalog only ever grows at its end.
    expect(
      [FINDIT_NETWORK, 'ACME-CORP', 'NAKATOMI-PLAZA', 'BREW-AND-CODE', 'MEGA-LO-MART'].map(
        (key) => [key, publicAddress(key)],
      ),
    ).toEqual([
      [FINDIT_NETWORK, '193.1.0.2'],
      ['ACME-CORP', '193.16.112.149'],
      ['NAKATOMI-PLAZA', '193.55.203.159'],
      ['BREW-AND-CODE', '87.1.159.19'],
      ['MEGA-LO-MART', '87.1.86.252'],
    ]);
  });

  it('answers a network nobody publishes from, before anybody has joined it', () => {
    // A home network publishes nothing, yet its gateway is on the internet like anyone's.
    expect(publicAddress('FAMILY-WIFI-2G')).toMatch(/^87\.1\./);
    expect(networkAt(publicAddress('FAMILY-WIFI-2G') ?? '')).toBe('FAMILY-WIFI-2G');
  });
});

describe('the addresses of the world', () => {
  /** Every network with a public address: all the declared ones, and findit. */
  const everyKey = (): readonly string[] => [
    ...DECLARED_NETWORKS.map((network) => network.key),
    FINDIT_NETWORK,
  ];

  it('gives every network an address no other network holds', () => {
    const addresses = everyKey().map((key) => publicAddress(key));
    expect(addresses).not.toContain(undefined);
    expect(new Set(addresses).size).toBe(addresses.length);
  });

  it('finds every network again behind the address it answers at', () => {
    for (const key of everyKey()) {
      expect(networkAt(publicAddress(key) ?? ''), key).toBe(key);
    }
  });

  it('never answers a network at a .0, a .1 or a .255', () => {
    // A `.1` is where nobody answers, which is what a wire-check aims at to prove a miss.
    for (const key of everyKey()) {
      const fourth = octetsOf(publicAddress(key))[3] ?? 0;
      expect(fourth, key).toBeGreaterThanOrEqual(2);
      expect(fourth, key).toBeLessThanOrEqual(254);
    }
    expect(networkAt('87.1.0.1')).toBeUndefined();
    expect(networkAt('193.0.0.1')).toBeUndefined();
  });

  it('holds no address for a network the world does not declare', () => {
    expect(publicAddress('LEASE-TEST-NET')).toBeUndefined();
    expect(networkAt('45.12.34.56')).toBeUndefined();
    expect(networkAt('ridgemont.edu')).toBeUndefined();
  });
});

describe('the regions of the world', () => {
  it('carve their blocks from octets no placeless site holds', () => {
    for (const octet of REGION_FIRST_OCTETS) {
      expect(octet).not.toBe(PLACELESS_FIRST_OCTET);
    }
  });
});
