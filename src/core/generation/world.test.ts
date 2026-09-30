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
  NAME_TEMPLATES,
  NAME_WORDS,
  type BusinessSubtype,
  type NetworkSubtype,
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
import { deepBoxes, filesUnder, lanBoxes } from '../../test/worldContent.js';
import type { NetworkCategory } from './pools/essidCatalog.js';
import { fillSlots } from './npcHome.js';
import { relationsTo } from './relations.js';
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

describe("Millbrook's cottage hospital", () => {
  it('stands after every home, so declaring it moved no earlier key', () => {
    const networks = millbrook();
    expect(hospitals()).toHaveLength(1);
    const [hospital] = hospitals();
    expect(hospital).toMatchObject({
      key: `r0/t1/n${networks.length - 1}`,
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
  millbrook().filter((network) => network.category === 'healthcare');

/** Millbrook's businesses: its shops, cafés and offices. */
const businesses = (): readonly DeclaredNetwork[] =>
  millbrook().filter((network) => network.category in BUSINESS_SUBTYPES);

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
    const kinded = [...businesses(), ...hospitals()];
    for (const network of DECLARED_NETWORKS.filter((each) => !kinded.includes(each))) {
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
    ].map((template) => fillSlots(template, { ...SITE_WORDS[subtype], site: 'X', town: 'Y' }));

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
      fillSlots(template, { ...words, site: 'X', town: 'Y' }),
    );

  it("says a hospital's wards, visiting hours and clinics on every page it draws", () => {
    const pages = pagesIn(SITE_WORDS.hospital);
    expect(pages.join('\n')).not.toMatch(/\{\w+\}/);
    for (const page of pages) {
      expect(page).toContain('wards, visiting hours and outpatient clinics');
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
const namesFor = (subtype: BusinessSubtype): readonly string[] =>
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
    }
    const essids = DECLARED_NETWORKS.map((network) => network.essid);
    expect(new Set(essids).size).toBe(essids.length);
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
    ).toEqual(['MILLBROOK-PD', 'ABERNETHY-AND-SONS-HARDWARE']);
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
