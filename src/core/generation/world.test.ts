import { describe, expect, it } from 'vitest';
import { publisherAt, publisherIp, siteAddress } from './publisher.js';
import { isPublicIp, publicFirstOctets, PUBLISHER_FIRST_OCTET } from './ip.js';
import { FINDIT_DOMAIN } from './finditNetwork.js';
import { siteServer } from './siteServer.js';
import { resolveLanHostIdentity } from './lanHostIdentity.js';
import { createFsView } from '../filesystem/fsView.js';
import { walkTree } from '../filesystem/walkTree.js';
import { asAbsPath } from '../types.js';
import { DECLARED_NETWORKS, REGION_FIRST_OCTETS, type DeclaredNetwork } from './world.js';
import { generateHomeLan } from './generateHomeLan.js';
import { buildApGatewayBaseFs } from './routerFs.js';
import { resolveLanName } from '../network/resolveName.js';

/**
 * The world reaches past Ridgemont. Millbrook is a village of its own, with its own block
 * of public addresses, whose institutions put their websites on the internet the way
 * Ridgemont's do. Nobody stands on its wifi yet, so the internet is the only way there.
 */

/** The front page served at `domain`, read off the box its network serves the web from. */
const homepageAt = (domain: string): string => {
  const address = siteAddress(domain);
  if (address === undefined) throw new Error(`nobody holds ${domain}`);
  const key = publisherAt(address);
  if (key === undefined) throw new Error(`nothing answers at ${address}`);
  const server = siteServer(key);
  if (server === undefined) throw new Error(`${key} serves no site`);
  const read = createFsView(resolveLanHostIdentity(server, key).baseFs, {
    userType: 'root',
  }).read(asAbsPath('/var/www/html/index.html'));
  if (!read.ok) throw new Error(`${key} has no front page`);
  return read.content;
};

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
      const address = publisherIp(network.key) ?? '';
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
        publisherIp(network.key),
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
    ]);
  });

  it('scatters its networks across its block rather than numbering them in a row', () => {
    const slots = millbrook().map((network) => {
      const [, , third, fourth] = (publisherIp(network.key) ?? '').split('.').map(Number);
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
      ...DECLARED_NETWORKS.flatMap((network) => publisherIp(network.key) ?? []),
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
      expect(publisherAt(publisherIp(network.key) ?? '')).toBe(network.key);
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

describe('Ridgemont', () => {
  it('still serves its own people on the sites that speak of them', () => {
    expect(descriptionOf(homepageAt('ridgemontlibrary.org'))).toContain(
      'visitor information for the people of Ridgemont.',
    );
  });
});

describe('the regions of the world', () => {
  it('carve their blocks from octets no joining network draws and no placeless site holds', () => {
    for (const octet of REGION_FIRST_OCTETS) {
      expect(publicFirstOctets).not.toContain(octet);
      expect(octet).not.toBe(PUBLISHER_FIRST_OCTET);
    }
  });
});
