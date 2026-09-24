import { describe, expect, it } from 'vitest';
import { createPatchApi } from '../../adapters/patchApi';
import { generateIdentity } from '../identity/identity';
import { computeWorkstationId } from '../identity/workstation';
import { signedEnvelopeSchema } from '../signedRequest/types';
import { asMachineId } from '../types';
import { deviceKindOf } from './device';
import { npcUsername } from './remoteHostFs';
import { createFsView } from '../filesystem/fsView';
import { asAbsPath } from '../types';
import { filesUnder, softwareVersionsIn } from '../../test/worldContent';
import {
  cameras,
  CAMERA_PREFIXES,
  contentOf,
  pagesOf,
  read,
  recorders,
  servesHttp,
  syntheticBoxes,
  syntheticLanBoxes,
  worldBoxesNamed,
  type BuiltBox,
} from '../../test/deviceBoxes';

/**
 * What every generated device shares: which kind a box is, what a box keeps that is no
 * device, the pages every kind publishes and what ftp can carry home off any of them.
 * Each kind's own files are tested beside it, under `device/`. Read the way a player
 * reads it, through the box's own tree at the tier the player holds, over every such box
 * in the world and over synthetic boxes for the kinds the world holds few of.
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

/** Where the devices built so far keep what they are. */
const DEVICE_ROOTS = [
  '/etc/cups',
  '/etc/motion',
  '/etc/nvr',
  '/etc/sensord',
  '/var/spool/cups',
  '/var/log/cups',
  '/var/lib/motion',
  '/var/lib/nvr',
  '/var/lib/sensord',
];

describe('the devices not yet built', () => {
  it('keep the generic device config and none of the files a built device keeps', () => {
    const others = ['tv', 'speaker', 'plug', 'lock'];
    const boxes = [
      ...worldBoxesNamed(others),
      ...others.flatMap((prefix) => syntheticBoxes(prefix).slice(0, 5)),
    ];
    expect(boxes.length).toBeGreaterThan(30);
    boxes.forEach(({ host, tree }) => {
      const root = createFsView(tree, { userType: 'root' });
      expect(read(tree, '/etc/device.conf').ok).toBe(true);
      DEVICE_ROOTS.forEach((path) => {
        expect({ host: host.hostname, path, held: root.stat(asAbsPath(path)) !== null }).toEqual({
          host: host.hostname,
          path,
          held: false,
        });
      });
    });
  });

  it('keep no page log on a camera or a recorder, which print nothing', () => {
    [...cameras(), ...recorders()].forEach(({ tree }) => {
      expect(createFsView(tree, { userType: 'root' }).stat(asAbsPath('/var/log/cups'))).toBeNull();
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
  });
});

/** The pages each device kind publishes, by file name beneath `/var/www/html`. */
const UI_PAGES: Readonly<Record<string, readonly string[]>> = {
  printer: ['index.html', 'printers.html', 'jobs.html'],
  camera: ['index.html', 'events.html'],
  recorder: ['index.html', 'recordings.html'],
};

/** The devices with pages of their own, and every device built so far. */
const WITH_PAGES = ['printer', 'nvr', ...CAMERA_PREFIXES];
const BUILT = [...WITH_PAGES, 'sensor', 'thermostat'];

/** Every device of these prefixes, world and synthetic, on both layers. */
const devicesNamed = (prefixes: readonly string[]): readonly BuiltBox[] => [
  ...worldBoxesNamed(prefixes),
  ...syntheticLanBoxes(prefixes).slice(0, 80),
  ...prefixes.flatMap((prefix) => syntheticBoxes(prefix).slice(0, 30)),
];


const hrefsIn = (page: string): readonly string[] =>
  Array.from(page.matchAll(/<a\s[^>]*href="([^"]*)"/g)).map((match) => match[1] ?? '');

describe("a device's own pages", () => {
  const serving = (): readonly (BuiltBox & { readonly kind: string })[] =>
    devicesNamed(WITH_PAGES)
      .filter(servesHttp)
      .map((box) => ({ ...box, kind: deviceKindOf(box.host.hostname) ?? '' }));

  it('are published only where the box serves the web, as its kind\'s two to four pages', () => {
    const boxes = serving();
    expect(new Set(boxes.map(({ kind }) => kind))).toEqual(new Set(['printer', 'camera', 'recorder']));
    boxes.forEach(({ host, kind, tree }) => {
      expect({ host: host.hostname, pages: [...pagesOf(tree).keys()].sort() }).toEqual({
        host: host.hostname,
        pages: [...(UI_PAGES[kind] ?? [])].sort(),
      });
    });
    devicesNamed(WITH_PAGES)
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

  it('name no port nothing serves, no software version and no account', () => {
    serving().forEach(({ essid, host, tree }) => {
      const account = npcUsername(essid, host);
      pagesOf(tree).forEach((page, name) => {
        expect({ host: host.hostname, name, rtsp: /rtsp|:554\b/.test(page) }).toEqual({
          host: host.hostname,
          name,
          rtsp: false,
        });
        expect(softwareVersionsIn(page)).toEqual([]);
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
    serving().forEach(({ kind, tree }) => {
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
          visited.add(`${kind}:${path}`);
        });
    });
    // Across the world, every page of every kind is walked to by somebody.
    Object.entries(UI_PAGES).forEach(([kind, names]) => {
      names.forEach((name) => {
        const path = name === 'index.html' ? '/' : `/${name}`;
        expect({ kind, path, visited: visited.has(`${kind}:${path}`) }).toEqual({
          kind,
          path,
          visited: true,
        });
      });
    });
  });
});

/** Where a device keeps what it is, and the pages it serves: every file a player could
 *  fetch off one and carry home. */
const DEVICE_PATHS = [...DEVICE_ROOTS, '/var/www/html'];

describe('what ftp get can carry home off a device', () => {
  it('fits every device file into the one signed write that saves it on the player box', async () => {
    const identity = generateIdentity();
    const sent: string[] = [];
    const patches = createPatchApi({
      identity,
      machineId: asMachineId(computeWorkstationId('deskbox', identity.publicKeyHex)),
      owner: 'operator',
      tier: 'user',
      fetchImpl: async (_url, init) => {
        sent.push(String(init?.body));
        return new Response('{}', { status: 200 });
      },
    });
    // The write's size is what the transport limits, and a file's escaped length is
    // what decides it, so the files hardest to carry are the ones sent.
    const hardest = devicesNamed(BUILT)
      .flatMap(({ host, tree }) =>
        DEVICE_PATHS.flatMap((root) => {
          const node = createFsView(tree, { userType: 'root' }).stat(asAbsPath(root));
          return node?.kind === 'directory'
            ? [...filesUnder(node)].map(([path, content]) => [`${host.hostname}:${root}/${path}`, content] as const)
            : [];
        }),
      )
      .sort(([, one], [, other]) => JSON.stringify(other).length - JSON.stringify(one).length)
      .slice(0, 20);

    for (const [path, content] of hardest) {
      await patches.write(asAbsPath(`/home/operator/${path.split('/').pop() ?? ''}`), content, {
        isNew: true,
      });
    }
    expect(sent).toHaveLength(hardest.length);
    sent.forEach((body, index) => {
      expect(
        signedEnvelopeSchema.safeParse(JSON.parse(body)).success,
        `${hardest[index]?.[0]}: ${JSON.stringify(hardest[index]?.[1]).length} escaped`,
      ).toBe(true);
    });
  });
});
