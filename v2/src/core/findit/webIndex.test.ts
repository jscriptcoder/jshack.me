import { describe, expect, it } from 'vitest';
import {
  indexedWeb,
  publisherMachineIds,
  type MachinePatchRow,
  type WebIndexDeps,
  type StoredAddress,
} from './webIndex';
import { computeApGatewayId } from '../identity/router';
import { siteServer } from '../generation/siteServer';
import { resolveLanHostIdentity } from '../generation/lanHostIdentity';
import { publisherIp, publisherSite } from '../generation/publisher';
import { FINDIT_NETWORK } from '../generation/findit';

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
  listPublicAddresses: async () => ({ data: [], error: null }),
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
      listPublicAddresses: async () => ({ data: [], error: null }),
      siteAt: async () =>
        servedSite('<html><head><title>Somebody else</title></head><body><p>Mine now.</p></body></html>'),
    });
    expect(elsewhere.find((page) => page.address === CAMPUS_DOMAIN)?.title).toBe('Somebody else');
  });

  it('holds nothing but the sites it found, so a dark one leaves no gap behind', async () => {
    const web = await indexWith([
      patchRow({ machine_id: campusServerId(), path: '/boot/vmlinuz', content: null }),
    ]);
    // Two machines are read per publisher, and exactly one publisher has gone dark.
    expect(web.length).toBe(publisherMachineIds().length / 2 - 1);
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
      listPublicAddresses: async () => ({ data: [], error: null }),
      siteAt: async () =>
        servedSite('<html><head><title>Gateway page</title></head><body><p>Served here now.</p></body></html>'),
    });
    expect(takenOver.find((page) => page.address === CAMPUS_DOMAIN)?.title).toBe('Gateway page');
  });

  it('asks for every publisher in one go, rather than one machine at a time', async () => {
    const asked: string[][] = [];
    await indexedWeb({
      findPatchesForMachines: async (machineIds) => {
        asked.push([...machineIds]);
        return { data: [], error: null };
      },
      listPublicAddresses: async () => ({ data: [], error: null }),
      siteAt: async () => null,
    });
    expect(asked).toHaveLength(1);
    expect(asked[0]).toEqual(expect.arrayContaining([...publisherMachineIds()]));
  });

  it('finds nothing at all when the journals cannot be read', async () => {
    const web = await indexedWeb({
      findPatchesForMachines: async () => ({ data: null, error: new Error('down') }),
      listPublicAddresses: async () => ({ data: [], error: null }),
      siteAt: async () => null,
    });
    expect(web).toEqual([]);
  });
});

/**
 * A player's page: served on a network with no domain, found because it answers on the
 * public web at all. Nobody submits it — being there is enough, and the only way to stay
 * out is to say so in `robots.txt`.
 */

const HOME = 'APT-3B-WIFI';
const HOME_IP = '45.12.7.9';
const HOME_LAN_BOX = '192.168.77.20';

const stored =
  (...addresses: readonly StoredAddress[]) =>
  async () => ({ data: addresses, error: null });

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
        listPublicAddresses: stored({ essid: HOME, public_ip: HOME_IP }),
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
        listPublicAddresses: stored({ essid: HOME, public_ip: HOME_IP }),
        siteAt: async () => servedSite('<html><body><p>No title here.</p></body></html>'),
      }),
    );
    expect(web.find((page) => page.address === HOME_IP)?.title).toBe(HOME_IP);
  });

  it('is not there when a visitor to that address would be served nothing', async () => {
    const web = await indexedWeb(
      depsWith([HOME_FORWARDING_THE_WEB], {
        listPublicAddresses: stored({ essid: HOME, public_ip: HOME_IP }),
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
          listPublicAddresses: stored({ essid: HOME, public_ip: HOME_IP }),
          siteAt: async () => servedSite(PLAYER_PAGE),
        },
      ),
    );
    expect(web.map((page) => page.address)).toContain(HOME_IP);
  });

  it('is never looked for on a network whose gateway serves no web at all', async () => {
    const { visited, siteAt } = recordingVisits();
    const web = await indexedWeb(
      depsWith([], { listPublicAddresses: stored({ essid: HOME, public_ip: HOME_IP }), siteAt }),
    );
    expect(web.map((page) => page.address)).not.toContain(HOME_IP);
    expect(visited).toEqual([]);
  });

  it('is never looked for behind a gateway that will not come up', async () => {
    const { visited, siteAt } = recordingVisits();
    const web = await indexedWeb(
      depsWith(
        [
          HOME_FORWARDING_THE_WEB,
          patchRow({ machine_id: computeApGatewayId(HOME), path: '/boot/vmlinuz', content: null }),
        ],
        { listPublicAddresses: stored({ essid: HOME, public_ip: HOME_IP }), siteAt },
      ),
    );
    expect(web.map((page) => page.address)).not.toContain(HOME_IP);
    expect(visited).toEqual([]);
  });

  it("reads the players' gateways in the same single read as the publishers'", async () => {
    const asked: string[][] = [];
    await indexedWeb(
      depsWith([], {
        findPatchesForMachines: async (machineIds) => {
          asked.push([...machineIds]);
          return { data: [], error: null };
        },
        listPublicAddresses: stored({ essid: HOME, public_ip: HOME_IP }),
      }),
    );
    expect(asked).toHaveLength(1);
    expect(asked[0]).toEqual(
      expect.arrayContaining([...publisherMachineIds(), computeApGatewayId(HOME)]),
    );
  });

  it('lists a joined institution once, by its domain, never again by its address', async () => {
    const campusIp = publisherIp(CAMPUS);
    if (campusIp === undefined) throw new Error('the campus has no address');
    const web = await indexedWeb(
      depsWith([], {
        listPublicAddresses: stored({ essid: CAMPUS, public_ip: campusIp }),
        siteAt: async () => servedSite(PLAYER_PAGE),
      }),
    );
    expect(web.map((page) => page.address)).not.toContain(campusIp);
    expect(web.filter((page) => page.address === CAMPUS_DOMAIN)).toHaveLength(1);
  });

  it('never lists findit among its own results', async () => {
    const web = await indexedWeb(
      depsWith([], {
        listPublicAddresses: stored({ essid: FINDIT_NETWORK, public_ip: HOME_IP }),
        siteAt: async () => servedSite(PLAYER_PAGE),
      }),
    );
    expect(web.map((page) => page.address)).not.toContain(HOME_IP);
  });

  it('lists the institutions still when no network has been joined at all', async () => {
    const web = await indexedWeb(
      depsWith([], { listPublicAddresses: async () => ({ data: null, error: null }) }),
    );
    expect(web.map((page) => page.address)).toContain(CAMPUS_DOMAIN);
  });

  it('lists the institutions as generated when no journal holds a row', async () => {
    const web = await indexedWeb(
      depsWith([], { findPatchesForMachines: async () => ({ data: null, error: null }) }),
    );
    expect(web.map((page) => page.address)).toContain(CAMPUS_DOMAIN);
  });

  it('finds nothing at all when the stored addresses cannot be read', async () => {
    const web = await indexedWeb(
      depsWith([], {
        listPublicAddresses: async () => ({ data: null, error: new Error('down') }),
      }),
    );
    expect(web).toEqual([]);
  });
});

describe('a site that asks not to be listed', () => {
  const SHUT_OUT = 'User-agent: *\nDisallow: /\n';

  it("keeps a player's page out", async () => {
    const web = await indexedWeb(
      depsWith([HOME_FORWARDING_THE_WEB], {
        listPublicAddresses: stored({ essid: HOME, public_ip: HOME_IP }),
        siteAt: async () => servedSite(PLAYER_PAGE, SHUT_OUT),
      }),
    );
    expect(web.map((page) => page.address)).not.toContain(HOME_IP);
  });

  it("keeps a player's page in when it shuts out only somebody else", async () => {
    const web = await indexedWeb(
      depsWith([HOME_FORWARDING_THE_WEB], {
        listPublicAddresses: stored({ essid: HOME, public_ip: HOME_IP }),
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
