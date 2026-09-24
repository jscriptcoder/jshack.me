import { describe, expect, it } from 'vitest';
import { buildRemoteHostFs } from './remoteHostFs';
import { buildDeepHostFs } from './deepHostFs';
import { deviceKindOf } from './device';
import { CUPSD_CONFS, PRINTER_MODELS } from './pools/devices';
import { createFsView } from '../filesystem/fsView';
import { asAbsPath } from '../types';
import type { Directory } from '../filesystem/types';
import type { LanHost } from './generateHomeLan';
import { ALL_ESSIDS, deepBoxes, lanBoxes, softwareVersionsIn, type Box } from '../../test/worldContent';

/**
 * What a generated device keeps because of what it is: a printer its print server, a
 * camera its events. Read the way a player reads it, through the box's own tree at the
 * tier the player holds, over every such box in the world and over synthetic boxes for
 * the kinds the world holds few of.
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

const prefixOf = (hostname: string): string => hostname.slice(0, hostname.lastIndexOf('-'));

/** A box built the way the world builds it: a LAN box as the LAN does, a deep one with
 *  its forced sshd. */
type BuiltBox = Box & { readonly tree: Directory; readonly layer: 'lan' | 'deep' };

/** Every box of these prefixes in the world, LAN and deep, built inside the calling test
 *  so a mutant is credited to the test that reads it. */
const worldBoxesNamed = (prefixes: readonly string[]): readonly BuiltBox[] => [
  ...lanBoxes(ALL_ESSIDS)
    .filter(({ host }) => prefixes.includes(prefixOf(host.hostname)))
    .map((box) => ({ ...box, tree: buildRemoteHostFs(box.essid, box.host), layer: 'lan' as const })),
  ...deepBoxes(ALL_ESSIDS)
    .filter(({ host }) => prefixes.includes(prefixOf(host.hostname)))
    .map(({ essid, host }) => ({
      essid,
      host,
      tree: buildDeepHostFs(essid, host),
      layer: 'deep' as const,
    })),
];

const SYNTHETIC_ESSID = 'BEAN-THERE-WIFI';

/** A box named `<prefix>-<octet>` that no network generated: it stands on no home LAN,
 *  so it is built the way a deep box is, knowing only itself. */
const syntheticBoxes = (prefix: string): readonly BuiltBox[] =>
  Array.from({ length: 120 }, (_, index) => index + 2).map((octet) => {
    const host: LanHost = { ip: `10.77.3.${octet}`, hostname: `${prefix}-${octet}`, kind: 'machine' };
    return {
      essid: SYNTHETIC_ESSID,
      host,
      tree: buildDeepHostFs(SYNTHETIC_ESSID, host),
      layer: 'deep' as const,
    };
  });

const read = (tree: Directory, path: string, tier: 'root' | 'user' | 'guest' = 'root') =>
  createFsView(tree, { userType: tier }).read(asAbsPath(path));

const contentOf = (tree: Directory, path: string): string => {
  const result = read(tree, path);
  if (!result.ok) throw new Error(`${path}: ${result.error}`);
  return result.content;
};

/** The model a printer's one queue says it is. */
const modelOf = (tree: Directory): string | undefined =>
  /^Info (.+)$/m.exec(contentOf(tree, '/etc/cups/printers.conf'))?.[1];

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

describe('a printer', () => {
  const printers = (): readonly BuiltBox[] => [
    ...worldBoxesNamed(['printer']),
    ...syntheticBoxes('printer'),
  ];

  it('is found on home LANs and below them', () => {
    const layers = new Set(worldBoxesNamed(['printer']).map(({ layer }) => layer));
    expect(layers).toEqual(new Set(['lan', 'deep']));
  });

  it("keeps its print server's two configs under /etc/cups, in place of a generic device.conf", () => {
    printers().forEach(({ host, tree }) => {
      const etc = createFsView(tree, { userType: 'root' });
      expect({ host: host.hostname, device: etc.stat(asAbsPath('/etc/device.conf')) }).toEqual({
        host: host.hostname,
        device: null,
      });
      expect(read(tree, '/etc/cups/cupsd.conf').ok).toBe(true);
      expect(read(tree, '/etc/cups/printers.conf').ok).toBe(true);
    });
  });

  it('lets only root read them: the queue and the scheduler are the print server admin\'s', () => {
    printers().forEach(({ tree }) => {
      ['/etc/cups/cupsd.conf', '/etc/cups/printers.conf'].forEach((path) => {
        expect(read(tree, path, 'root').ok).toBe(true);
        expect(read(tree, path, 'user').ok).toBe(false);
        expect(read(tree, path, 'guest').ok).toBe(false);
      });
    });
  });

  it('listens for print jobs on the loopback only, so no file claims a port a scan cannot see', () => {
    printers().forEach(({ tree }) => {
      const listens = contentOf(tree, '/etc/cups/cupsd.conf')
        .split('\n')
        .filter((line) => /^\s*(Listen|Port)\b/.test(line))
        .map((line) => line.trim());
      expect(listens).toContain('Listen localhost:631');
      listens
        .filter((line) => !line.startsWith('Listen /'))
        .forEach((line) => expect(line).toBe('Listen localhost:631'));
    });
  });

  it('holds one queue, its default, named the way CUPS names a queue after its model', () => {
    printers().forEach(({ tree }) => {
      const conf = contentOf(tree, '/etc/cups/printers.conf');
      const opened = [...conf.matchAll(/^<(Default)?Printer ([^>]+)>$/gm)];
      expect(opened).toHaveLength(1);
      expect(opened[0]?.[1]).toBe('Default');
      const queue = opened[0]?.[2] ?? '';
      expect(queue).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(conf).toMatch(/^<\/DefaultPrinter>$/m);
      // The queue is the model with its spaces made underscores, as `lpadmin` does.
      const info = /^Info (.+)$/m.exec(conf)?.[1] ?? '';
      expect(queue).toBe(info.replaceAll(' ', '_'));
    });
  });

  it('is attached over USB, so its device URI names no host or port on the network', () => {
    printers().forEach(({ tree }) => {
      expect(contentOf(tree, '/etc/cups/printers.conf')).toMatch(/^DeviceURI usb:\/\/[^\s]+$/m);
    });
  });

  it('dates itself by no software version', () => {
    printers().forEach(({ host, tree }) => {
      ['/etc/cups/cupsd.conf', '/etc/cups/printers.conf'].forEach((path) => {
        expect({ host: host.hostname, path, versions: softwareVersionsIn(contentOf(tree, path)) }).toEqual(
          { host: host.hostname, path, versions: [] },
        );
      });
    });
  });

  it('draws every model and every scheduler config in the pool on some printer', () => {
    const boxes = printers();
    const models = new Set(boxes.map(({ tree }) => modelOf(tree)));
    const schedulers = new Set(boxes.map(({ tree }) => contentOf(tree, '/etc/cups/cupsd.conf')));
    PRINTER_MODELS.forEach((model) => expect({ model, drawn: models.has(model) }).toEqual({ model, drawn: true }));
    CUPSD_CONFS.forEach((conf, index) => expect({ index, drawn: schedulers.has(conf) }).toEqual({ index, drawn: true }));
  });

  it('does not hand every printer the same model or the same scheduler config', () => {
    const boxes = printers();
    const models = new Set(boxes.map(({ tree }) => modelOf(tree)));
    const schedulers = new Set(boxes.map(({ tree }) => contentOf(tree, '/etc/cups/cupsd.conf')));
    expect(models.size).toBeGreaterThan(3);
    expect(schedulers.size).toBeGreaterThan(1);
  });
});
