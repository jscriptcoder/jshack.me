import { describe, expect, it } from 'vitest';
import { CUPSD_CONFS, PRINTER_MODELS } from '../pools/devices';
import { buildRemoteHostFs, npcUsername } from '../remoteHostFs';
import { peopleKnownOn } from '../mailbox';
import { roleOfHostname } from '../pools/hostnames';
import { WORLD_EPOCH } from '../../cve/worldClock';
import { createFsView } from '../../filesystem/fsView';
import { asAbsPath } from '../../types';
import type { Directory } from '../../filesystem/types';
import { filesUnder, lanBoxes, softwareVersionsIn } from '../../../test/worldContent';
import {
  contentOf,
  pagesOf,
  read,
  readableLinesOf,
  servesHttp,
  syntheticBoxes,
  syntheticLanBoxes,
  worldBoxesNamed,
  type BuiltBox,
} from '../../../test/deviceBoxes';

/** The model a printer's one queue says it is. */
const modelOf = (tree: Directory): string | undefined =>
  /^Info (.+)$/m.exec(contentOf(tree, '/etc/cups/printers.conf'))?.[1];

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
      const conf = contentOf(tree, '/etc/cups/printers.conf');
      expect(conf).toMatch(/^DeviceURI usb:\/\/[^\s]+$/m);
      // The URI names the printer as USB enumerates it: its make, then the rest of its name.
      const [make, ...product] = (modelOf(tree) ?? '').split(' ');
      expect(conf).toContain(`DeviceURI usb://${make}/${encodeURIComponent(product.join(' '))}?serial=`);
    });
  });

  it('tells its scheduler to keep exactly what the spool and the page log hold', () => {
    // The page log is written in the format asked for here, and the spool keeps thirty
    // days of history and a day of documents: a config saying otherwise would contradict
    // the files a player reads beside it.
    printers().forEach(({ tree }) => {
      const conf = contentOf(tree, '/etc/cups/cupsd.conf');
      expect(conf).toContain(
        'PageLogFormat %p %u %j %T %P %C %{job-billing} %{job-originating-host-name} %{job-name} %{media} %{sides}\n',
      );
      expect(conf).toMatch(/^PreserveJobHistory 30d$/m);
      expect(conf).toMatch(/^PreserveJobFiles 1d$/m);
      expect(conf).toMatch(/^Listen \/run\/cups\/cups\.sock$/m);
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
  readonly format: string | undefined;
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
          format: attributeOf(lines, 'document-format'),
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

  it('prints some jobs on one side and some on both', () => {
    const sides = new Set(
      printers().flatMap(({ tree }) =>
        pageLinesOf(contentOf(tree, '/var/log/cups/page_log.1')).map((line) => line.sides),
      ),
    );
    expect(sides).toEqual(new Set(['one-sided', 'two-sided-long-edge']));
  });
});

/** An entry of a PDF's Info dictionary, as `strings` shows it. */
const pdfEntry = (lines: readonly string[], key: string): string | undefined =>
  lines.join('\n').match(new RegExp(`/${key} \\(([^)]*)\\)`))?.[1];

/** A PDF date, `D:YYYYMMDDHHMMSSZ`, in milliseconds. */
const pdfTime = (value: string): number =>
  Date.UTC(
    Number(value.slice(2, 6)),
    Number(value.slice(6, 8)) - 1,
    Number(value.slice(8, 10)),
    Number(value.slice(10, 12)),
    Number(value.slice(12, 14)),
    Number(value.slice(14, 16)),
  );

/** How each kind of document a job may carry begins, by its extension. */
const SIGNATURES: Readonly<Record<string, string>> = {
  pdf: '%PDF',
  docx: 'PK',
  xlsx: 'PK',
  jpg: '\u00ff\u00d8',
};

/** The media type a client declares for each extension; plain text for any other. */
const MEDIA_TYPES: Readonly<Record<string, string>> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  jpg: 'image/jpeg',
};

const extensionOf = (title: string): string => title.slice(title.lastIndexOf('.') + 1);

describe('a printed document', () => {
  /** Printers of every sort: beside shares, and drafting their own. */
  const printers = (): readonly BuiltBox[] => [
    ...worldBoxesNamed(['printer']),
    ...syntheticLanBoxes(['printer']).slice(0, 40),
    ...syntheticBoxes('printer').slice(0, 40),
  ];

  /** Every kept document with the page-log line of the job that printed it. */
  const keptDocuments = (tree: Directory) => {
    const spool = spoolOf(tree);
    return pageLinesOf(contentOf(tree, '/var/log/cups/page_log.1')).flatMap((line) => {
      const content = spool.get(`d${jobFileName(line.jobId).slice(1)}-001`);
      return content === undefined ? [] : [{ line, content }];
    });
  };

  it('is kept in the format its title names', () => {
    let kept = 0;
    printers().forEach(({ tree }) => {
      keptDocuments(tree).forEach(({ line, content }) => {
        kept += 1;
        const signature = SIGNATURES[extensionOf(line.title)];
        if (signature !== undefined) {
          expect({ title: line.title, starts: content.startsWith(signature) }).toEqual({
            title: line.title,
            starts: true,
          });
        }
      });
    });
    expect(kept).toBeGreaterThan(10);
  });

  it('is sent with the media type its name declares', async () => {
    for (const { tree } of printers()) {
      for (const job of await jobsIn(tree)) {
        expect(job.format).toBe(MEDIA_TYPES[extensionOf(job.title ?? '')] ?? 'text/plain');
      }
    }
  });

  it('is printed by the person who wrote it, saved before it was printed', async () => {
    let read = 0;
    for (const { essid, host, tree } of printers()) {
      const people = peopleKnownOn({ essid, host, username: npcUsername(essid, host) });
      for (const { line, content } of keptDocuments(tree)) {
        if (!content.startsWith('%PDF')) continue;
        read += 1;
        const lines = await readableLinesOf(content);
        const writer = people.find((person) => person.username === line.user);
        expect({ title: line.title, author: pdfEntry(lines, 'Author') }).toEqual({
          title: line.title,
          author: writer?.fullName,
        });
        const saved = pdfTime(pdfEntry(lines, 'ModDate') ?? '');
        const created = pdfTime(pdfEntry(lines, 'CreationDate') ?? '');
        expect(created).toBeLessThanOrEqual(saved);
        expect(created).toBeGreaterThan(WORLD_EPOCH - 400 * 86_400_000);
        expect(saved).toBeLessThanOrEqual(line.at);
        expect(saved).toBeGreaterThan(WORLD_EPOCH - 400 * 86_400_000);
      }
    }
    expect(read).toBeGreaterThan(3);
  });
});

/** Every printer: the world's, LAN and deep, and synthetic ones on both layers. */
const everyPrinter = (): readonly BuiltBox[] => [
  ...worldBoxesNamed(['printer']),
  ...syntheticLanBoxes(['printer']).slice(0, 40),
  ...syntheticBoxes('printer').slice(0, 30),
];

describe("a printer's own pages", () => {
  const serving = (): readonly BuiltBox[] => everyPrinter().filter(servesHttp);

  it("list a printer's jobs with their user and title withheld, as CUPS does by default", () => {
    const printers = serving();
    expect(printers.length).toBeGreaterThan(0);
    printers.forEach(({ tree }) => {
      const page = pagesOf(tree).get('jobs.html') ?? '';
      const rows = page.split('\n').filter((line) => line.startsWith('<tr><td>'));
      const logged = pageLinesOf(contentOf(tree, '/var/log/cups/page_log.1'));
      expect(rows).toHaveLength(logged.length);
      logged.forEach((line) => {
        const row = rows.find((candidate) => candidate.startsWith(`<tr><td>${line.queue}-${line.jobId}</td>`));
        expect(row).toBeDefined();
        expect(row?.match(/<td>Withheld<\/td>/g)).toHaveLength(2);
        expect(page).not.toContain(line.title);
      });
    });
  });

  it('list the jobs newest first, each completed when the page log says it printed', () => {
    serving()
      .forEach(({ tree }) => {
        const rows = (pagesOf(tree).get('jobs.html') ?? '')
          .split('\n')
          .filter((line) => line.startsWith('<tr><td>'));
        const logged = [...pageLinesOf(contentOf(tree, '/var/log/cups/page_log.1'))].reverse();
        rows.forEach((row, index) => {
          const line = logged[index];
          const completed = new Date(line?.at ?? 0).toISOString().slice(0, 19).replace('T', ' ');
          expect(row.startsWith(`<tr><td>${line?.queue}-${line?.jobId}</td>`)).toBe(true);
          expect(row).toContain(`completed at ${completed}`);
        });
      });
  });
});
