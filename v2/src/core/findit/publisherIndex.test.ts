import { describe, expect, it } from 'vitest';
import { indexedWeb, publisherMachineIds, type MachinePatchRow } from './publisherIndex';
import { computeApGatewayId } from '../identity/router';
import { siteServer } from '../generation/siteServer';
import { resolveLanHostIdentity } from '../generation/lanHostIdentity';
import { publisherSite } from '../generation/publisher';

/**
 * What findit holds when somebody searches: the institutions' homepages as they are
 * BEING SERVED, not as they were generated. A page somebody rewrote reads as they
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

/** The index, built over a world in which the given rows have been written. */
const indexWith = async (rows: readonly MachinePatchRow[] = []) =>
  indexedWeb({
    findPatchesForMachines: async (machineIds) => ({
      data: rows.filter((row) => machineIds.includes(row.machine_id)),
      error: null,
    }),
    resolveElsewhere: async () => null,
  });

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
      resolveElsewhere: async () =>
        '<html><head><title>Somebody else</title></head><body><p>Mine now.</p></body></html>',
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
      resolveElsewhere: async () =>
        '<html><head><title>Gateway page</title></head><body><p>Served here now.</p></body></html>',
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
      resolveElsewhere: async () => null,
    });
    expect(asked).toHaveLength(1);
    expect(asked[0]).toEqual(expect.arrayContaining([...publisherMachineIds()]));
  });

  it('finds nothing at all when the journals cannot be read', async () => {
    const web = await indexedWeb({
      findPatchesForMachines: async () => ({ data: null, error: new Error('down') }),
      resolveElsewhere: async () => null,
    });
    expect(web).toEqual([]);
  });
});
