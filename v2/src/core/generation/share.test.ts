import { describe, expect, it } from 'vitest';
import { strings } from '../commands/strings';
import type { TerminalLine } from '../commands/types';
import { buildDirectory, buildFile } from '../../test/factories/filesystem';
import { mockCommandEnv, mockFsViewFromTree } from '../../test/factories/commandEnv';
import {
  ALL_ESSIDS,
  filesUnder,
  lanBoxes,
  softwareVersionsIn,
  type Box,
} from '../../test/worldContent';
import { asAbsPath } from '../types';
import { WORLD_EPOCH } from '../cve/worldClock';
import { createFsView } from '../filesystem/fsView';
import type { Directory } from '../filesystem/types';
import { createPrng } from './prng';
import { renderDocument, type DocumentMetadata } from './documentFormats';
import { buildRemoteHostFs, npcUsername } from './remoteHostFs';
import { networkPersona } from './persona';
import { networkMail } from './networkMail';
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
