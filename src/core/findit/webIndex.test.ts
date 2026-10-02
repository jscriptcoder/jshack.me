import { describe, expect, it } from 'vitest';
import {
  indexedWeb,
  publisherMachineIds,
  type MachinePatchRow,
  type WebIndexDeps,
} from './webIndex.js';
import { computeApGatewayId } from '../identity/router.js';
import { siteServer } from '../generation/siteServer.js';
import { resolveLanHostIdentity } from '../generation/lanHostIdentity.js';
import { publisherIp, publisherSite } from '../generation/publisher.js';
import { FINDIT_NETWORK } from '../generation/findit.js';
import { rankPages } from './search.js';
import { DECLARED_NETWORKS, publicAddress } from '../generation/world.js';

/**
 * What findit holds when somebody searches: every homepage on the public web as it is
 * BEING SERVED, not as it was generated. A page somebody rewrote reads as they
 * rewrote it, and a site that has gone dark is simply not there to find — the index is
 * a view of the live web, so nothing about it can go stale.
 */

const CAMPUS = 'CAMPUS-GUEST-OPEN';
const CAMPUS_DOMAIN = 'ridgemont.edu';

const patchRow = (overrides: Partial<MachinePatchRow> = {}): MachinePatchRow => ({
  machine_id: 'unset',
  path: '/var/www/html/index.html',
  content: '<html><head><title>Unset</title></head><body></body></html>',
  owner: 'root',
  permissions: null,
  node_type: 'file',
  updated_at: '2026-01-01T00:00:00Z',
  writer_key: 'somebody',
  ...overrides,
});

const campusServerId = (): string => {
  const server = siteServer(CAMPUS);
  if (server === undefined) throw new Error('the campus serves no site');
  return resolveLanHostIdentity(server, CAMPUS).machineId;
};

/** A world in which the given rows have been written, nobody has joined a network, and
 *  every address fetched the ordinary way answers with nothing. */
const depsWith = (
  rows: readonly MachinePatchRow[] = [],
  overrides: Partial<WebIndexDeps> = {},
): WebIndexDeps => ({
  findPatchesForMachines: async (machineIds) => ({
    data: rows.filter((row) => machineIds.includes(row.machine_id)),
    error: null,
  }),
  siteAt: async () => null,
  ...overrides,
});

/** The index, built over a world in which the given rows have been written. */
const indexWith = async (rows: readonly MachinePatchRow[] = []) => indexedWeb(depsWith(rows));

/** A site as a visitor to its address would be served it. */
const servedSite = (homepage: string, robotsTxt: string | null = null) => ({ homepage, robotsTxt });

const found = async (domain: string, rows: readonly MachinePatchRow[] = []) =>
  (await indexWith(rows)).find((page) => page.address === domain);

describe('the web findit searches', () => {
  it('holds every institution that publishes a website, under its own domain', async () => {
    const web = await indexWith();
    const domains = web.map((page) => page.address);
    expect(domains).toContain(CAMPUS_DOMAIN);
    expect(domains).toContain('acme.com');
    expect(new Set(domains).size).toBe(domains.length);
  });

  it('puts the institution a search names first: the police for police, the court for court', async () => {
    const web = await indexWith();
    // More than one town keeps a listed police department, so all of them come before
    // anything else, and a search names the town to find its own first.
    const departments = web
      .map((page) => page.address)
      .filter((address) => /pd\.gov$/.test(address));
    const police = rankPages(web, 'police').map((page) => page.address);
    expect(departments.length).toBeGreaterThan(1);
    expect([...police.slice(0, departments.length)].sort()).toEqual([...departments].sort());
    expect(rankPages(web, 'ridgemont police')[0]?.address).toBe('ridgemontpd.gov');
    expect(rankPages(web, 'kingsford police')[0]?.address).toBe('kingsfordpd.gov');
    // More than one town keeps a court, so a search names the town to find its own.
    expect(rankPages(web, 'court')[0]?.address).toMatch(/^[a-z]+courts\.gov$/);
    expect(rankPages(web, 'ridgemont court')[0]?.address).toBe('ridgemontcourts.gov');
    expect(rankPages(web, 'oakhurst court')[0]?.address).toBe('oakhurstcourts.gov');
  });

  it('puts a shop first for its own name, and for the groceries only a shop says it sells', async () => {
    const web = await indexWith();
    const shops = DECLARED_NETWORKS.filter((network) => network.category === 'retail').flatMap(
      (network) => network.site?.domain ?? [],
    );
    expect(rankPages(web, 'monstromart')[0]?.address).toBe('monstromart.com');
    expect(shops).toContain(rankPages(web, 'groceries')[0]?.address);
  });

  it('lists the council, the library and the hospital of a town beyond Ridgemont for its name', async () => {
    const web = await indexWith();
    const found = rankPages(web, 'millbrook').map((page) => page.address);
    expect(found).toEqual(
      expect.arrayContaining(['millbrook.gov', 'millbrooklibrary.org', 'millbrookhospital.org']),
    );
  });

  it('describes every place in a town beyond Ridgemont as standing in that town', async () => {
    // A search for a town and a kind of place has nothing else to go on: a café's name
    // says nothing of where it stands.
    const web = await indexWith();
    const places = DECLARED_NETWORKS.filter(
      (network) =>
        network.town !== undefined &&
        network.town !== 'Ridgemont' &&
        network.site !== undefined &&
        network.unlisted !== true,
    );
    expect(places.length).toBeGreaterThan(0);
    for (const place of places) {
      const page = web.find((each) => each.address === place.site?.domain);
      expect(page?.description, place.key).toContain(place.town);
    }
  });

  it("lists every place of a town beyond Ridgemont in the top ten for the town's name and a word of its kind", async () => {
    /** A word each kind of place says of itself in its description. */
    const kindWords: Readonly<Record<string, string>> = {
      'the town hall': 'council',
      'the police station': 'police',
      'the public library': 'library',
      'the courthouse': 'court',
      hospital: 'wards',
      clinic: 'vaccinations',
      dentist: 'fillings',
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
    const web = await indexWith();
    const places = DECLARED_NETWORKS.filter(
      (network) =>
        network.town !== undefined &&
        network.town !== 'Ridgemont' &&
        network.site !== undefined &&
        network.unlisted !== true,
    );
    const missed = places.flatMap((place) => {
      const query = `${place.town} ${kindWords[place.subtype ?? place.place]}`;
      const found = rankPages(web, query)
        .slice(0, 10)
        .map((page) => page.address);
      return found.includes(place.site?.domain ?? '') ? [] : [`${query}: ${place.site?.domain}`];
    });
    expect(places.map((place) => place.town)).toContain('Oakhurst');
    expect(missed).toEqual([]);
    expect(rankPages(web, 'Millbrook café').map((page) => page.address)).toContain(
      'yatesscafe.com',
    );
  });

  it('puts the hospital first for the wards only a hospital says it keeps', async () => {
    const web = await indexWith();
    expect(rankPages(web, 'wards')[0]?.address).toMatch(/^[a-z]+hospital\.org$/);
  });

  it('puts a listed dentist first for the fillings only a dentist says it does', async () => {
    const web = await indexWith();
    const dentists = DECLARED_NETWORKS.filter(
      (network) => network.subtype === 'dentist' && network.unlisted !== true,
    ).flatMap((network) => network.site?.domain ?? []);
    expect(dentists).not.toEqual([]);
    expect(dentists).toContain(rankPages(web, 'fillings')[0]?.address);
  });

  it("lists each of that town's listed businesses for its own name", async () => {
    const web = await indexWith();
    const businesses = DECLARED_NETWORKS.filter(
      (network) =>
        network.town === 'Millbrook' &&
        network.parent === undefined &&
        network.unlisted !== true &&
        ['cafe', 'retail', 'corporate'].includes(network.category),
    );
    expect(businesses.length).toBeGreaterThan(0);
    for (const business of businesses) {
      expect(rankPages(web, business.place)[0]?.address).toBe(business.site?.domain);
    }
  });

  it("lists every corporation, which nothing but a search leads to, first for its own name and described in its kind's words", async () => {
    /** A word only one kind of office uses of itself. */
    const kindWords: Readonly<Record<string, string>> = {
      consulting: 'audits',
      logistics: 'freight',
      insurance: 'insurance',
      'it-services': 'managed IT',
      accounting: 'payroll',
    };
    const web = await indexWith();
    const corporations = DECLARED_NETWORKS.filter((network) => network.town === undefined);
    expect(corporations.length).toBeGreaterThanOrEqual(20);
    for (const corporation of corporations) {
      const domain = corporation.site?.domain;
      expect(rankPages(web, corporation.place)[0]?.address, corporation.key).toBe(domain);
      // A search shows one page of results, so it is the description a search reads, not
      // a place on that page, that every office of a kind can count on.
      expect(web.find((page) => page.address === domain)?.description, corporation.key).toContain(
        kindWords[corporation.subtype ?? ''],
      );
    }
  });

  it('reads each homepage for what the site calls itself and says about itself', async () => {
    const campus = await found(CAMPUS_DOMAIN);
    expect(campus?.title).toBe(publisherSite(CAMPUS)?.name);
    expect(campus?.description).toContain('admissions');
  });

  it('reads a homepage somebody rewrote as it now reads', async () => {
    const rewritten = await found(CAMPUS_DOMAIN, [
      patchRow({
        machine_id: campusServerId(),
        content: '<html><head><title>OWNED BY R00T</title></head><body><p>Hacked.</p></body></html>',
      }),
    ]);
    expect(rewritten?.title).toBe('OWNED BY R00T');
    expect(rewritten?.text).toBe('Hacked.');
  });

  it('cannot find a site whose web server will not come up', async () => {
    const bricked = await found(CAMPUS_DOMAIN, [
      patchRow({ machine_id: campusServerId(), path: '/boot/vmlinuz', content: null }),
    ]);
    expect(bricked).toBeUndefined();
  });

  it('cannot find a site whose gateway will not come up', async () => {
    const bricked = await found(CAMPUS_DOMAIN, [
      patchRow({ machine_id: computeApGatewayId(CAMPUS), path: '/boot/vmlinuz', content: null }),
    ]);
    expect(bricked).toBeUndefined();
  });

  it('cannot find a site whose front page was deleted', async () => {
    const deleted = await found(CAMPUS_DOMAIN, [
      patchRow({ machine_id: campusServerId(), content: null }),
    ]);
    expect(deleted).toBeUndefined();
  });

  it('cannot find a site whose web server has been stopped', async () => {
    const stopped = await found(CAMPUS_DOMAIN, [
      patchRow({ machine_id: campusServerId(), path: '/var/run/nginx.pid', content: null }),
    ]);
    expect(stopped).toBeUndefined();
  });

  it('follows a gateway repointed at somebody else, and lists whatever now answers', async () => {
    const elsewhere = await indexedWeb({
      findPatchesForMachines: async () => ({
        data: [
          patchRow({
            machine_id: computeApGatewayId(CAMPUS),
            path: '/etc/iptables/rules.v4',
            // The gateway's own forward table, rewritten to send the web somewhere
            // else — what a player who has rooted the gateway writes.
            content: 'forward 80 to 192.168.200.250:80\n',
          }),
        ],
        error: null,
      }),
      siteAt: async () =>
        servedSite('<html><head><title>Somebody else</title></head><body><p>Mine now.</p></body></html>'),
    });
    expect(elsewhere.find((page) => page.address === CAMPUS_DOMAIN)?.title).toBe('Somebody else');
  });

  it('holds nothing but the sites it found, so a dark one leaves no gap behind', async () => {
    const web = await indexWith([
      patchRow({ machine_id: campusServerId(), path: '/boot/vmlinuz', content: null }),
    ]);
    // Two machines are read per publisher, exactly one publisher has gone dark, and the
    // unlisted ones are read only to be left out.
    const unlisted = DECLARED_NETWORKS.filter((network) => network.unlisted === true).length;
    expect(web.length).toBe(publisherMachineIds().length / 2 - 1 - unlisted);
    for (const page of web) {
      expect(page.address).not.toBe('');
      expect(typeof page.title).toBe('string');
    }
  });

  it('replays a whole journal, not only its last line', async () => {
    // Two writes to one machine, and the EARLIER one is what decides: the web server was
    // stopped, and only then was the page rewritten. A reader of the last row alone would
    // list a site that stopped answering before the page it is listing was even written.
    const defacedAfterStopping = await found(CAMPUS_DOMAIN, [
      patchRow({ machine_id: campusServerId(), path: '/var/run/nginx.pid', content: null }),
      patchRow({
        machine_id: campusServerId(),
        content: '<html><head><title>Mine</title></head><body></body></html>',
      }),
    ]);
    expect(defacedAfterStopping).toBeUndefined();
  });

  it('lists a gateway that took over serving the web itself', async () => {
    const takenOver = await indexedWeb({
      findPatchesForMachines: async () => ({
        data: [
          patchRow({
            machine_id: computeApGatewayId(CAMPUS),
            path: '/etc/iptables/rules.v4',
            content: '# nothing forwarded any more\n',
          }),
          patchRow({
            machine_id: computeApGatewayId(CAMPUS),
            path: '/var/run/nginx.pid',
            content: 'nginx 80\n',
          }),
        ],
        error: null,
      }),
      siteAt: async () =>
        servedSite('<html><head><title>Gateway page</title></head><body><p>Served here now.</p></body></html>'),
    });
    expect(takenOver.find((page) => page.address === CAMPUS_DOMAIN)?.title).toBe('Gateway page');
  });

  it('asks for the publishers a few hundred machines at a time, each machine once', async () => {
    // One read names its machines in its request's address, and an address naming every
    // publisher in a city's world is longer than the database's gateway accepts. The
    // single read before the city named 281 machines in 6.7 KB and was answered; with the
    // city, 529 in 12.6 KB were refused.
    const asked: string[][] = [];
    await indexedWeb({
      findPatchesForMachines: async (machineIds) => {
        asked.push([...machineIds]);
        return { data: [], error: null };
      },
      siteAt: async () => null,
    });
    const named = asked.flat();
    expect(asked.length).toBeGreaterThan(1);
    expect(asked.length).toBeLessThan(10);
    expect(new Set(named).size).toBe(named.length);
    expect(named).toEqual(expect.arrayContaining([...publisherMachineIds()]));
    for (const machineIds of asked) {
      const address = encodeURIComponent(machineIds.map((id) => `"${id}"`).join(','));
      expect(address.length).toBeLessThanOrEqual(6_000);
    }
  });

  it('serves a rewritten homepage whichever read its machine is asked for in', async () => {
    const reads: string[][] = [];
    const deps = depsWith([], {
      findPatchesForMachines: async (machineIds) => {
        reads.push([...machineIds]);
        return { data: [], error: null };
      },
    });
    await indexedWeb(deps);
    const laterReads = reads.slice(1).flat();
    const publisher = DECLARED_NETWORKS.find((network) => {
      const server = siteServer(network.key);
      return (
        network.site !== undefined &&
        network.unlisted !== true &&
        server !== undefined &&
        laterReads.includes(resolveLanHostIdentity(server, network.key).machineId)
      );
    });
    const server = publisher === undefined ? undefined : siteServer(publisher.key);
    if (publisher?.site === undefined || server === undefined) {
      throw new Error('no read after the first names a listed web server');
    }
    const rewritten = patchRow({
      machine_id: resolveLanHostIdentity(server, publisher.key).machineId,
      content: '<html><head><title>Rewritten Late</title></head><body></body></html>',
    });
    const page = (await indexWith([rewritten])).find(
      (each) => each.address === publisher.site?.domain,
    );
    expect(page?.title).toBe('Rewritten Late');
  });

  it('finds nothing at all when any of its reads fails', async () => {
    let reads = 0;
    const web = await indexedWeb({
      findPatchesForMachines: async () => {
        reads += 1;
        return reads === 2
          ? { data: null, error: new Error('down') }
          : { data: [], error: null };
      },
      siteAt: async () => null,
    });
    expect(web).toEqual([]);
  });

  it('finds nothing at all when the journals cannot be read', async () => {
    const web = await indexedWeb({
      findPatchesForMachines: async () => ({ data: null, error: new Error('down') }),
      siteAt: async () => null,
    });
    expect(web).toEqual([]);
  });
});

/**
 * A search on a server that has already answered one. What the world generated may be
 * kept between searches, but a site somebody touched since must be read as it is served
 * now, and a site whose touches are gone must read as generated again.
 */
describe('a search after an earlier one', () => {
  /** The index, built after a search of the untouched world. */
  const afterAnUntouchedSearch = async (
    rows: readonly MachinePatchRow[],
    overrides: Partial<WebIndexDeps> = {},
  ) => {
    await indexWith();
    return indexedWeb(depsWith(rows, overrides));
  };
  const campusIn = (web: readonly { readonly address: string; readonly title: string }[]) =>
    web.find((page) => page.address === CAMPUS_DOMAIN);

  it('answers the untouched world exactly as the first did', async () => {
    expect(await indexWith()).toEqual(await indexWith());
  });

  it('reads a homepage rewritten since as it now reads', async () => {
    const web = await afterAnUntouchedSearch([
      patchRow({
        machine_id: campusServerId(),
        content: '<html><head><title>Rewritten Since</title></head><body></body></html>',
      }),
    ]);
    expect(campusIn(web)?.title).toBe('Rewritten Since');
  });

  it('cannot find a site whose web server was bricked since', async () => {
    const web = await afterAnUntouchedSearch([
      patchRow({ machine_id: campusServerId(), path: '/boot/vmlinuz', content: null }),
    ]);
    expect(campusIn(web)).toBeUndefined();
  });

  it('cannot find a site whose web server was stopped since', async () => {
    const web = await afterAnUntouchedSearch([
      patchRow({ machine_id: campusServerId(), path: '/var/run/nginx.pid', content: null }),
    ]);
    expect(campusIn(web)).toBeUndefined();
  });

  it('cannot find a site whose gateway was bricked since', async () => {
    const web = await afterAnUntouchedSearch([
      patchRow({ machine_id: computeApGatewayId(CAMPUS), path: '/boot/vmlinuz', content: null }),
    ]);
    expect(campusIn(web)).toBeUndefined();
  });

  it('lists whatever answers behind a gateway repointed since', async () => {
    const web = await afterAnUntouchedSearch(
      [
        patchRow({
          machine_id: computeApGatewayId(CAMPUS),
          path: '/etc/iptables/rules.v4',
          content: 'forward 80 to 192.168.200.250:80\n',
        }),
      ],
      {
        siteAt: async () =>
          servedSite('<html><head><title>Somebody else</title></head><body></body></html>'),
      },
    );
    expect(campusIn(web)?.title).toBe('Somebody else');
  });

  it('reads a site as generated again once its box is restored', async () => {
    await indexWith([
      patchRow({
        machine_id: campusServerId(),
        content: '<html><head><title>Rewritten Before</title></head><body></body></html>',
      }),
    ]);
    expect(campusIn(await indexWith())?.title).toBe(publisherSite(CAMPUS)?.name);
  });
});

/**
 * A player's page: served on a network with no domain, found because it answers on the
 * public web at all. Nobody submits it — being there is enough, and the only way to stay
 * out is to say so in `robots.txt`.
 */

const HOME = 'APT-3B-WIFI';
const HOME_IP = publicAddress(HOME) ?? '';
const HOME_LAN_BOX = '192.168.77.20';

const homeGateway = (content: string): MachinePatchRow =>
  patchRow({ machine_id: computeApGatewayId(HOME), path: '/etc/iptables/rules.v4', content });

/** A home network whose gateway sends the public web to a box on its LAN. */
const HOME_FORWARDING_THE_WEB = homeGateway(`forward 80 to ${HOME_LAN_BOX}:80\n`);

const PLAYER_PAGE =
  '<html><head><title>Ada builds things</title></head><body><p>Robots and gardening.</p></body></html>';

/** Every address the index went on to fetch the ordinary way, in the order it asked. */
const recordingVisits = () => {
  const visited: string[] = [];
  const siteAt = async (publicIp: string) => {
    visited.push(publicIp);
    return servedSite(PLAYER_PAGE);
  };
  return { visited, siteAt };
};

describe("a player's page on the public web", () => {
  it('is listed under the bare address it answers at', async () => {
    const web = await indexedWeb(
      depsWith([HOME_FORWARDING_THE_WEB], {
        siteAt: async (publicIp) => (publicIp === HOME_IP ? servedSite(PLAYER_PAGE) : null),
      }),
    );
    expect(web.find((page) => page.address === HOME_IP)).toEqual({
      address: HOME_IP,
      title: 'Ada builds things',
      description: 'Robots and gardening.',
      text: 'Robots and gardening.',
    });
  });

  it('is titled by its address when it names nothing', async () => {
    const web = await indexedWeb(
      depsWith([HOME_FORWARDING_THE_WEB], {
        siteAt: async () => servedSite('<html><body><p>No title here.</p></body></html>'),
      }),
    );
    expect(web.find((page) => page.address === HOME_IP)?.title).toBe(HOME_IP);
  });

  it('is not there when a visitor to that address would be served nothing', async () => {
    const web = await indexedWeb(
      depsWith([HOME_FORWARDING_THE_WEB], {
        siteAt: async () => null,
      }),
    );
    expect(web.map((page) => page.address)).not.toContain(HOME_IP);
  });

  it('is listed when the gateway serves the page itself', async () => {
    const web = await indexedWeb(
      depsWith(
        [
          homeGateway('# nothing forwarded\n'),
          patchRow({
            machine_id: computeApGatewayId(HOME),
            path: '/var/run/nginx.pid',
            content: 'nginx 80\n',
          }),
        ],
        {
            siteAt: async () => servedSite(PLAYER_PAGE),
        },
      ),
    );
    expect(web.map((page) => page.address)).toContain(HOME_IP);
  });

  it('is never looked for on a network whose gateway serves no web at all', async () => {
    const { visited, siteAt } = recordingVisits();
    const web = await indexedWeb(
      depsWith([], { siteAt }),
    );
    expect(web.map((page) => page.address)).not.toContain(HOME_IP);
    expect(visited).toEqual([]);
  });

  it('is never looked for at a home in another town, whose gateway keeps its web to itself', async () => {
    const homes = DECLARED_NETWORKS.filter(
      (network) => network.town === 'Millbrook' && network.category === 'residential',
    ).map((network) => publicAddress(network.key));
    expect(homes.length).toBeGreaterThan(0);
    const { visited, siteAt } = recordingVisits();
    const web = await indexedWeb(depsWith([], { siteAt }));
    for (const address of homes) {
      expect(visited).not.toContain(address);
      expect(web.map((page) => page.address)).not.toContain(address);
    }
  });

  it('is never looked for behind a gateway that will not come up', async () => {
    const { visited, siteAt } = recordingVisits();
    const web = await indexedWeb(
      depsWith(
        [
          HOME_FORWARDING_THE_WEB,
          patchRow({ machine_id: computeApGatewayId(HOME), path: '/boot/vmlinuz', content: null }),
        ],
        { siteAt },
      ),
    );
    expect(web.map((page) => page.address)).not.toContain(HOME_IP);
    expect(visited).toEqual([]);
  });

  it("reads the players' gateways in the same reads as the publishers'", async () => {
    const asked: string[][] = [];
    await indexedWeb(
      depsWith([], {
        findPatchesForMachines: async (machineIds) => {
          asked.push([...machineIds]);
          return { data: [], error: null };
        },
      }),
    );
    // Exactly the machines a listing can come from: every publisher's, and the gateway of
    // every declared network that publishes nothing. A search costs what the world holds.
    const unpublishedGateways = DECLARED_NETWORKS.filter(
      (network) => network.site === undefined,
    ).map((network) => computeApGatewayId(network.key));
    expect(unpublishedGateways).toContain(computeApGatewayId(HOME));
    expect(asked.flat().sort()).toEqual(
      [...publisherMachineIds(), ...unpublishedGateways].sort(),
    );
  });

  it('lists an institution once, by its domain, never again by its address', async () => {
    const campusIp = publisherIp(CAMPUS);
    if (campusIp === undefined) throw new Error('the campus has no address');
    const web = await indexedWeb(
      depsWith([], {
        siteAt: async () => servedSite(PLAYER_PAGE),
      }),
    );
    expect(web.map((page) => page.address)).not.toContain(campusIp);
    expect(web.filter((page) => page.address === CAMPUS_DOMAIN)).toHaveLength(1);
  });

  it('never lists findit among its own results', async () => {
    const finditIp = publicAddress(FINDIT_NETWORK);
    const web = await indexedWeb(
      depsWith(
        [
          patchRow({
            machine_id: computeApGatewayId(FINDIT_NETWORK),
            path: '/etc/iptables/rules.v4',
            content: `forward 80 to ${HOME_LAN_BOX}:80
`,
          }),
        ],
        { siteAt: async () => servedSite(PLAYER_PAGE) },
      ),
    );
    expect(web.map((page) => page.address)).not.toContain(finditIp);
  });

  it('is looked for on every network nobody publishes from, joined or not', async () => {
    // Every network's address is its place in the world, so a page served through any
    // gateway that forwards the web is found there, with no record of who ever joined.
    const unpublished = DECLARED_NETWORKS.filter((network) => network.site === undefined);
    const web = await indexedWeb(
      depsWith(
        unpublished.map((network) =>
          patchRow({
            machine_id: computeApGatewayId(network.key),
            path: '/etc/iptables/rules.v4',
            content: `forward 80 to ${HOME_LAN_BOX}:80
`,
          }),
        ),
        { siteAt: async () => servedSite(PLAYER_PAGE) },
      ),
    );
    expect(unpublished.length).toBeGreaterThan(0);
    expect(web.map((page) => page.address)).toEqual(
      expect.arrayContaining(unpublished.map((network) => publicAddress(network.key))),
    );
  });

  it('never looks for a page on a network the world does not declare', async () => {
    const { visited, siteAt } = recordingVisits();
    await indexedWeb(
      depsWith(
        [
          patchRow({
            machine_id: computeApGatewayId('LEASE-TEST-NET'),
            path: '/etc/iptables/rules.v4',
            content: `forward 80 to ${HOME_LAN_BOX}:80
`,
          }),
        ],
        { siteAt },
      ),
    );
    expect(visited).toEqual([]);
  });

  it('lists the institutions as generated when no journal holds a row', async () => {
    const web = await indexedWeb(
      depsWith([], { findPatchesForMachines: async () => ({ data: null, error: null }) }),
    );
    expect(web.map((page) => page.address)).toContain(CAMPUS_DOMAIN);
  });

});

describe('a site that asks not to be listed', () => {
  const SHUT_OUT = 'User-agent: *\nDisallow: /\n';

  it('never lists a site its town keeps off every search, by its name, its domain or its town', async () => {
    const web = await indexWith();
    const unlisted = DECLARED_NETWORKS.filter((network) => network.unlisted === true);
    expect(unlisted.length).toBeGreaterThan(0);
    for (const network of unlisted) {
      const domain = network.site?.domain ?? '';
      expect(
        web.map((page) => page.address),
        network.essid,
      ).not.toContain(domain);
      const town = network.town === undefined ? [] : [network.town];
      for (const words of [network.site?.name ?? '', network.place, domain, ...town]) {
        expect(
          rankPages(web, words).map((page) => page.address),
          words,
        ).not.toContain(domain);
      }
    }
  });

  it("keeps a player's page out", async () => {
    const web = await indexedWeb(
      depsWith([HOME_FORWARDING_THE_WEB], {
        siteAt: async () => servedSite(PLAYER_PAGE, SHUT_OUT),
      }),
    );
    expect(web.map((page) => page.address)).not.toContain(HOME_IP);
  });

  it("keeps a player's page in when it shuts out only somebody else", async () => {
    const web = await indexedWeb(
      depsWith([HOME_FORWARDING_THE_WEB], {
        siteAt: async () => servedSite(PLAYER_PAGE, 'User-agent: Googlebot\nDisallow: /\n'),
      }),
    );
    expect(web.map((page) => page.address)).toContain(HOME_IP);
  });

  it('keeps an institution out once somebody rewrites its robots.txt', async () => {
    const shut = await found(CAMPUS_DOMAIN, [
      patchRow({
        machine_id: campusServerId(),
        path: '/var/www/html/robots.txt',
        content: SHUT_OUT,
      }),
    ]);
    expect(shut).toBeUndefined();
  });

  it('keeps out an institution whose gateway now sends the web to a page that asks it to', async () => {
    const web = await indexedWeb(
      depsWith(
        [
          patchRow({
            machine_id: computeApGatewayId(CAMPUS),
            path: '/etc/iptables/rules.v4',
            content: 'forward 80 to 192.168.200.250:80\n',
          }),
        ],
        { siteAt: async () => servedSite(PLAYER_PAGE, SHUT_OUT) },
      ),
    );
    expect(web.map((page) => page.address)).not.toContain(CAMPUS_DOMAIN);
  });
});
