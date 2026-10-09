import { describe, expect, it } from 'vitest';
import { siteAddress } from './publisher.js';
import { isPublicIp } from './ip.js';
import { FINDIT_NETWORK, FIXED_SITES } from './fixedSites.js';
import { siteServer } from './siteServer.js';
import { resolveLanHostIdentity } from './lanHostIdentity.js';
import { createFsView } from '../filesystem/fsView.js';
import { walkTree } from '../filesystem/walkTree.js';
import { asAbsPath } from '../types.js';
import {
  businessSpelling,
  DECLARED_NETWORKS,
  isLandmark,
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
import { crackableEssidPool, noiseEssidPool } from './generateWifi.js';
import { HOME_TEMPLATES, HOME_WORDS, type HomeForm } from './pools/homeNames.js';
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

/** Every network the world declares in a town it draws: every one but Ridgemont's and
 *  the corporations'. */
const drawnTownNetworks = (): readonly DeclaredNetwork[] =>
  DECLARED_NETWORKS.filter((network) => network.town !== undefined && network.town !== RIDGEMONT);

/** Every town the world draws, in the order it declares them. */
const drawnTowns = (): readonly string[] => [
  ...new Set(drawnTownNetworks().flatMap((network) => network.town ?? [])),
];

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
      ['r0/t1/n3', 'YATESS-CAFE', "Yates's Café", 'yatesscafe.com', '87.98.36.169'],
      ['r0/t1/n4', 'SILVERBIRCH-COFFEE', 'Silverbirch Coffee', 'silverbirchcoffee.com', '87.98.134.56'],
      [
        'r0/t1/n5',
        'KENDRICK-AND-SONS-HARDWARE',
        'Kendrick and Sons Hardware',
        'kendrickandsonshardware.com',
        '87.98.231.196',
      ],
      ['r0/t1/n6', 'LINDLEYS-BOOKS', "Lindley's Books", 'lindleysbooks.com', '87.98.73.83'],
      ['r0/t1/n7', 'WARRINGTONS-BAKERY', "Warrington's Bakery", 'warringtonsbakery.com', '87.98.170.223'],
      [
        'r0/t1/n8',
        'BROAD-STREET-HAULAGE',
        'Broad Street Haulage',
        'broadstreethaulage.com',
        '87.98.12.110',
      ],
      ['r0/t1/n9', 'BARN-CONVERSION', 'the barn conversion', undefined, '87.98.109.250'],
      ['r0/t1/n10', 'BEECH-LODGE', 'Beech Lodge', undefined, '87.98.207.137'],
      ['r0/t1/n11', 'FITZGERALD-WIFI', "the Fitzgeralds' house", undefined, '87.98.49.24'],
      ['r0/t1/n12', 'ROSE-VIEW', 'Rose View', undefined, '87.98.146.164'],
      ['r0/t1/n13', 'HEATHER-HOUSE', 'Heather House', undefined, '87.98.244.51'],
      ['r0/t1/n14', 'THE-COACH-HOUSE', 'the Coach House', undefined, '87.98.85.191'],
      [
        'r0/t1/n15',
        'COTTAGE-HOSPITAL',
        'the cottage hospital',
        'millbrookhospital.org',
        '87.98.183.78',
      ],
      ['r0/t1/n16', 'GATEWAY-DENTAL', 'Gateway Dental', 'gatewaydental.com', '87.98.24.218'],
      ['r0/t1/n17', 'SUMMIT-HOLDINGS-MILLBROOK', 'the Millbrook office', undefined, '87.98.122.105'],
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
      ...FIXED_SITES.map((site) => siteAddress(site.domain)),
    ];
    const domains = [
      ...DECLARED_NETWORKS.flatMap((network) => network.site?.domain ?? []),
      ...FIXED_SITES.map((site) => site.domain),
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
    const councils = drawnTownNetworks()
      .filter((network) => network.place === 'the town hall')
      .flatMap((network) => network.site?.domain ?? []);
    expect(councils).toEqual(drawnTowns().map((town) => `${town.toLowerCase()}.gov`));
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

  it('broadcasts no home to a wifi scan in Ridgemont', () => {
    for (const home of homes()) {
      expect(crackableEssidPool, home.key).not.toContain(home.essid);
    }
  });
});

/** A flat's number: its floor, 1 to 9, and its door, A to D. */
const FLAT_NUMBERS: readonly string[] = Array.from({ length: 9 }, (_, floor) =>
  ['A', 'B', 'C', 'D'].map((door) => `${floor + 1}${door}`),
).flat();

/** A family named in the plural: a surname already ending in "s" takes no more. */
const familyOf = (surname: string): string => (surname.endsWith('s') ? surname : `${surname}s`);

/** A home a template can name: its wifi as a pattern, since a router's default name runs
 *  on any four hex digits, its place, and the word of the homes' lists it uses, if any. */
type FormedHome = { readonly essid: RegExp; readonly place: string; readonly word?: string };

/** Every home `form`'s templates can name: each slot filled with each word of its list,
 *  and a flat with each number. */
const formedHomes = (form: HomeForm): readonly FormedHome[] =>
  HOME_TEMPLATES[form].flatMap(([essid, place]) => {
    const template = `${essid} ${place}`;
    const slot = /\{(surname|plant|description)s?\}/.exec(template)?.[1] as
      | keyof typeof HOME_WORDS
      | undefined;
    const words: readonly (string | undefined)[] =
      slot === undefined ? [undefined] : HOME_WORDS[slot];
    const numbers: readonly (string | undefined)[] = template.includes('{flat}')
      ? FLAT_NUMBERS
      : [undefined];
    return words.flatMap((word) =>
      numbers.map((number) => {
        const filled = (text: string): string =>
          text
            .replace('{surnames}', familyOf(word ?? ''))
            .replace(`{${slot}}`, word ?? '')
            .replace('{flat}', number ?? '')
            .replace('{hex}', 'HEXDIGITS');
        const spelt = businessSpelling(filled(essid)).essid.replace('HEXDIGITS', '[0-9A-F]{4}');
        return {
          essid: new RegExp(`^${spelt}$`),
          place: filled(place),
          ...(word === undefined ? {} : { word }),
        };
      }),
    );
  });

/** Every home the homes' grammar can name, of every form. */
const everyFormedHome = (): readonly FormedHome[] =>
  (Object.keys(HOME_TEMPLATES) as HomeForm[]).flatMap(formedHomes);

/** The homes of every town the world draws: every one but Ridgemont's. */
const townHomes = (): readonly DeclaredNetwork[] =>
  DECLARED_NETWORKS.filter(
    (network) => network.category === 'residential' && network.town !== RIDGEMONT,
  );

/** The home the grammar names as `home` is named. */
const formedAs = (home: DeclaredNetwork): FormedHome | undefined =>
  everyFormedHome().find(
    (formed) => formed.place === home.place && formed.essid.test(home.essid),
  );

/**
 * A town names its homes the way people name their own: after the family, after the house,
 * by the flat's number, or not at all, under the name the router came with. Every form
 * fills its slots from lists of the homes' own, so a town can draw far more homes than any
 * one list could hold.
 */
describe("a town's homes", () => {
  it('names every home after its family, its house, its flat, or the router it came with', () => {
    expect(townHomes().length).toBeGreaterThan(VILLAGE_HOMES_MOST);
    for (const home of townHomes()) {
      expect(formedAs(home), `${home.essid} ${home.place}`).toBeDefined();
    }
  });

  it('can name a home of every form, each under a place read after "at"', () => {
    for (const form of Object.keys(HOME_TEMPLATES) as HomeForm[]) {
      expect(formedHomes(form).length, form).toBeGreaterThan(0);
      for (const { place } of formedHomes(form)) {
        // "bills at the Hargreaves' house", "at flat 2A", "at Rose Cottage"
        expect(place, form).toMatch(/^(the [a-zA-Z]|flat \d[A-D]$|[A-Z][a-z])/);
      }
    }
  });

  it('spells every home it can name as a wifi a scan will show', () => {
    const essids = everyFormedHome().map((home) =>
      home.essid.source.slice(1, -1).replace('[0-9A-F]{4}', 'FFFF'),
    );
    expect(
      essids.filter((essid) => essid.length > 32 || !/^[A-Z0-9]+(-[A-Z0-9]+)*$/.test(essid)),
    ).toEqual([]);
    expect(essids.filter((essid) => crackableEssidPool.includes(essid))).toEqual([]);
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
    for (const network of landmarks()) {
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
      'BROAD-STREET-HAULAGE',
      'COTTAGE-HOSPITAL',
      'SUMMIT-HOLDINGS-MILLBROOK',
    ]);
    expect(drew('lone')).toEqual([
      'SILVERBIRCH-COFFEE',
      'KENDRICK-AND-SONS-HARDWARE',
      'WARRINGTONS-BAKERY',
      'FITZGERALD-WIFI',
      'ROSE-VIEW',
      'THE-COACH-HOUSE',
    ]);
    expect(drew('flat')).toEqual([
      'LIBRARY-PUBLIC',
      'YATESS-CAFE',
      'LINDLEYS-BOOKS',
      'BARN-CONVERSION',
      'BEECH-LODGE',
      'HEATHER-HOUSE',
      'GATEWAY-DENTAL',
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
      'YATESS-CAFE cafe',
      'SILVERBIRCH-COFFEE coffee-bar',
      'KENDRICK-AND-SONS-HARDWARE hardware',
      'LINDLEYS-BOOKS bookshop',
      'WARRINGTONS-BAKERY bakery',
      'BROAD-STREET-HAULAGE logistics',
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

  it('gives no kind to a council, a library, a home or a landmark', () => {
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
    ).toEqual(['KENDRICK-AND-SONS-HARDWARE', 'LINDLEYS-BOOKS']);
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
      'c0 insurance flat Lantern Holdings 193.71.60.53',
      'c1 it-services deep Maddox & Lindley 193.86.172.200',
      'c2 consulting deep Jarrow & Quinlan 193.102.29.94',
      'c3 accounting deep Abernethy Group 193.117.141.241',
      'c4 logistics flat Copper Holdings 193.132.254.135',
      'c5 insurance deep Jessop Group 193.148.111.29',
      'c6 logistics flat Summit Holdings 193.163.223.176',
      'c7 consulting deep Crowther & Goodwin 193.179.80.70',
      'c8 it-services deep Silverbirch Holdings 193.194.192.217',
      'c9 it-services flat Calloway Group 193.210.49.111',
      'c10 consulting deep Cartwright & Ashworth 193.225.162.5',
      'c11 insurance deep Fairbanks Group 193.241.18.152',
      'c12 accounting deep Redwood Holdings 193.2.131.46',
      'c13 consulting flat Hartley & Gilchrist 193.17.243.193',
      'c14 logistics flat Acorn Holdings 193.33.100.87',
      'c15 consulting deep Millstone Holdings 193.48.212.234',
      'c16 logistics deep Winslow & Sutcliffe 193.64.69.128',
      'c17 consulting deep Talbot Group 193.79.182.22',
      'c18 insurance flat Sheridan & Mortimer 193.95.38.169',
      'c19 logistics flat Whitaker & Brannigan 193.110.151.63',
      'c20 accounting deep Halloran Group 193.126.7.210',
      'c21 logistics flat Kestrel Holdings 193.141.120.104',
      'c22 logistics deep Skylark Holdings 193.156.232.251',
      'c23 consulting flat Dunmore Group 193.172.89.145',
      'c24 accounting flat Prescott & Norcross 193.187.202.39',
      'c25 logistics flat Harvest Holdings 193.203.58.186',
      'c26 it-services deep Oakley & Barrow 193.218.171.80',
      'c27 logistics deep Varley & Stanhope 193.234.27.227',
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

/** Every way `template` can be filled, with the words that fill it: each slot with each
 *  word of its list, and no word twice in one name. */
const wordedFillingsOf = (
  template: string,
  used: readonly string[] = [],
): readonly (readonly [name: string, words: readonly string[]])[] => {
  const slot = template.match(/\{(\w+)\}/)?.[1] as keyof typeof NAME_WORDS | undefined;
  if (slot === undefined) return [[template, used]];
  return NAME_WORDS[slot]
    .filter((word) => !used.includes(word))
    .flatMap((word) => wordedFillingsOf(template.replace(`{${slot}}`, word), [...used, word]));
};

/** Every way `template` can be filled. */
const fillingsOf = (template: string): readonly string[] =>
  wordedFillingsOf(template).map(([name]) => name);

/** The words from the lists `network`'s name is made of: a business's or a practice's
 *  from its kind's templates, a corporation's from theirs, a home's from its form's. */
const wordsOf = (network: DeclaredNetwork): readonly string[] => {
  if (network.category === 'residential') {
    const word = formedAs(network)?.word;
    return word === undefined ? [] : [word];
  }
  const subtype = network.subtype;
  if (subtype === undefined || subtype === 'hospital') return [];
  const templates = /^c\d+$/.test(network.key)
    ? CORPORATION_NAME_TEMPLATES
    : NAME_TEMPLATES[subtype];
  const filling = templates
    .flatMap((template) => wordedFillingsOf(template))
    .find(([name]) => name === network.place);
  if (filling === undefined) throw new Error(`${network.key} is named by no template`);
  return filling[1];
};

/** Every word used twice among the names of `networks`. */
const repeatedWords = (networks: readonly DeclaredNetwork[]): readonly string[] => {
  const words = networks.flatMap(wordsOf);
  return words.filter((word, index) => words.indexOf(word) !== index);
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
        [...FIXED_SITES.map((site) => site.domain), ...others.map((network) => network.site?.domain)],
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

  it("fits every name its grammar gives in the wifi of a branch, after any declared town's name", () => {
    // A branch broadcasts its company's wifi and its town's name, so a long name in a long
    // town would otherwise outgrow the 32 characters a wifi can hold.
    const towns = [...new Set(DECLARED_NETWORKS.flatMap((network) => network.town ?? []))];
    expect(towns).toContain('Millbrook');
    const tooLong = corporationNames().flatMap((name) =>
      towns
        .map((town) => `${businessSpelling(name).essid}-${town.toUpperCase()}`)
        .filter((essid) => essid.length > 32),
    );
    expect(tooLong).toEqual([]);
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
    ).toEqual(['r0/t1/n17 c6 SUMMIT-HOLDINGS-MILLBROOK logistics deep 87.98.122.105']);
  });
});

/** Every network the world declares in Ashby. */
const ashby = (): readonly DeclaredNetwork[] =>
  DECLARED_NETWORKS.filter((network) => network.town === 'Ashby');

/** What a town declares `network` as: one of its institutions, a business, a home, a
 *  practice, or a corporation's branch. A hospital is an institution. */
type DrawnAs = 'institution' | 'business' | 'home' | 'practice' | 'branch';
const drawnAs = (network: DeclaredNetwork): DrawnAs =>
  network.parent !== undefined
    ? 'branch'
    : network.category === 'residential'
      ? 'home'
      : network.subtype !== undefined && isBusinessKind(network.subtype)
        ? 'business'
        : network.category === 'healthcare' && network.subtype !== 'hospital'
          ? 'practice'
          : 'institution';

/** The kinds `networks` are declared as, each run of one kind told once, in order. */
const runsOf = (networks: readonly DeclaredNetwork[]): readonly DrawnAs[] =>
  networks.map(drawnAs).filter((kind, index, kinds) => kind !== kinds[index - 1]);

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
    expect(runsOf(ashby())).toEqual(['institution', 'business', 'home', 'practice', 'branch']);
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
      'r0/t2/n3 | BRIGHTLINE-BAKEHOUSE | Brightline Bakehouse | brightlinebakehouse.com | 87.195.36.169 | deep | bakery | -',
      'r0/t2/n4 | GOLDEN-PHARMACY | Golden Pharmacy | goldenpharmacy.com | 87.195.134.56 | flat | pharmacy | -',
      'r0/t2/n5 | PEBBLE-TOOLS | Pebble Tools | pebbletools.com | 87.195.231.196 | flat | hardware | -',
      'r0/t2/n6 | MEADOW-CONSULTING | Meadow Consulting | meadowconsulting.com | 87.195.73.83 | flat | consulting | -',
      'r0/t2/n7 | CHAPEL-LANE-CAFE | Chapel Lane Café | chapellanecafe.com | 87.195.170.223 | lone | cafe | -',
      'r0/t2/n8 | LINKSYS-A2BE | the end terrace | - | 87.195.12.110 | flat | - | -',
      'r0/t2/n9 | CLOVER-HOUSE | Clover House | - | 87.195.109.250 | lone | - | -',
      'r0/t2/n10 | THE-GRANARY | the Granary | - | 87.195.207.137 | lone | - | -',
      'r0/t2/n11 | TOP-FLAT | the top flat | - | 87.195.49.24 | flat | - | -',
      'r0/t2/n12 | KOWALSKI-FAMILY | the Kowalski family home | - | 87.195.146.164 | lone | - | -',
      "r0/t2/n13 | THE-HARGREAVES | the Hargreaves' house | - | 87.195.244.51 | flat | - | -",
      'r0/t2/n14 | WHITLOCK-FAMILY-PRACTICE | Whitlock Family Practice | whitlockfamilypractice.com | 87.195.85.191 | flat | clinic | unlisted',
      'r0/t2/n15 | HALLORAN-DENTAL-CARE | Halloran Dental Care | hallorandentalcare.com | 87.195.183.78 | flat | dentist | -',
      'r0/t2/n16 | TALBOT-GROUP-ASHBY | the Ashby office | - | 87.195.24.218 | flat | consulting | c17',
      'r0/t2/n17 | SKYLARK-HOLDINGS-ASHBY | the Ashby office | - | 87.195.122.105 | deep | logistics | c22',
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

/** Every network the world declares in Oakhurst. */
const oakhurst = (): readonly DeclaredNetwork[] =>
  DECLARED_NETWORKS.filter((network) => network.town === 'Oakhurst');

/** How many of `networks` are declared as `kind`. */
const countDrawnAs = (networks: readonly DeclaredNetwork[], kind: DrawnAs): number =>
  networks.filter((network) => drawnAs(network) === kind).length;

/**
 * Oakhurst is the world's first town: a place bigger than a village, with a courthouse of
 * its own and, as it happens, a hospital. Everything else in it is drawn as a village's is,
 * only more of it.
 */
describe('Oakhurst', () => {
  it("declares the region's fourth town, its council, police, library, courthouse and hospital named for it", () => {
    expect(
      oakhurst()
        .slice(0, 5)
        .map((network) => [
          network.key,
          network.essid,
          network.category,
          network.subtype ?? '-',
          network.place,
          network.site,
          network.region,
          network.directory !== undefined,
        ]),
    ).toEqual([
      [
        'r0/t3/n0',
        'TOWN-HALL-WIFI',
        'government',
        '-',
        'the town hall',
        { domain: 'oakhurst.gov', name: 'Oakhurst Town Council' },
        'Harrow Valley',
        true,
      ],
      [
        'r0/t3/n1',
        'OAKHURST-PD',
        'government',
        '-',
        'the police station',
        { domain: 'oakhurstpd.gov', name: 'Oakhurst Police Department' },
        'Harrow Valley',
        false,
      ],
      [
        'r0/t3/n2',
        'LIBRARY-PUBLIC',
        'public',
        '-',
        'the public library',
        { domain: 'oakhurstlibrary.org', name: 'Oakhurst Public Library' },
        'Harrow Valley',
        false,
      ],
      [
        'r0/t3/n3',
        'COURTHOUSE-WIFI',
        'government',
        '-',
        'the courthouse',
        { domain: 'oakhurstcourts.gov', name: 'Oakhurst County Court' },
        'Harrow Valley',
        false,
      ],
      [
        'r0/t3/n4',
        'GENERAL-HOSPITAL',
        'healthcare',
        'hospital',
        'the hospital',
        { domain: 'oakhursthospital.org', name: 'Oakhurst General Hospital' },
        'Harrow Valley',
        false,
      ],
    ]);
  });

  it('keeps 12 to 24 businesses, 12 to 24 homes, 2 to 4 practices and 2 or 3 branches, as a town does', () => {
    const counts = (['business', 'home', 'practice', 'branch'] as const).map((kind) =>
      countDrawnAs(oakhurst(), kind),
    );
    const [businessCount, homeCount, practiceCount, branchCount] = counts;
    expect(businessCount).toBeGreaterThanOrEqual(12);
    expect(businessCount).toBeLessThanOrEqual(24);
    expect(homeCount).toBeGreaterThanOrEqual(12);
    expect(homeCount).toBeLessThanOrEqual(24);
    expect(practiceCount).toBeGreaterThanOrEqual(2);
    expect(practiceCount).toBeLessThanOrEqual(4);
    expect(branchCount).toBeGreaterThanOrEqual(2);
    expect(branchCount).toBeLessThanOrEqual(3);
  });

  it('draws its businesses, then its homes, then its practices, then the branches it keeps, each keyed after the last', () => {
    expect(runsOf(oakhurst())).toEqual(['institution', 'business', 'home', 'practice', 'branch']);
    expect(oakhurst().map((network) => network.key)).toEqual(
      oakhurst().map((_, index) => `r0/t3/n${index}`),
    );
  });

  it('is pinned (golden): locks every network it draws under its key, name, domain, address, size and kind', () => {
    // A key, a name or an address that moved would strand every journal, bookmark and note
    // a player holds about the network, so the town only ever grows.
    expect(
      oakhurst().map((network) =>
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
      'r0/t3/n0 | TOWN-HALL-WIFI | the town hall | oakhurst.gov | 87.38.0.2 | deep | - | -',
      'r0/t3/n1 | OAKHURST-PD | the police station | oakhurstpd.gov | 87.38.97.142 | deep | - | unlisted',
      'r0/t3/n2 | LIBRARY-PUBLIC | the public library | oakhurstlibrary.org | 87.38.195.29 | deep | - | unlisted',
      'r0/t3/n3 | COURTHOUSE-WIFI | the courthouse | oakhurstcourts.gov | 87.38.36.169 | deep | - | -',
      'r0/t3/n4 | GENERAL-HOSPITAL | the hospital | oakhursthospital.org | 87.38.134.56 | deep | hospital | -',
      'r0/t3/n5 | IRONSIDE-COFFEE | Ironside Coffee | ironsidecoffee.com | 87.38.231.196 | lone | coffee-bar | -',
      'r0/t3/n6 | HALLMARK-INSURANCE | Hallmark Insurance | hallmarkinsurance.com | 87.38.73.83 | flat | insurance | -',
      "r0/t3/n7 | NORCROSSS-TEA-ROOM | Norcross's Tea Room | norcrossstearoom.com | 87.38.170.223 | flat | tea-room | -",
      'r0/t3/n8 | PEBBLE-CAFE | Pebble Café | pebblecafe.com | 87.38.12.110 | flat | cafe | -',
      'r0/t3/n9 | HEARTH-IT-SOLUTIONS | Hearth IT Solutions | hearthitsolutions.com | 87.38.109.250 | deep | it-services | -',
      'r0/t3/n10 | GRANITE-BOOKS | Granite Books | granitebooks.com | 87.38.207.137 | lone | bookshop | -',
      "r0/t3/n11 | ELLISONS-TEA-ROOM | Ellison's Tea Room | ellisonstearoom.com | 87.38.49.24 | lone | tea-room | -",
      "r0/t3/n12 | EASTONS-PAWNBROKERS | Easton's Pawnbrokers | eastonspawnbrokers.com | 87.38.146.164 | lone | pawn | -",
      'r0/t3/n13 | STARLING-TOOLS | Starling Tools | starlingtools.com | 87.38.244.51 | flat | hardware | -',
      'r0/t3/n14 | MILLSTONE-MARKET | Millstone Market | millstonemarket.com | 87.38.85.191 | lone | grocer | unlisted',
      'r0/t3/n15 | HOLLIS-ACCOUNTANTS | Hollis Accountants | hollisaccountants.com | 87.38.183.78 | deep | accounting | -',
      'r0/t3/n16 | FLETCHER-ELECTRICAL | Fletcher Electrical | fletcherelectrical.com | 87.38.24.218 | lone | electronics | -',
      'r0/t3/n17 | CORNERSTONE-TEA-ROOMS | Cornerstone Tea Rooms | cornerstonetearooms.com | 87.38.122.105 | flat | tea-room | -',
      'r0/t3/n18 | VARLEY-CHEMISTS | Varley Chemists | varleychemists.com | 87.38.219.245 | lone | pharmacy | unlisted',
      'r0/t3/n19 | WESTGATE-BLOOMS | Westgate Blooms | westgateblooms.com | 87.38.61.132 | lone | florist | -',
      "r0/t3/n20 | ORMSBYS-BAKERY | Ormsby's Bakery | ormsbysbakery.com | 87.38.159.19 | lone | bakery | -",
      'r0/t3/n21 | SCHOOL-LANE-BLOOMS | School Lane Blooms | schoollaneblooms.com | 87.38.0.159 | deep | florist | -',
      'r0/t3/n22 | ACORN-ROASTERS | Acorn Roasters | acornroasters.com | 87.38.98.46 | flat | coffee-bar | -',
      'r0/t3/n23 | TOP-FLAT | the top flat | - | 87.38.195.186 | lone | - | -',
      "r0/t3/n24 | THE-JANKOWSKIS | the Jankowskis' house | - | 87.38.37.73 | flat | - | -",
      'r0/t3/n25 | PRIMROSE-COTTAGE | Primrose Cottage | - | 87.38.134.213 | flat | - | -',
      "r0/t3/n26 | THE-HADDADS | the Haddads' house | - | 87.38.232.100 | lone | - | -",
      'r0/t3/n27 | THE-OLD-FORGE | the Old Forge | - | 87.38.73.240 | lone | - | -',
      "r0/t3/n28 | OSEI-WIFI | the Oseis' house | - | 87.38.171.127 | flat | - | -",
      "r0/t3/n29 | SANDOVAL-WIFI | the Sandovals' house | - | 87.38.13.14 | flat | - | -",
      'r0/t3/n30 | ADEYEMI-FAMILY | the Adeyemi family home | - | 87.38.110.154 | flat | - | -',
      'r0/t3/n31 | WISTERIA-HOUSE | Wisteria House | - | 87.38.208.41 | lone | - | -',
      'r0/t3/n32 | NETGEAR-5FA9 | the house with the red door | - | 87.38.49.181 | lone | - | -',
      'r0/t3/n33 | TP-LINK-F43C | the house with the conservatory | - | 87.38.147.68 | lone | - | -',
      "r0/t3/n34 | MOREAU-WIFI | the Moreaus' house | - | 87.38.244.208 | lone | - | -",
      'r0/t3/n35 | THE-OLD-DAIRY | the Old Dairy | - | 87.38.86.95 | lone | - | -',
      "r0/t3/n36 | THE-QUIGLEYS | the Quigleys' house | - | 87.38.183.235 | lone | - | -",
      'r0/t3/n37 | THE-GRANARY | the Granary | - | 87.38.25.122 | lone | - | -',
      "r0/t3/n38 | ROSSI-WIFI | the Rossis' house | - | 87.38.123.9 | flat | - | -",
      'r0/t3/n39 | THE-COACH-HOUSE | the Coach House | - | 87.38.220.149 | flat | - | -',
      "r0/t3/n40 | THE-OKONKWOS | the Okonkwos' house | - | 87.38.62.36 | flat | - | -",
      'r0/t3/n41 | THE-OLD-RECTORY | the Old Rectory | - | 87.38.159.176 | flat | - | -',
      "r0/t3/n42 | KOWALSKI-WIFI | the Kowalskis' house | - | 87.38.1.63 | lone | - | -",
      'r0/t3/n43 | LANDMARK-HEALTH-CENTRE | Landmark Health Centre | landmarkhealthcentre.com | 87.38.98.203 | flat | clinic | -',
      'r0/t3/n44 | OAKLEY-DENTAL-CARE | Oakley Dental Care | oakleydentalcare.com | 87.38.196.90 | deep | dentist | -',
      'r0/t3/n45 | DUNMORE-GROUP-OAKHURST | the Oakhurst office | - | 87.38.37.230 | deep | consulting | c23',
      'r0/t3/n46 | SHERIDAN-MORTIMER-OAKHURST | the Oakhurst office | - | 87.38.135.117 | deep | insurance | c18',
    ]);
  });

  it("keeps a directory on the council's site linking each of its institutions, the courthouse and the hospital among them", () => {
    const page = pageAt('oakhurst.gov', 'directory.html') ?? '';
    expect(page).toContain('<p>The public bodies of Oakhurst,');
    expect(outboundLinksIn(page)).toEqual([
      ['http://oakhurst.gov/', 'Oakhurst Town Council'],
      ['http://oakhurstpd.gov/', 'Oakhurst Police Department'],
      ['http://oakhurstlibrary.org/', 'Oakhurst Public Library'],
      ['http://oakhurstcourts.gov/', 'Oakhurst County Court'],
      ['http://oakhursthospital.org/', 'Oakhurst General Hospital'],
    ]);
  });

  it("answers every network in the town's own block of the region, and finds it there again", () => {
    expect(oakhurst().length).toBeGreaterThan(0);
    for (const network of oakhurst()) {
      const address = publicAddress(network.key) ?? '';
      expect(address, network.key).toMatch(/^87\.38\.\d{1,3}\.\d{1,3}$/);
      expect(networkAt(address), network.key).toBe(network.key);
    }
  });
});

/** Every network the world declares in Kingsford. */
const kingsford = (): readonly DeclaredNetwork[] =>
  DECLARED_NETWORKS.filter((network) => network.town === 'Kingsford');

/**
 * Kingsford is the world's first city: a courthouse and a hospital it always keeps, and
 * everything else drawn as a town's is, only several times more of it.
 */
describe('Kingsford', () => {
  it("declares the region's fifth town, its council, police, library, courthouse and hospital named for it", () => {
    expect(
      kingsford()
        .slice(0, 5)
        .map((network) => [
          network.key,
          network.essid,
          network.category,
          network.subtype ?? '-',
          network.place,
          network.site,
          network.region,
          network.directory !== undefined,
        ]),
    ).toEqual([
      [
        'r0/t4/n0',
        'TOWN-HALL-WIFI',
        'government',
        '-',
        'the town hall',
        { domain: 'kingsford.gov', name: 'Kingsford Town Council' },
        'Harrow Valley',
        true,
      ],
      [
        'r0/t4/n1',
        'KINGSFORD-PD',
        'government',
        '-',
        'the police station',
        { domain: 'kingsfordpd.gov', name: 'Kingsford Police Department' },
        'Harrow Valley',
        false,
      ],
      [
        'r0/t4/n2',
        'LIBRARY-PUBLIC',
        'public',
        '-',
        'the public library',
        { domain: 'kingsfordlibrary.org', name: 'Kingsford Public Library' },
        'Harrow Valley',
        false,
      ],
      [
        'r0/t4/n3',
        'COURTHOUSE-WIFI',
        'government',
        '-',
        'the courthouse',
        { domain: 'kingsfordcourts.gov', name: 'Kingsford County Court' },
        'Harrow Valley',
        false,
      ],
      [
        'r0/t4/n4',
        'GENERAL-HOSPITAL',
        'healthcare',
        'hospital',
        'the hospital',
        { domain: 'kingsfordhospital.org', name: 'Kingsford General Hospital' },
        'Harrow Valley',
        false,
      ],
    ]);
  });

  it('keeps 40 to 80 businesses, 40 to 80 homes, 5 to 8 practices and 3 to 5 branches, as a city does', () => {
    const counts = (['business', 'home', 'practice', 'branch'] as const).map((kind) =>
      countDrawnAs(kingsford(), kind),
    );
    const [businessCount, homeCount, practiceCount, branchCount] = counts;
    expect(businessCount).toBeGreaterThanOrEqual(40);
    expect(businessCount).toBeLessThanOrEqual(80);
    expect(homeCount).toBeGreaterThanOrEqual(40);
    expect(homeCount).toBeLessThanOrEqual(80);
    expect(practiceCount).toBeGreaterThanOrEqual(5);
    expect(practiceCount).toBeLessThanOrEqual(8);
    expect(branchCount).toBeGreaterThanOrEqual(3);
    expect(branchCount).toBeLessThanOrEqual(5);
  });

  it('draws its businesses, then its homes, then its practices, then the branches it keeps, each keyed after the last', () => {
    expect(runsOf(kingsford())).toEqual(['institution', 'business', 'home', 'practice', 'branch']);
    expect(kingsford().map((network) => network.key)).toEqual(
      kingsford().map((_, index) => `r0/t4/n${index}`),
    );
  });

  it('is pinned (golden): locks every network it draws under its key, name, domain, address, size and kind', () => {
    // A key, a name or an address that moved would strand every journal, bookmark and note
    // a player holds about the network, so the city only ever grows.
    expect(
      kingsford().map((network) =>
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
      'r0/t4/n0 | TOWN-HALL-WIFI | the town hall | kingsford.gov | 87.135.0.2 | deep | - | -',
      'r0/t4/n1 | KINGSFORD-PD | the police station | kingsfordpd.gov | 87.135.97.142 | flat | - | -',
      'r0/t4/n2 | LIBRARY-PUBLIC | the public library | kingsfordlibrary.org | 87.135.195.29 | flat | - | -',
      'r0/t4/n3 | COURTHOUSE-WIFI | the courthouse | kingsfordcourts.gov | 87.135.36.169 | deep | - | -',
      'r0/t4/n4 | GENERAL-HOSPITAL | the hospital | kingsfordhospital.org | 87.135.134.56 | deep | hospital | -',
      'r0/t4/n5 | MILLSTONE-CASH-EXCHANGE | Millstone Cash Exchange | millstonecashexchange.com | 87.135.231.196 | flat | pawn | -',
      'r0/t4/n6 | HERON-ROASTERS | Heron Roasters | heronroasters.com | 87.135.73.83 | lone | coffee-bar | -',
      'r0/t4/n7 | STONEBRIDGE-LOGISTICS | Stonebridge Logistics | stonebridgelogistics.com | 87.135.170.223 | flat | logistics | -',
      'r0/t4/n8 | NEW-ROAD-MUTUAL | New Road Mutual | newroadmutual.com | 87.135.12.110 | deep | insurance | unlisted',
      "r0/t4/n9 | LORIMERS-FLORIST | Lorimer's Florist | lorimersflorist.com | 87.135.109.250 | flat | florist | -",
      'r0/t4/n10 | BRIDGE-STREET-MINI-MART | Bridge Street Mini Mart | bridgestreetminimart.com | 87.135.207.137 | lone | grocer | -',
      'r0/t4/n11 | FOUNDRY-ELECTRONICS | Foundry Electronics | foundryelectronics.com | 87.135.49.24 | lone | electronics | unlisted',
      'r0/t4/n12 | CARTWRIGHT-AND-SONS-HARDWARE | Cartwright and Sons Hardware | cartwrightandsonshardware.com | 87.135.146.164 | lone | hardware | -',
      'r0/t4/n13 | RIVERSTONE-ACCOUNTING | Riverstone Accounting | riverstoneaccounting.com | 87.135.244.51 | deep | accounting | -',
      'r0/t4/n14 | BLUEBELL-SYSTEMS | Bluebell Systems | bluebellsystems.com | 87.135.85.191 | flat | it-services | -',
      'r0/t4/n15 | NORTHSTAR-CONSULTING | Northstar Consulting | northstarconsulting.com | 87.135.183.78 | deep | consulting | -',
      'r0/t4/n16 | CROWN-CONSULTING | Crown Consulting | crownconsulting.com | 87.135.24.218 | deep | consulting | -',
      'r0/t4/n17 | RIVERSIDE-BAKERY | Riverside Bakery | riversidebakery.com | 87.135.122.105 | lone | bakery | -',
      'r0/t4/n18 | PIONEER-TEA-ROOMS | Pioneer Tea Rooms | pioneertearooms.com | 87.135.219.245 | flat | tea-room | -',
      'r0/t4/n19 | HARBOUR-ROAD-PHARMACY | Harbour Road Pharmacy | harbourroadpharmacy.com | 87.135.61.132 | flat | pharmacy | -',
      'r0/t4/n20 | LANDMARK-CAFE | Landmark Café | landmarkcafe.com | 87.135.159.19 | lone | cafe | unlisted',
      "r0/t4/n21 | YARDLEYS-BOOKS | Yardley's Books | yardleysbooks.com | 87.135.0.159 | lone | bookshop | -",
      'r0/t4/n22 | BEACON-SYSTEMS | Beacon Systems | beaconsystems.com | 87.135.98.46 | flat | it-services | -',
      'r0/t4/n23 | SILVERBIRCH-ELECTRONICS | Silverbirch Electronics | silverbirchelectronics.com | 87.135.195.186 | flat | electronics | -',
      'r0/t4/n24 | TRIDENT-ELECTRONICS | Trident Electronics | tridentelectronics.com | 87.135.37.73 | flat | electronics | -',
      'r0/t4/n25 | SUMMIT-COFFEE | Summit Coffee | summitcoffee.com | 87.135.134.213 | flat | coffee-bar | -',
      'r0/t4/n26 | SWIFT-ROASTERS | Swift Roasters | swiftroasters.com | 87.135.232.100 | lone | coffee-bar | unlisted',
      'r0/t4/n27 | LIGHTHOUSE-ROASTERS | Lighthouse Roasters | lighthouseroasters.com | 87.135.73.240 | lone | coffee-bar | -',
      'r0/t4/n28 | HALLMARK-BAKEHOUSE | Hallmark Bakehouse | hallmarkbakehouse.com | 87.135.171.127 | lone | bakery | -',
      'r0/t4/n29 | QUAYLE-COMPUTING | Quayle Computing | quaylecomputing.com | 87.135.13.14 | deep | it-services | -',
      'r0/t4/n30 | WESTGATE-BOOKSHOP | Westgate Bookshop | westgatebookshop.com | 87.135.110.154 | lone | bookshop | unlisted',
      'r0/t4/n31 | SOUTHGATE-TAX-AND-ACCOUNTS | Southgate Tax and Accounts | southgatetaxandaccounts.com | 87.135.208.41 | deep | accounting | -',
      'r0/t4/n32 | THE-LODESTAR-TEAPOT | The Lodestar Teapot | thelodestarteapot.com | 87.135.49.181 | flat | tea-room | -',
      'r0/t4/n33 | CHAPEL-LANE-MUTUAL | Chapel Lane Mutual | chapellanemutual.com | 87.135.147.68 | flat | insurance | -',
      'r0/t4/n34 | ACORN-FLOWERS | Acorn Flowers | acornflowers.com | 87.135.244.208 | flat | florist | unlisted',
      'r0/t4/n35 | EVERGREEN-MARKET | Evergreen Market | evergreenmarket.com | 87.135.86.95 | flat | grocer | unlisted',
      'r0/t4/n36 | OLD-TOWN-TAX-AND-ACCOUNTS | Old Town Tax and Accounts | oldtowntaxandaccounts.com | 87.135.183.235 | flat | accounting | -',
      'r0/t4/n37 | AINSLEY-AND-SONS-HARDWARE | Ainsley and Sons Hardware | ainsleyandsonshardware.com | 87.135.25.122 | flat | hardware | -',
      'r0/t4/n38 | LINDLEY-ELECTRICAL | Lindley Electrical | lindleyelectrical.com | 87.135.123.9 | lone | electronics | -',
      'r0/t4/n39 | CANAL-STREET-MINI-MART | Canal Street Mini Mart | canalstreetminimart.com | 87.135.220.149 | flat | grocer | -',
      'r0/t4/n40 | MILL-LANE-BOOKSHOP | Mill Lane Bookshop | milllanebookshop.com | 87.135.62.36 | lone | bookshop | -',
      'r0/t4/n41 | HIGH-STREET-GROCERS | High Street Grocers | highstreetgrocers.com | 87.135.159.176 | flat | grocer | -',
      'r0/t4/n42 | ANCHOR-ROASTERS | Anchor Roasters | anchorroasters.com | 87.135.1.63 | lone | coffee-bar | -',
      "r0/t4/n43 | EVERETTS-FLORIST | Everett's Florist | everettsflorist.com | 87.135.98.203 | flat | florist | -",
      'r0/t4/n44 | FORE-STREET-HAULAGE | Fore Street Haulage | forestreethaulage.com | 87.135.196.90 | deep | logistics | unlisted',
      'r0/t4/n45 | ZENITH-TEA-ROOMS | Zenith Tea Rooms | zenithtearooms.com | 87.135.37.230 | flat | tea-room | -',
      'r0/t4/n46 | HARVEST-TEA-ROOMS | Harvest Tea Rooms | harvesttearooms.com | 87.135.135.117 | lone | tea-room | unlisted',
      'r0/t4/n47 | MERLIN-BOOKS | Merlin Books | merlinbooks.com | 87.135.233.4 | flat | bookshop | -',
      'r0/t4/n48 | FALCON-SYSTEMS | Falcon Systems | falconsystems.com | 87.135.74.144 | flat | it-services | -',
      'r0/t4/n49 | BLUEWATER-PANTRY | Bluewater Pantry | bluewaterpantry.com | 87.135.172.31 | lone | grocer | -',
      'r0/t4/n50 | HARTLEY-FREIGHT | Hartley Freight | hartleyfreight.com | 87.135.13.171 | deep | logistics | -',
      'r0/t4/n51 | ALBERT-ROAD-BAKERY | Albert Road Bakery | albertroadbakery.com | 87.135.111.58 | lone | bakery | -',
      "r0/t4/n52 | WAKEFIELDS-TEA-ROOM | Wakefield's Tea Room | wakefieldstearoom.com | 87.135.208.198 | flat | tea-room | -",
      'r0/t4/n53 | CASTLE-STREET-CAFE | Castle Street Café | castlestreetcafe.com | 87.135.50.85 | flat | cafe | unlisted',
      'r0/t4/n54 | MARLOWE-ACCOUNTANTS | Marlowe Accountants | marloweaccountants.com | 87.135.147.225 | deep | accounting | -',
      "r0/t4/n55 | CALLOWAYS-TEA-ROOM | Calloway's Tea Room | callowaystearoom.com | 87.135.245.112 | flat | tea-room | -",
      'r0/t4/n56 | GOODWIN-ACCOUNTANTS | Goodwin Accountants | goodwinaccountants.com | 87.135.86.252 | deep | accounting | unlisted',
      'r0/t4/n57 | MEADOW-ADVISORY | Meadow Advisory | meadowadvisory.com | 87.135.184.139 | deep | consulting | -',
      'r0/t4/n58 | ORMSBY-AND-SONS-HARDWARE | Ormsby and Sons Hardware | ormsbyandsonshardware.com | 87.135.26.26 | flat | hardware | -',
      'r0/t4/n59 | BROAD-STREET-PHONE-REPAIR | Broad Street Phone Repair | broadstreetphonerepair.com | 87.135.123.166 | lone | electronics | -',
      'r0/t4/n60 | THE-GOLDEN-TEAPOT | The Golden Teapot | thegoldenteapot.com | 87.135.221.53 | lone | tea-room | -',
      'r0/t4/n61 | HALLORAN-FREIGHT | Halloran Freight | halloranfreight.com | 87.135.62.193 | deep | logistics | -',
      'r0/t4/n62 | IRONSIDE-FLOWERS | Ironside Flowers | ironsideflowers.com | 87.135.160.80 | flat | florist | -',
      "r0/t4/n63 | BLACKWOODS-FLORIST | Blackwood's Florist | blackwoodsflorist.com | 87.135.1.220 | flat | florist | -",
      'r0/t4/n64 | BRIGHTLINE-ADVISORY | Brightline Advisory | brightlineadvisory.com | 87.135.99.107 | deep | consulting | -',
      'r0/t4/n65 | MADDOX-ELECTRICAL | Maddox Electrical | maddoxelectrical.com | 87.135.196.247 | flat | electronics | -',
      'r0/t4/n66 | SUNRISE-ADVISORY | Sunrise Advisory | sunriseadvisory.com | 87.135.38.134 | deep | consulting | -',
      "r0/t4/n67 | THACKERAYS-TEA-ROOM | Thackeray's Tea Room | thackeraystearoom.com | 87.135.136.21 | flat | tea-room | -",
      'r0/t4/n68 | KING-STREET-ESPRESSO | King Street Espresso | kingstreetespresso.com | 87.135.233.161 | flat | coffee-bar | -',
      'r0/t4/n69 | THE-KEYSTONE-TEAPOT | The Keystone Teapot | thekeystoneteapot.com | 87.135.75.48 | flat | tea-room | -',
      'r0/t4/n70 | THE-HORIZON-KETTLE | The Horizon Kettle | thehorizonkettle.com | 87.135.172.188 | lone | cafe | -',
      'r0/t4/n71 | CROWTHER-COMPUTING | Crowther Computing | crowthercomputing.com | 87.135.14.75 | deep | it-services | unlisted',
      'r0/t4/n72 | FRESHWAY-CAFE | FreshWay Café | freshwaycafe.com | 87.135.111.215 | lone | cafe | -',
      'r0/t4/n73 | NESBITT-INSURANCE-BROKERS | Nesbitt Insurance Brokers | nesbittinsurancebrokers.com | 87.135.209.102 | deep | insurance | -',
      'r0/t4/n74 | THE-PARADE-CAFE | The Parade Café | theparadecafe.com | 87.135.50.242 | lone | cafe | -',
      'r0/t4/n75 | SCHOOL-LANE-ESPRESSO | School Lane Espresso | schoollaneespresso.com | 87.135.148.129 | flat | coffee-bar | -',
      'r0/t4/n76 | GARDEN-FLAT | the garden flat | - | 87.135.246.16 | flat | - | -',
      'r0/t4/n77 | THE-OLD-FORGE | the Old Forge | - | 87.135.87.156 | flat | - | -',
      'r0/t4/n78 | FLAT-6C | flat 6C | - | 87.135.185.43 | flat | - | -',
      "r0/t4/n79 | FITZGERALD-WIFI | the Fitzgeralds' house | - | 87.135.26.183 | lone | - | -",
      'r0/t4/n80 | LILAC-LODGE | Lilac Lodge | - | 87.135.124.70 | lone | - | -',
      'r0/t4/n81 | LINKSYS-4680 | the bungalow | - | 87.135.221.210 | flat | - | -',
      'r0/t4/n82 | HONEYSUCKLE-COTTAGE | Honeysuckle Cottage | - | 87.135.63.97 | lone | - | -',
      "r0/t4/n83 | THE-PETROVS | the Petrovs' house | - | 87.135.160.237 | flat | - | -",
      'r0/t4/n84 | NETGEAR-CEA4 | the house with the red door | - | 87.135.2.124 | flat | - | -',
      "r0/t4/n85 | THE-BRENNANS | the Brennans' house | - | 87.135.100.11 | lone | - | -",
      "r0/t4/n86 | THE-MOREAUS | the Moreaus' house | - | 87.135.197.151 | flat | - | -",
      "r0/t4/n87 | BIANCHI-WIFI | the Bianchis' house | - | 87.135.39.38 | lone | - | -",
      'r0/t4/n88 | BASEMENT-FLAT | the basement flat | - | 87.135.136.178 | flat | - | -',
      'r0/t4/n89 | THE-OLD-DAIRY | the Old Dairy | - | 87.135.234.65 | lone | - | -',
      'r0/t4/n90 | OSEI-FAMILY | the Osei family home | - | 87.135.75.205 | flat | - | -',
      'r0/t4/n91 | TP-LINK-5C3A | the converted chapel | - | 87.135.173.92 | lone | - | -',
      "r0/t4/n92 | ACHEBE-WIFI | the Achebes' house | - | 87.135.14.232 | lone | - | -",
      "r0/t4/n93 | THE-CASTILLOS | the Castillos' house | - | 87.135.112.119 | flat | - | -",
      "r0/t4/n94 | MURPHY-WIFI | the Murphys' house | - | 87.135.210.6 | flat | - | -",
      'r0/t4/n95 | LINKSYS-93D6 | the new build | - | 87.135.51.146 | lone | - | -',
      'r0/t4/n96 | LAUREL-COTTAGE | Laurel Cottage | - | 87.135.149.33 | flat | - | -',
      'r0/t4/n97 | TP-LINK-7D48 | the cottage up the hill | - | 87.135.246.173 | lone | - | -',
      'r0/t4/n98 | JASMINE-COTTAGE | Jasmine Cottage | - | 87.135.88.60 | flat | - | -',
      'r0/t4/n99 | FLAT-1B | flat 1B | - | 87.135.185.200 | flat | - | -',
      'r0/t4/n100 | THE-GRANARY | the Granary | - | 87.135.27.87 | lone | - | -',
      'r0/t4/n101 | PATEL-FAMILY | the Patel family home | - | 87.135.124.227 | flat | - | -',
      "r0/t4/n102 | THE-USMANS | the Usmans' house | - | 87.135.222.114 | flat | - | -",
      'r0/t4/n103 | HADDAD-FAMILY | the Haddad family home | - | 87.135.63.254 | flat | - | -',
      "r0/t4/n104 | REILLY-WIFI | the Reillys' house | - | 87.135.161.141 | flat | - | -",
      'r0/t4/n105 | JANKOWSKI-FAMILY | the Jankowski family home | - | 87.135.3.28 | flat | - | -',
      'r0/t4/n106 | TP-LINK-B90D | the house by the bridge | - | 87.135.100.168 | flat | - | -',
      'r0/t4/n107 | QUIGLEY-FAMILY | the Quigley family home | - | 87.135.198.55 | flat | - | -',
      'r0/t4/n108 | TP-LINK-A97F | the townhouse | - | 87.135.39.195 | flat | - | -',
      "r0/t4/n109 | HARGREAVES-WIFI | the Hargreaves' house | - | 87.135.137.82 | lone | - | -",
      "r0/t4/n110 | THE-NGUYENS | the Nguyens' house | - | 87.135.234.222 | flat | - | -",
      'r0/t4/n111 | BT-HUB-6161 | the house behind the hedge | - | 87.135.76.109 | flat | - | -',
      'r0/t4/n112 | TP-LINK-D68F | the farmhouse | - | 87.135.173.249 | flat | - | -',
      'r0/t4/n113 | SANDOVAL-FAMILY | the Sandoval family home | - | 87.135.15.136 | flat | - | -',
      'r0/t4/n114 | APPLE-TREE-HOUSE | Apple Tree House | - | 87.135.113.23 | flat | - | -',
      'r0/t4/n115 | DOHERTY-FAMILY | the Doherty family home | - | 87.135.210.163 | flat | - | -',
      'r0/t4/n116 | DELGADO-FAMILY | the Delgado family home | - | 87.135.52.50 | lone | - | -',
      'r0/t4/n117 | ELM-VIEW | Elm View | - | 87.135.149.190 | lone | - | -',
      "r0/t4/n118 | LINDQVIST-WIFI | the Lindqvists' house | - | 87.135.247.77 | lone | - | -",
      'r0/t4/n119 | BARN-CONVERSION | the barn conversion | - | 87.135.88.217 | flat | - | -',
      'r0/t4/n120 | TP-LINK-9A9C | the house opposite the pub | - | 87.135.186.104 | lone | - | -',
      'r0/t4/n121 | TOP-FLAT | the top flat | - | 87.135.27.244 | lone | - | -',
      'r0/t4/n122 | FLAT-2C | flat 2C | - | 87.135.125.131 | flat | - | -',
      'r0/t4/n123 | THE-OLD-RECTORY | the Old Rectory | - | 87.135.223.18 | lone | - | -',
      'r0/t4/n124 | ROWAN-VIEW | Rowan View | - | 87.135.64.158 | flat | - | -',
      'r0/t4/n125 | HAZEL-VIEW | Hazel View | - | 87.135.162.45 | flat | - | -',
      'r0/t4/n126 | NETGEAR-1FE0 | the end terrace | - | 87.135.3.185 | lone | - | -',
      'r0/t4/n127 | NETGEAR-7A1E | the house with the pond | - | 87.135.101.72 | flat | - | -',
      'r0/t4/n128 | FLAT-9C | flat 9C | - | 87.135.198.212 | flat | - | -',
      'r0/t4/n129 | CHERRY-TREE-LODGE | Cherry Tree Lodge | - | 87.135.40.99 | flat | - | -',
      "r0/t4/n130 | THE-ZIELINSKIS | the Zielinskis' house | - | 87.135.137.239 | lone | - | -",
      'r0/t4/n131 | BRAMBLE-HOUSE | Bramble House | - | 87.135.235.126 | lone | - | -',
      'r0/t4/n132 | FLAT-1A | flat 1A | - | 87.135.77.13 | lone | - | -',
      'r0/t4/n133 | NETGEAR-1D2B | the terraced house | - | 87.135.174.153 | lone | - | -',
      'r0/t4/n134 | FLAT-3B | flat 3B | - | 87.135.16.40 | flat | - | -',
      'r0/t4/n135 | MAHONEY-FAMILY | the Mahoney family home | - | 87.135.113.180 | flat | - | -',
      "r0/t4/n136 | TAKAHASHI-WIFI | the Takahashis' house | - | 87.135.211.67 | flat | - | -",
      "r0/t4/n137 | GALLAGHER-WIFI | the Gallaghers' house | - | 87.135.52.207 | lone | - | -",
      "r0/t4/n138 | THE-KOWALSKIS | the Kowalskis' house | - | 87.135.150.94 | flat | - | -",
      'r0/t4/n139 | HEATHER-LODGE | Heather Lodge | - | 87.135.247.234 | flat | - | -',
      "r0/t4/n140 | THE-OKONKWOS | the Okonkwos' house | - | 87.135.89.121 | flat | - | -",
      'r0/t4/n141 | MAGNOLIA-COTTAGE | Magnolia Cottage | - | 87.135.187.8 | flat | - | -',
      'r0/t4/n142 | LINKSYS-4ACB | the house by the allotments | - | 87.135.28.148 | flat | - | -',
      'r0/t4/n143 | THE-COACH-HOUSE | the Coach House | - | 87.135.126.35 | flat | - | -',
      'r0/t4/n144 | PEAR-TREE-LODGE | Pear Tree Lodge | - | 87.135.223.175 | flat | - | -',
      'r0/t4/n145 | FLAT-4B | flat 4B | - | 87.135.65.62 | lone | - | -',
      'r0/t4/n146 | FLAT-8B | flat 8B | - | 87.135.162.202 | flat | - | -',
      'r0/t4/n147 | LAVENDER-COTTAGE | Lavender Cottage | - | 87.135.4.89 | lone | - | -',
      "r0/t4/n148 | NOVAK-WIFI | the Novaks' house | - | 87.135.101.229 | lone | - | -",
      'r0/t4/n149 | FRASER-FAMILY | the Fraser family home | - | 87.135.199.116 | flat | - | -',
      'r0/t4/n150 | FLAT-1D | flat 1D | - | 87.135.41.3 | lone | - | -',
      'r0/t4/n151 | FOXGLOVE-LODGE | Foxglove Lodge | - | 87.135.138.143 | flat | - | -',
      'r0/t4/n152 | WISTERIA-VIEW | Wisteria View | - | 87.135.236.30 | lone | - | -',
      "r0/t4/n153 | THE-ERIKSENS | the Eriksens' house | - | 87.135.77.170 | flat | - | -",
      'r0/t4/n154 | BT-HUB-59C5 | the cottage by the green | - | 87.135.175.57 | flat | - | -',
      "r0/t4/n155 | THE-ADEYEMIS | the Adeyemis' house | - | 87.135.16.197 | lone | - | -",
      'r0/t4/n156 | FIELDSTONE-DENTAL | Fieldstone Dental | fieldstonedental.com | 87.135.114.84 | flat | dentist | -',
      'r0/t4/n157 | TOWER-HILL-SURGERY | Tower Hill Surgery | towerhillsurgery.com | 87.135.211.224 | flat | clinic | -',
      'r0/t4/n158 | HEARTH-HEALTH-CENTRE | Hearth Health Centre | hearthhealthcentre.com | 87.135.53.111 | deep | clinic | -',
      'r0/t4/n159 | PEMBROKE-FAMILY-PRACTICE | Pembroke Family Practice | pembrokefamilypractice.com | 87.135.150.251 | flat | clinic | -',
      'r0/t4/n160 | QUINLAN-FAMILY-PRACTICE | Quinlan Family Practice | quinlanfamilypractice.com | 87.135.248.138 | deep | clinic | -',
      'r0/t4/n161 | BRANNIGAN-DENTAL-CARE | Brannigan Dental Care | brannigandentalcare.com | 87.135.90.25 | deep | dentist | -',
      'r0/t4/n162 | KESTREL-HOLDINGS-KINGSFORD | the Kingsford office | - | 87.135.187.165 | deep | logistics | c21',
      'r0/t4/n163 | FAIRBANKS-GROUP-KINGSFORD | the Kingsford office | - | 87.135.29.52 | deep | insurance | c11',
      'r0/t4/n164 | CROWTHER-GOODWIN-KINGSFORD | the Kingsford office | - | 87.135.126.192 | flat | consulting | c7',
      'r0/t4/n165 | MADDOX-LINDLEY-KINGSFORD | the Kingsford office | - | 87.135.224.79 | flat | it-services | c1',
    ]);
  });

  it("keeps a directory on the council's site linking each of its institutions, the courthouse and the hospital among them", () => {
    const page = pageAt('kingsford.gov', 'directory.html') ?? '';
    expect(page).toContain('<p>The public bodies of Kingsford,');
    expect(outboundLinksIn(page)).toEqual([
      ['http://kingsford.gov/', 'Kingsford Town Council'],
      ['http://kingsfordpd.gov/', 'Kingsford Police Department'],
      ['http://kingsfordlibrary.org/', 'Kingsford Public Library'],
      ['http://kingsfordcourts.gov/', 'Kingsford County Court'],
      ['http://kingsfordhospital.org/', 'Kingsford General Hospital'],
    ]);
  });

  it("answers every network in the town's own block of the region, and finds it there again", () => {
    expect(kingsford().length).toBeGreaterThan(0);
    for (const network of kingsford()) {
      const address = publicAddress(network.key) ?? '';
      expect(address, network.key).toMatch(/^87\.135\.\d{1,3}\.\d{1,3}$/);
      expect(networkAt(address), network.key).toBe(network.key);
    }
  });
});

/** The towns the region declares after Kingsford: where each stands, how big it is, and
 *  the institutions a town bigger than a village keeps beyond the council, police and
 *  library. */
const LAST_TOWNS = [
  { name: 'Fenwick', row: 5, size: 'village', block: '87.232', beyond: [] },
  { name: 'Thornbury', row: 6, size: 'village', block: '87.75', beyond: [] },
  { name: 'Hollowmere', row: 7, size: 'village', block: '87.172', beyond: [] },
  { name: 'Ely', row: 8, size: 'village', block: '87.15', beyond: [] },
  { name: 'Wexcombe', row: 9, size: 'town', block: '87.112', beyond: ['courthouse'] },
  {
    name: 'Stonebury',
    row: 10,
    size: 'town',
    block: '87.209',
    beyond: ['courthouse', 'hospital'],
  },
] as const;

/** The fewest and the most of each kind a village and a town keep. */
const SIZE_RANGES = {
  village: { business: [3, 6], home: [4, 8], practice: [1, 2], branch: [1, 2] },
  town: { business: [12, 24], home: [12, 24], practice: [2, 4], branch: [2, 3] },
} as const;

/** Every network the world declares in `town`. */
const townNamed = (town: string): readonly DeclaredNetwork[] =>
  DECLARED_NETWORKS.filter((network) => network.town === town);

type InstitutionKind = 'council' | 'police' | 'library' | 'courthouse' | 'hospital';

/** What a town's institution is named, by the rule every town's are. */
const institutionNamed = (town: string, kind: InstitutionKind) => {
  const lower = town.toLowerCase();
  return {
    council: { essid: 'TOWN-HALL-WIFI', domain: `${lower}.gov`, name: `${town} Town Council` },
    police: {
      essid: `${town.toUpperCase()}-PD`,
      domain: `${lower}pd.gov`,
      name: `${town} Police Department`,
    },
    library: {
      essid: 'LIBRARY-PUBLIC',
      domain: `${lower}library.org`,
      name: `${town} Public Library`,
    },
    courthouse: {
      essid: 'COURTHOUSE-WIFI',
      domain: `${lower}courts.gov`,
      name: `${town} County Court`,
    },
    hospital: {
      essid: 'GENERAL-HOSPITAL',
      domain: `${lower}hospital.org`,
      name: `${town} General Hospital`,
    },
  }[kind];
};

/** Each later town's networks, pinned as Kingsford's are. */
type LastTownName = (typeof LAST_TOWNS)[number]['name'];

const LAST_TOWN_GOLDENS: Readonly<Record<LastTownName, readonly string[]>> = {
  Fenwick: [
    'r0/t5/n0 | TOWN-HALL-WIFI | the town hall | fenwick.gov | 87.232.0.2 | deep | - | -',
    'r0/t5/n1 | FENWICK-PD | the police station | fenwickpd.gov | 87.232.97.142 | flat | - | -',
    'r0/t5/n2 | LIBRARY-PUBLIC | the public library | fenwicklibrary.org | 87.232.195.29 | flat | - | -',
    'r0/t5/n3 | PEBBLE-SYSTEMS | Pebble Systems | pebblesystems.com | 87.232.36.169 | deep | it-services | -',
    'r0/t5/n4 | PARAGON-ROASTERS | Paragon Roasters | paragonroasters.com | 87.232.134.56 | lone | coffee-bar | -',
    'r0/t5/n5 | THE-GRANITE-TEAPOT | The Granite Teapot | thegraniteteapot.com | 87.232.231.196 | lone | tea-room | -',
    'r0/t5/n6 | RIVERSTONE-CAFE | Riverstone Café | riverstonecafe.com | 87.232.73.83 | flat | cafe | unlisted',
    'r0/t5/n7 | THE-FOUNDRY-TEAPOT | The Foundry Teapot | thefoundryteapot.com | 87.232.170.223 | lone | tea-room | -',
    'r0/t5/n8 | NETGEAR-CDC4 | the end terrace | - | 87.232.12.110 | flat | - | -',
    'r0/t5/n9 | BASEMENT-FLAT | the basement flat | - | 87.232.109.250 | flat | - | -',
    'r0/t5/n10 | FLAT-5A | flat 5A | - | 87.232.207.137 | lone | - | -',
    'r0/t5/n11 | THE-COACH-HOUSE | the Coach House | - | 87.232.49.24 | lone | - | -',
    "r0/t5/n12 | OKONKWO-WIFI | the Okonkwos' house | - | 87.232.146.164 | lone | - | -",
    'r0/t5/n13 | JESSOP-DENTAL-CARE | Jessop Dental Care | jessopdentalcare.com | 87.232.244.51 | flat | dentist | -',
    'r0/t5/n14 | MADDOX-LINDLEY-FENWICK | the Fenwick office | - | 87.232.85.191 | deep | it-services | c1',
  ],
  Thornbury: [
    'r0/t6/n0 | TOWN-HALL-WIFI | the town hall | thornbury.gov | 87.75.0.2 | deep | - | -',
    'r0/t6/n1 | THORNBURY-PD | the police station | thornburypd.gov | 87.75.97.142 | flat | - | -',
    'r0/t6/n2 | LIBRARY-PUBLIC | the public library | thornburylibrary.org | 87.75.195.29 | lone | - | unlisted',
    'r0/t6/n3 | EASTFIELD-ESPRESSO | Eastfield Espresso | eastfieldespresso.com | 87.75.36.169 | flat | coffee-bar | unlisted',
    'r0/t6/n4 | IRONSIDE-ADVISORY | Ironside Advisory | ironsideadvisory.com | 87.75.134.56 | deep | consulting | -',
    'r0/t6/n5 | FIELDSTONE-CAFE | Fieldstone Café | fieldstonecafe.com | 87.75.231.196 | flat | cafe | -',
    'r0/t6/n6 | YATES-COMPUTING | Yates Computing | yatescomputing.com | 87.75.73.83 | deep | it-services | -',
    'r0/t6/n7 | JARROW-CHEMISTS | Jarrow Chemists | jarrowchemists.com | 87.75.170.223 | flat | pharmacy | -',
    "r0/t6/n8 | FITZGERALD-WIFI | the Fitzgeralds' house | - | 87.75.12.110 | lone | - | -",
    'r0/t6/n9 | BARN-CONVERSION | the barn conversion | - | 87.75.109.250 | flat | - | -',
    "r0/t6/n10 | THE-BRENNANS | the Brennans' house | - | 87.75.207.137 | lone | - | -",
    'r0/t6/n11 | NETGEAR-1E16 | the house with the long drive | - | 87.75.49.24 | lone | - | -',
    "r0/t6/n12 | ADEYEMI-WIFI | the Adeyemis' house | - | 87.75.146.164 | flat | - | -",
    'r0/t6/n13 | TOP-FLAT | the top flat | - | 87.75.244.51 | flat | - | -',
    'r0/t6/n14 | TP-LINK-418C | the house on the corner | - | 87.75.85.191 | flat | - | -',
    "r0/t6/n15 | MAHONEY-WIFI | the Mahoneys' house | - | 87.75.183.78 | flat | - | -",
    'r0/t6/n16 | MAIN-STREET-MEDICAL-CENTRE | Main Street Medical Centre | mainstreetmedicalcentre.com | 87.75.24.218 | deep | clinic | -',
    'r0/t6/n17 | HARBOUR-ROAD-DENTAL-PRACTICE | Harbour Road Dental Practice | harbourroaddentalpractice.com | 87.75.122.105 | deep | dentist | -',
    'r0/t6/n18 | TALBOT-GROUP-THORNBURY | the Thornbury office | - | 87.75.219.245 | deep | consulting | c17',
    'r0/t6/n19 | CALLOWAY-GROUP-THORNBURY | the Thornbury office | - | 87.75.61.132 | deep | it-services | c9',
  ],
  Hollowmere: [
    'r0/t7/n0 | TOWN-HALL-WIFI | the town hall | hollowmere.gov | 87.172.0.2 | deep | - | -',
    'r0/t7/n1 | HOLLOWMERE-PD | the police station | hollowmerepd.gov | 87.172.97.142 | flat | - | -',
    'r0/t7/n2 | LIBRARY-PUBLIC | the public library | hollowmerelibrary.org | 87.172.195.29 | flat | - | -',
    'r0/t7/n3 | EASTON-INSURANCE-BROKERS | Easton Insurance Brokers | eastoninsurancebrokers.com | 87.172.36.169 | flat | insurance | -',
    'r0/t7/n4 | STONEBRIDGE-BAKEHOUSE | Stonebridge Bakehouse | stonebridgebakehouse.com | 87.172.134.56 | flat | bakery | -',
    'r0/t7/n5 | QUARRY-COFFEE | Quarry Coffee | quarrycoffee.com | 87.172.231.196 | lone | coffee-bar | -',
    'r0/t7/n6 | THE-COMPASS-TEAPOT | The Compass Teapot | thecompassteapot.com | 87.172.73.83 | flat | tea-room | -',
    'r0/t7/n7 | EASTFIELD-CAFE | Eastfield Café | eastfieldcafe.com | 87.172.170.223 | flat | cafe | unlisted',
    'r0/t7/n8 | SCHOOL-LANE-HAULAGE | School Lane Haulage | schoollanehaulage.com | 87.172.12.110 | deep | logistics | unlisted',
    'r0/t7/n9 | WILLOW-HOUSE | Willow House | - | 87.172.109.250 | lone | - | -',
    'r0/t7/n10 | BT-HUB-C366 | the bungalow | - | 87.172.207.137 | flat | - | -',
    'r0/t7/n11 | BT-HUB-AD85 | the house at the end of the lane | - | 87.172.49.24 | flat | - | -',
    "r0/t7/n12 | TAKAHASHI-WIFI | the Takahashis' house | - | 87.172.146.164 | flat | - | -",
    'r0/t7/n13 | FORGE-LANE-MEDICAL-CENTRE | Forge Lane Medical Centre | forgelanemedicalcentre.com | 87.172.244.51 | deep | clinic | -',
    'r0/t7/n14 | WHITLOCK-DENTAL-CARE | Whitlock Dental Care | whitlockdentalcare.com | 87.172.85.191 | deep | dentist | -',
    'r0/t7/n15 | DUNMORE-GROUP-HOLLOWMERE | the Hollowmere office | - | 87.172.183.78 | flat | consulting | c23',
    'r0/t7/n16 | ABERNETHY-GROUP-HOLLOWMERE | the Hollowmere office | - | 87.172.24.218 | deep | accounting | c3',
  ],
  Ely: [
    'r0/t8/n0 | TOWN-HALL-WIFI | the town hall | ely.gov | 87.15.0.2 | deep | - | -',
    'r0/t8/n1 | ELY-PD | the police station | elypd.gov | 87.15.97.142 | flat | - | -',
    'r0/t8/n2 | LIBRARY-PUBLIC | the public library | elylibrary.org | 87.15.195.29 | flat | - | -',
    'r0/t8/n3 | CRESCENT-PANTRY | Crescent Pantry | crescentpantry.com | 87.15.36.169 | flat | grocer | -',
    'r0/t8/n4 | SOUTHGATE-BOOKSHOP | Southgate Bookshop | southgatebookshop.com | 87.15.134.56 | deep | bookshop | -',
    'r0/t8/n5 | GARROW-ACCOUNTANTS | Garrow Accountants | garrowaccountants.com | 87.15.231.196 | deep | accounting | -',
    "r0/t8/n6 | TAKAHASHI-WIFI | the Takahashis' house | - | 87.15.73.83 | flat | - | -",
    "r0/t8/n7 | THE-FRASERS | the Frasers' house | - | 87.15.170.223 | flat | - | -",
    'r0/t8/n8 | BT-HUB-0A0C | the house with the solar panels | - | 87.15.12.110 | lone | - | -',
    'r0/t8/n9 | THE-OLD-RECTORY | the Old Rectory | - | 87.15.109.250 | lone | - | -',
    "r0/t8/n10 | NOVAK-WIFI | the Novaks' house | - | 87.15.207.137 | flat | - | -",
    'r0/t8/n11 | NETGEAR-0E06 | the cottage by the green | - | 87.15.49.24 | flat | - | -',
    'r0/t8/n12 | THE-OLD-DAIRY | the Old Dairy | - | 87.15.146.164 | flat | - | -',
    'r0/t8/n13 | FLAT-1B | flat 1B | - | 87.15.244.51 | lone | - | -',
    'r0/t8/n14 | VICTORIA-ROAD-DENTAL-SURGERY | Victoria Road Dental Surgery | victoriaroaddentalsurgery.com | 87.15.85.191 | deep | dentist | unlisted',
    'r0/t8/n15 | JESSOP-GROUP-ELY | the Ely office | - | 87.15.183.78 | flat | insurance | c5',
  ],
  Wexcombe: [
    'r0/t9/n0 | TOWN-HALL-WIFI | the town hall | wexcombe.gov | 87.112.0.2 | deep | - | -',
    'r0/t9/n1 | WEXCOMBE-PD | the police station | wexcombepd.gov | 87.112.97.142 | flat | - | -',
    'r0/t9/n2 | LIBRARY-PUBLIC | the public library | wexcombelibrary.org | 87.112.195.29 | flat | - | -',
    'r0/t9/n3 | COURTHOUSE-WIFI | the courthouse | wexcombecourts.gov | 87.112.36.169 | deep | - | -',
    'r0/t9/n4 | BROAD-STREET-GROCERS | Broad Street Grocers | broadstreetgrocers.com | 87.112.134.56 | flat | grocer | -',
    'r0/t9/n5 | VICKERS-AND-SONS-HARDWARE | Vickers and Sons Hardware | vickersandsonshardware.com | 87.112.231.196 | lone | hardware | -',
    'r0/t9/n6 | CANAL-STREET-ESPRESSO | Canal Street Espresso | canalstreetespresso.com | 87.112.73.83 | flat | coffee-bar | -',
    'r0/t9/n7 | BEACON-LOGISTICS | Beacon Logistics | beaconlogistics.com | 87.112.170.223 | deep | logistics | -',
    'r0/t9/n8 | DUNMORE-CHEMISTS | Dunmore Chemists | dunmorechemists.com | 87.112.12.110 | flat | pharmacy | -',
    'r0/t9/n9 | EMBER-CASH-EXCHANGE | Ember Cash Exchange | embercashexchange.com | 87.112.109.250 | flat | pawn | -',
    'r0/t9/n10 | FENWICK-AND-PARTNERS | Fenwick and Partners | fenwickandpartners.com | 87.112.207.137 | flat | consulting | -',
    'r0/t9/n11 | THE-STERLING-TEAPOT | The Sterling Teapot | thesterlingteapot.com | 87.112.49.24 | lone | tea-room | -',
    'r0/t9/n12 | TOWER-HILL-BOOKSHOP | Tower Hill Bookshop | towerhillbookshop.com | 87.112.146.164 | lone | bookshop | unlisted',
    'r0/t9/n13 | MADDOX-COMPUTING | Maddox Computing | maddoxcomputing.com | 87.112.244.51 | deep | it-services | unlisted',
    'r0/t9/n14 | GARROW-INSURANCE-BROKERS | Garrow Insurance Brokers | garrowinsurancebrokers.com | 87.112.85.191 | deep | insurance | unlisted',
    'r0/t9/n15 | UNION-STREET-PHONE-REPAIR | Union Street Phone Repair | unionstreetphonerepair.com | 87.112.183.78 | deep | electronics | -',
    'r0/t9/n16 | THE-FRESHWAY-KETTLE | The FreshWay Kettle | thefreshwaykettle.com | 87.112.24.218 | flat | cafe | -',
    "r0/t9/n17 | ASHWORTHS-BAKERY | Ashworth's Bakery | ashworthsbakery.com | 87.112.122.105 | flat | bakery | -",
    'r0/t9/n18 | EVERGREEN-COFFEE | Evergreen Coffee | evergreencoffee.com | 87.112.219.245 | flat | coffee-bar | -',
    'r0/t9/n19 | THE-SKYLARK-TEAPOT | The Skylark Teapot | theskylarkteapot.com | 87.112.61.132 | lone | tea-room | -',
    'r0/t9/n20 | EASTFIELD-BLOOMS | Eastfield Blooms | eastfieldblooms.com | 87.112.159.19 | flat | florist | -',
    'r0/t9/n21 | BARN-CONVERSION | the barn conversion | - | 87.112.0.159 | flat | - | -',
    'r0/t9/n22 | TP-LINK-5C08 | the house at the end of the lane | - | 87.112.98.46 | flat | - | -',
    'r0/t9/n23 | BT-HUB-A22C | the house by the level crossing | - | 87.112.195.186 | flat | - | -',
    'r0/t9/n24 | JANKOWSKI-FAMILY | the Jankowski family home | - | 87.112.37.73 | lone | - | -',
    "r0/t9/n25 | THE-LINDQVISTS | the Lindqvists' house | - | 87.112.134.213 | flat | - | -",
    "r0/t9/n26 | THE-MURPHYS | the Murphys' house | - | 87.112.232.100 | lone | - | -",
    'r0/t9/n27 | DOHERTY-FAMILY | the Doherty family home | - | 87.112.73.240 | lone | - | -',
    'r0/t9/n28 | THE-OLD-FORGE | the Old Forge | - | 87.112.171.127 | flat | - | -',
    'r0/t9/n29 | THE-OLD-RECTORY | the Old Rectory | - | 87.112.13.14 | lone | - | -',
    'r0/t9/n30 | BASEMENT-FLAT | the basement flat | - | 87.112.110.154 | flat | - | -',
    'r0/t9/n31 | TOP-FLAT | the top flat | - | 87.112.208.41 | flat | - | -',
    'r0/t9/n32 | THE-GRANARY | the Granary | - | 87.112.49.181 | flat | - | -',
    'r0/t9/n33 | SUMMIT-HEALTH-CENTRE | Summit Health Centre | summithealthcentre.com | 87.112.147.68 | deep | clinic | unlisted',
    'r0/t9/n34 | RIVERSIDE-DENTAL-SURGERY | Riverside Dental Surgery | riversidedentalsurgery.com | 87.112.244.208 | deep | dentist | -',
    'r0/t9/n35 | LIGHTHOUSE-DENTAL | Lighthouse Dental | lighthousedental.com | 87.112.86.95 | flat | dentist | -',
    'r0/t9/n36 | SILVERBIRCH-HOLDINGS-WEXCOMBE | the Wexcombe office | - | 87.112.183.235 | deep | it-services | c8',
    'r0/t9/n37 | MILLSTONE-HOLDINGS-WEXCOMBE | the Wexcombe office | - | 87.112.25.122 | deep | consulting | c15',
  ],
  Stonebury: [
    'r0/t10/n0 | TOWN-HALL-WIFI | the town hall | stonebury.gov | 87.209.0.2 | flat | - | -',
    'r0/t10/n1 | STONEBURY-PD | the police station | stoneburypd.gov | 87.209.97.142 | deep | - | -',
    'r0/t10/n2 | LIBRARY-PUBLIC | the public library | stoneburylibrary.org | 87.209.195.29 | flat | - | unlisted',
    'r0/t10/n3 | COURTHOUSE-WIFI | the courthouse | stoneburycourts.gov | 87.209.36.169 | flat | - | -',
    'r0/t10/n4 | GENERAL-HOSPITAL | the hospital | stoneburyhospital.org | 87.209.134.56 | deep | hospital | -',
    'r0/t10/n5 | HARBOUR-ROAD-HARDWARE | Harbour Road Hardware | harbourroadhardware.com | 87.209.231.196 | flat | hardware | -',
    'r0/t10/n6 | MILLSTONE-PHARMACY | Millstone Pharmacy | millstonepharmacy.com | 87.209.73.83 | deep | pharmacy | -',
    'r0/t10/n7 | LIGHTHOUSE-COFFEE | Lighthouse Coffee | lighthousecoffee.com | 87.209.170.223 | flat | coffee-bar | -',
    'r0/t10/n8 | GATEWAY-SYSTEMS | Gateway Systems | gatewaysystems.com | 87.209.12.110 | deep | it-services | -',
    'r0/t10/n9 | BARROW-FREIGHT | Barrow Freight | barrowfreight.com | 87.209.109.250 | flat | logistics | -',
    'r0/t10/n10 | MERLIN-TEA-ROOMS | Merlin Tea Rooms | merlintearooms.com | 87.209.207.137 | flat | tea-room | -',
    "r0/t10/n11 | SHERIDANS-BAKERY | Sheridan's Bakery | sheridansbakery.com | 87.209.49.24 | flat | bakery | -",
    'r0/t10/n12 | THE-LODESTAR-KETTLE | The Lodestar Kettle | thelodestarkettle.com | 87.209.146.164 | lone | cafe | -',
    "r0/t10/n13 | IVERSONS-CAFE | Iverson's Café | iversonscafe.com | 87.209.244.51 | lone | cafe | unlisted",
    "r0/t10/n14 | ELLISONS-FLORIST | Ellison's Florist | ellisonsflorist.com | 87.209.85.191 | lone | florist | -",
    'r0/t10/n15 | KEYSTONE-ACCOUNTING | Keystone Accounting | keystoneaccounting.com | 87.209.183.78 | flat | accounting | -',
    'r0/t10/n16 | DUNMORE-ELECTRICAL | Dunmore Electrical | dunmoreelectrical.com | 87.209.24.218 | lone | electronics | -',
    'r0/t10/n17 | GRANITE-TEA-ROOMS | Granite Tea Rooms | granitetearooms.com | 87.209.122.105 | lone | tea-room | -',
    'r0/t10/n18 | FORGE-LANE-PAWN | Forge Lane Pawn | forgelanepawn.com | 87.209.219.245 | lone | pawn | -',
    'r0/t10/n19 | VANGUARD-CAFE | Vanguard Café | vanguardcafe.com | 87.209.61.132 | lone | cafe | unlisted',
    'r0/t10/n20 | HARVEST-PANTRY | Harvest Pantry | harvestpantry.com | 87.209.159.19 | flat | grocer | -',
    "r0/t10/n21 | BELLAMYS-CAFE | Bellamy's Café | bellamyscafe.com | 87.209.0.159 | flat | cafe | -",
    'r0/t10/n22 | QUARRY-ADVISORY | Quarry Advisory | quarryadvisory.com | 87.209.98.46 | flat | consulting | -',
    'r0/t10/n23 | THE-EMBER-KETTLE | The Ember Kettle | theemberkettle.com | 87.209.195.186 | lone | cafe | -',
    "r0/t10/n24 | THE-OSEIS | the Oseis' house | - | 87.209.37.73 | lone | - | -",
    'r0/t10/n25 | THE-OLD-FORGE | the Old Forge | - | 87.209.134.213 | flat | - | -',
    "r0/t10/n26 | THE-JANKOWSKIS | the Jankowskis' house | - | 87.209.232.100 | flat | - | -",
    "r0/t10/n27 | THE-ROSSIS | the Rossis' house | - | 87.209.73.240 | lone | - | -",
    'r0/t10/n28 | MURPHY-FAMILY | the Murphy family home | - | 87.209.171.127 | flat | - | -',
    'r0/t10/n29 | LINDQVIST-FAMILY | the Lindqvist family home | - | 87.209.13.14 | flat | - | -',
    'r0/t10/n30 | CHERRY-TREE-LODGE | Cherry Tree Lodge | - | 87.209.110.154 | flat | - | -',
    'r0/t10/n31 | HOLLY-VIEW | Holly View | - | 87.209.208.41 | flat | - | -',
    'r0/t10/n32 | BASEMENT-FLAT | the basement flat | - | 87.209.49.181 | flat | - | -',
    'r0/t10/n33 | NETGEAR-C72B | the house opposite the pub | - | 87.209.147.68 | flat | - | -',
    'r0/t10/n34 | BARN-CONVERSION | the barn conversion | - | 87.209.244.208 | lone | - | -',
    'r0/t10/n35 | THE-OLD-DAIRY | the Old Dairy | - | 87.209.86.95 | flat | - | -',
    'r0/t10/n36 | FLAT-3B | flat 3B | - | 87.209.183.235 | lone | - | -',
    'r0/t10/n37 | LINKSYS-1D41 | the house with the red door | - | 87.209.25.122 | flat | - | -',
    'r0/t10/n38 | THE-OLD-RECTORY | the Old Rectory | - | 87.209.123.9 | flat | - | -',
    "r0/t10/n39 | THE-BIANCHIS | the Bianchis' house | - | 87.209.220.149 | lone | - | -",
    'r0/t10/n40 | BT-HUB-57F7 | the semi with the blue door | - | 87.209.62.36 | lone | - | -',
    'r0/t10/n41 | LINKSYS-98D4 | the cottage up the hill | - | 87.209.159.176 | lone | - | -',
    'r0/t10/n42 | LAUREL-VIEW | Laurel View | - | 87.209.1.63 | flat | - | -',
    'r0/t10/n43 | PRIMROSE-VIEW | Primrose View | - | 87.209.98.203 | lone | - | -',
    "r0/t10/n44 | THE-NOVAKS | the Novaks' house | - | 87.209.196.90 | flat | - | -",
    'r0/t10/n45 | TOP-FLAT | the top flat | - | 87.209.37.230 | lone | - | -',
    'r0/t10/n46 | CHURCH-ROAD-DENTAL-PRACTICE | Church Road Dental Practice | churchroaddentalpractice.com | 87.209.135.117 | flat | dentist | unlisted',
    'r0/t10/n47 | WESTGATE-MEDICAL-CENTRE | Westgate Medical Centre | westgatemedicalcentre.com | 87.209.233.4 | deep | clinic | -',
    'r0/t10/n48 | SCHOOL-LANE-SURGERY | School Lane Surgery | schoollanesurgery.com | 87.209.74.144 | flat | clinic | -',
    'r0/t10/n49 | ABERNETHY-GROUP-STONEBURY | the Stonebury office | - | 87.209.172.31 | flat | accounting | c3',
    'r0/t10/n50 | HALLORAN-GROUP-STONEBURY | the Stonebury office | - | 87.209.13.171 | flat | accounting | c20',
  ],
};

/**
 * The region's last six towns: four villages and two towns, each drawn as every town of
 * its size is. Harrow Valley then holds the eleven towns it launches with.
 */
describe("the region's last six towns", () => {
  it('leave Harrow Valley holding eleven towns, Ridgemont among them', () => {
    const towns = new Set(
      DECLARED_NETWORKS.filter((network) => network.region === 'Harrow Valley').flatMap(
        (network) => network.town ?? [],
      ),
    );
    expect([...towns]).toEqual([
      'Ridgemont',
      'Millbrook',
      'Ashby',
      'Oakhurst',
      'Kingsford',
      ...LAST_TOWNS.map((town) => town.name),
    ]);
  });

  it.each(LAST_TOWNS)(
    'declares $name with its council, police and library named for it, and what a $size keeps beyond them',
    ({ name, row, beyond }) => {
      const kinds = ['council', 'police', 'library', ...beyond] as const;
      expect(
        townNamed(name)
          .slice(0, kinds.length)
          .map((network) => [
            network.key,
            network.essid,
            network.site,
            network.region,
            network.directory !== undefined,
          ]),
      ).toEqual([
        ...kinds.map((kind, index) => {
          const { essid, domain, name: siteName } = institutionNamed(name, kind);
          return [
            `r0/t${row}/n${index}`,
            essid,
            { domain, name: siteName },
            'Harrow Valley',
            kind === 'council',
          ];
        }),
      ]);
    },
  );

  it.each(LAST_TOWNS)(
    'keeps in $name the businesses, homes, practices and branches a $size keeps',
    ({ name, size }) => {
      for (const kind of ['business', 'home', 'practice', 'branch'] as const) {
        const [fewest, most] = SIZE_RANGES[size][kind];
        const count = countDrawnAs(townNamed(name), kind);
        expect(count, kind).toBeGreaterThanOrEqual(fewest);
        expect(count, kind).toBeLessThanOrEqual(most);
      }
    },
  );

  it.each(LAST_TOWNS)(
    'draws in $name its businesses, then its homes, then its practices, then its branches, each keyed after the last',
    ({ name, row }) => {
      expect(runsOf(townNamed(name))).toEqual([
        'institution',
        'business',
        'home',
        'practice',
        'branch',
      ]);
      expect(townNamed(name).map((network) => network.key)).toEqual(
        townNamed(name).map((_, index) => `r0/t${row}/n${index}`),
      );
    },
  );

  it.each(LAST_TOWNS)(
    'pins $name (golden): locks every network it draws under its key, name, domain, address, size and kind',
    ({ name }) => {
      // A key, a name or an address that moved would strand every journal, bookmark and
      // note a player holds about the network, so a town only ever grows.
      expect(
        townNamed(name).map((network) =>
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
      ).toEqual(LAST_TOWN_GOLDENS[name]);
    },
  );

  it.each(LAST_TOWNS)(
    'keeps a directory on the council site of $name, linking each of its institutions',
    ({ name, beyond }) => {
      const page = pageAt(`${name.toLowerCase()}.gov`, 'directory.html') ?? '';
      expect(page).toContain(`<p>The public bodies of ${name},`);
      expect(outboundLinksIn(page)).toEqual(
        (['council', 'police', 'library', ...beyond] as const).map((kind) => {
          const { domain, name: siteName } = institutionNamed(name, kind);
          return [`http://${domain}/`, siteName];
        }),
      );
    },
  );

  it.each(LAST_TOWNS)(
    "answers every network of $name in the town's own block of the region, and finds it there again",
    ({ name, block }) => {
      expect(townNamed(name).length).toBeGreaterThan(0);
      for (const network of townNamed(name)) {
        const address = publicAddress(network.key) ?? '';
        expect(address.startsWith(`${block}.`), network.key).toBe(true);
        expect(networkAt(address), network.key).toBe(network.key);
      }
    },
  );
});

describe('a village', () => {
  it('keeps neither a courthouse nor a general hospital, only the institutions it was declared with', () => {
    const villages = LAST_TOWNS.filter((town) => town.size === 'village');
    expect(villages.length).toBeGreaterThan(0);
    for (const village of [millbrook(), ashby(), ...villages.map((town) => townNamed(town.name))]) {
      expect(village.length).toBeGreaterThan(0);
      const essids = village.map((network) => network.essid);
      expect(essids).not.toContain('COURTHOUSE-WIFI');
      expect(essids).not.toContain('GENERAL-HOSPITAL');
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
    const drawn = DECLARED_NETWORKS.filter((network) => !isLandmark(network.key));
    const towns = new Set(drawn.flatMap((network) => network.town ?? []));
    expect(towns).toContain(RIDGEMONT);
    for (const town of towns) {
      const listedOffices = drawn.filter(
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
  DECLARED_NETWORKS.filter((network) => isLandmark(network.key));

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

  it('answers findit, hackademy and every corporation in the placeless block', () => {
    const corporations = landmarks().filter((network) => network.category === 'corporate');
    expect(corporations).toHaveLength(20);
    for (const key of [
      FINDIT_NETWORK,
      'hackademy.io',
      ...corporations.map((network) => network.key),
    ]) {
      const address = publicAddress(key);
      expect(address, key).toMatch(/^193\.\d{1,3}\.\d{1,3}\.\d{1,3}$/);
      expect(isPublicIp(address ?? ''), key).toBe(true);
    }
  });

  it('keeps findit, hackademy and the landmarks at the addresses they were given', () => {
    // An address that moved would strand every note, log line and script a player holds
    // about the network, so the catalog only ever grows at its end.
    expect(
      [
        FINDIT_NETWORK,
        'hackademy.io',
        'ACME-CORP',
        'NAKATOMI-PLAZA',
        'BREW-AND-CODE',
        'MEGA-LO-MART',
      ].map((key) => [key, publicAddress(key)]),
    ).toEqual([
      [FINDIT_NETWORK, '193.1.0.2'],
      ['hackademy.io', '193.249.140.121'],
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

/** Ridgemont's networks the world draws, as it draws a city's: every one but a landmark. */
const ridgemontDrawn = (): readonly DeclaredNetwork[] =>
  DECLARED_NETWORKS.filter((network) => network.town === RIDGEMONT && !isLandmark(network.key));

/**
 * Ridgemont is a city, and beyond its landmarks it holds what a city holds: shops, homes
 * and practices drawn as any town's are. Its council, police, library and courthouse are
 * landmarks already, so the only institution it draws is a hospital.
 */
describe("Ridgemont's drawn networks", () => {
  it('draws its hospital, its businesses, its homes, its practices and its branches, keyed after the 57 landmarks', () => {
    expect(runsOf(ridgemontDrawn())).toEqual([
      'institution',
      'business',
      'home',
      'practice',
      'branch',
    ]);
    expect(ridgemontDrawn().map((network) => network.key)).toEqual(
      Array.from({ length: 121 }, (_, index) => `r0/t0/n${57 + index}`),
    );
  });

  it('keeps 65 businesses, 44 homes, 8 practices and 3 branches, as a city may', () => {
    expect(
      (['business', 'home', 'practice', 'branch'] as const).map((kind) =>
        countDrawnAs(ridgemontDrawn(), kind),
      ),
    ).toEqual([65, 44, 8, 3]);
  });

  it('keeps a general hospital of its own, and none of the institutions its landmarks already are', () => {
    expect(
      ridgemontDrawn()
        .filter((network) => drawnAs(network) === 'institution')
        .map((network) => [
          network.key,
          network.essid,
          network.place,
          network.site,
          network.profile,
          network.region,
        ]),
    ).toEqual([
      [
        'r0/t0/n57',
        'GENERAL-HOSPITAL',
        'the hospital',
        { domain: 'ridgemonthospital.org', name: 'Ridgemont General Hospital' },
        'deep',
        'Harrow Valley',
      ],
    ]);
  });

  it('keeps an office for three of the corporations, each under its company and the town', () => {
    expect(
      ridgemontDrawn()
        .filter((network) => network.parent !== undefined)
        .map((network) => [network.key, network.essid, network.place, network.parent]),
    ).toEqual([
      ['r0/t0/n175', 'CROWTHER-GOODWIN-RIDGEMONT', 'the Ridgemont office', 'c7'],
      ['r0/t0/n176', 'PRESCOTT-NORCROSS-RIDGEMONT', 'the Ridgemont office', 'c24'],
      ['r0/t0/n177', 'OAKLEY-BARROW-RIDGEMONT', 'the Ridgemont office', 'c26'],
    ]);
  });

  it('is pinned (golden): locks every network it draws under its key, name, domain, address, size and kind', () => {
    // A key, a name or an address that moved would strand every journal, bookmark and note
    // a player holds about the network, so Ridgemont only ever grows.
    expect(
      ridgemontDrawn().map((network) =>
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
      'r0/t0/n57 | GENERAL-HOSPITAL | the hospital | ridgemonthospital.org | 87.1.184.139 | deep | hospital | -',
      'r0/t0/n58 | STARLING-CASH-EXCHANGE | Starling Cash Exchange | starlingcashexchange.com | 87.1.26.26 | flat | pawn | -',
      'r0/t0/n59 | UNION-STREET-TAX-AND-ACCOUNTS | Union Street Tax and Accounts | unionstreettaxandaccounts.com | 87.1.123.166 | deep | accounting | -',
      'r0/t0/n60 | WARRINGTON-INSURANCE-BROKERS | Warrington Insurance Brokers | warringtoninsurancebrokers.com | 87.1.221.53 | flat | insurance | unlisted',
      'r0/t0/n61 | CHAPEL-LANE-PHONE-REPAIR | Chapel Lane Phone Repair | chapellanephonerepair.com | 87.1.62.193 | lone | electronics | -',
      'r0/t0/n62 | CRESCENT-TEA-ROOMS | Crescent Tea Rooms | crescenttearooms.com | 87.1.160.80 | lone | tea-room | -',
      'r0/t0/n63 | STATION-ROAD-HAULAGE | Station Road Haulage | stationroadhaulage.com | 87.1.1.220 | flat | logistics | -',
      'r0/t0/n64 | REDWOOD-ADVISORY | Redwood Advisory | redwoodadvisory.com | 87.1.99.107 | flat | consulting | -',
      'r0/t0/n65 | EASTFIELD-GROCERS | Eastfield Grocers | eastfieldgrocers.com | 87.1.196.247 | flat | grocer | -',
      'r0/t0/n66 | PARAGON-SYSTEMS | Paragon Systems | paragonsystems.com | 87.1.38.134 | flat | it-services | -',
      'r0/t0/n67 | THE-PARADE-MUTUAL | The Parade Mutual | theparademutual.com | 87.1.136.21 | deep | insurance | -',
      'r0/t0/n68 | COPPER-SYSTEMS | Copper Systems | coppersystems.com | 87.1.233.161 | deep | it-services | -',
      'r0/t0/n69 | STONEBRIDGE-CAFE | Stonebridge Café | stonebridgecafe.com | 87.1.75.48 | flat | cafe | -',
      "r0/t0/n70 | WHITAKERS-BOOKS | Whitaker's Books | whitakersbooks.com | 87.1.172.188 | lone | bookshop | -",
      'r0/t0/n71 | EMBER-TOOLS | Ember Tools | embertools.com | 87.1.14.75 | lone | hardware | -',
      'r0/t0/n72 | DRIFTWOOD-ROASTERS | Driftwood Roasters | driftwoodroasters.com | 87.1.111.215 | flat | coffee-bar | -',
      'r0/t0/n73 | FORGE-LANE-BLOOMS | Forge Lane Blooms | forgelaneblooms.com | 87.1.209.102 | lone | florist | -',
      'r0/t0/n74 | NORTHSTAR-BAKEHOUSE | Northstar Bakehouse | northstarbakehouse.com | 87.1.50.242 | flat | bakery | -',
      'r0/t0/n75 | CHURCH-ROAD-MUTUAL | Church Road Mutual | churchroadmutual.com | 87.1.148.129 | deep | insurance | -',
      "r0/t0/n76 | LORIMERS-TEA-ROOM | Lorimer's Tea Room | lorimerstearoom.com | 87.1.246.16 | flat | tea-room | -",
      'r0/t0/n77 | CROSS-STREET-PHARMACY | Cross Street Pharmacy | crossstreetpharmacy.com | 87.1.87.156 | flat | pharmacy | -',
      'r0/t0/n78 | THE-MERLIN-KETTLE | The Merlin Kettle | themerlinkettle.com | 87.1.185.43 | lone | cafe | -',
      'r0/t0/n79 | GOLDEN-IT-SOLUTIONS | Golden IT Solutions | goldenitsolutions.com | 87.1.26.183 | deep | it-services | unlisted',
      "r0/t0/n80 | QUAYLES-BOOKS | Quayle's Books | quaylesbooks.com | 87.1.124.70 | lone | bookshop | unlisted",
      'r0/t0/n81 | GATEWAY-CONSULTING | Gateway Consulting | gatewayconsulting.com | 87.1.221.210 | deep | consulting | unlisted',
      'r0/t0/n82 | BRIGHTLINE-BOOKS | Brightline Books | brightlinebooks.com | 87.1.63.97 | lone | bookshop | -',
      "r0/t0/n83 | MADDOXS-PAWNBROKERS | Maddox's Pawnbrokers | maddoxspawnbrokers.com | 87.1.160.237 | flat | pawn | -",
      'r0/t0/n84 | MEADOW-TEA-ROOMS | Meadow Tea Rooms | meadowtearooms.com | 87.1.2.124 | lone | tea-room | -',
      'r0/t0/n85 | SOUTHGATE-HAULAGE | Southgate Haulage | southgatehaulage.com | 87.1.100.11 | deep | logistics | -',
      'r0/t0/n86 | LODESTAR-PHARMACY | Lodestar Pharmacy | lodestarpharmacy.com | 87.1.197.151 | lone | pharmacy | -',
      'r0/t0/n87 | UPPER-GREEN-MUTUAL | Upper Green Mutual | uppergreenmutual.com | 87.1.39.38 | deep | insurance | -',
      'r0/t0/n88 | GARROW-COMPUTING | Garrow Computing | garrowcomputing.com | 87.1.136.178 | flat | it-services | -',
      'r0/t0/n89 | FLETCHER-COMPUTING | Fletcher Computing | fletchercomputing.com | 87.1.234.65 | deep | it-services | -',
      'r0/t0/n90 | TOWER-HILL-HARDWARE | Tower Hill Hardware | towerhillhardware.com | 87.1.75.205 | flat | hardware | -',
      'r0/t0/n91 | ACORN-ELECTRONICS | Acorn Electronics | acornelectronics.com | 87.1.173.92 | flat | electronics | -',
      'r0/t0/n92 | NORCROSS-FREIGHT | Norcross Freight | norcrossfreight.com | 87.1.14.232 | flat | logistics | unlisted',
      'r0/t0/n93 | NESBITT-ELECTRICAL | Nesbitt Electrical | nesbittelectrical.com | 87.1.112.119 | lone | electronics | -',
      'r0/t0/n94 | QUARRY-PHARMACY | Quarry Pharmacy | quarrypharmacy.com | 87.1.210.6 | flat | pharmacy | unlisted',
      'r0/t0/n95 | HORIZON-IT-SOLUTIONS | Horizon IT Solutions | horizonitsolutions.com | 87.1.51.146 | flat | it-services | -',
      'r0/t0/n96 | EVERGREEN-ADVISORY | Evergreen Advisory | evergreenadvisory.com | 87.1.149.33 | deep | consulting | -',
      'r0/t0/n97 | LOCKWOOD-ACCOUNTANTS | Lockwood Accountants | lockwoodaccountants.com | 87.1.246.173 | flat | accounting | unlisted',
      'r0/t0/n98 | KESTREL-ROASTERS | Kestrel Roasters | kestrelroasters.com | 87.1.88.60 | flat | coffee-bar | -',
      'r0/t0/n99 | VICTORIA-ROAD-GROCERS | Victoria Road Grocers | victoriaroadgrocers.com | 87.1.185.200 | flat | grocer | -',
      "r0/t0/n100 | TENNANTS-FLORIST | Tennant's Florist | tennantsflorist.com | 87.1.27.87 | lone | florist | -",
      'r0/t0/n101 | NEW-ROAD-PHONE-REPAIR | New Road Phone Repair | newroadphonerepair.com | 87.1.124.227 | lone | electronics | -',
      "r0/t0/n102 | STANHOPES-FLORIST | Stanhope's Florist | stanhopesflorist.com | 87.1.222.114 | lone | florist | -",
      'r0/t0/n103 | CANAL-STREET-BOOKSHOP | Canal Street Bookshop | canalstreetbookshop.com | 87.1.63.254 | lone | bookshop | -',
      'r0/t0/n104 | PEMBROKE-ACCOUNTANTS | Pembroke Accountants | pembrokeaccountants.com | 87.1.161.141 | deep | accounting | -',
      'r0/t0/n105 | STERLING-INSURANCE | Sterling Insurance | sterlinginsurance.com | 87.1.3.28 | deep | insurance | -',
      'r0/t0/n106 | MILL-LANE-BAKERY | Mill Lane Bakery | milllanebakery.com | 87.1.100.168 | lone | bakery | unlisted',
      'r0/t0/n107 | ABERNETHY-CHEMISTS | Abernethy Chemists | abernethychemists.com | 87.1.198.55 | flat | pharmacy | -',
      "r0/t0/n108 | CARVERS-BAKERY | Carver's Bakery | carversbakery.com | 87.1.39.195 | flat | bakery | -",
      'r0/t0/n109 | FRESHWAY-BOOKS | FreshWay Books | freshwaybooks.com | 87.1.137.82 | lone | bookshop | -',
      'r0/t0/n110 | ABBEY-ROAD-MUTUAL | Abbey Road Mutual | abbeyroadmutual.com | 87.1.234.222 | deep | insurance | -',
      'r0/t0/n111 | FORE-STREET-HARDWARE | Fore Street Hardware | forestreethardware.com | 87.1.76.109 | flat | hardware | -',
      'r0/t0/n112 | WESTGATE-PAWN | Westgate Pawn | westgatepawn.com | 87.1.173.249 | lone | pawn | -',
      'r0/t0/n113 | SHERIDAN-ELECTRICAL | Sheridan Electrical | sheridanelectrical.com | 87.1.15.136 | flat | electronics | -',
      'r0/t0/n114 | KEYSTONE-COFFEE | Keystone Coffee | keystonecoffee.com | 87.1.113.23 | lone | coffee-bar | -',
      'r0/t0/n115 | WESTBROOK-MUTUAL | Westbrook Mutual | westbrookmutual.com | 87.1.210.163 | flat | insurance | -',
      'r0/t0/n116 | SWIFT-FOODS | Swift Foods | swiftfoods.com | 87.1.52.50 | lone | grocer | -',
      'r0/t0/n117 | ANCHOR-TEA-ROOMS | Anchor Tea Rooms | anchortearooms.com | 87.1.149.190 | lone | tea-room | -',
      'r0/t0/n118 | WAYFARER-IT-SOLUTIONS | Wayfarer IT Solutions | wayfareritsolutions.com | 87.1.247.77 | flat | it-services | -',
      'r0/t0/n119 | FENWICK-ACCOUNTANTS | Fenwick Accountants | fenwickaccountants.com | 87.1.88.217 | deep | accounting | -',
      'r0/t0/n120 | QUEEN-STREET-HARDWARE | Queen Street Hardware | queenstreethardware.com | 87.1.186.104 | deep | hardware | -',
      'r0/t0/n121 | SUNRISE-CAFE | Sunrise Café | sunrisecafe.com | 87.1.27.244 | flat | cafe | -',
      'r0/t0/n122 | CASTLE-STREET-HARDWARE | Castle Street Hardware | castlestreethardware.com | 87.1.125.131 | lone | hardware | -',
      'r0/t0/n123 | THE-COACH-HOUSE | the Coach House | - | 87.1.223.18 | flat | - | -',
      'r0/t0/n124 | PRIMROSE-HOUSE | Primrose House | - | 87.1.64.158 | lone | - | -',
      'r0/t0/n125 | APPLE-TREE-LODGE | Apple Tree Lodge | - | 87.1.162.45 | lone | - | -',
      "r0/t0/n126 | OKONKWO-WIFI | the Okonkwos' house | - | 87.1.3.185 | flat | - | -",
      "r0/t0/n127 | ERIKSEN-WIFI | the Eriksens' house | - | 87.1.101.72 | flat | - | -",
      'r0/t0/n128 | FLAT-7C | flat 7C | - | 87.1.198.212 | flat | - | -',
      'r0/t0/n129 | THE-OLD-RECTORY | the Old Rectory | - | 87.1.40.99 | flat | - | -',
      "r0/t0/n130 | DOHERTY-WIFI | the Dohertys' house | - | 87.1.137.239 | flat | - | -",
      "r0/t0/n131 | QUIGLEY-WIFI | the Quigleys' house | - | 87.1.235.126 | lone | - | -",
      "r0/t0/n132 | THE-JANKOWSKIS | the Jankowskis' house | - | 87.1.77.13 | lone | - | -",
      'r0/t0/n133 | GARDEN-FLAT | the garden flat | - | 87.1.174.153 | flat | - | -',
      "r0/t0/n134 | THE-MAHONEYS | the Mahoneys' house | - | 87.1.16.40 | lone | - | -",
      'r0/t0/n135 | BASEMENT-FLAT | the basement flat | - | 87.1.113.180 | lone | - | -',
      'r0/t0/n136 | HAZEL-HOUSE | Hazel House | - | 87.1.211.67 | flat | - | -',
      'r0/t0/n137 | NETGEAR-E882 | the end terrace | - | 87.1.52.207 | flat | - | -',
      'r0/t0/n138 | TOP-FLAT | the top flat | - | 87.1.150.94 | flat | - | -',
      "r0/t0/n139 | THE-ROSSIS | the Rossis' house | - | 87.1.247.234 | flat | - | -",
      "r0/t0/n140 | FITZGERALD-WIFI | the Fitzgeralds' house | - | 87.1.89.121 | lone | - | -",
      'r0/t0/n141 | BARN-CONVERSION | the barn conversion | - | 87.1.187.8 | flat | - | -',
      "r0/t0/n142 | HADDAD-WIFI | the Haddads' house | - | 87.1.28.148 | flat | - | -",
      'r0/t0/n143 | BT-HUB-1401 | the new build | - | 87.1.126.35 | lone | - | -',
      "r0/t0/n144 | BIANCHI-WIFI | the Bianchis' house | - | 87.1.223.175 | flat | - | -",
      'r0/t0/n145 | HOLLY-HOUSE | Holly House | - | 87.1.65.62 | flat | - | -',
      'r0/t0/n146 | THE-OLD-DAIRY | the Old Dairy | - | 87.1.162.202 | flat | - | -',
      'r0/t0/n147 | LINKSYS-7CA1 | the townhouse | - | 87.1.4.89 | flat | - | -',
      'r0/t0/n148 | ELM-HOUSE | Elm House | - | 87.1.101.229 | lone | - | -',
      "r0/t0/n149 | NOVAK-WIFI | the Novaks' house | - | 87.1.199.116 | flat | - | -",
      'r0/t0/n150 | HEATHER-COTTAGE | Heather Cottage | - | 87.1.41.3 | flat | - | -',
      'r0/t0/n151 | PEAR-TREE-HOUSE | Pear Tree House | - | 87.1.138.143 | flat | - | -',
      "r0/t0/n152 | USMAN-WIFI | the Usmans' house | - | 87.1.236.30 | flat | - | -",
      "r0/t0/n153 | OSEI-WIFI | the Oseis' house | - | 87.1.77.170 | lone | - | -",
      'r0/t0/n154 | MAGNOLIA-COTTAGE | Magnolia Cottage | - | 87.1.175.57 | flat | - | -',
      'r0/t0/n155 | BEECH-LODGE | Beech Lodge | - | 87.1.16.197 | flat | - | -',
      'r0/t0/n156 | NETGEAR-5624 | the house by the bridge | - | 87.1.114.84 | flat | - | -',
      "r0/t0/n157 | ADEYEMI-WIFI | the Adeyemis' house | - | 87.1.211.224 | flat | - | -",
      'r0/t0/n158 | ROWAN-VIEW | Rowan View | - | 87.1.53.111 | flat | - | -',
      'r0/t0/n159 | LINKSYS-8939 | the house opposite the pub | - | 87.1.150.251 | lone | - | -',
      'r0/t0/n160 | TP-LINK-3B20 | the cottage by the green | - | 87.1.248.138 | flat | - | -',
      "r0/t0/n161 | THE-BRENNANS | the Brennans' house | - | 87.1.90.25 | lone | - | -",
      "r0/t0/n162 | THE-REILLYS | the Reillys' house | - | 87.1.187.165 | flat | - | -",
      'r0/t0/n163 | TP-LINK-F472 | the house by the allotments | - | 87.1.29.52 | flat | - | -',
      'r0/t0/n164 | TP-LINK-48AD | the house with the long drive | - | 87.1.126.192 | lone | - | -',
      "r0/t0/n165 | PATEL-WIFI | the Patels' house | - | 87.1.224.79 | flat | - | -",
      'r0/t0/n166 | NETGEAR-8118 | the converted chapel | - | 87.1.65.219 | flat | - | -',
      'r0/t0/n167 | CARTWRIGHT-DENTAL-CARE | Cartwright Dental Care | cartwrightdentalcare.com | 87.1.163.106 | flat | dentist | -',
      'r0/t0/n168 | MARKET-SQUARE-MEDICAL-CENTRE | Market Square Medical Centre | marketsquaremedicalcentre.com | 87.1.4.246 | flat | clinic | -',
      'r0/t0/n169 | MAIN-STREET-DENTAL-SURGERY | Main Street Dental Surgery | mainstreetdentalsurgery.com | 87.1.102.133 | flat | dentist | unlisted',
      'r0/t0/n170 | LANDMARK-DENTAL | Landmark Dental | landmarkdental.com | 87.1.200.20 | deep | dentist | -',
      'r0/t0/n171 | IRONSIDE-DENTAL | Ironside Dental | ironsidedental.com | 87.1.41.160 | deep | dentist | -',
      'r0/t0/n172 | GILCHRIST-FAMILY-PRACTICE | Gilchrist Family Practice | gilchristfamilypractice.com | 87.1.139.47 | deep | clinic | -',
      'r0/t0/n173 | OLD-TOWN-DENTAL-SURGERY | Old Town Dental Surgery | oldtowndentalsurgery.com | 87.1.236.187 | flat | dentist | unlisted',
      'r0/t0/n174 | WATER-LANE-MEDICAL-CENTRE | Water Lane Medical Centre | waterlanemedicalcentre.com | 87.1.78.74 | deep | clinic | unlisted',
      'r0/t0/n175 | CROWTHER-GOODWIN-RIDGEMONT | the Ridgemont office | - | 87.1.175.214 | deep | consulting | c7',
      'r0/t0/n176 | PRESCOTT-NORCROSS-RIDGEMONT | the Ridgemont office | - | 87.1.17.101 | flat | accounting | c24',
      'r0/t0/n177 | OAKLEY-BARROW-RIDGEMONT | the Ridgemont office | - | 87.1.114.241 | deep | it-services | c26',
    ]);
  });

  it('is declared after every other network, so drawing it moved no earlier key', () => {
    expect(ridgemontDrawn().length).toBeGreaterThan(0);
    expect(DECLARED_NETWORKS.slice(-ridgemontDrawn().length)).toEqual(ridgemontDrawn());
  });

  it('names no business or practice under a wifi or a domain any other network holds', () => {
    const named = ridgemontDrawn().filter(
      (network) => drawnAs(network) === 'business' || drawnAs(network) === 'practice',
    );
    expect(named).toHaveLength(73);
    for (const network of named) {
      const others = DECLARED_NETWORKS.filter((other) => other !== network);
      expect(
        others.map((other) => other.essid),
        network.key,
      ).not.toContain(network.essid);
      expect(
        others.flatMap((other) => other.site?.domain ?? []),
        network.key,
      ).not.toContain(network.site?.domain);
    }
  });

  it("answers every one in Ridgemont's block of the region, and finds it there again", () => {
    expect(ridgemontDrawn().length).toBeGreaterThan(0);
    for (const network of ridgemontDrawn()) {
      const address = publicAddress(network.key) ?? '';
      expect(address, network.key).toMatch(/^87\.1\.\d{1,3}\.\d{1,3}$/);
      expect(networkAt(address), network.key).toBe(network.key);
    }
  });

  it('forwards services beyond their sites from its gateways, as a town does, and none from a landmark', () => {
    expect(
      ridgemontDrawn().filter((network) => seededForwards(network.key).length > 0).length,
    ).toBeGreaterThan(0);
    for (const network of DECLARED_NETWORKS.filter((each) => isLandmark(each.key))) {
      expect(seededForwards(network.key), network.key).toEqual([]);
    }
  });

  it('says on the front page of every business and practice that it stands in Ridgemont', () => {
    const named = ridgemontDrawn().filter(
      (network) => drawnAs(network) === 'business' || drawnAs(network) === 'practice',
    );
    expect(named.length).toBeGreaterThan(0);
    for (const network of named) {
      expect(homepageAt(network.site?.domain ?? ''), network.key).toContain(', Ridgemont');
    }
  });

  it('is found on findit by every site it publishes but the 11 it keeps unlisted', async () => {
    const web = await indexedWeb({
      findPatchesForMachines: async () => ({ data: [], error: null }),
      siteAt: async () => null,
    });
    const searchable = new Set(web.map((page) => page.address));
    const sited = ridgemontDrawn().filter((network) => network.site !== undefined);
    const listed = sited.filter((network) => network.unlisted !== true);
    const unlisted = sited.filter((network) => network.unlisted === true);
    expect([listed.length, unlisted.length]).toEqual([63, 11]);
    expect(
      listed
        .filter((network) => !searchable.has(network.site?.domain ?? ''))
        .map((network) => network.key),
    ).toEqual([]);
    expect(
      unlisted
        .filter((network) => searchable.has(network.site?.domain ?? ''))
        .map((network) => network.key),
    ).toEqual([]);
  });

  it("broadcasts 178 wifis in Ridgemont, no two alike and none a noise network's", () => {
    const essids = DECLARED_NETWORKS.filter((network) => network.town === RIDGEMONT).map(
      (network) => network.essid,
    );
    expect(essids).toHaveLength(178);
    expect(new Set(essids).size).toBe(178);
    expect(essids.filter((essid) => noiseEssidPool.includes(essid))).toEqual([]);
  });
});

describe('the addresses of the world', () => {
  /** Every network with a public address: all the declared ones, and the fixed sites. */
  const everyKey = (): readonly string[] => [
    ...DECLARED_NETWORKS.map((network) => network.key),
    ...FIXED_SITES.map((site) => site.key),
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

/**
 * Names are drawn from word lists, and a town, a city and the corporations draw many. The
 * lists are long enough that no kind of place runs out of names, and a home and a business
 * never share a word, so no home reads as the family behind a shop.
 */
describe('the words places are named with', () => {
  it('gives businesses 72 surnames, 36 streets and 60 fillers, and homes surnames, plants and descriptions of their own', () => {
    expect(NAME_WORDS.surname).toHaveLength(72);
    expect(NAME_WORDS.street).toHaveLength(36);
    expect(NAME_WORDS.filler).toHaveLength(60);
    expect(HOME_WORDS.surname.length).toBeGreaterThanOrEqual(30);
    expect(HOME_WORDS.plant.length).toBeGreaterThanOrEqual(20);
    expect(HOME_WORDS.description.length).toBeGreaterThanOrEqual(20);
    const words = [...Object.values(NAME_WORDS), ...Object.values(HOME_WORDS)]
      .flat()
      .map((word) => word.toLowerCase());
    expect(words.filter((word, index) => words.indexOf(word) !== index)).toEqual([]);
  });

  it('can form 150 names or more for every kind of business and practice, for the corporations and for the homes', () => {
    for (const subtype of Object.keys(NAME_TEMPLATES) as NamedSubtype[]) {
      const names = NAME_TEMPLATES[subtype].flatMap((template) => fillingsOf(template));
      expect(names.length, subtype).toBeGreaterThanOrEqual(150);
    }
    expect(corporationNames().length).toBeGreaterThanOrEqual(150);
    expect(everyFormedHome().length).toBeGreaterThanOrEqual(150);
  });

  it('names no two places a town draws with one word: its businesses, its practices and its homes', () => {
    // A branch carries its company's name, and is drawn by no town's grammar.
    const towns = drawnTowns();
    expect(towns.length).toBeGreaterThan(2);
    for (const town of towns) {
      const drawn = DECLARED_NETWORKS.filter(
        (network) => network.town === town && network.parent === undefined,
      );
      expect(drawn.flatMap(wordsOf).length, town).toBeGreaterThan(0);
      expect(repeatedWords(drawn), town).toEqual([]);
    }
  });

  it('names no two corporations with one word', () => {
    expect(corporations().flatMap(wordsOf).length).toBeGreaterThan(corporations().length);
    expect(repeatedWords(corporations())).toEqual([]);
  });
});

describe('the regions of the world', () => {
  it('carve their blocks from octets no placeless site holds', () => {
    for (const octet of REGION_FIRST_OCTETS) {
      expect(octet).not.toBe(PLACELESS_FIRST_OCTET);
    }
  });
});
