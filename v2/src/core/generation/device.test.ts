import { describe, expect, it } from 'vitest';
import { buildRemoteHostFs } from './remoteHostFs';
import { buildDeepHostFs } from './deepHostFs';
import { deviceKindOf } from './device';
import {
  CAMERA_MODELS,
  CAMERA_RESOLUTIONS,
  CUPSD_CONFS,
  PRINTER_MODELS,
} from './pools/devices';
import { peopleKnownOn } from './mailbox';
import { npcUsername } from './remoteHostFs';
import { roleOfHostname } from './pools/hostnames';
import { strings } from '../commands/strings';
import { WORLD_EPOCH } from '../cve/worldClock';
import type { TerminalLine } from '../commands/types';
import { createFsView } from '../filesystem/fsView';
import { asAbsPath } from '../types';
import type { Directory } from '../filesystem/types';
import type { LanHost } from './generateHomeLan';
import { buildDirectory, buildFile } from '../../test/factories/filesystem';
import { mockCommandEnv, mockFsViewFromTree } from '../../test/factories/commandEnv';
import {
  ALL_ESSIDS,
  deepBoxes,
  filesUnder,
  lanBoxes,
  softwareVersionsIn,
  type Box,
} from '../../test/worldContent';

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

/** Home LANs the catalog does not hold, the way a player's own router or a stranger's
 *  factory name makes one: any ESSID generates a whole network, so these carry the
 *  kinds and neighbourhoods the catalog's fifty networks hold too few of. */
const SYNTHETIC_LAN_ESSIDS = Array.from({ length: 120 }, (_, index) => `HOME-NET-${index}`);

/** The boxes of these prefixes on the synthetic home LANs, built as their LAN builds them. */
const syntheticLanBoxes = (prefixes: readonly string[]): readonly BuiltBox[] =>
  lanBoxes(SYNTHETIC_LAN_ESSIDS)
    .filter(({ host }) => prefixes.includes(prefixOf(host.hostname)))
    .map((box) => ({ ...box, tree: buildRemoteHostFs(box.essid, box.host), layer: 'lan' as const }));

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

const NO_FLAGS = new Map<string, string | true>();

/** What a player reads with `strings` on a file holding `content`: the real command's
 *  own run extraction, so every claim below is one a player can see. */
const readableLinesOf = async (content: string): Promise<readonly string[]> => {
  const result = await strings.execute(
    mockCommandEnv({
      fs: mockFsViewFromTree(buildDirectory({ document: buildFile(content, { owner: 'root' }) }), {
        userType: 'root',
        cwd: asAbsPath('/'),
      }),
    }),
    ['/document'],
    NO_FLAGS,
  );
  if (result.kind !== 'sync') throw new Error('strings answered asynchronously');
  return result.lines
    .filter((line: TerminalLine) => line.kind === 'text')
    .map((line) => line.content);
};

/** The attribute names a control file carries, as `strings` shows them. */
const ATTRIBUTE_NAMES = [
  'attributes-charset',
  'attributes-natural-language',
  'printer-uri',
  'job-originating-user-name',
  'job-name',
  'document-format',
  'job-originating-host-name',
  'job-id',
  'job-state',
  'time-at-creation',
  'time-at-completed',
];

/** The value `strings` shows straight after an attribute's name in a control file, or
 *  undefined where it shows none: a value under four characters is below `strings`'
 *  minimum, so the next thing shown is the next attribute's name. */
const attributeOf = (lines: readonly string[], name: string): string | undefined => {
  const at = lines.indexOf(name);
  const value = at < 0 ? undefined : lines[at + 1];
  return value === undefined || ATTRIBUTE_NAMES.includes(value) ? undefined : value;
};

/** A print job as its control file tells it, with the file's own name. */
type SpooledJob = {
  readonly name: string;
  readonly user: string | undefined;
  readonly host: string | undefined;
  readonly title: string | undefined;
  readonly printerUri: string | undefined;
};

const spoolOf = (tree: Directory): ReadonlyMap<string, string> => {
  const spool = createFsView(tree, { userType: 'root' }).list(asAbsPath('/var/spool/cups'));
  if (!spool.ok) throw new Error(`/var/spool/cups: ${spool.error}`);
  return new Map(spool.entries.map((name) => [name, contentOf(tree, `/var/spool/cups/${name}`)]));
};

const jobsIn = async (tree: Directory): Promise<readonly SpooledJob[]> =>
  Promise.all(
    [...spoolOf(tree)]
      .filter(([name]) => name.startsWith('c'))
      .map(async ([name, content]) => {
        const lines = await readableLinesOf(content);
        return {
          name,
          user: attributeOf(lines, 'job-originating-user-name'),
          host: attributeOf(lines, 'job-originating-host-name'),
          title: attributeOf(lines, 'job-name'),
          printerUri: attributeOf(lines, 'printer-uri'),
        };
      }),
  );

/** The shortest run `strings` keeps. A login shorter than this does not show through
 *  it, as on any real box; the page log names every one. */
const STRINGS_MINIMUM = 4;

/** Every document on the file servers of `essid`'s home LAN, by its file name. */
const sharedDocuments = (essid: string): ReadonlyMap<string, readonly string[]> => {
  const byName = new Map<string, readonly string[]>();
  lanBoxes([essid])
    .filter(({ host }) => roleOfHostname(host.hostname) === 'fileserver')
    .forEach(({ host }) => {
      const srv = buildRemoteHostFs(essid, host).entries.get('srv');
      if (srv?.kind !== 'directory') return;
      filesUnder(srv).forEach((content, path) => {
        const name = path.slice(path.lastIndexOf('/') + 1);
        byName.set(name, [...(byName.get(name) ?? []), content]);
      });
    });
  return byName;
};

describe("a printer's spool", () => {
  const printers = (): readonly BuiltBox[] => [
    ...worldBoxesNamed(['printer']),
    ...syntheticBoxes('printer').slice(0, 30),
  ];

  const lanPrintersWithShares = (): readonly BuiltBox[] =>
    [...worldBoxesNamed(['printer']), ...syntheticLanBoxes(['printer'])].filter(
      ({ essid, layer }) => layer === 'lan' && sharedDocuments(essid).size > 0,
    );

  it('holds between three and twelve control files, each named for its job, beside their data files', () => {
    printers().forEach(({ host, tree }) => {
      const names = [...spoolOf(tree).keys()];
      const controls = names.filter((name) => name.startsWith('c'));
      expect({ host: host.hostname, count: controls.length >= 3 && controls.length <= 12 }).toEqual({
        host: host.hostname,
        count: true,
      });
      controls.forEach((name) => expect(name).toMatch(/^c\d{5}$/));
      names
        .filter((name) => !name.startsWith('c'))
        .forEach((name) => {
          expect(name).toMatch(/^d\d{5}-001$/);
          expect(controls).toContain(`c${name.slice(1, 6)}`);
        });
    });
  });

  it("is root's alone: neither the box's user nor a guest can list it or read a job", () => {
    printers().forEach(({ tree }) => {
      const first = [...spoolOf(tree).keys()][0] ?? '';
      expect(createFsView(tree, { userType: 'user' }).list(asAbsPath('/var/spool/cups')).ok).toBe(false);
      expect(createFsView(tree, { userType: 'guest' }).list(asAbsPath('/var/spool/cups')).ok).toBe(false);
      expect(read(tree, `/var/spool/cups/${first}`, 'user').ok).toBe(false);
      expect(read(tree, `/var/spool/cups/${first}`, 'guest').ok).toBe(false);
    });
  });

  it("sends every job to the printer's own queue", async () => {
    for (const { tree } of printers()) {
      const queue = /^<DefaultPrinter ([^>]+)>$/m.exec(contentOf(tree, '/etc/cups/printers.conf'))?.[1];
      for (const job of await jobsIn(tree)) {
        expect(job.printerUri).toBe(`ipp://localhost/printers/${queue}`);
      }
    }
  });

  it('names, through strings, a person of the network printing from the machine they use', async () => {
    const lan = [...worldBoxesNamed(['printer']), ...syntheticLanBoxes(['printer'])].filter(
      ({ layer }) => layer === 'lan',
    );
    expect(lan.length).toBeGreaterThan(10);
    for (const { essid, host, tree } of lan) {
      const people = peopleKnownOn({ essid, host, username: npcUsername(essid, host) });
      for (const job of await jobsIn(tree)) {
        // The printer's own account prints over the loopback; everyone else from their desk.
        const senders = people.filter((person) =>
          person.host.ip === host.ip ? job.host === 'localhost' : person.host.ip === job.host,
        );
        expect({ host: host.hostname, job: job.name, from: job.host, known: senders.length > 0 }).toEqual({
          host: host.hostname,
          job: job.name,
          from: job.host,
          known: true,
        });
        const visible = senders.filter((person) => person.username.length >= STRINGS_MINIMUM);
        if (visible.length > 0) {
          expect(visible.map((person) => person.username)).toContain(job.user);
        }
        expect(job.title).toBeDefined();
      }
    }
  });

  it('prints, on a network with a file server, documents that are on its shares', async () => {
    const boxes = lanPrintersWithShares();
    expect(boxes.length).toBeGreaterThan(0);
    for (const { essid, host, tree } of boxes) {
      const documents = sharedDocuments(essid);
      for (const job of await jobsIn(tree)) {
        expect({ host: host.hostname, title: job.title, shared: documents.has(job.title ?? '') }).toEqual({
          host: host.hostname,
          title: job.title,
          shared: true,
        });
      }
    }
  });

  it("keeps a job's document, where it keeps one, byte for byte as the share holds it", () => {
    const compared = lanPrintersWithShares().flatMap(({ essid, tree }) => {
      const copies = [...sharedDocuments(essid).values()].flat();
      return [...spoolOf(tree)]
        .filter(([name]) => name.startsWith('d'))
        .map(([name, content]) => ({ name, onShare: copies.includes(content) }));
    });
    expect(compared.length).toBeGreaterThan(0);
    compared.forEach((kept) => expect(kept).toEqual({ name: kept.name, onShare: true }));
  });

  it("comes, below the LAN, from the box's own people at localhost", async () => {
    const deep = [
      ...worldBoxesNamed(['printer']).filter(({ layer }) => layer === 'deep'),
      ...syntheticBoxes('printer').slice(0, 30),
    ];
    for (const { essid, host, tree } of deep) {
      const logins = peopleKnownOn({ essid, host, username: npcUsername(essid, host) }).map(
        (person) => person.username,
      );
      for (const job of await jobsIn(tree)) {
        expect(job.host).toBe('localhost');
        if (job.user !== undefined) expect(logins).toContain(job.user);
        expect(job.title).toBeDefined();
      }
    }
  });
});

/** One line of `page_log`, read back in the format every `cupsd.conf` here asks for. */
type PageLine = {
  readonly queue: string;
  readonly user: string;
  readonly jobId: number;
  /** When it printed, in milliseconds. */
  readonly at: number;
  readonly pages: number;
  readonly billing: string;
  readonly host: string;
  readonly title: string;
  readonly media: string;
  readonly sides: string;
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const PAGE_LINE =
  /^(\S+) (\S+) (\d+) \[(\d\d)\/(\w{3})\/(\d{4}):(\d\d):(\d\d):(\d\d) \+0000\] total (\d+) (\S+) (\S+) (\S+) (\S+) (\S+)$/;

const pageLinesOf = (content: string): readonly PageLine[] =>
  content
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => {
      const match = PAGE_LINE.exec(line);
      if (match === null) throw new Error(`not a page_log line: ${line}`);
      const [, queue = '', user = '', jobId, day, month = '', year, hours, minutes, seconds] = match;
      return {
        queue,
        user,
        jobId: Number(jobId),
        at: Date.UTC(
          Number(year),
          MONTHS.indexOf(month),
          Number(day),
          Number(hours),
          Number(minutes),
          Number(seconds),
        ),
        pages: Number(match[10]),
        billing: match[11] ?? '',
        host: match[12] ?? '',
        title: match[13] ?? '',
        media: match[14] ?? '',
        sides: match[15] ?? '',
      };
    });

const jobFileName = (jobId: number): string => `c${String(jobId).padStart(5, '0')}`;

describe("a printer's page log", () => {
  const printers = (): readonly BuiltBox[] => [
    ...worldBoxesNamed(['printer']),
    ...syntheticLanBoxes(['printer']).slice(0, 20),
    ...syntheticBoxes('printer').slice(0, 30),
  ];

  const DAY_MS = 86_400_000;

  it('keeps the rotated log beside an empty live one, both for root alone', () => {
    printers().forEach(({ tree }) => {
      expect(contentOf(tree, '/var/log/cups/page_log')).toBe('');
      expect(contentOf(tree, '/var/log/cups/page_log.1')).not.toBe('');
      ['/var/log/cups/page_log', '/var/log/cups/page_log.1'].forEach((path) => {
        expect(read(tree, path, 'user').ok).toBe(false);
        expect(read(tree, path, 'guest').ok).toBe(false);
      });
    });
  });

  it('writes one line for every job the spool remembers, agreeing with its control file', async () => {
    for (const { host, tree } of printers()) {
      const lines = pageLinesOf(contentOf(tree, '/var/log/cups/page_log.1'));
      const jobs = await jobsIn(tree);
      const queue = /^<DefaultPrinter ([^>]+)>$/m.exec(contentOf(tree, '/etc/cups/printers.conf'))?.[1];
      expect({ host: host.hostname, lines: lines.length }).toEqual({
        host: host.hostname,
        lines: jobs.length,
      });
      jobs.forEach((job) => {
        const line = lines.find((candidate) => jobFileName(candidate.jobId) === job.name);
        expect({ job: job.name, logged: line !== undefined }).toEqual({ job: job.name, logged: true });
        if (line === undefined) return;
        expect(line.queue).toBe(queue);
        expect(line.host).toBe(job.host);
        expect(line.title).toBe(job.title);
        if (job.user !== undefined) expect(line.user).toBe(job.user);
        expect(line.pages).toBeGreaterThan(0);
      });
    }
  });

  it('logs in the order the jobs printed, each inside the history kept and before the world began', () => {
    printers().forEach(({ tree }) => {
      const lines = pageLinesOf(contentOf(tree, '/var/log/cups/page_log.1'));
      const times = lines.map((line) => line.at);
      expect(times).toEqual([...times].sort((earlier, later) => earlier - later));
      expect(lines.map((line) => line.jobId)).toEqual(
        lines.map((_, index) => (lines[0]?.jobId ?? 0) + index),
      );
      times.forEach((at) => {
        expect(at).toBeLessThan(WORLD_EPOCH);
        expect(at).toBeGreaterThanOrEqual(WORLD_EPOCH - 30 * DAY_MS);
      });
    });
  });

  it('spans more than a day on some printer, since a quiet printer never fills it to rotation', () => {
    const spans = printers().map(({ tree }) => {
      const times = pageLinesOf(contentOf(tree, '/var/log/cups/page_log.1')).map((line) => line.at);
      return Math.max(...times) - Math.min(...times);
    });
    expect(spans.some((span) => span > DAY_MS)).toBe(true);
  });

  it("keeps a job's document exactly when the job printed inside the last day", () => {
    let kept = 0;
    printers().forEach(({ tree }) => {
      const spool = spoolOf(tree);
      pageLinesOf(contentOf(tree, '/var/log/cups/page_log.1')).forEach((line) => {
        const name = `d${jobFileName(line.jobId).slice(1)}-001`;
        const recent = line.at >= WORLD_EPOCH - DAY_MS;
        expect({ name, kept: spool.has(name) }).toEqual({ name, kept: recent });
        if (recent) kept += 1;
      });
    });
    expect(kept).toBeGreaterThan(0);
  });

  it('logs A4 paper and the sides each job asked for, and no billing code nobody set', () => {
    printers().forEach(({ tree }) => {
      pageLinesOf(contentOf(tree, '/var/log/cups/page_log.1')).forEach((line) => {
        expect(line.billing).toBe('-');
        expect(line.media).toBe('iso_a4_210x297mm');
        expect(['one-sided', 'two-sided-long-edge']).toContain(line.sides);
      });
    });
  });
});

const CAMERA_PREFIXES = ['cam', 'doorbell', 'babycam'];

/** Every camera-kind box: the world's, LAN and deep, and synthetic ones of each flavour
 *  on both layers, since the world holds only a few of each. */
const cameras = (): readonly BuiltBox[] => [
  ...worldBoxesNamed(CAMERA_PREFIXES),
  ...syntheticLanBoxes(CAMERA_PREFIXES).slice(0, 40),
  ...CAMERA_PREFIXES.flatMap((prefix) => syntheticBoxes(prefix).slice(0, 15)),
];

/** One entry of a camera's event index. */
type CameraEvent = {
  /** When it happened, in milliseconds. */
  readonly at: number;
  readonly kind: string;
  readonly snapshot: string;
};

const EVENT_LINE = /^(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d) (\S+) (snapshots\/\S+\.jpg)$/;

const eventsOf = (tree: Directory): readonly CameraEvent[] =>
  contentOf(tree, '/var/lib/motion/events.log')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => {
      const match = EVENT_LINE.exec(line);
      if (match === null) throw new Error(`not an event line: ${line}`);
      const [, year, month, day, hours, minutes, seconds, kind = '', snapshot = ''] = match;
      return {
        at: Date.UTC(
          Number(year),
          Number(month) - 1,
          Number(day),
          Number(hours),
          Number(minutes),
          Number(seconds),
        ),
        kind,
        snapshot,
      };
    });

const snapshotNamesOf = (tree: Directory): readonly string[] => {
  const listing = createFsView(tree, { userType: 'root' }).list(asAbsPath('/var/lib/motion/snapshots'));
  if (!listing.ok) throw new Error(`/var/lib/motion/snapshots: ${listing.error}`);
  return listing.entries;
};

/** A photo's Exif date, as `strings` shows it. */
const exifDate = (at: number): string => {
  const iso = new Date(at).toISOString();
  return `${iso.slice(0, 10).replaceAll('-', ':')} ${iso.slice(11, 19)}`;
};

/** The camera a motion config names, as `camera_name <make> <model>` spells it. */
const cameraNameOf = (tree: Directory): string =>
  /^camera_name (.+)$/m.exec(contentOf(tree, '/etc/motion/motion.conf'))?.[1] ?? '';

describe('a camera', () => {
  it('is found on home LANs and below them, in every flavour', () => {
    const boxes = worldBoxesNamed(CAMERA_PREFIXES);
    expect(new Set(boxes.map(({ layer }) => layer))).toEqual(new Set(['lan', 'deep']));
    const flavours = new Set(cameras().map(({ host }) => prefixOf(host.hostname)));
    expect(flavours).toEqual(new Set(CAMERA_PREFIXES));
  });

  it('keeps a motion config naming where its events and snapshots go, in place of device.conf', () => {
    cameras().forEach(({ host, tree }) => {
      expect({ host: host.hostname, device: read(tree, '/etc/device.conf').ok }).toEqual({
        host: host.hostname,
        device: false,
      });
      const conf = contentOf(tree, '/etc/motion/motion.conf');
      expect(conf).toMatch(/^target_dir \/var\/lib\/motion$/m);
      expect(conf).toMatch(/^picture_filename snapshots\/%Y%m%d-%H%M%S$/m);
      expect(softwareVersionsIn(conf)).toEqual([]);
    });
  });

  it('serves its stream and its controls on the loopback only, so no file claims a port a scan cannot see', () => {
    cameras().forEach(({ tree }) => {
      const conf = contentOf(tree, '/etc/motion/motion.conf');
      expect(conf).toMatch(/^stream_localhost on$/m);
      expect(conf).toMatch(/^webcontrol_localhost on$/m);
    });
  });

  it('indexes every event against a snapshot it holds, and holds no snapshot no event names', () => {
    cameras().forEach(({ host, tree }) => {
      const events = eventsOf(tree);
      const held = snapshotNamesOf(tree).map((name) => `snapshots/${name}`);
      expect({ host: host.hostname, some: events.length > 0 }).toEqual({ host: host.hostname, some: true });
      expect([...events.map((event) => event.snapshot)].sort()).toEqual([...held].sort());
    });
  });

  it('logs its events in order, each before the world began', () => {
    cameras().forEach(({ tree }) => {
      const times = eventsOf(tree).map((event) => event.at);
      expect(times).toEqual([...times].sort((earlier, later) => earlier - later));
      times.forEach((at) => expect(at).toBeLessThan(WORLD_EPOCH));
    });
  });

  it("stamps each snapshot, through strings, with the camera's own make and model and the event's time", async () => {
    for (const { tree } of cameras()) {
      const name = cameraNameOf(tree);
      for (const event of eventsOf(tree)) {
        const lines = await readableLinesOf(contentOf(tree, `/var/lib/motion/${event.snapshot}`));
        const model = CAMERA_MODELS.find((camera) => `${camera.make} ${camera.model}` === name);
        expect({ name, known: model !== undefined }).toEqual({ name, known: true });
        expect(lines).toContain(model?.make);
        expect(lines).toContain(model?.model);
        expect(lines).toContain(exifDate(event.at));
      }
    }
  });

  it('records rings on a doorbell, sound on a baby monitor, and motion alone on any other camera', () => {
    cameras().forEach(({ host, tree }) => {
      const kinds = new Set(eventsOf(tree).map((event) => event.kind));
      const flavour = prefixOf(host.hostname);
      const allowed =
        flavour === 'doorbell' ? ['motion', 'ring'] : flavour === 'babycam' ? ['motion', 'sound'] : ['motion'];
      kinds.forEach((kind) => expect({ host: host.hostname, kind, allowed: allowed.includes(kind) }).toEqual({
        host: host.hostname,
        kind,
        allowed: true,
      }));
      if (flavour === 'doorbell') expect(kinds).toContain('ring');
      if (flavour === 'babycam') expect(kinds).toContain('sound');
    });
  });

  it("keeps its events for the box's own user to read, and not a guest", () => {
    cameras().forEach(({ tree }) => {
      const first = snapshotNamesOf(tree)[0] ?? '';
      expect(read(tree, '/var/lib/motion/events.log', 'user').ok).toBe(true);
      expect(read(tree, `/var/lib/motion/snapshots/${first}`, 'user').ok).toBe(true);
      expect(read(tree, '/var/lib/motion/events.log', 'guest').ok).toBe(false);
      expect(createFsView(tree, { userType: 'guest' }).list(asAbsPath('/var/lib/motion')).ok).toBe(false);
    });
  });

  it('is a model of the flavour its name says, drawing every model in the pool somewhere', () => {
    const named = cameras().map(({ host, tree }) => ({ host, name: cameraNameOf(tree) }));
    const drawn = new Set(named.map(({ name }) => name));
    CAMERA_MODELS.forEach(({ make, model, flavour }) => {
      const name = `${make} ${model}`;
      expect({ name, drawn: drawn.has(name) }).toEqual({ name, drawn: true });
      named
        .filter((camera) => camera.name === name)
        .forEach(({ host }) => expect(prefixOf(host.hostname)).toBe(flavour));
    });
  });

  it('streams at every frame size in the pool somewhere', () => {
    const sizes = new Set(
      cameras().map(({ tree }) => {
        const conf = contentOf(tree, '/etc/motion/motion.conf');
        return `${/^width (\d+)$/m.exec(conf)?.[1]}x${/^height (\d+)$/m.exec(conf)?.[1]}`;
      }),
    );
    expect(sizes).toEqual(new Set(CAMERA_RESOLUTIONS.map(([width, height]) => `${width}x${height}`)));
  });
});
