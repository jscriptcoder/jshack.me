import { describe, expect, it } from 'vitest';
import { deviceKindOf } from './device.js';
import { npcUsername } from './remoteHostFs.js';
import { createFsView } from '../filesystem/fsView.js';
import { asAbsPath } from '../types.js';
import { softwareVersionsIn } from '../../test/worldContent.js';
import {
  CAMERA_PREFIXES,
  contentOf,
  pagesOf,
  prefixOf,
  read,
  servesHttp,
  syntheticBoxes,
  syntheticLanBoxes,
  withoutMeasurements,
  worldBoxesNamed,
  type BuiltBox,
} from '../../test/deviceBoxes.js';

/**
 * What every generated device shares: which kind a box is, that each keeps its own kind's
 * files and no other's, the pages every kind publishes, and what ftp can carry home off
 * any of them. Each kind's own files are tested beside it, under `device/`. Read the way
 * a player reads it, through the box's own tree at the tier the player holds, over every
 * such box in the world and over synthetic boxes for the kinds the world holds few of.
 */

/** Which device each IoT name is, restated here rather than imported so the test says
 *  what the world is meant to hold instead of echoing whatever the table holds. */
const KIND_BY_PREFIX: Readonly<Record<string, string>> = {
  cam: 'camera',
  doorbell: 'camera',
  babycam: 'camera',
  nvr: 'recorder',
  printer: 'printer',
  sensor: 'climate',
  thermostat: 'climate',
  tv: 'media',
  speaker: 'media',
  plug: 'plug',
  lock: 'lock',
};

describe('which device a box is', () => {
  it('reads the device off the name, one kind per IoT prefix', () => {
    Object.entries(KIND_BY_PREFIX).forEach(([prefix, kind]) => {
      expect({ prefix, kind: deviceKindOf(`${prefix}-12`) }).toEqual({ prefix, kind });
    });
  });

  it('calls no box a device whose name is not an IoT one', () => {
    ['desktop-12', 'nas-12', 'www-12', 'host-12', 'printer12', 'cam'].forEach((hostname) => {
      expect({ hostname, kind: deviceKindOf(hostname) }).toEqual({ hostname, kind: undefined });
    });
  });
});

/** Where each kind keeps what it is. */
const ROOTS_BY_KIND: Readonly<Record<string, readonly string[]>> = {
  printer: ['/etc/cups', '/var/spool/cups', '/var/log/cups'],
  camera: ['/etc/motion', '/var/lib/motion'],
  recorder: ['/etc/nvr', '/var/lib/nvr'],
  climate: ['/etc/sensord', '/var/lib/sensord'],
  media: ['/etc/mediad', '/var/lib/mediad'],
  plug: ['/etc/plugd', '/var/lib/plugd'],
  lock: ['/etc/lockd', '/var/lib/lockd', '/var/log/lockd'],
};

const DEVICE_ROOTS = Object.values(ROOTS_BY_KIND).flat();

describe('every IoT box', () => {
  it("keeps its own kind's files, no other kind's, and no generic device config", () => {
    devicesNamed(Object.keys(KIND_BY_PREFIX)).forEach(({ host, tree }) => {
      const root = createFsView(tree, { userType: 'root' });
      const own = ROOTS_BY_KIND[KIND_BY_PREFIX[prefixOf(host.hostname)] ?? ''] ?? [];
      expect({ host: host.hostname, device: read(tree, '/etc/device.conf').ok }).toEqual({
        host: host.hostname,
        device: false,
      });
      DEVICE_ROOTS.forEach((path) => {
        expect({ host: host.hostname, path, held: root.stat(asAbsPath(path)) !== null }).toEqual({
          host: host.hostname,
          path,
          held: own.includes(path),
        });
      });
    });
  });
});

describe("a device's root history", () => {
  it("names the device's own configs and logs, on some box of each kind", () => {
    const histories = (prefixes: readonly string[]): string =>
      worldBoxesNamed(prefixes)
        .map(({ tree }) => contentOf(tree, '/root/.bash_history'))
        .join('\n');
    const printerHistory = histories(['printer']);
    ['/etc/cups/cupsd.conf', '/etc/cups/printers.conf', '/var/log/cups/page_log.1'].forEach((path) =>
      expect(printerHistory).toContain(path),
    );
    expect(histories(CAMERA_PREFIXES)).toContain('/etc/motion/motion.conf');
    expect(histories(['nvr'])).toContain('/etc/nvr/nvr.conf');
    expect(histories(['sensor', 'thermostat'])).toContain('/etc/sensord/sensord.conf');
    expect(histories(['tv', 'speaker'])).toContain('/etc/mediad/mediad.conf');
    expect(histories(['plug'])).toContain('/etc/plugd/plugd.conf');
    expect(histories(['lock'])).toContain('/etc/lockd/lockd.conf');
  });
});

/** The pages each device publishes, by file name beneath `/var/www/html`, by the name
 *  it goes by: a thermostat's schedule is the one page a plain sensor lacks. */
const UI_PAGES: Readonly<Record<string, readonly string[]>> = {
  printer: ['index.html', 'printers.html', 'jobs.html'],
  cam: ['index.html', 'events.html'],
  doorbell: ['index.html', 'events.html'],
  babycam: ['index.html', 'events.html'],
  nvr: ['index.html', 'recordings.html'],
  sensor: ['index.html', 'settings.html'],
  thermostat: ['index.html', 'settings.html', 'schedule.html'],
  tv: ['index.html', 'devices.html'],
  speaker: ['index.html', 'devices.html'],
  plug: ['index.html', 'schedule.html'],
  lock: ['index.html', 'settings.html'],
};

const BUILT = Object.keys(KIND_BY_PREFIX);


/** Every device of these prefixes, world and synthetic, on both layers. */
const devicesNamed = (prefixes: readonly string[]): readonly BuiltBox[] => [
  ...worldBoxesNamed(prefixes),
  ...syntheticLanBoxes(prefixes).slice(0, 80),
  ...prefixes.flatMap((prefix) => syntheticBoxes(prefix).slice(0, 30)),
];


const hrefsIn = (page: string): readonly string[] =>
  Array.from(page.matchAll(/<a\s[^>]*href="([^"]*)"/g)).map((match) => match[1] ?? '');

describe("a device's own pages", () => {
  const serving = (): readonly (BuiltBox & { readonly prefix: string })[] =>
    devicesNamed(BUILT)
      .filter(servesHttp)
      .map((box) => ({ ...box, prefix: prefixOf(box.host.hostname) }));

  it('are published only where the box serves the web, as its kind\'s two to four pages', () => {
    const boxes = serving();
    expect(new Set(boxes.map(({ prefix }) => prefix))).toEqual(new Set(BUILT));
    boxes.forEach(({ host, prefix, tree }) => {
      expect({ host: host.hostname, pages: [...pagesOf(tree).keys()].sort() }).toEqual({
        host: host.hostname,
        pages: [...(UI_PAGES[prefix] ?? [])].sort(),
      });
    });
    devicesNamed(BUILT)
      .filter((box) => !servesHttp(box))
      .forEach(({ tree }) => expect(pagesOf(tree).size).toBe(0));
  });

  it('link only to one another, so no link is dead', () => {
    serving().forEach(({ host, tree }) => {
      const pages = pagesOf(tree);
      pages.forEach((page) => {
        const hrefs = hrefsIn(page);
        expect(hrefs.length).toBeGreaterThan(0);
        hrefs.forEach((href) => {
          const target = href === '/' ? 'index.html' : href.replace(/^\//, '');
          expect({ host: host.hostname, href, live: pages.has(target) }).toEqual({
            host: host.hostname,
            href,
            live: true,
          });
        });
      });
    });
  });

  it('link each to every other, so a visitor can reach them all from any one', () => {
    serving().forEach(({ host, tree }) => {
      const pages = pagesOf(tree);
      pages.forEach((page, name) => {
        const linked = new Set(hrefsIn(page).map((href) => (href === '/' ? 'index.html' : href.slice(1))));
        expect({ host: host.hostname, name, linked: [...linked].sort() }).toEqual({
          host: host.hostname,
          name,
          linked: [...pages.keys()].sort(),
        });
      });
    });
  });

  it('name no port nothing serves, no software version and no account', () => {
    serving().forEach(({ essid, host, tree }) => {
      const account = npcUsername(essid, host);
      pagesOf(tree).forEach((page, name) => {
        expect({ host: host.hostname, name, rtsp: /rtsp|:554\b/.test(page) }).toEqual({
          host: host.hostname,
          name,
          rtsp: false,
        });
        expect(softwareVersionsIn(withoutMeasurements(page))).toEqual([]);
        expect({ host: host.hostname, name, account: page.includes(`>${account}<`) }).toEqual({
          host: host.hostname,
          name,
          account: false,
        });
      });
    });
  });

  it('record visitors walking to each of its pages, at the size each serves', () => {
    const visited = new Set<string>();
    serving().forEach(({ prefix, tree }) => {
      const log = read(tree, '/var/log/access.log.1');
      if (!log.ok) return;
      const pages = pagesOf(tree);
      log.content
        .split('\n')
        .filter((line) => line !== '')
        .forEach((line) => {
          const [, path = '', size] = /"GET (\S+) HTTP\/1\.1" 200 (\d+)$/.exec(line) ?? [];
          const page = pages.get(path === '/' ? 'index.html' : path.slice(1));
          expect({ path, served: page?.length }).toEqual({ path, served: Number(size) });
          visited.add(`${prefix}:${path}`);
        });
    });
    // Across the world, every page of every device is walked to by somebody.
    Object.entries(UI_PAGES).forEach(([prefix, names]) => {
      names.forEach((name) => {
        const path = name === 'index.html' ? '/' : `/${name}`;
        expect({ prefix, path, visited: visited.has(`${prefix}:${path}`) }).toEqual({
          prefix,
          path,
          visited: true,
        });
      });
    });
  });
});
