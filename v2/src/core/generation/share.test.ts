import { describe, expect, it } from 'vitest';
import { strings } from '../commands/strings';
import type { TerminalLine } from '../commands/types';
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
import { buildDeepHostFs } from './deepHostFs';
import { generateApplication } from './generateDatabase';
import { generateHomeLan } from './generateHomeLan';
import { roleOfHostname } from './pools/hostnames';
import { asAbsPath, asMachineId } from '../types';
import { createPatchApi } from '../../adapters/patchApi';
import { generateIdentity } from '../identity/identity';
import { computeWorkstationId } from '../identity/workstation';
import { signedEnvelopeSchema } from '../signedRequest/types';
import { WORLD_EPOCH } from '../cve/worldClock';
import { createFsView } from '../filesystem/fsView';
import type { Directory } from '../filesystem/types';
import { createPrng } from './prng';
import { renderDocument, type DocumentMetadata } from './documentFormats';
import { buildRemoteHostFs, hostServices, npcUsername } from './remoteHostFs';
import { networkPersona } from './persona';
import { boxMail, networkMail } from './networkMail';
import { ALL_GENERATED_PASSWORDS } from './passwordPools';
import { PHONE_MODELS, SHARE_FOLDERS } from './pools/shareFiles';
import type { NetworkCategory } from './pools/essidCatalog';

const NO_FLAGS = new Map<string, string | true>();

/** What a player reads with `strings` on a file holding `content` — the real
 *  command's own run extraction, so every claim below is one a player can see. */
const readableLinesOf = async (content: string): Promise<readonly string[]> => {
  const result = await strings.execute(
    mockCommandEnv({
      fs: mockFsViewFromTree(buildDirectory({ document: buildFile(content, { owner: 'alice' }) }), {
        userType: 'user',
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

type PdfMetadata = Extract<DocumentMetadata, { readonly format: 'pdf' }>;
type PhotoMetadata = Extract<DocumentMetadata, { readonly format: 'jpeg' }>;

const getPdf = (overrides?: Partial<PdfMetadata>): PdfMetadata => ({
  format: 'pdf',
  title: 'Q2 budget',
  author: 'Maria Rodriguez',
  createdAt: Date.UTC(2026, 3, 2, 10, 29, 2),
  modifiedAt: Date.UTC(2026, 3, 9, 16, 30, 15),
  ...overrides,
});

const getPhoto = (overrides?: Partial<PhotoMetadata>): PhotoMetadata => ({
  format: 'jpeg',
  make: 'Apple',
  model: 'iPhone 13',
  takenAt: Date.UTC(2026, 3, 2, 10, 29, 2),
  artist: 'Maria Rodriguez',
  ...overrides,
});

/** An entry of a PDF's Info dictionary, as `strings` shows it. */
const pdfEntry = (lines: readonly string[], key: string): string | undefined =>
  lines.join('\n').match(new RegExp(`/${key} \\(([^)]*)\\)`))?.[1];

const ALL_FORMATS: readonly DocumentMetadata[] = [
  getPdf(),
  getPhoto(),
  { format: 'docx' },
  { format: 'xlsx' },
];

describe('a document on a share is the real format, not text wearing its name', () => {
  it('a PDF gives up who wrote it, its title and when, through strings', async () => {
    const lines = await readableLinesOf(renderDocument(getPdf(), createPrng('pdf')));

    expect(lines[0]).toBe('%PDF-1.7');
    expect(pdfEntry(lines, 'Author')).toBe('Maria Rodriguez');
    expect(pdfEntry(lines, 'Title')).toBe('Q2 budget');
    expect(pdfEntry(lines, 'CreationDate')).toBe('D:20260402102902Z');
    expect(pdfEntry(lines, 'ModDate')).toBe('D:20260409163015Z');
    expect(lines.at(-1)).toBe('%%EOF');
  });

  it('a PDF pads every date field to its fixed width', async () => {
    const lines = await readableLinesOf(
      renderDocument(
        getPdf({
          createdAt: Date.UTC(2025, 0, 3, 4, 5, 6),
          modifiedAt: Date.UTC(2025, 10, 23, 21, 0, 9),
        }),
        createPrng('pdf'),
      ),
    );

    expect(pdfEntry(lines, 'CreationDate')).toBe('D:20250103040506Z');
    expect(pdfEntry(lines, 'ModDate')).toBe('D:20251123210009Z');
  });

  it('a PDF cross-reference table points at the objects it indexes', () => {
    const content = renderDocument(getPdf(), createPrng('pdf'));

    const offsets = [...content.matchAll(/^(\d{10}) 00000 n $/gm)].map((entry) =>
      Number(entry[1]),
    );
    expect(offsets.map((offset) => content.slice(offset, offset + 7))).toEqual([
      '1 0 obj',
      '2 0 obj',
      '3 0 obj',
      '4 0 obj',
      '5 0 obj',
    ]);
    const startxref = Number(content.match(/startxref\n(\d+)\n/)?.[1]);
    expect(content.slice(startxref, startxref + 4)).toBe('xref');
  });

  it('a PDF holds one A4 page, and its cross-reference and trailer count every object', async () => {
    const content = renderDocument(getPdf(), createPrng('pdf'));
    const lines = await readableLinesOf(content);

    expect(lines).toContain('<< /Type /Catalog /Pages 2 0 R >>');
    expect(lines).toContain('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
    expect(lines).toContain(
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R >>',
    );
    const xref = content.slice(content.indexOf('\nxref\n') + 1, content.indexOf('trailer'));
    expect(xref.split('\n').slice(0, 3)).toEqual(['xref', '0 6', '0000000000 65535 f ']);
    expect(xref.match(/^\d{10} \d{5} [fn] $/gm)).toHaveLength(6);
    // The heading, the subsection line and the six entries: nothing else.
    expect(xref.trimEnd().split('\n')).toHaveLength(8);
    expect(lines).toContain('<< /Size 6 /Root 1 0 R /Info 5 0 R >>');
  });

  it('a photo opens and closes with the JPEG markers, and its Exif says its byte order', () => {
    const content = renderDocument(getPhoto(), createPrng('jpeg'));

    expect(content.startsWith('\u00ff\u00d8\u00ff\u00e0')).toBe(true);
    expect(content.endsWith('\u00ff\u00d9')).toBe(true);
    expect(content.slice(content.indexOf('Exif'), content.indexOf('Exif') + 12)).toContain('MM');
  });

  it.each(['docx', 'xlsx'] as const)(
    'a %s opens with a zip member header and closes with the end of its directory',
    (format) => {
      const content = renderDocument({ format }, createPrng('zip'));

      expect(content.startsWith('PK\u0003\u0004')).toBe(true);
      const end = content.lastIndexOf('PK\u0005\u0006');
      expect(end).toBeGreaterThan(0);
      // The end record is fixed-size: its signature and eighteen bytes after it.
      expect(content.length - end).toBe(22);
    },
  );

  it('a PDF names no software version, only its format', async () => {
    const lines = await readableLinesOf(renderDocument(getPdf(), createPrng('pdf')));

    expect(softwareVersionsIn(lines.slice(1).join('\n'))).toEqual([]);
  });

  it('a photo gives up the camera, the moment and who took it, as Exif does', async () => {
    const lines = await readableLinesOf(renderDocument(getPhoto(), createPrng('jpeg')));

    expect(lines).toEqual([
      'JFIF',
      'Exif',
      'Apple',
      'iPhone 13',
      '2026:04:02 10:29:02',
      'Maria Rodriguez',
    ]);
  });

  it('a photo nobody signed carries no artist', async () => {
    const lines = await readableLinesOf(
      renderDocument(
        getPhoto({ artist: null, takenAt: Date.UTC(2025, 8, 1, 7, 3, 9) }),
        createPrng('jpeg'),
      ),
    );

    expect(lines).toEqual(['JFIF', 'Exif', 'Apple', 'iPhone 13', '2025:09:01 07:03:09']);
  });

  it('a Word document gives up its zip member names and nothing about who wrote it', async () => {
    const lines = await readableLinesOf(renderDocument({ format: 'docx' }, createPrng('docx')));

    // Word deflates every member, the author's core.xml included, so a real
    // `strings` on a real docx finds the names in the local headers and again
    // in the central directory, and no person.
    const members = [
      '[Content_Types].xml',
      '_rels/.rels',
      'docProps/core.xml',
      'docProps/app.xml',
      'word/document.xml',
    ];
    expect(lines).toEqual([...members, ...members]);
  });

  it('a spreadsheet gives up its workbook members and nothing else', async () => {
    const lines = await readableLinesOf(renderDocument({ format: 'xlsx' }, createPrng('xlsx')));

    const members = [
      '[Content_Types].xml',
      '_rels/.rels',
      'docProps/core.xml',
      'docProps/app.xml',
      'xl/workbook.xml',
      'xl/worksheets/sheet1.xml',
      'xl/sharedStrings.xml',
    ];
    expect(lines).toEqual([...members, ...members]);
  });

  it.each(ALL_FORMATS)('a $format holds no NUL, which the patch store cannot keep', (metadata) => {
    expect(renderDocument(metadata, createPrng('nul')).includes('\u0000')).toBe(false);
  });

  it.each(ALL_FORMATS)(
    'a $format is mostly noise to cat, and the noise hides nothing strings would find',
    async (metadata) => {
      const oneRender = renderDocument(metadata, createPrng('one'));
      const another = renderDocument(metadata, createPrng('another'));

      expect(oneRender).not.toBe(another);
      // Lengths and offsets are numbers the format really states, and they move
      // with the noise's size; anything else readable that moved came from noise.
      const withoutNumbers = async (content: string) =>
        (await readableLinesOf(content)).map((line) => line.replace(/\d+/g, '#'));
      expect(await withoutNumbers(oneRender)).toEqual(await withoutNumbers(another));
      const unreadable = [...oneRender].filter((character) => {
        const code = character.charCodeAt(0);
        return code < 32 ? code !== 9 && code !== 10 : code > 126;
      });
      expect(unreadable.length).toBeGreaterThanOrEqual(64);
    },
  );

  it.each(ALL_FORMATS)(
    'a $format shows its noise to cat, with nothing that reads as a space or as nothing',
    (metadata) => {
      ['one', 'two', 'three', 'four', 'five'].forEach((seed) => {
        const content = renderDocument(metadata, createPrng(seed));
        expect(content.includes('\u00a0'), seed).toBe(false);
        expect(content.includes('\u00ad'), seed).toBe(false);
      });
    },
  );

  it.each(ALL_FORMATS)(
    'a $format carries no carriage return or escape a terminal would act on',
    (metadata) => {
      const content = renderDocument(metadata, createPrng('terminal'));
      expect(content.includes('\r')).toBe(false);
      expect(content.includes('\u001b')).toBe(false);
    },
  );
});

/** Which department folders each kind of place keeps, written out here rather than read
 *  from the pool that builds them, so a pool that drifted would fail this. */
const FOLDERS_BY_CATEGORY: Readonly<Record<NetworkCategory, readonly string[]>> = {
  corporate: ['finance', 'hr', 'legal', 'sales', 'it', 'marketing', 'facilities'],
  cafe: ['menus', 'rota', 'suppliers', 'invoices', 'inspections', 'photos'],
  residential: ['paperwork', 'taxes', 'house', 'school', 'photos', 'recipes'],
  university: ['research', 'theses', 'lectures', 'admin', 'grants'],
  public: ['minutes', 'planning', 'notices', 'budgets', 'maintenance'],
  hacker: ['talks', 'zines', 'writeups', 'meetups', 'photos'],
  iot: ['datasheets', 'qa', 'certification', 'manuals'],
};

const WORKING_SHARE_PREFIXES: readonly string[] = ['share', 'files', 'nas'];

const prefixOf = (hostname: string): string => hostname.slice(0, hostname.lastIndexOf('-'));

const keepsWorkingShare = ({ host }: Box): boolean =>
  WORKING_SHARE_PREFIXES.includes(prefixOf(host.hostname));

const workingShareBoxes = (): readonly Box[] => lanBoxes(ALL_ESSIDS).filter(keepsWorkingShare);

const BACKUP_PREFIXES: readonly string[] = ['backup', 'vault'];

const keepsBackups = ({ host }: Box): boolean => BACKUP_PREFIXES.includes(prefixOf(host.hostname));

const backupBoxes = (): readonly Box[] => lanBoxes(ALL_ESSIDS).filter(keepsBackups);

const fileServerBoxes = (): readonly Box[] =>
  lanBoxes(ALL_ESSIDS).filter((box) => keepsWorkingShare(box) || keepsBackups(box));

/** The snapshots a backup box keeps, oldest first, each as its date and its tree. */
const snapshotsOf = ({ essid, host }: Box): readonly (readonly [string, Directory])[] =>
  [...directoryAt(buildRemoteHostFs(essid, host), ['srv', 'backup']).entries]
    .map(([date, node]): readonly [string, Directory] => {
      if (node.kind !== 'directory') throw new Error(`${date} is not a snapshot`);
      return [date, node];
    })
    .sort(([earlier], [later]) => earlier.localeCompare(later));

/** The last moment of a `YYYY-MM-DD` day. */
const endOfDay = (date: string): number => Date.parse(`${date}T23:59:59Z`);

const directoryAt = (tree: Directory, path: readonly string[]): Directory => {
  const found = path.reduce<Directory | undefined>((current, name) => {
    const next = current?.entries.get(name);
    return next?.kind === 'directory' ? next : undefined;
  }, tree);
  if (found === undefined) throw new Error(`no /${path.join('/')}`);
  return found;
};

/** Every directory under `directory`, as its path relative to it. */
const directoriesUnder = (directory: Directory, prefix = ''): readonly string[] =>
  [...directory.entries].flatMap(([name, node]) =>
    node.kind === 'directory'
      ? [`${prefix}${name}`, ...directoriesUnder(node, `${prefix}${name}/`)]
      : [],
  );

/** A PDF date (`D:20260402102902Z`) as the moment it names. */
const pdfMoment = (stamp: string): number => {
  const [, year, month, day, hours, minutes, seconds] =
    stamp.match(/^D:(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)Z$/) ?? [];
  return Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hours),
    Number(minutes),
    Number(seconds),
  );
};

describe('a working share holds the departments of the place it serves', () => {
  it('keeps a working share on a share box, backups on a backup box, and /srv on no other box', () => {
    lanBoxes(ALL_ESSIDS).forEach((box) => {
      const tree = buildRemoteHostFs(box.essid, box.host);
      const srv = tree.entries.get('srv');
      const label = `${box.essid} ${box.host.hostname}`;

      if (!keepsWorkingShare(box) && !keepsBackups(box)) {
        expect(srv, label).toBeUndefined();
        return;
      }
      expect(srv?.kind, label).toBe('directory');
      expect([...directoryAt(tree, ['srv']).entries.keys()], label).toEqual(
        keepsWorkingShare(box) ? ['share'] : ['backup'],
      );
    });
  });

  it("keeps three or more of its place's own departments, each holding files", () => {
    const boxes = workingShareBoxes();
    expect(boxes.length).toBeGreaterThan(0);

    boxes.forEach(({ essid, host }) => {
      const share = directoryAt(buildRemoteHostFs(essid, host), ['srv', 'share']);
      const folders = [...share.entries.keys()];
      const allowed = FOLDERS_BY_CATEGORY[networkPersona(essid).category];

      expect(folders.length, `${essid} ${host.hostname}`).toBeGreaterThanOrEqual(3);
      folders.forEach((folder) => {
        expect(allowed, `${essid} ${host.hostname}`).toContain(folder);
        expect(filesUnder(directoryAt(share, [folder])).size).toBeGreaterThan(0);
      });
    });
  });

  it('is written by people who really are on the network, whose mail the network carries', async () => {
    let signedDocuments = 0;
    for (const { essid, host } of fileServerBoxes()) {
      const people = networkMail(essid).people.map((person) => person.fullName);
      const files = filesUnder(directoryAt(buildRemoteHostFs(essid, host), ['srv']));

      for (const [path, content] of files) {
        if (path.endsWith('.pdf')) {
          expect(people, `${essid} ${path}`).toContain(
            pdfEntry(await readableLinesOf(content), 'Author'),
          );
          signedDocuments++;
        }
        if (path.endsWith('.jpg')) {
          // Exif's strings come out in tag order, and the artist is the last of them.
          const artist = (await readableLinesOf(content))[5];
          if (artist !== undefined) {
            expect(people, `${essid} ${path}`).toContain(artist);
            signedDocuments++;
          }
        }
      }
    }
    expect(signedDocuments).toBeGreaterThan(0);
  });

  it('dates every PDF as created before it was last saved, and both before the world stopped', async () => {
    for (const { essid, host } of fileServerBoxes()) {
      const files = filesUnder(directoryAt(buildRemoteHostFs(essid, host), ['srv']));
      for (const [path, content] of files) {
        if (!path.endsWith('.pdf')) continue;
        const lines = await readableLinesOf(content);
        const created = pdfMoment(pdfEntry(lines, 'CreationDate') ?? '');
        const modified = pdfMoment(pdfEntry(lines, 'ModDate') ?? '');

        expect(created, `${essid} ${path}`).toBeLessThanOrEqual(modified);
        expect(modified, `${essid} ${path}`).toBeLessThan(WORLD_EPOCH);
      }
    }
  });

  it("is anyone's to read and only the box's own account's to change", () => {
    fileServerBoxes().forEach(({ essid, host }) => {
      const tree = buildRemoteHostFs(essid, host);
      const srv = directoryAt(tree, ['srv']);
      const guest = createFsView(tree, { userType: 'guest' });
      const user = createFsView(tree, { userType: 'user' });

      // /srv itself is root's, as Debian ships it; what is under it is the account's.
      expect(guest.list(asAbsPath('/srv')).ok).toBe(true);
      expect(user.canWrite(asAbsPath('/srv/dropped.txt')).allowed).toBe(false);
      directoriesUnder(srv).forEach((path) => {
        const directory = `/srv/${path}`;
        expect(guest.list(asAbsPath(directory)).ok, directory).toBe(true);
        expect(guest.canWrite(asAbsPath(`${directory}/dropped.txt`)).allowed).toBe(false);
        expect(user.canWrite(asAbsPath(`${directory}/dropped.txt`)).allowed).toBe(true);
      });
      [...filesUnder(srv).keys()].forEach((path) => {
        const location = asAbsPath(`/srv/${path}`);
        expect(guest.read(location).ok, location).toBe(true);
        expect(guest.canWrite(location).allowed).toBe(false);
        expect(user.canWrite(location).allowed).toBe(true);
      });
      // `ls -l` names who uploaded it all: the box's one account.
      [...srv.entries.values()].forEach((top) => {
        expect(top.owner).toBe(npcUsername(essid, host));
      });
    });
  });
});

describe('a backup box keeps dated snapshots of the same kind of share', () => {
  it('keeps two to four snapshots, each named for a day before the world stopped', () => {
    const boxes = backupBoxes();
    expect(boxes.length).toBeGreaterThan(0);

    boxes.forEach((box) => {
      const dates = snapshotsOf(box).map(([date]) => date);
      const label = `${box.essid} ${box.host.hostname}`;

      expect(dates.length, label).toBeGreaterThanOrEqual(2);
      expect(dates.length, label).toBeLessThanOrEqual(4);
      dates.forEach((date) => {
        expect(date, label).toMatch(/^\d{4}-\d\d-\d\d$/);
        expect(endOfDay(date), label).toBeLessThan(WORLD_EPOCH);
      });
    });
  });

  it("holds its place's own departments in every snapshot", () => {
    backupBoxes().forEach((box) => {
      const allowed = FOLDERS_BY_CATEGORY[networkPersona(box.essid).category];
      snapshotsOf(box).forEach(([date, snapshot]) => {
        expect(snapshot.entries.size, `${box.host.hostname} ${date}`).toBeGreaterThan(0);
        [...snapshot.entries.keys()].forEach((folder) => {
          expect(allowed, `${box.host.hostname} ${date}`).toContain(folder);
        });
      });
    });
  });

  it('holds nothing saved after the night it was taken', async () => {
    for (const box of backupBoxes()) {
      for (const [date, snapshot] of snapshotsOf(box)) {
        for (const [path, content] of filesUnder(snapshot)) {
          const lines = await readableLinesOf(content);
          const label = `${box.host.hostname} ${date}/${path}`;
          if (path.endsWith('.pdf')) {
            expect(pdfMoment(pdfEntry(lines, 'ModDate') ?? ''), label).toBeLessThanOrEqual(
              endOfDay(date),
            );
          }
          if (path.endsWith('.jpg')) {
            const taken = Date.parse(
              (lines[4] ?? '').replace(/^(\d{4}):(\d\d):(\d\d) /, '$1-$2-$3T') + 'Z',
            );
            expect(taken, label).toBeLessThanOrEqual(endOfDay(date));
          }
        }
      }
    }
  });

  it('keeps everything the night before kept, and adds or changes something every night', () => {
    backupBoxes().forEach((box) => {
      const snapshots = snapshotsOf(box).map(([date, snapshot]) => ({
        date,
        files: filesUnder(snapshot),
      }));
      snapshots.slice(1).forEach((later, index) => {
        const earlier = snapshots[index];
        if (earlier === undefined) throw new Error('no earlier snapshot');
        const label = `${box.host.hostname} ${earlier.date} -> ${later.date}`;

        [...earlier.files.keys()].forEach((path) => {
          expect([...later.files.keys()], label).toContain(path);
        });
        const moved = [...later.files].filter(
          ([path, content]) => earlier.files.get(path) !== content,
        );
        expect(moved.length, label).toBeGreaterThan(0);
      });
    });
  });

  it('keeps a file nobody touched between two nights byte for byte the same in both', async () => {
    let unchanged = 0;
    for (const box of backupBoxes()) {
      const snapshots = snapshotsOf(box).map(([, snapshot]) => filesUnder(snapshot));
      for (const [index, later] of snapshots.slice(1).entries()) {
        const earlier = snapshots[index] ?? new Map<string, string>();
        for (const [path, content] of later) {
          const before = earlier.get(path);
          if (before === undefined || !path.endsWith('.pdf')) continue;
          const savedThen = pdfEntry(await readableLinesOf(before), 'ModDate');
          const savedNow = pdfEntry(await readableLinesOf(content), 'ModDate');
          if (savedThen !== savedNow) continue;
          expect(content, path).toBe(before);
          unchanged++;
        }
      }
    }
    expect(unchanged).toBeGreaterThan(0);
  });
});

/** Every file server on a layer below the LAN, which cannot see what else is down there. */
const deepFileServers = (): readonly Box[] =>
  deepBoxes(ALL_ESSIDS).filter((box) => keepsWorkingShare(box) || keepsBackups(box));

/** The people a box below the LAN knows: the logins its own application keeps, as its
 *  own mail names them. */
const deepCastOf = ({ essid, host }: Box): readonly string[] => {
  const account = npcUsername(essid, host);
  const logins = (
    generateApplication({
      appSeed: `db-app-${essid}-${host.ip}`,
      essid,
      host,
      account,
      role: roleOfHostname(host.hostname),
    }).tables.users?.rows ?? []
  ).map((row) => String(row.username));
  return boxMail({ essid, host, account, people: logins }).people.map(
    (person) => person.fullName,
  );
};

/** What any tree keeps under /srv, or nothing. */
const srvFilesOf = (tree: Directory): ReadonlyMap<string, string> => {
  const srv = tree.entries.get('srv');
  return srv?.kind === 'directory' ? filesUnder(srv) : new Map();
};

/** A file server of every shape on a network of every kind, stood up below the LAN so no
 *  pairing goes untested for want of a network that happens to have it. */
const everyKindOfFileServer = (): readonly Box[] => {
  const byCategory = new Map(
    [...ALL_ESSIDS].reverse().map((essid) => [networkPersona(essid).category, essid] as const),
  );
  return [...byCategory.values()].flatMap((essid) =>
    [...WORKING_SHARE_PREFIXES, ...BACKUP_PREFIXES].map((prefix) => ({
      essid,
      host: { ip: '10.40.0.9', hostname: `${prefix}-9`, kind: 'machine' as const },
    })),
  );
};

describe('a share below the LAN', () => {
  it('is kept by every file server down there, in the shape its name says', () => {
    const boxes = deepFileServers();
    expect(boxes.length).toBeGreaterThan(0);

    boxes.forEach((box) => {
      const srv = directoryAt(buildDeepHostFs(box.essid, box.host), ['srv']);
      expect([...srv.entries.keys()], `${box.essid} ${box.host.hostname}`).toEqual(
        keepsWorkingShare(box) ? ['share'] : ['backup'],
      );
    });
  });

  it('is written only by the people its own application knows', async () => {
    let signedDocuments = 0;
    for (const box of deepFileServers()) {
      const cast = deepCastOf(box);
      for (const [path, content] of srvFilesOf(buildDeepHostFs(box.essid, box.host))) {
        if (!path.endsWith('.pdf')) continue;
        expect(cast, `${box.essid} ${path}`).toContain(
          pdfEntry(await readableLinesOf(content), 'Author'),
        );
        signedDocuments++;
      }
    }
    expect(signedDocuments).toBeGreaterThan(0);
  });

  it('names no machine up on the LAN, because it cannot see past its own layer', () => {
    deepFileServers().forEach((box) => {
      const files = [...srvFilesOf(buildDeepHostFs(box.essid, box.host)).values()];
      generateHomeLan(box.essid)
        .hosts.filter((lanHost) => lanHost.kind === 'machine')
        .forEach((lanHost) => {
          files.forEach((content) => {
            expect(content).not.toContain(lanHost.hostname);
            expect(content).not.toContain(lanHost.ip);
          });
        });
    });
  });

  it('is the same bytes however often it is built', () => {
    deepFileServers().forEach((box) => {
      expect(srvFilesOf(buildDeepHostFs(box.essid, box.host))).toEqual(
        srvFilesOf(buildDeepHostFs(box.essid, box.host)),
      );
    });
  });

  it("keeps its place's own departments on every kind of network, in every shape", () => {
    const boxes = everyKindOfFileServer();
    expect(new Set(boxes.map((box) => networkPersona(box.essid).category)).size).toBe(
      Object.keys(FOLDERS_BY_CATEGORY).length,
    );

    boxes.forEach((box) => {
      const srv = directoryAt(buildDeepHostFs(box.essid, box.host), ['srv']);
      const allowed = FOLDERS_BY_CATEGORY[networkPersona(box.essid).category];
      const label = `${box.essid} ${box.host.hostname}`;
      const trees = keepsWorkingShare(box)
        ? [directoryAt(srv, ['share'])]
        : [...directoryAt(srv, ['backup']).entries.values()].map((snapshot) => {
            if (snapshot.kind !== 'directory') throw new Error(`${label}: a file in /srv/backup`);
            return snapshot;
          });

      expect(trees.length, label).toBeGreaterThan(0);
      trees.forEach((tree) => {
        expect(tree.entries.size, label).toBeGreaterThan(0);
        [...tree.entries.keys()].forEach((folder) => {
          expect(allowed, label).toContain(folder);
        });
      });
    });
  });
});

/** Many file servers of every shape on every kind of network, below the LAN: enough
 *  draws that anything a pool holds but a share could never be given would show. */
const manyFileServers = (): readonly Box[] =>
  everyKindOfFileServer().flatMap(({ essid, host }) =>
    Array.from({ length: 12 }, (_, index) => ({
      essid,
      host: { ...host, ip: `10.40.${index}.9` },
    })),
  );

/** Every file a share holds, once: a snapshot copy of a file is the same file. */
const uniqueShareFiles = (tree: Directory): ReadonlyMap<string, string> => {
  const srv = directoryAt(tree, ['srv']);
  const backup = srv.entries.get('backup');
  if (backup?.kind !== 'directory') return filesUnder(srv);
  return new Map(
    [...backup.entries.values()].flatMap((snapshot) =>
      snapshot.kind === 'directory' ? [...filesUnder(snapshot)] : [],
    ),
  );
};

const TEXT_EXTENSIONS: readonly string[] = ['.txt', '.csv', '.md'];

const isText = (path: string): boolean =>
  TEXT_EXTENSIONS.some((extension) => path.endsWith(extension));

/** What a player can read in a file: all of a text file, and a document's readable runs
 *  past its format signature. */
const writtenIn = async (path: string, content: string): Promise<string> =>
  isText(path) ? content : (await readableLinesOf(content)).slice(1).join('\n');

/** What each kind of phone a network holds could have taken a photo with. */
const PHONE_MAKERS: Readonly<Record<string, readonly string[]>> = {
  iphone: ['Apple'],
  android: ['Google', 'Samsung'],
};

/** Every model line a phone of that make would stamp starts with its range's name. */
const MODEL_RANGE: Readonly<Record<string, string>> = {
  Apple: 'iPhone',
  Google: 'Pixel',
  Samsung: 'Galaxy',
};

describe('what a share holds', () => {
  it('keeps twenty-five to sixty files on a working share', () => {
    [...workingShareBoxes(), ...manyFileServers().filter(keepsWorkingShare)].forEach((box) => {
      const count = filesUnder(directoryAt(buildRemoteHostFs(box.essid, box.host), ['srv'])).size;
      expect(count, `${box.essid} ${box.host.hostname}`).toBeGreaterThanOrEqual(25);
      expect(count, `${box.essid} ${box.host.hostname}`).toBeLessThanOrEqual(60);
    });
  });

  it('keeps no more than eighty files across every snapshot on a backup box', () => {
    [...backupBoxes(), ...manyFileServers().filter(keepsBackups)].forEach((box) => {
      const count = filesUnder(directoryAt(buildRemoteHostFs(box.essid, box.host), ['srv'])).size;
      expect(count, `${box.essid} ${box.host.hostname}`).toBeLessThanOrEqual(80);
    });
  });

  it("dates photos with a phone the network really has, or a camera where it has none", async () => {
    let fromPhones = 0;
    let fromCameras = 0;
    for (const essid of ALL_ESSIDS) {
      const servers = fileServerBoxes().filter((box) => box.essid === essid);
      if (servers.length === 0) continue;
      const phones = generateHomeLan(essid).hosts.filter(
        (host) => prefixOf(host.hostname) in PHONE_MAKERS,
      );
      const makers = phones.flatMap((phone) => PHONE_MAKERS[prefixOf(phone.hostname)] ?? []);
      const stamped = new Set<string>();
      for (const box of servers) {
        const files = uniqueShareFiles(buildRemoteHostFs(box.essid, box.host));
        for (const [path, content] of files) {
          if (!path.endsWith('.jpg')) continue;
          const [, , make = '', model = ''] = await readableLinesOf(content);
          if (phones.length === 0) {
            expect(Object.keys(MODEL_RANGE), `${essid} ${path}`).not.toContain(make);
            fromCameras++;
            continue;
          }
          expect(makers, `${essid} ${path}`).toContain(make);
          expect(model.startsWith(MODEL_RANGE[make] ?? '?'), `${essid} ${path}: ${model}`).toBe(
            true,
          );
          stamped.add(`${make} ${model}`);
          fromPhones++;
        }
      }
      // Each phone is one model, so a network cannot have taken photos on more models
      // than it has phones.
      expect(stamped.size, essid).toBeLessThanOrEqual(phones.length);
    }
    expect(fromPhones).toBeGreaterThan(0);
    expect(fromCameras).toBeGreaterThan(0);
  });

  it('carries no word a player could try as a password', async () => {
    const pool = new Set(ALL_GENERATED_PASSWORDS.map((password) => password.toLowerCase()));
    for (const box of [...fileServerBoxes(), ...deepFileServers()]) {
      for (const [path, content] of uniqueShareFiles(buildDeepHostFs(box.essid, box.host))) {
        const words = (await writtenIn(path, content)).toLowerCase().match(/[a-z0-9]+/g) ?? [];
        expect(`${path}: ${words.filter((word) => pool.has(word)).join(',')}`).toBe(`${path}: `);
      }
    }
  });

  it('states no version and leaves no slot unfilled', async () => {
    for (const box of [...fileServerBoxes(), ...deepFileServers()]) {
      for (const [path, content] of uniqueShareFiles(buildDeepHostFs(box.essid, box.host))) {
        const written = await writtenIn(path, content);
        const wrong = [
          ...softwareVersionsIn(written),
          ...(written.match(/[{}]|undefined|NaN|\[object/g) ?? []),
        ];
        expect(`${box.host.hostname} ${path}: ${wrong.join(',')}`).toBe(
          `${box.host.hostname} ${path}: `,
        );
      }
    }
  });

  it('can be given every department and every file its pools hold', () => {
    const seen = new Set(
      manyFileServers().flatMap((box) =>
        [...uniqueShareFiles(buildRemoteHostFs(box.essid, box.host)).keys()].map(
          (path) => `${networkPersona(box.essid).category}:${path.split('/').slice(-2).join('/')}`,
        ),
      ),
    );
    const unreached = Object.entries(SHARE_FOLDERS).flatMap(([category, folders]) =>
      Object.entries(folders).flatMap(([folder, specs]) =>
        specs
          .map((spec) => `${category}:${folder}/${spec.name}`)
          .filter((entry) => !seen.has(entry)),
      ),
    );
    expect(unreached).toEqual([]);
  });

  it('keeps ten or more files in every department a pool offers', () => {
    // Three departments of up to ten files each is how a working share reaches its
    // twenty-five, so a department that could not fill ten would cap one short.
    Object.entries(SHARE_FOLDERS).forEach(([category, folders]) => {
      Object.entries(folders).forEach(([folder, specs]) => {
        expect(specs.length, `${category}/${folder}`).toBeGreaterThanOrEqual(10);
      });
    });
  });

  it('never holds the same file on two boxes of one network', () => {
    ALL_ESSIDS.forEach((essid) => {
      const servers = fileServerBoxes().filter((box) => box.essid === essid);
      const seenOn = new Map<string, string>();
      servers.forEach((box) => {
        const files = uniqueShareFiles(buildRemoteHostFs(box.essid, box.host));
        new Set(files.values()).forEach((content) => {
          const other = seenOn.get(content);
          expect(other, `${essid}: ${box.host.hostname} repeats ${other}`).toBeUndefined();
          seenOn.set(content, box.host.hostname);
        });
      });
    });
  });

  it('reads as a different share on nearly every file server in the world', () => {
    const shares = fileServerBoxes().map((box) =>
      uniqueShareFiles(buildRemoteHostFs(box.essid, box.host)),
    );
    const nameSets = new Set(
      shares.map((files) => [...files.keys()].map((path) => path.split('/').pop()).sort().join()),
    );
    expect(nameSets.size / shares.length).toBeGreaterThanOrEqual(0.9);

    const bodies = shares.flatMap((files) =>
      [...new Set([...files].filter(([path]) => isText(path)).map(([, content]) => content))],
    );
    expect(bodies.length).toBeGreaterThan(0);
    expect(new Set(bodies).size / bodies.length).toBeGreaterThanOrEqual(0.9);
  });
});

describe('what ftp get can carry home', () => {
  it('fits every file a share holds into the one signed write that saves it on the player box', async () => {
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
    const hardest = [...fileServerBoxes(), ...manyFileServers()]
      .flatMap((box) => [...uniqueShareFiles(buildRemoteHostFs(box.essid, box.host))])
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

/** A backup box's snapshots, oldest first, each as its date and its files. */
const snapshotFilesOf = (box: Box) =>
  snapshotsOf(box).map(([date, snapshot]) => ({ date, files: filesUnder(snapshot) }));

/** Every pair of consecutive snapshots on every backup box in the world. */
const consecutiveNights = () =>
  backupBoxes().flatMap((box) => {
    const snapshots = snapshotFilesOf(box);
    return snapshots.slice(1).map((later, index) => ({
      box,
      earlier: snapshots[index] ?? later,
      later,
    }));
  });

/** The earliest a box could have been installed: nothing on it predates that. */
const EARLIEST_INSTALL = WORLD_EPOCH - 400 * 86_400_000;

describe('how a share changed over time', () => {
  it('shows a document saved again between two nights with its later save', async () => {
    let revised = 0;
    for (const { box, earlier, later } of consecutiveNights()) {
      for (const [path, content] of later.files) {
        const before = earlier.files.get(path);
        if (before === undefined || before === content) continue;
        const label = `${box.host.hostname} ${earlier.date} -> ${later.date} ${path}`;
        // A photo is taken once and a note is rewritten whole; only a document is saved
        // over, so only a document may differ from one night to the next.
        expect(/\.(pdf|docx|xlsx)$/.test(path), label).toBe(true);
        if (path.endsWith('.pdf')) {
          const then = await readableLinesOf(before);
          const now = await readableLinesOf(content);
          expect(pdfEntry(now, 'CreationDate'), label).toBe(pdfEntry(then, 'CreationDate'));
          expect(pdfMoment(pdfEntry(now, 'ModDate') ?? ''), label).toBeGreaterThan(
            pdfMoment(pdfEntry(then, 'ModDate') ?? ''),
          );
        }
        revised++;
      }
    }
    expect(revised).toBeGreaterThan(0);
  });

  it('saves over every kind of document, and leaves most of them as they were', () => {
    const revisedKinds = new Set<string>();
    let kept = 0;
    let changed = 0;
    backupBoxes().forEach((box) => {
      const snapshots = snapshotFilesOf(box);
      const first = snapshots[0]?.files ?? new Map<string, string>();
      const last = snapshots.at(-1)?.files ?? new Map<string, string>();
      [...first].forEach(([path, content]) => {
        if (!/\.(pdf|docx|xlsx)$/.test(path)) return;
        if (last.get(path) === content) {
          kept++;
          return;
        }
        changed++;
        revisedKinds.add(path.slice(path.lastIndexOf('.')));
      });
    });
    expect([...revisedKinds].sort()).toEqual(['.docx', '.pdf', '.xlsx']);
    // A few documents are saved again between backups; most sit untouched.
    expect(changed).toBeLessThan(kept);
  });

  it('sometimes gains more than one file in a night', () => {
    const gains = consecutiveNights().map(
      ({ earlier, later }) =>
        [...later.files.keys()].filter((path) => !earlier.files.has(path)).length,
    );
    expect(Math.max(...gains)).toBeGreaterThan(1);
  });

  it('dates every document within the life of the box', async () => {
    for (const box of fileServerBoxes()) {
      for (const [path, content] of uniqueShareFiles(buildRemoteHostFs(box.essid, box.host))) {
        if (!path.endsWith('.pdf')) continue;
        const lines = await readableLinesOf(content);
        const created = pdfMoment(pdfEntry(lines, 'CreationDate') ?? '');
        expect(created, `${box.host.hostname} ${path}`).toBeGreaterThanOrEqual(EARLIEST_INSTALL);
      }
    }
  });

  it('shows documents on a working share worked on for days after they were started', async () => {
    let workedOn = 0;
    for (const box of workingShareBoxes()) {
      for (const [path, content] of uniqueShareFiles(buildRemoteHostFs(box.essid, box.host))) {
        if (!path.endsWith('.pdf')) continue;
        const lines = await readableLinesOf(content);
        const days =
          (pdfMoment(pdfEntry(lines, 'ModDate') ?? '') -
            pdfMoment(pdfEntry(lines, 'CreationDate') ?? '')) /
          86_400_000;
        if (days > 1) workedOn++;
      }
    }
    expect(workedOn).toBeGreaterThan(0);
  });

  it('keeps some departments full and some not', () => {
    const counts = workingShareBoxes().flatMap((box) =>
      [...directoryAt(buildRemoteHostFs(box.essid, box.host), ['srv', 'share']).entries.values()].map(
        (folder) => (folder.kind === 'directory' ? folder.entries.size : 0),
      ),
    );
    expect(Math.max(...counts)).toBe(10);
    expect(Math.min(...counts)).toBeLessThan(10);
  });
});

describe('what the photos and notes on a share say', () => {
  it('names a camera on every photo, signs some and leaves others unsigned', async () => {
    let signed = 0;
    let unsigned = 0;
    for (const box of [...fileServerBoxes(), ...deepFileServers()]) {
      for (const [path, content] of uniqueShareFiles(buildDeepHostFs(box.essid, box.host))) {
        if (!path.endsWith('.jpg')) continue;
        const lines = await readableLinesOf(content);
        expect(lines.length, `${box.host.hostname} ${path}`).toBeGreaterThanOrEqual(5);
        expect(lines[2], path).toMatch(/^\S.{3,}$/);
        expect(lines[3], path).toMatch(/^\S.{3,}$/);
        if (lines.length === 6) signed++;
        else unsigned++;
      }
    }
    expect(signed).toBeGreaterThan(0);
    expect(unsigned).toBeGreaterThan(0);
  });

  it('takes photos below the LAN on a camera, since no phone there can be seen', async () => {
    let photos = 0;
    for (const box of deepFileServers()) {
      for (const [path, content] of uniqueShareFiles(buildDeepHostFs(box.essid, box.host))) {
        if (!path.endsWith('.jpg')) continue;
        const make = (await readableLinesOf(content))[2] ?? '';
        expect(Object.keys(MODEL_RANGE), `${box.host.hostname} ${path}`).not.toContain(make);
        expect(make.length).toBeGreaterThanOrEqual(4);
        photos++;
      }
    }
    expect(photos).toBeGreaterThan(0);
  });

  it('knows each phone in the world as its own model, not every phone as one', async () => {
    const models = new Map<string, Set<string>>();
    for (const box of fileServerBoxes()) {
      for (const [path, content] of uniqueShareFiles(buildRemoteHostFs(box.essid, box.host))) {
        if (!path.endsWith('.jpg')) continue;
        const [, , make = '', model = ''] = await readableLinesOf(content);
        if (!(make in MODEL_RANGE)) continue;
        models.set(make, (models.get(make) ?? new Set()).add(model));
      }
    }
    expect([...models.values()].some((seen) => seen.size > 1)).toBe(true);
  });

  it('names every file the way a person saves one, its extension its format', () => {
    for (const box of manyFileServers()) {
      for (const path of uniqueShareFiles(buildRemoteHostFs(box.essid, box.host)).keys()) {
        expect(path.split('/').pop(), path).toMatch(
          /^(README|[a-z0-9]+(-[a-z0-9]+)*)\.(pdf|jpg|docx|xlsx|txt|csv|md)$/,
        );
      }
    }
  });

  it('can have been taken on every model of phone a network may hold', async () => {
    // The catalog holds too few phones to draw every model, so these networks are
    // stood up only to be read: any file server on them with a phone beside it.
    const seen = new Set<string>();
    for (let index = 0; index < 400; index++) {
      const essid = `PHONE-SURVEY-${index}`;
      const hosts = generateHomeLan(essid).hosts;
      if (!hosts.some((host) => prefixOf(host.hostname) in PHONE_MAKERS)) continue;
      for (const host of hosts.filter(
        (candidate) => roleOfHostname(candidate.hostname) === 'fileserver',
      )) {
        for (const [path, content] of uniqueShareFiles(buildRemoteHostFs(essid, host))) {
          if (!path.endsWith('.jpg')) continue;
          const [, , make = '', model = ''] = await readableLinesOf(content);
          seen.add(`${make}|${model}`);
        }
      }
    }
    const everyModel = Object.values(PHONE_MODELS)
      .flat()
      .map(({ make, model }) => `${make}|${model}`);
    expect(everyModel.filter((model) => !seen.has(model))).toEqual([]);
  });

  it('gives every PDF a title', async () => {
    for (const box of manyFileServers()) {
      for (const [path, content] of uniqueShareFiles(buildRemoteHostFs(box.essid, box.host))) {
        if (!path.endsWith('.pdf')) continue;
        expect(pdfEntry(await readableLinesOf(content), 'Title'), path).toMatch(/^\S/);
      }
    }
  });

  it('writes every note without a stray blank line', () => {
    for (const box of manyFileServers()) {
      for (const [path, content] of uniqueShareFiles(buildRemoteHostFs(box.essid, box.host))) {
        if (!isText(path)) continue;
        const lines = content.replace(/\n$/, '').split('\n');
        const label = `${path}: ${JSON.stringify(content)}`;
        expect(content.endsWith('\n'), label).toBe(true);
        expect(lines[0], label).toMatch(/\S/);
        expect(lines.at(-1), label).toMatch(/\S/);
        // Markdown keeps one blank line under its heading and nowhere else is one needed.
        const blanks = lines.filter((line) => line.trim() === '').length;
        expect(blanks, label).toBe(path.endsWith('.md') && lines[0]?.startsWith('# ') ? 1 : 0);
        if (path.endsWith('.md')) expect(lines[1], label).toBe('');
      }
    }
  });

  it("fills a note's slots with the place, its people, a day and a number", () => {
    const checked = new Set<string>();
    for (const box of manyFileServers()) {
      const cast = deepCastOf(box);
      const firstNames = cast.map((name) => name.split(' ')[0]);
      const place = networkPersona(box.essid).place;
      for (const [path, content] of uniqueShareFiles(buildRemoteHostFs(box.essid, box.host))) {
        const name = path.split('/').pop() ?? '';
        const lines = content.split('\n');
        const label = `${box.host.hostname} ${path}`;
        if (name === 'keys.txt') {
          const [, where, day] = lines[0]?.match(/^Who holds a key to (.+), as of (.+)$/) ?? [];
          expect(where, label).toBe(place);
          expect(day, label).toMatch(/^\d{4}-\d\d-\d\d$/);
          expect(Date.parse(`${day ?? ''}T00:00:00Z`), label).toBeLessThan(WORLD_EPOCH);
          lines.slice(1, 4).forEach((line) => expect(cast, label).toContain(line));
          checked.add(name);
        }
        if (name === 'printer-setup.txt') {
          const [, first] = lines[2]?.match(/^Still stuck\? Ask (\S+)\. Updated \S+\.$/) ?? [];
          expect(firstNames, label).toContain(first);
          checked.add(name);
        }
        if (name === 'fridge-temps.csv') {
          const [, count, person] = lines[1]?.match(/^\S+,display,(\d+),(.+)$/) ?? [];
          expect(Number(count), label).toBeGreaterThanOrEqual(2);
          expect(Number(count), label).toBeLessThanOrEqual(40);
          expect(cast, label).toContain(person);
          checked.add(name);
        }
        if (name === 'banking.txt') {
          const [, amount] = lines[0]?.match(/^Banked on \d{4}-\d\d-\d\d: (\d+)$/) ?? [];
          expect(Number(amount), label).toBeGreaterThanOrEqual(20);
          expect(Number(amount), label).toBeLessThanOrEqual(4000);
          checked.add(name);
        }
      }
    }
    expect([...checked].sort()).toEqual([
      'banking.txt',
      'fridge-temps.csv',
      'keys.txt',
      'printer-setup.txt',
    ]);
  });
});

const LOOPBACK = '127.0.0.1';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** One line of a vsftpd log, read back the way a player reads it. */
type FtpLogLine = {
  readonly at: number;
  readonly pid: string;
  readonly user: string | null;
  readonly event: string;
  readonly client: string;
  readonly path: string | null;
  readonly bytes: number | null;
};

const FTP_LOG_LINE =
  /^\w{3} (\w{3}) ([ \d]\d) (\d\d):(\d\d):(\d\d) (\d{4}) \[pid (\d+)\] (?:\[([\w.-]+)\] )?(CONNECT|OK LOGIN|OK UPLOAD): Client "([\d.]+)"(?:, "([^"]+)", (\d+) bytes)?$/;

const ftpLogLinesOf = (log: string): readonly FtpLogLine[] =>
  log
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => {
      const match = FTP_LOG_LINE.exec(line);
      if (match === null) throw new Error(`not a vsftpd line: ${line}`);
      const [, month, day, hours, minutes, seconds, year, pid, user, event, client, path, bytes] =
        match;
      return {
        at: Date.UTC(
          Number(year),
          MONTHS.indexOf(month ?? ''),
          Number(day),
          Number(hours),
          Number(minutes),
          Number(seconds),
        ),
        pid: pid ?? '',
        user: user ?? null,
        event: event ?? '',
        client: client ?? '',
        path: path ?? null,
        bytes: bytes === undefined ? null : Number(bytes),
      };
    });

const runsFtp = ({ essid, host }: Box): boolean =>
  hostServices(essid, host).some(({ spec }) => spec.service === 'ftp');

/** `/var/log/vsftpd.log.1` as root reads it, or null where the box keeps none. */
const transferHistoryOf = (tree: Directory): string | null => {
  const result = createFsView(tree, { userType: 'root' }).read(
    asAbsPath('/var/log/vsftpd.log.1'),
  );
  return result.ok ? result.content : null;
};

const uploadsIn = (log: string): readonly FtpLogLine[] =>
  ftpLogLinesOf(log).filter((line) => line.event === 'OK UPLOAD');

/** The machine a person on the network writes from, as the file server sees it: across
 *  the LAN, or over the loopback when they sit at the file server itself. */
const clientOf = (box: Box, fullName: string | undefined): string | undefined => {
  const person = networkMail(box.essid).people.find((known) => known.fullName === fullName);
  if (person === undefined) return undefined;
  return person.host.ip === box.host.ip ? LOOPBACK : person.host.ip;
};

describe("the file server's own record of what arrived on its share", () => {
  it('logs the arrival of every file a working share holds, from the machine of whoever wrote it, to the byte', async () => {
    const boxes = workingShareBoxes().filter(runsFtp);
    expect(boxes.length).toBeGreaterThan(0);
    let corroborated = 0;

    for (const box of boxes) {
      const tree = buildRemoteHostFs(box.essid, box.host);
      const files = filesUnder(directoryAt(tree, ['srv', 'share']));
      const uploads = uploadsIn(transferHistoryOf(tree) ?? '');
      const label = `${box.essid} ${box.host.hostname}`;

      expect(uploads.map((upload) => upload.path).sort(), label).toEqual(
        [...files.keys()].map((path) => `/srv/share/${path}`).sort(),
      );
      for (const upload of uploads) {
        const content = files.get((upload.path ?? '').slice('/srv/share/'.length)) ?? '';
        expect(upload.bytes, `${label} ${upload.path}`).toBe(content.length);
        expect(upload.user, label).toBe(npcUsername(box.essid, box.host));
        if (!(upload.path ?? '').endsWith('.pdf')) continue;
        const lines = await readableLinesOf(content);
        expect(upload.client, `${label} ${upload.path}`).toBe(
          clientOf(box, pdfEntry(lines, 'Author')),
        );
        // Saved straight onto the share: the moment it arrived is the moment the PDF
        // says it was last saved.
        expect(upload.at, `${label} ${upload.path}`).toBe(pdfMoment(pdfEntry(lines, 'ModDate') ?? ''));
        corroborated++;
      }
    }
    expect(corroborated).toBeGreaterThan(0);
  });

  it("logs each night's new and changed files arriving from their authors' machines while the backup ran", async () => {
    const boxes = backupBoxes().filter(runsFtp);
    expect(boxes.length).toBeGreaterThan(0);
    let corroborated = 0;

    for (const box of boxes) {
      const tree = buildRemoteHostFs(box.essid, box.host);
      const label = `${box.essid} ${box.host.hostname}`;
      const snapshots = snapshotsOf(box).map(([date, snapshot]) => ({
        date,
        files: filesUnder(snapshot),
      }));
      // What each night had that the night before did not: a file new that night, or
      // saved again since. A file nobody touched is not sent again.
      const arrived = snapshots.flatMap(({ date, files }, index) =>
        [...files]
          .filter(([path, content]) => snapshots[index - 1]?.files.get(path) !== content)
          .map(([path]) => `/srv/backup/${date}/${path}`),
      );
      const uploads = uploadsIn(transferHistoryOf(tree) ?? '');

      expect(uploads.map((upload) => upload.path).sort(), label).toEqual(arrived.sort());
      for (const upload of uploads) {
        const [, date = '', path = ''] = /^\/srv\/backup\/([\d-]+)\/(.+)$/.exec(upload.path ?? '') ?? [];
        const content = snapshots.find((snapshot) => snapshot.date === date)?.files.get(path) ?? '';
        expect(upload.bytes, `${label} ${upload.path}`).toBe(content.length);
        expect(upload.user, label).toBe(npcUsername(box.essid, box.host));
        // The nightly job runs in the small hours of the day the snapshot is named for.
        expect(new Date(upload.at).toISOString().slice(0, 10), `${label} ${upload.path}`).toBe(date);
        expect(new Date(upload.at).getUTCHours(), `${label} ${upload.path}`).toBeGreaterThanOrEqual(2);
        expect(new Date(upload.at).getUTCHours(), `${label} ${upload.path}`).toBeLessThan(3);
        if (!path.endsWith('.pdf')) continue;
        const lines = await readableLinesOf(content);
        expect(upload.client, `${label} ${upload.path}`).toBe(
          clientOf(box, pdfEntry(lines, 'Author')),
        );
        expect(pdfMoment(pdfEntry(lines, 'ModDate') ?? ''), `${label} ${upload.path}`).toBeLessThanOrEqual(
          upload.at,
        );
        corroborated++;
      }
    }
    expect(corroborated).toBeGreaterThan(0);
  });

  it('writes one line for each arrival and nothing else, each its own session', () => {
    fileServerBoxes()
      .filter(runsFtp)
      .forEach((box) => {
        const lines = ftpLogLinesOf(transferHistoryOf(buildRemoteHostFs(box.essid, box.host)) ?? '');
        const label = `${box.essid} ${box.host.hostname}`;
        expect(lines.length, label).toBeGreaterThan(0);
        lines.forEach((line) => {
          expect(line.event, label).toBe('OK UPLOAD');
          expect(line.user, label).toBe(npcUsername(box.essid, box.host));
        });
        expect(new Set(lines.map((line) => line.pid)).size, label).toBe(lines.length);
      });
  });

  it('fits every transfer log into the one signed write that saves it on the player box', async () => {
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
    const logs = fileServerBoxes()
      .filter(runsFtp)
      .map((box) => ({
        label: `${box.essid} ${box.host.hostname}`,
        log: transferHistoryOf(buildRemoteHostFs(box.essid, box.host)) ?? '',
      }));

    for (const { log } of logs) {
      await patches.write(asAbsPath('/home/operator/transfers.log'), log, { isNew: true });
    }
    expect(sent).toHaveLength(logs.length);
    sent.forEach((body, index) => {
      expect(
        signedEnvelopeSchema.safeParse(JSON.parse(body)).success,
        `${logs[index]?.label}: ${JSON.stringify(logs[index]?.log).length} escaped`,
      ).toBe(true);
    });
  });

  it('writes the uploads in the order they happened, all before the world began', () => {
    fileServerBoxes()
      .filter(runsFtp)
      .forEach((box) => {
        const moments = ftpLogLinesOf(
          transferHistoryOf(buildRemoteHostFs(box.essid, box.host)) ?? '',
        ).map((line) => line.at);
        expect(moments.length).toBeGreaterThan(0);
        expect(moments).toEqual([...moments].sort((earlier, later) => earlier - later));
        moments.forEach((moment) => expect(moment).toBeLessThan(WORLD_EPOCH));
      });
  });

  it('keeps no transfer history where no ftp runs, off a file server, or below the LAN', () => {
    lanBoxes(ALL_ESSIDS)
      .filter((box) => !runsFtp(box) || !(keepsWorkingShare(box) || keepsBackups(box)))
      .forEach((box) => {
        expect(transferHistoryOf(buildRemoteHostFs(box.essid, box.host)), box.host.hostname).toBeNull();
      });
    deepFileServers().forEach((box) => {
      expect(transferHistoryOf(buildDeepHostFs(box.essid, box.host)), box.host.hostname).toBeNull();
    });
  });
});
