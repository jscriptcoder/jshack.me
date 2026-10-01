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
  businessSpelling,
  DECLARED_NETWORKS,
  networkAt,
  PLACELESS_FIRST_OCTET,
  publicAddress,
  REGION_FIRST_OCTETS,
  RIDGEMONT,
  type DeclaredNetwork,
} from './world.js';
import { generateHomeLan } from './generateHomeLan.js';
import { buildApGatewayBaseFs } from './routerFs.js';
import { resolveLanName } from '../network/resolveName.js';
import { crackableEssidPool } from './generateWifi.js';
import { TOWN_HOMES } from './pools/townHomes.js';
import {
  CORPORATION_NAME_TEMPLATES,
  NAME_TEMPLATES,
  NAME_WORDS,
  type BusinessSubtype,
  type NamedSubtype,
  type NetworkSubtype,
  type PracticeSubtype,
} from './pools/businessKinds.js';
import {
  API_ENDPOINTS,
  CATEGORY_WORDS,
  FRONT_PAGES,
  PEOPLE_ROLES,
  SITE_DESCRIPTIONS,
  SITE_WORDS,
} from './pools/webSites.js';
import { MOTD_TEMPLATES } from './pools/etcFiles.js';
import { PLACE_DOWNLOADS } from './pools/phoneFiles.js';
import { buildRemoteHostFs } from './remoteHostFs.js';
import { buildDeepHostFs } from './deepHostFs.js';
import { deepBoxes, filesUnder, gatewaysOn, lanBoxes } from '../../test/worldContent.js';
import { networkPersona } from './persona.js';
import type { NetworkCategory } from './pools/essidCatalog.js';
import { fillSlots } from './npcHome.js';
import { relationsTo } from './relations.js';
import { seededForwards } from './seededForwards.js';
import { indexedWeb } from '../findit/webIndex.js';
import { robotsAllowFindit } from '../findit/robots.js';

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

/** The networks Millbrook draws of its own: every one but the corporations' branches. */
const townsOwn = (): readonly DeclaredNetwork[] =>
  millbrook().filter((network) => network.parent === undefined);

describe('Millbrook', () => {
  it("answers the council's domain at an address in its region's block", () => {
    expect(siteAddress('millbrook.gov')).toMatch(/^87\.\d{1,3}\.\d{1,3}\.\d{1,3}$/);
  });

  it.each([
    ['millbrook.gov', 'Millbrook Town Council'],
    ['millbrookpd.gov', 'Millbrook Police Department'],
    ['millbrooklibrary.org', 'Millbrook Public Library'],
    ['millbrookhospital.org', 'Millbrook Cottage Hospital'],
  ])('serves %s under the name of the institution that holds it', (domain, name) => {
    expect(homepageAt(domain)).toContain(`<title>${name}</title>`);
  });

  it('describes each institution the way its kind of place describes itself', () => {
    expect(descriptionOf(homepageAt('millbrook.gov'))).toContain('public services');
    expect(descriptionOf(homepageAt('millbrookpd.gov'))).toContain('public services');
    expect(descriptionOf(homepageAt('millbrooklibrary.org'))).toContain(
      'visitor information for the people of Millbrook.',
    );
    expect(descriptionOf(homepageAt('millbrookhospital.org'))).toContain('wards');
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
      ['r0/t1/n3', 'WHITLOCKS-CAFE', "Whitlock's Café", 'whitlockscafe.com', '87.98.36.169'],
      ['r0/t1/n4', 'FRESHWAY-COFFEE', 'FreshWay Coffee', 'freshwaycoffee.com', '87.98.134.56'],
      [
        'r0/t1/n5',
        'ABERNETHY-AND-SONS-HARDWARE',
        'Abernethy and Sons Hardware',
        'abernethyandsonshardware.com',
        '87.98.231.196',
      ],
      ['r0/t1/n6', 'ABERNETHYS-BOOKS', "Abernethy's Books", 'abernethysbooks.com', '87.98.73.83'],
      ['r0/t1/n7', 'VARLEYS-BAKERY', "Varley's Bakery", 'varleysbakery.com', '87.98.170.223'],
      [
        'r0/t1/n8',
        'WESTBROOK-HAULAGE',
        'Westbrook Haulage',
        'westbrookhaulage.com',
        '87.98.12.110',
      ],
      ['r0/t1/n9', 'KOWALSKI-WIFI', "the Kowalskis' house", undefined, '87.98.109.250'],
      ['r0/t1/n10', 'THE-HARGREAVES', "the Hargreaves' house", undefined, '87.98.207.137'],
      ['r0/t1/n11', 'GARDEN-FLAT', 'the garden flat', undefined, '87.98.49.24'],
      ['r0/t1/n12', 'ROSE-COTTAGE', 'Rose Cottage', undefined, '87.98.146.164'],
      ['r0/t1/n13', 'PEAR-TREE-HOUSE', 'Pear Tree House', undefined, '87.98.244.51'],
      ['r0/t1/n14', 'OKONKWO-FAMILY', 'the Okonkwo family home', undefined, '87.98.85.191'],
      [
        'r0/t1/n15',
        'COTTAGE-HOSPITAL',
        'the cottage hospital',
        'millbrookhospital.org',
        '87.98.183.78',
      ],
      ['r0/t1/n16', 'OAKWOOD-DENTAL', 'Oakwood Dental', 'oakwooddental.com', '87.98.24.218'],
      ['r0/t1/n17', 'LORIMER-GROUP-MILLBROOK', 'the Millbrook office', undefined, '87.98.122.105'],
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
    const businesses = townsOwn().filter((network) =>
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
      ['http://millbrookhospital.org/', 'Millbrook Cottage Hospital'],
    ]);
  });

  it('leads every link to the front page of the institution it names', () => {
    for (const [href, label] of outboundLinksIn(directory())) {
      const domain = new URL(href).hostname;
      expect(homepageAt(domain), href).toContain(`<title>${label}</title>`);
    }
  });

  it("names no network but the town's own institutions", () => {
    const listed = [
      'millbrook.gov',
      'millbrookpd.gov',
      'millbrooklibrary.org',
      'millbrookhospital.org',
    ];
    const page = directory();
    for (const network of DECLARED_NETWORKS) {
      if (network.site !== undefined && listed.includes(network.site.domain)) continue;
      expect(page, network.key).not.toContain(network.essid);
      if (network.site === undefined) continue;
      expect(page, network.key).not.toContain(network.site.domain);
      expect(page, network.key).not.toContain(network.site.name);
    }
  });

  it("is kept by a town's council alone", () => {
    const councils = ['millbrook.gov', 'ashby.gov'];
    const others = DECLARED_NETWORKS.flatMap((network) =>
      network.site === undefined || councils.includes(network.site.domain)
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
    const networks = townsOwn();
    const count = homes().length;
    expect(count).toBeGreaterThanOrEqual(4);
    expect(count).toBeLessThanOrEqual(8);
    const first = networks.indexOf(homes()[0]);
    expect(networks.slice(first, first + count)).toEqual(homes());
    for (const business of businesses()) {
      expect(networks.indexOf(business), business.essid).toBeLessThan(first);
    }
    expect(networks.map((network) => network.key)).toEqual(
      networks.map((_, index) => `r0/t1/n${index}`),
    );
  });

  it('names every home under a wifi and a place of its own', () => {
    const essids = millbrook().map((network) => network.essid);
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

describe("Millbrook's cottage hospital", () => {
  it('stands after every home and before the practices, so declaring it moved no earlier key', () => {
    const networks = townsOwn();
    expect(hospitals()).toHaveLength(1);
    const [hospital] = hospitals();
    expect(hospital).toMatchObject({
      key: `r0/t1/n${networks.length - 1 - practices().length}`,
      essid: 'COTTAGE-HOSPITAL',
      category: 'healthcare',
      subtype: 'hospital',
      place: 'the cottage hospital',
      site: { domain: 'millbrookhospital.org', name: 'Millbrook Cottage Hospital' },
    });
    for (const home of homes()) {
      expect(networks.indexOf(home), home.essid).toBeLessThan(networks.indexOf(hospital));
    }
  });

  it('reads as a hospital on every box a player can reach: its sites, its database, its phone and every login banner', () => {
    // The hospital keeps no desk, mail server or file server, so notes, shell history,
    // mail and shares reach no box of its; those are proven on places of care elsewhere.
    const [hospital] = hospitals();
    const key = hospital?.key ?? '';
    const boxes = [
      ...lanBoxes([key]).map(({ host }) => ({
        host,
        files: filesUnder(buildRemoteHostFs(key, host)),
      })),
      ...deepBoxes([key]).map(({ host }) => ({
        host,
        files: filesUnder(buildDeepHostFs(key, host)),
      })),
    ];
    const pathsUnder = (prefix: string): readonly string[] =>
      boxes.flatMap(({ files }) => [...files.keys()].filter((path) => path.startsWith(prefix)));

    for (const { host, files } of boxes) {
      const banners = MOTD_TEMPLATES.healthcare.map((template) =>
        fillSlots(template, { place: 'the cottage hospital', hostname: host.hostname }),
      );
      expect(banners, host.hostname).toContain(files.get('etc/motd'));
    }

    const clinicians = boxes.flatMap(
      ({ files }) => files.get('var/www/html/clinicians.html') ?? [],
    );
    expect(clinicians).toHaveLength(1);
    const roles = [
      ...(clinicians[0] ?? '').matchAll(/<tr><td>[^<]*<\/td><td>([^<]*)<\/td><\/tr>/g),
    ].map(([, role]) => role);
    expect(roles.length).toBeGreaterThan(1);
    for (const role of roles) expect(['Webmaster', ...PEOPLE_ROLES.healthcare]).toContain(role);

    const ownEndpoints = API_ENDPOINTS.healthcare.map(({ file }) => `var/www/html/${file}`);
    expect(pathsUnder('var/www/html/api/v1/').some((path) => ownEndpoints.includes(path))).toBe(
      true,
    );

    expect(
      boxes.some(({ files }) =>
        (files.get('var/lib/mysql/data.json') ?? '').includes('"patients"'),
      ),
    ).toBe(true);

    const paperwork = PLACE_DOWNLOADS.healthcare.map(
      ({ name }) => new RegExp(`/Downloads/${name.replace('.', '\\.').replace('{ref}', '\\d+')}$`),
    );
    expect(
      pathsUnder('home/').some((path) => paperwork.some((pattern) => pattern.test(path))),
    ).toBe(true);
  });
});

/** The essids of Millbrook's networks that drew `profile`. */
const drew = (profile: string): readonly string[] =>
  millbrook()
    .filter((network) => network.profile === profile)
    .map((network) => network.essid);

describe("Millbrook's network sizes", () => {
  it('sizes every network in the town as lone, flat or deep, and no landmark at all', () => {
    for (const network of millbrook()) {
      expect(['lone', 'flat', 'deep'], network.essid).toContain(network.profile);
    }
    for (const network of DECLARED_NETWORKS.filter((each) => each.town === RIDGEMONT)) {
      expect(network.profile, network.essid).toBeUndefined();
    }
  });

  it('never hides a chain behind a home or a cafe, nor shrinks a council, an office or a hospital to one box', () => {
    for (const network of millbrook()) {
      if (network.category === 'residential' || network.category === 'cafe') {
        expect(network.profile, network.essid).not.toBe('deep');
      }
      if (['government', 'corporate', 'healthcare'].includes(network.category)) {
        expect(network.profile, network.essid).not.toBe('lone');
      }
    }
  });

  it('is pinned (golden): locks the network-profile- stream and its weights', () => {
    expect(drew('deep')).toEqual([
      'TOWN-HALL-WIFI',
      'MILLBROOK-PD',
      'WESTBROOK-HAULAGE',
      'COTTAGE-HOSPITAL',
      'LORIMER-GROUP-MILLBROOK',
    ]);
    expect(drew('lone')).toEqual([
      'FRESHWAY-COFFEE',
      'ABERNETHY-AND-SONS-HARDWARE',
      'VARLEYS-BAKERY',
      'GARDEN-FLAT',
      'ROSE-COTTAGE',
      'OKONKWO-FAMILY',
    ]);
    expect(drew('flat')).toEqual([
      'LIBRARY-PUBLIC',
      'WHITLOCKS-CAFE',
      'ABERNETHYS-BOOKS',
      'KOWALSKI-WIFI',
      'THE-HARGREAVES',
      'PEAR-TREE-HOUSE',
      'OAKWOOD-DENTAL',
    ]);
  });
});

/** The kinds of business a town draws, by category. */
const BUSINESS_SUBTYPES: Readonly<Record<string, readonly string[]>> = {
  retail: [
    'grocer',
    'bakery',
    'pharmacy',
    'bookshop',
    'electronics',
    'hardware',
    'pawn',
    'florist',
  ],
  cafe: ['cafe', 'tea-room', 'coffee-bar'],
  corporate: ['consulting', 'logistics', 'insurance', 'it-services', 'accounting'],
};

/** A word only one kind of business in its category uses of itself. */
const KIND_WORDS: Readonly<Record<BusinessSubtype, string>> = {
  grocer: 'groceries',
  bakery: 'pastries',
  pharmacy: 'prescriptions',
  bookshop: 'books',
  electronics: 'cables',
  hardware: 'screws',
  pawn: 'jewellery',
  florist: 'wreaths',
  cafe: 'light lunches',
  'tea-room': 'scones',
  'coffee-bar': 'cold brew',
  consulting: 'audits',
  logistics: 'freight',
  insurance: 'insurance',
  'it-services': 'managed IT',
  accounting: 'payroll',
};

/** Whether `kind` is a kind of shop, café or office rather than of a place of care. */
const isBusinessKind = (kind: NetworkSubtype): kind is BusinessSubtype => kind in KIND_WORDS;

/** The kind of shop, café or office `business` is: a grocer when it drew none. */
const kindOf = (business: DeclaredNetwork): BusinessSubtype => {
  const kind = business.subtype ?? 'grocer';
  if (!isBusinessKind(kind)) throw new Error(`${business.essid} is no kind of business`);
  return kind;
};

/** Millbrook's hospitals. */
const hospitals = (): readonly DeclaredNetwork[] =>
  millbrook().filter((network) => network.subtype === 'hospital');

/** The kinds of practice a town draws beside its shops. */
const PRACTICE_KINDS: readonly PracticeSubtype[] = ['clinic', 'dentist'];

/** A word only one kind of practice uses of itself. */
const PRACTICE_WORDS: Readonly<Record<PracticeSubtype, string>> = {
  clinic: 'vaccinations',
  dentist: 'fillings',
};

/** The kind of practice `practice` is. */
const practiceKindOf = (practice: DeclaredNetwork): PracticeSubtype => {
  const kind = PRACTICE_KINDS.find((each) => each === practice.subtype);
  if (kind === undefined) throw new Error(`${practice.essid} is no kind of practice`);
  return kind;
};

/** Millbrook's practices: its places of care that are no hospital. */
const practices = (): readonly DeclaredNetwork[] =>
  millbrook().filter(
    (network) => network.category === 'healthcare' && network.subtype !== 'hospital',
  );

/** Millbrook's businesses: its shops, cafés and offices. */
const businesses = (): readonly DeclaredNetwork[] =>
  townsOwn().filter((network) => network.category in BUSINESS_SUBTYPES);

describe("Millbrook's kinds of business", () => {
  it('makes every business one kind of shop, café or office', () => {
    expect(businesses()).toHaveLength(6);
    for (const business of businesses()) {
      expect(BUSINESS_SUBTYPES[business.category], business.essid).toContain(business.subtype);
    }
  });

  it('keeps two businesses from being the same kind while their category has another', () => {
    for (const [category, subtypes] of Object.entries(BUSINESS_SUBTYPES)) {
      const drawn = businesses()
        .filter((business) => business.category === category)
        .map((business) => business.subtype);
      expect(new Set(drawn).size, category).toBe(Math.min(drawn.length, subtypes.length));
    }
  });

  it('is pinned (golden): locks the town-business-kinds- stream and its weights', () => {
    expect(businesses().map((business) => `${business.essid} ${business.subtype}`)).toEqual([
      'WHITLOCKS-CAFE cafe',
      'FRESHWAY-COFFEE coffee-bar',
      'ABERNETHY-AND-SONS-HARDWARE hardware',
      'ABERNETHYS-BOOKS bookshop',
      'VARLEYS-BAKERY bakery',
      'WESTBROOK-HAULAGE logistics',
    ]);
  });

  it('keeps an office in the town, which the leads to its homes and hidden sites start from', () => {
    expect(businesses().filter((business) => business.category === 'corporate')).not.toEqual([]);
  });

  it('describes every business to a search by the words of its kind', () => {
    for (const business of businesses()) {
      const description = descriptionOf(homepageAt(business.site?.domain ?? ''));
      expect(description, business.essid).toContain(KIND_WORDS[kindOf(business)]);
    }
  });

  it('gives no kind to a council, a library, a home or a Ridgemont network', () => {
    const kinded = [...businesses(), ...hospitals(), ...practices(), ...branches()];
    const towns = [...landmarks(), ...millbrook()];
    for (const network of towns.filter((each) => !kinded.includes(each))) {
      expect(network.subtype, network.essid).toBeUndefined();
    }
  });
});

describe('what a business says of its kind', () => {
  /** Every word a business of `subtype` can publish about itself: its search description
   *  and each front page its site may draw, with the kind's words in their slots. */
  const pagesOf = (category: string, subtype: BusinessSubtype): readonly string[] =>
    [
      SITE_DESCRIPTIONS[category as NetworkCategory] ?? '',
      ...FRONT_PAGES[category as NetworkCategory],
    ].map((template) =>
      fillSlots(template, { ...SITE_WORDS[subtype], site: 'X', town: 'Y', locality: ', Y' }),
    );

  it('fills every slot, and says nothing another kind of its category says of itself', () => {
    for (const [category, subtypes] of Object.entries(BUSINESS_SUBTYPES)) {
      for (const subtype of subtypes as BusinessSubtype[]) {
        const pages = pagesOf(category, subtype);
        expect(pages.join('\n'), subtype).not.toMatch(/\{\w+\}/);
        expect(pages[0], subtype).toContain(KIND_WORDS[subtype]);
        for (const other of (subtypes as BusinessSubtype[]).filter((each) => each !== subtype)) {
          for (const page of pages) {
            expect(page, `${subtype} ${other}`).not.toContain(KIND_WORDS[other]);
          }
        }
      }
    }
  });

  it('never has a shop that sells no food offer groceries or bread', () => {
    const nonFood = BUSINESS_SUBTYPES.retail.filter((each) => !['grocer', 'bakery'].includes(each));
    for (const subtype of nonFood) {
      for (const page of pagesOf('retail', subtype as BusinessSubtype)) {
        expect(page, subtype).not.toMatch(/groceries|bread/i);
      }
    }
  });
});

describe('what a place of care says of itself', () => {
  /** Its search description and each front page its site may draw, in `words`. */
  const pagesIn = (words: Readonly<Record<string, string>>): readonly string[] =>
    [SITE_DESCRIPTIONS.healthcare ?? '', ...FRONT_PAGES.healthcare].map((template) =>
      fillSlots(template, { ...words, site: 'X', town: 'Y', locality: ', Y' }),
    );

  it("says a hospital's wards, visiting hours and clinics on every page it draws", () => {
    const pages = pagesIn(SITE_WORDS.hospital);
    expect(pages.join('\n')).not.toMatch(/\{\w+\}/);
    for (const page of pages) {
      expect(page).toContain('wards, visiting hours and outpatient clinics');
    }
  });

  it("says a clinic's or a dentist's own care on every page it draws, and never a hospital's or the other's", () => {
    for (const kind of PRACTICE_KINDS) {
      const pages = pagesIn(SITE_WORDS[kind]);
      expect(pages.join('\n'), kind).not.toMatch(/\{\w+\}/);
      for (const page of pages) {
        expect(page, kind).toContain(PRACTICE_WORDS[kind]);
        expect(page, kind).not.toMatch(/wards|visiting hours|outpatient/);
        for (const other of PRACTICE_KINDS.filter((each) => each !== kind)) {
          expect(page, `${kind} ${other}`).not.toContain(PRACTICE_WORDS[other]);
        }
      }
    }
  });

  it('says neither where it is no hospital, and still fills every slot', () => {
    const pages = pagesIn(CATEGORY_WORDS.healthcare ?? {});
    expect(pages.join('\n')).not.toMatch(/\{\w+\}/);
    for (const page of pages) {
      expect(page).not.toMatch(/wards|visiting hours|outpatient/);
    }
  });
});

/** Every name a kind's templates can spell: each template's one slot filled with each
 *  word of its list. */
const namesFor = (subtype: NamedSubtype): readonly string[] =>
  NAME_TEMPLATES[subtype].flatMap((template) => {
    const slot = template.match(/\{(\w+)\}/)?.[1] as keyof typeof NAME_WORDS;
    return NAME_WORDS[slot].map((word) => template.replace(`{${slot}}`, word));
  });

describe("Millbrook's business names", () => {
  it('names every business the way its kind of business is named', () => {
    for (const business of businesses()) {
      const subtype = kindOf(business);
      expect(namesFor(subtype), business.essid).toContain(business.place);
      expect(business.site?.name).toBe(business.place);
    }
  });

  it('names no business the way any other network in the world is named', () => {
    for (const business of businesses()) {
      const others = DECLARED_NETWORKS.filter((network) => network !== business).flatMap(
        (network) => [network.place, network.site?.name ?? network.place],
      );
      expect(
        others.map((name) => name.toLowerCase()),
        business.essid,
      ).not.toContain(business.place.toLowerCase());
      expect(
        DECLARED_NETWORKS.filter((network) => network !== business).map((network) => network.essid),
        business.essid,
      ).not.toContain(business.essid);
    }
  });

  it('spells the wifi and the domain from the name, without its accents or apostrophes', () => {
    expect(businessSpelling("Ashworth's Café")).toEqual({
      essid: 'ASHWORTHS-CAFE',
      domain: 'ashworthscafe.com',
    });
    expect(businessSpelling('Main Street Mini Mart')).toEqual({
      essid: 'MAIN-STREET-MINI-MART',
      domain: 'mainstreetminimart.com',
    });
    expect(businessSpelling('Hearth & Grain')).toEqual({
      essid: 'HEARTH-GRAIN',
      domain: 'hearthgrain.com',
    });
    for (const business of businesses()) {
      expect(businessSpelling(business.place)).toEqual({
        essid: business.essid,
        domain: business.site?.domain,
      });
    }
  });

  it('can spell every name its kinds are given as a wifi a scan will show', () => {
    const subtypes = Object.values(BUSINESS_SUBTYPES).flat() as BusinessSubtype[];
    for (const name of subtypes.flatMap(namesFor)) {
      const { essid, domain } = businessSpelling(name);
      expect(essid, name).toMatch(/^[A-Z0-9]+(-[A-Z0-9]+)*$/);
      expect(essid.length, name).toBeLessThanOrEqual(32);
      expect(domain, name).toMatch(/^[a-z0-9]+\.com$/);
    }
  });
});

describe("Millbrook's practices", () => {
  it('keeps 1 or 2 clinics or dentists, declared after the hospital so no earlier key moves', () => {
    const networks = townsOwn();
    const [hospital] = hospitals();
    expect(practices().length).toBeGreaterThanOrEqual(1);
    expect(practices().length).toBeLessThanOrEqual(2);
    for (const practice of practices()) {
      expect(PRACTICE_KINDS, practice.essid).toContain(practice.subtype);
      expect(networks.indexOf(practice), practice.essid).toBeGreaterThan(
        networks.indexOf(hospital ?? practice),
      );
    }
    expect(networks.slice(-practices().length)).toEqual(practices());
  });

  it('keeps two practices from being the same kind while the other is left', () => {
    const drawn = practices().map((practice) => practice.subtype);
    expect(new Set(drawn).size).toBe(Math.min(drawn.length, PRACTICE_KINDS.length));
  });

  it('is pinned (golden): locks the town-practices- stream, its count and its kinds', () => {
    expect(practices().map((practice) => `${practice.key} ${practice.subtype}`)).toEqual([
      'r0/t1/n16 dentist',
    ]);
  });

  it('puts every practice on the internet under its own name, as a business is', () => {
    for (const practice of practices()) {
      expect(practice.site?.name, practice.essid).toBe(practice.place);
      expect(businessSpelling(practice.place)).toEqual({
        essid: practice.essid,
        domain: practice.site?.domain,
      });
      expect(homepageAt(practice.site?.domain ?? '')).toContain(
        `<title>${practice.site?.name}</title>`,
      );
    }
  });

  it('names every practice the way its kind of practice is named', () => {
    for (const practice of practices()) {
      expect(namesFor(practiceKindOf(practice)), practice.essid).toContain(practice.place);
    }
  });

  it('names no practice the way any other network in the world is named', () => {
    for (const practice of practices()) {
      const others = DECLARED_NETWORKS.filter((network) => network !== practice).flatMap(
        (network) => [network.place, network.site?.name ?? network.place],
      );
      expect(
        others.map((name) => name.toLowerCase()),
        practice.essid,
      ).not.toContain(practice.place.toLowerCase());
    }
  });

  it('can spell every name its kinds are given as a wifi a scan will show', () => {
    for (const kind of PRACTICE_KINDS) {
      const names = namesFor(kind);
      expect(names.length, kind).toBeGreaterThan(0);
      for (const name of names) {
        const { essid, domain } = businessSpelling(name);
        expect(essid, name).toMatch(/^[A-Z0-9]+(-[A-Z0-9]+)*$/);
        expect(essid.length, name).toBeLessThanOrEqual(32);
        expect(domain, name).toMatch(/^[a-z0-9]+\.com$/);
      }
    }
  });

  it('describes every practice to a search by the words of its kind', () => {
    for (const practice of practices()) {
      const description = descriptionOf(homepageAt(practice.site?.domain ?? ''));
      expect(description, practice.essid).toContain(PRACTICE_WORDS[practiceKindOf(practice)]);
    }
  });
});

/** The share of a town's publishers that ask crawlers to stay away. */
const UNLISTED_SHARE = 0.15;

/** Millbrook's publishers: the networks there that put a site on the internet. */
const publishers = (): readonly DeclaredNetwork[] =>
  millbrook().filter((network) => network.site !== undefined);

/** The one line a site that asks every crawler to stay away serves as its robots.txt. */
const SHUT_OUT = 'User-agent: *\nDisallow: /\n';

describe("Millbrook's unlisted site", () => {
  it('unlists 15% of the publishers, at least one, and never the council that keeps the directory', () => {
    const unlisted = publishers().filter((network) => network.unlisted === true);
    expect(unlisted).toHaveLength(Math.max(1, Math.round(publishers().length * UNLISTED_SHARE)));
    for (const network of unlisted) {
      expect(network.directory, network.essid).toBeUndefined();
    }
    for (const network of millbrook()) {
      if (network.site === undefined) expect(network.unlisted, network.essid).toBeUndefined();
    }
  });

  it('is pinned (golden): locks the town-unlisted- stream, the publisher it picks', () => {
    expect(
      millbrook()
        .filter((network) => network.unlisted === true)
        .map((network) => network.essid),
    ).toEqual(['ABERNETHY-AND-SONS-HARDWARE', 'ABERNETHYS-BOOKS']);
  });

  it('asks every crawler to stay away from the whole site, and says nothing else', () => {
    for (const network of publishers()) {
      const robots = pageAt(network.site?.domain ?? '', 'robots.txt');
      if (network.unlisted === true) expect(robots, network.essid).toBe(SHUT_OUT);
      else expect(robotsAllowFindit(robots ?? null), network.essid).toBe(true);
    }
  });

  it('still answers its front page to anybody who knows its domain', () => {
    for (const network of publishers().filter((each) => each.unlisted === true)) {
      expect(homepageAt(network.site?.domain ?? '')).toContain(
        `<title>${network.site?.name}</title>`,
      );
    }
  });
});

/** The corporations: the networks the world declares in no town. */
const corporations = (): readonly DeclaredNetwork[] =>
  DECLARED_NETWORKS.filter((network) => network.town === undefined);

/**
 * Beyond Acme and Initech the world holds a few dozen more companies, drawn rather than
 * written. Each is one head office that stands in no town: it answers in the placeless
 * block as the landmark corporations do, and findit is the first way in.
 */
describe('the corporations', () => {
  it('declares 20 to 40 offices after every network of Millbrook, keyed c0, c1 and on', () => {
    expect(corporations().length).toBeGreaterThanOrEqual(20);
    expect(corporations().length).toBeLessThanOrEqual(40);
    expect(corporations().map((network) => network.key)).toEqual(
      corporations().map((_, index) => `c${index}`),
    );
    for (const network of corporations()) {
      expect(network.category, network.key).toBe('corporate');
      expect(BUSINESS_SUBTYPES.corporate, network.key).toContain(network.subtype);
    }
  });

  it('keeps two corporations from being the same kind while another kind is left', () => {
    const kinds = corporations().map((network) => network.subtype);
    const corporateKinds = BUSINESS_SUBTYPES.corporate ?? [];
    expect(new Set(kinds.slice(0, corporateKinds.length)).size).toBe(corporateKinds.length);
  });

  it('answers each in the placeless block, after findit and the twenty landmark corporations', () => {
    // findit is the block's first network and the landmark corporations its next twenty,
    // so the first drawn corporation is its twenty-second.
    expect(
      corporations()
        .slice(0, 2)
        .map((network) => [network.key, publicAddress(network.key)]),
    ).toEqual([
      ['c0', '193.71.60.53'],
      ['c1', '193.86.172.200'],
    ]);
    for (const network of corporations()) {
      expect(publicAddress(network.key), network.key).toMatch(/^193\.\d{1,3}\.\d{1,3}\.\d{1,3}$/);
    }
  });

  it('is pinned (golden): locks the corporations stream, its count and kinds, and each name, size and address', () => {
    // A key, a name or an address that moved would strand every journal, bookmark and note
    // a player holds about the corporation, so the declaration only ever grows.
    expect(
      corporations().map(
        (network) =>
          `${network.key} ${network.subtype} ${network.profile} ${network.place} ${publicAddress(network.key)}`,
      ),
    ).toEqual([
      'c0 insurance flat Keystone Holdings 193.71.60.53',
      'c1 it-services deep Bluebell International 193.86.172.200',
      'c2 consulting deep Compass International 193.102.29.94',
      'c3 accounting deep Quayle & Bellamy 193.117.141.241',
      'c4 logistics flat Summit Holdings 193.132.254.135',
      'c5 insurance deep Garrow Group 193.148.111.29',
      'c6 logistics flat Lorimer Group 193.163.223.176',
      'c7 consulting deep Thackeray Group 193.179.80.70',
      'c8 it-services deep Silverbirch Holdings 193.194.192.217',
      'c9 it-services flat Delaney & Sutcliffe 193.210.49.111',
      'c10 consulting deep Merriweather & Delaney 193.225.162.5',
      'c11 insurance deep Anchor Holdings 193.241.18.152',
      'c12 accounting deep Copper International 193.2.131.46',
      'c13 consulting flat Bellamy Group 193.17.243.193',
      'c14 logistics flat Thackeray & Sutcliffe 193.33.100.87',
      'c15 consulting deep Sunrise Holdings 193.48.212.234',
      'c16 logistics deep Meadow International 193.64.69.128',
      'c17 consulting deep Oakwood Holdings 193.79.182.22',
      'c18 insurance flat Ashworth Group 193.95.38.169',
      'c19 logistics flat Quayle & Whitlock 193.110.151.63',
      'c20 accounting deep Pinnacle International 193.126.7.210',
      'c21 logistics flat Sutcliffe Group 193.141.120.104',
      'c22 logistics deep Radley & Oakley 193.156.232.251',
      'c23 consulting flat Compass Holdings 193.172.89.145',
      'c24 accounting flat Willow Holdings 193.187.202.39',
      'c25 logistics flat Bluebell Holdings 193.203.58.186',
      'c26 it-services deep Bellamy & Garrow 193.218.171.80',
      'c27 logistics deep Varley & Ellison 193.234.27.227',
    ]);
  });

  it('always publishes, is always listed, and never stands on one machine', () => {
    for (const network of corporations()) {
      expect(network.site, network.key).toBeDefined();
      expect(network.unlisted, network.key).toBeUndefined();
      expect(['flat', 'deep'], network.key).toContain(network.profile);
    }
  });

  it('stands in no town and no region, and its people name none as theirs', () => {
    for (const network of corporations()) {
      expect(network.town, network.key).toBeUndefined();
      expect(network.region, network.key).toBeUndefined();
      expect(networkPersona(network.key).town, network.key).toBeUndefined();
    }
  });

  it('names no town and no region in any file on its gateways or its boxes but its branches, nor leaves a slot for one', () => {
    const keys = corporations().map((network) => network.key);
    // A head office's shortcut to its branch is named for the branch's wifi, which carries
    // the town the office stands in.
    const branchHosts = new Set(
      DECLARED_NETWORKS.filter((network) => network.parent !== undefined).map(
        (branch) => `Host ${branch.essid.toLowerCase()}`,
      ),
    );
    const trees = [
      ...gatewaysOn(keys).map((gateway) => ({ name: gateway.name, tree: gateway.tree })),
      ...lanBoxes(keys).map((box) => ({
        name: `${box.essid} ${box.host.hostname}`,
        tree: buildRemoteHostFs(box.essid, box.host),
      })),
      ...deepBoxes(keys).map((box) => ({
        name: `${box.essid} ${box.host.hostname}`,
        tree: buildDeepHostFs(box.essid, box.host),
      })),
    ];
    expect(trees.length).toBeGreaterThan(keys.length * 2);
    const named = trees.flatMap(({ name, tree }) =>
      [...filesUnder(tree)].flatMap(([path, content]) =>
        content
          .split('\n')
          .filter((line) => !branchHosts.has(line))
          .some((line) => /Ridgemont|Millbrook|Harrow Valley|\{town\}|\{region\}/i.test(line))
          ? [`${name} /${path}`]
          : [],
      ),
    );
    expect(branchHosts.size).toBeGreaterThan(0);
    expect(named).toEqual([]);
  });
});

/** Every way `template` can be filled: each slot with each word of its list, and no word
 *  twice in one name. */
const fillingsOf = (template: string, used: readonly string[] = []): readonly string[] => {
  const slot = template.match(/\{(\w+)\}/)?.[1] as keyof typeof NAME_WORDS | undefined;
  if (slot === undefined) return [template];
  return NAME_WORDS[slot]
    .filter((word) => !used.includes(word))
    .flatMap((word) => fillingsOf(template.replace(`{${slot}}`, word), [...used, word]));
};

/** Every name the corporations' grammar can spell. */
const corporationNames = (): readonly string[] =>
  CORPORATION_NAME_TEMPLATES.flatMap((template) => fillingsOf(template));

describe("the corporations' names", () => {
  it('names every corporation from a grammar of its own, every slot filled and no surname twice', () => {
    for (const network of corporations()) {
      expect(corporationNames(), network.key).toContain(network.place);
    }
    // A partnership of one family would read as a typing slip.
    expect(corporationNames()).not.toContain('Thackeray & Thackeray');
    expect(corporationNames()).toContain('Quayle & Thackeray');
  });

  it('never names a corporation the way a village business is named', () => {
    const villageNames = Object.values(NAME_TEMPLATES)
      .flat()
      .flatMap((template) => fillingsOf(template));
    for (const name of corporationNames()) {
      expect(villageNames, name).not.toContain(name);
    }
  });

  it('publishes under its name, spelt into its wifi and its domain as a business is', () => {
    for (const network of corporations()) {
      expect(network.site?.name, network.key).toBe(network.place);
      expect(businessSpelling(network.place), network.key).toEqual({
        essid: network.essid,
        domain: network.site?.domain,
      });
    }
  });

  it('names no corporation the way any other network in the world is named', () => {
    for (const corporation of corporations()) {
      const others = DECLARED_NETWORKS.filter((network) => network !== corporation);
      const names = others.flatMap((network) => [network.place, network.site?.name ?? '']);
      expect(
        names.map((name) => name.toLowerCase()),
        corporation.key,
      ).not.toContain(corporation.place.toLowerCase());
      expect(
        others.map((network) => network.essid),
        corporation.key,
      ).not.toContain(corporation.essid);
      expect(
        [FINDIT_DOMAIN, ...others.map((network) => network.site?.domain)],
        corporation.key,
      ).not.toContain(corporation.site?.domain);
    }
  });

  it('can spell every name its grammar gives as a wifi a scan will show', () => {
    for (const name of corporationNames()) {
      const { essid, domain } = businessSpelling(name);
      expect(essid, name).toMatch(/^[A-Z0-9]+(-[A-Z0-9]+)*$/);
      expect(essid.length, name).toBeLessThanOrEqual(32);
      expect(domain, name).toMatch(/^[a-z0-9]+\.com$/);
    }
  });
});

/** Millbrook's branches: the offices the corporations keep there. */
const branches = (): readonly DeclaredNetwork[] =>
  millbrook().filter((network) => network.parent !== undefined);

/** The fewest and the most branches a village keeps. */
const VILLAGE_BRANCHES = { min: 1, max: 2 };

/**
 * A corporation keeps offices in the villages as well as its head office. A branch
 * publishes nothing: its company's site is its public face, and the way in is the head
 * office's own lead to it.
 */
describe("Millbrook's branches", () => {
  it('keeps one or two offices of the corporations, keyed after every other network of the town', () => {
    const own = townsOwn();
    expect(branches().length).toBeGreaterThanOrEqual(VILLAGE_BRANCHES.min);
    expect(branches().length).toBeLessThanOrEqual(VILLAGE_BRANCHES.max);
    expect(branches().map((network) => network.key)).toEqual(
      branches().map((_, index) => `r0/t1/n${own.length + index}`),
    );
  });

  it('keeps each for a different corporation, as an office of its kind under its wifi', () => {
    const parents = branches().map((network) => network.parent);
    expect(new Set(parents).size).toBe(parents.length);
    for (const branch of branches()) {
      const parent = corporations().find((network) => network.key === branch.parent);
      expect(parent, branch.key).toBeDefined();
      expect(branch.category, branch.key).toBe('corporate');
      expect(branch.subtype, branch.key).toBe(parent?.subtype);
      expect(branch.essid, branch.key).toBe(`${parent?.essid}-MILLBROOK`);
      expect(branch.place, branch.key).toBe('the Millbrook office');
      expect(branch.town, branch.key).toBe('Millbrook');
      expect(branch.region, branch.key).toBe('Harrow Valley');
    }
  });

  it('publishes nothing, never stands on one machine, and forwards a thing or two as an office does', () => {
    for (const branch of branches()) {
      expect(branch.site, branch.key).toBeUndefined();
      expect(['flat', 'deep'], branch.key).toContain(branch.profile);
      expect(seededForwards(branch.key).length, branch.key).toBeGreaterThanOrEqual(1);
      expect(seededForwards(branch.key).length, branch.key).toBeLessThanOrEqual(2);
    }
  });

  it("can name an office in Millbrook for any corporation within a wifi's 32 characters", () => {
    for (const corporation of corporations()) {
      expect(`${corporation.essid}-MILLBROOK`.length, corporation.key).toBeLessThanOrEqual(32);
    }
  });

  it("is pinned (golden): locks the town-branches- stream, each branch's corporation, size and address", () => {
    // A branch that moved would strand every note a player holds about it, so the town
    // only ever grows.
    expect(
      branches().map(
        (network) =>
          `${network.key} ${network.parent} ${network.essid} ${network.subtype} ${network.profile} ${publicAddress(network.key)}`,
      ),
    ).toEqual(['r0/t1/n17 c6 LORIMER-GROUP-MILLBROOK logistics deep 87.98.122.105']);
  });
});

/** Every network the world declares in Ashby. */
const ashby = (): readonly DeclaredNetwork[] =>
  DECLARED_NETWORKS.filter((network) => network.town === 'Ashby');

/**
 * Ashby is the second town the world draws, a village like Millbrook. Its institutions are
 * named for it by the rule Millbrook's are, and the rest of it is drawn as Millbrook's is.
 */
describe('Ashby', () => {
  it("declares the region's third town, its council, police and library named for it", () => {
    expect(
      ashby()
        .slice(0, 3)
        .map((network) => [
          network.key,
          network.essid,
          network.category,
          network.place,
          network.site,
          network.region,
          network.directory !== undefined,
        ]),
    ).toEqual([
      [
        'r0/t2/n0',
        'TOWN-HALL-WIFI',
        'government',
        'the town hall',
        { domain: 'ashby.gov', name: 'Ashby Town Council' },
        'Harrow Valley',
        true,
      ],
      [
        'r0/t2/n1',
        'ASHBY-PD',
        'government',
        'the police station',
        { domain: 'ashbypd.gov', name: 'Ashby Police Department' },
        'Harrow Valley',
        false,
      ],
      [
        'r0/t2/n2',
        'LIBRARY-PUBLIC',
        'public',
        'the public library',
        { domain: 'ashbylibrary.org', name: 'Ashby Public Library' },
        'Harrow Valley',
        false,
      ],
    ]);
  });

  it('draws its businesses, then its homes, then its practices, then the branches it keeps, each keyed after the last', () => {
    const order = ashby().map((network) =>
      network.parent !== undefined
        ? 'branch'
        : network.category === 'residential'
          ? 'home'
          : network.subtype !== undefined && isBusinessKind(network.subtype)
            ? 'business'
            : network.category === 'healthcare'
              ? 'practice'
              : 'institution',
    );
    const runs = order.filter((kind, index) => kind !== order[index - 1]);
    expect(runs).toEqual(['institution', 'business', 'home', 'practice', 'branch']);
    expect(ashby().map((network) => network.key)).toEqual(
      ashby().map((_, index) => `r0/t2/n${index}`),
    );
  });

  it('is pinned (golden): locks every network it draws under its key, name, domain, address, size and kind', () => {
    // A key, a name or an address that moved would strand every journal, bookmark and note
    // a player holds about the network, so the town only ever grows.
    expect(
      ashby().map((network) =>
        [
          network.key,
          network.essid,
          network.place,
          network.site?.domain ?? '-',
          publicAddress(network.key),
          network.profile,
          network.subtype ?? '-',
          network.unlisted === true ? 'unlisted' : (network.parent ?? '-'),
        ].join(' | '),
      ),
    ).toEqual([
      'r0/t2/n0 | TOWN-HALL-WIFI | the town hall | ashby.gov | 87.195.0.2 | deep | - | -',
      'r0/t2/n1 | ASHBY-PD | the police station | ashbypd.gov | 87.195.97.142 | deep | - | unlisted',
      'r0/t2/n2 | LIBRARY-PUBLIC | the public library | ashbylibrary.org | 87.195.195.29 | deep | - | -',
      'r0/t2/n3 | GREENLEAF-BAKEHOUSE | Greenleaf Bakehouse | greenleafbakehouse.com | 87.195.36.169 | deep | bakery | -',
      'r0/t2/n4 | GREENLEAF-PHARMACY | Greenleaf Pharmacy | greenleafpharmacy.com | 87.195.134.56 | flat | pharmacy | -',
      'r0/t2/n5 | LANTERN-TOOLS | Lantern Tools | lanterntools.com | 87.195.231.196 | flat | hardware | -',
      'r0/t2/n6 | BRIGHTLINE-CONSULTING | Brightline Consulting | brightlineconsulting.com | 87.195.73.83 | flat | consulting | -',
      'r0/t2/n7 | BRIDGE-STREET-CAFE | Bridge Street Café | bridgestreetcafe.com | 87.195.170.223 | lone | cafe | -',
      'r0/t2/n8 | BARN-CONVERSION | the barn conversion | - | 87.195.12.110 | flat | - | -',
      'r0/t2/n9 | THE-OLD-RECTORY | the Old Rectory | - | 87.195.109.250 | lone | - | -',
      'r0/t2/n10 | OKONKWO-FAMILY | the Okonkwo family home | - | 87.195.207.137 | lone | - | -',
      'r0/t2/n11 | WILLOW-VIEW | Willow View | - | 87.195.49.24 | flat | - | -',
      'r0/t2/n12 | GARDEN-FLAT | the garden flat | - | 87.195.146.164 | lone | - | -',
      'r0/t2/n13 | ROSE-COTTAGE | Rose Cottage | - | 87.195.244.51 | flat | - | -',
      'r0/t2/n14 | GARROW-FAMILY-PRACTICE | Garrow Family Practice | garrowfamilypractice.com | 87.195.85.191 | flat | clinic | unlisted',
      'r0/t2/n15 | LORIMER-DENTAL-CARE | Lorimer Dental Care | lorimerdentalcare.com | 87.195.183.78 | flat | dentist | -',
      'r0/t2/n16 | OAKWOOD-HOLDINGS-ASHBY | the Ashby office | - | 87.195.24.218 | flat | consulting | c17',
      'r0/t2/n17 | RADLEY-OAKLEY-ASHBY | the Ashby office | - | 87.195.122.105 | deep | logistics | c22',
    ]);
  });

  it("keeps a directory on the council's site linking each of its institutions and nothing of Millbrook's", () => {
    const page = pageAt('ashby.gov', 'directory.html') ?? '';
    expect(page).toContain('<p>The public bodies of Ashby,');
    expect(outboundLinksIn(page)).toEqual([
      ['http://ashby.gov/', 'Ashby Town Council'],
      ['http://ashbypd.gov/', 'Ashby Police Department'],
      ['http://ashbylibrary.org/', 'Ashby Public Library'],
    ]);
    for (const network of millbrook()) {
      expect(page, network.key).not.toContain(network.place);
      if (network.site !== undefined) expect(page, network.key).not.toContain(network.site.domain);
    }
  });

  it("answers every network in the town's own block of the region, and finds it there again", () => {
    expect(ashby().length).toBeGreaterThan(0);
    for (const network of ashby()) {
      const address = publicAddress(network.key) ?? '';
      expect(address, network.key).toMatch(/^87\.195\.\d{1,3}\.\d{1,3}$/);
      expect(networkAt(address), network.key).toBe(network.key);
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
    // A directory leads anywhere only once its council's own site is found.
    const inDirectory = new Set(
      DECLARED_NETWORKS.filter(
        (network) => network.site !== undefined && searchable.has(network.site.domain),
      )
        .flatMap((network) => network.directory ?? [])
        .map((site) => site.domain),
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

  it('keeps every town an office a search lists, and starts every lead on a publisher a search lists', () => {
    // The leads to a town's homes start on an office's desk. An office no search lists is
    // found only through a lead itself, so the homes behind it would be two steps from
    // anything a player can find.
    const towns = new Set(
      DECLARED_NETWORKS.flatMap((network) =>
        network.town === undefined || network.town === RIDGEMONT ? [] : [network.town],
      ),
    );
    expect(towns.size).toBeGreaterThan(1);
    for (const town of towns) {
      const listedOffices = DECLARED_NETWORKS.filter(
        (network) =>
          network.town === town &&
          network.category === 'corporate' &&
          network.site !== undefined &&
          network.unlisted !== true,
      );
      expect(listedOffices.length, town).toBeGreaterThan(0);
    }
    const unlistedSources = DECLARED_NETWORKS.flatMap((network) =>
      relationsTo(network.key).flatMap((relation) => {
        const source = DECLARED_NETWORKS.find((each) => each.key === relation.source);
        return source?.site !== undefined && source.unlisted !== true
          ? []
          : [`${relation.kind} ${relation.source} -> ${network.key}`];
      }),
    );
    expect(unlistedSources).toEqual([]);
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

describe('the names of the world', () => {
  it('gives no two networks of one town the same wifi, and no network a wifi longer than 32 characters', () => {
    // A scan shows one town's wifi at a time, so only a town's own networks must differ.
    const towns = new Set(DECLARED_NETWORKS.map((network) => network.town));
    expect(towns.size).toBeGreaterThan(2);
    for (const town of towns) {
      const essids = DECLARED_NETWORKS.filter((network) => network.town === town).map(
        (network) => network.essid,
      );
      expect(new Set(essids).size, town).toBe(essids.length);
    }
    for (const network of DECLARED_NETWORKS) {
      expect(network.essid.length, network.key).toBeLessThanOrEqual(32);
    }
  });
});

describe('the regions of the world', () => {
  it('carve their blocks from octets no placeless site holds', () => {
    for (const octet of REGION_FIRST_OCTETS) {
      expect(octet).not.toBe(PLACELESS_FIRST_OCTET);
    }
  });
});
