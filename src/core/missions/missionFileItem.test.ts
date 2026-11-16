import { describe, expect, it } from 'vitest';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import {
  missionFileContent,
  missionFileItem,
  missionFileName,
  missionFilePath,
  missionPlantContent,
} from './missionFileItem.js';
import { missionKind, missionTopology } from './missionShape.js';
import { isMissionNumber } from './missionNetwork.js';
import { WORLD_EPOCH } from '../cve/worldClock.js';
import { CAMERAS } from '../generation/pools/shareFiles.js';

/** File jobs, from a spread of contract numbers across the whole block. */
const FILE_JOBS = Array.from({ length: 6000 }, (_unused, index) => index * 2741 + 2).filter(
  (missionNumber) => isMissionNumber(missionNumber) && missionKind(missionNumber) === 'file',
);

const SECRET = 'test-mission-secret';

/** The file jobs asking for the item called `noun`. */
const jobsFor = (noun: string): readonly number[] =>
  FILE_JOBS.filter((missionNumber) => missionFileItem(missionNumber).noun === noun);

/** A handful of them, for the checks that draw the bytes. */
const someJobsFor = (noun: string): readonly number[] => jobsFor(noun).slice(0, 30);

/** What `strings` keeps: runs of four or more printable ASCII characters. */
const readableRuns = (content: string): readonly string[] => content.match(/[ -~]{4,}/g) ?? [];

const directoryOf = (path: string): string => path.slice(0, path.lastIndexOf('/'));

const DAY_MS = 86_400_000;

/** The 300 days before the world's epoch, which a share's documents are dated in too. */
const isInWindow = (epochMs: number): boolean =>
  epochMs >= WORLD_EPOCH - 300 * DAY_MS && epochMs < WORLD_EPOCH;

const ITEM_NOUNS = [
  'prototype render',
  'site photo',
  'signed contract',
  'firmware image',
  'customer export',
  'key ring',
];

/** Infiltrate jobs, from the same spread. */
const INFILTRATE_JOBS = Array.from({ length: 6000 }, (_unused, index) => index * 2741 + 2).filter(
  (missionNumber) => isMissionNumber(missionNumber) && missionKind(missionNumber) === 'infiltrate',
);

describe('the item an infiltrate job slips in', () => {
  it("is the company's firmware image, at a firmware image's name and place", () => {
    expect(INFILTRATE_JOBS.length).toBeGreaterThan(100);
    for (const missionNumber of INFILTRATE_JOBS) {
      const label = `contract ${missionNumber}`;

      expect(missionFileItem(missionNumber).noun, label).toBe('firmware image');
      expect(missionFileName(missionNumber), label).toMatch(
        /^[a-z0-9]+(-[a-z0-9]+)*-fw-[\d.]+\.bin$/,
      );
      expect(directoryOf(missionFilePath(missionNumber)), label).toMatch(
        /^\/(opt\/firmware|srv\/releases)$/,
      );
    }
  });
});

describe("the client's own file on an infiltrate job", () => {
  /** A firmware image's header: its version and its device, before the noise. */
  const headerOf = (content: string): string | undefined =>
    /^FWIMG v[\d.]+ [a-z0-9-]+/.exec(content)?.[0];

  // The company's image and the client's look alike from outside: the same name in the same
  // place, opening on the same header, so only their bytes tell them apart.
  it("opens on the company's image's header and is never the company's image", () => {
    for (const missionNumber of INFILTRATE_JOBS.slice(0, 60)) {
      const theirs = missionFileContent(missionNumber, SECRET);
      const ours = missionPlantContent(missionNumber, SECRET);
      const label = `contract ${missionNumber}`;

      expect(headerOf(ours), label).toBeDefined();
      expect(headerOf(ours), label).toBe(headerOf(theirs));
      expect(ours, label).not.toBe(theirs);
    }
  });

  it('is the same file for the same number under the same secret, and another under another', () => {
    const [missionNumber] = INFILTRATE_JOBS;
    if (missionNumber === undefined) throw new Error('no infiltrate job in the spread');

    expect(missionPlantContent(missionNumber, SECRET)).toBe(
      missionPlantContent(missionNumber, SECRET),
    );
    expect(missionPlantContent(missionNumber, 'another-secret')).not.toBe(
      missionPlantContent(missionNumber, SECRET),
    );
  });

  // A file kept from one job must not complete another, even one whose file goes under the
  // same name: each contract's client sends a file of its own.
  it('is a different file on two contracts whose files share a name', () => {
    const firstByName = new Map<string, number>();
    const sameName = INFILTRATE_JOBS.flatMap((missionNumber) => {
      const name = missionFileName(missionNumber);
      const earlier = firstByName.get(name);
      if (earlier === undefined) firstByName.set(name, missionNumber);
      return earlier === undefined ? [] : [[earlier, missionNumber] as const];
    });

    expect(sameName.length).toBeGreaterThan(0);
    for (const [earlier, later] of sameName) {
      expect(missionPlantContent(later, SECRET), `contracts ${earlier} and ${later}`).not.toBe(
        missionPlantContent(earlier, SECRET),
      );
    }
  });

  // It reaches the contractor as the briefing's attachment, at most 8,000 characters, and goes
  // on through `mail save` and `scp`, which carry these characters unchanged.
  it('fits in one mail, made of characters a copy carries unchanged', () => {
    for (const missionNumber of INFILTRATE_JOBS.slice(0, 60)) {
      const content = missionPlantContent(missionNumber, SECRET);
      const label = `contract ${missionNumber}`;

      expect(content.length, label).toBeLessThanOrEqual(8000);
      expect(content, label).toMatch(/^[ -~\u00a1-\u00ac\u00ae-\u00ff]+$/);
    }
  });
});

describe('the item a file job asks for', () => {
  it('is one of six, each asked for about a sixth of the time', () => {
    const counts = ITEM_NOUNS.map((noun) => jobsFor(noun).length);

    expect(new Set(FILE_JOBS.map((missionNumber) => missionFileItem(missionNumber).noun))).toEqual(
      new Set(ITEM_NOUNS),
    );
    for (const count of counts) {
      expect(count / FILE_JOBS.length).toBeGreaterThan(0.13);
      expect(count / FILE_JOBS.length).toBeLessThan(0.2);
    }
  });

  it('is kept by the people who would keep it', () => {
    const keepersOf = (noun: string) => missionFileItem(jobsFor(noun)[0]!).keepers;

    expect(ITEM_NOUNS.map(keepersOf)).toEqual([
      'designers',
      'surveyors',
      'lawyers',
      'engineers',
      'salespeople',
      'admins',
    ]);
  });

  it('carries four reasons of its own for wanting it, shared with no other item', () => {
    const pitchesOf = (noun: string) => missionFileItem(jobsFor(noun)[0]!).pitches;
    const every = ITEM_NOUNS.flatMap(pitchesOf);

    for (const noun of ITEM_NOUNS) expect(pitchesOf(noun), noun).toHaveLength(4);
    expect(new Set(every).size).toBe(24);
    for (const pitch of every) expect(pitch).toMatch(/^[A-Z].{20,}\.$/);
  });

  it('sits in its own name, and never in a home directory a user could empty', () => {
    for (const missionNumber of FILE_JOBS) {
      const path = missionFilePath(missionNumber);

      expect(path.endsWith(`/${missionFileName(missionNumber)}`)).toBe(true);
      expect(path.startsWith('/home/'), path).toBe(false);
    }
  });

  it('is the same file for the same number under the same secret', () => {
    for (const noun of ITEM_NOUNS) {
      const missionNumber = jobsFor(noun)[0]!;
      expect(missionFileContent(missionNumber, SECRET)).toBe(
        missionFileContent(missionNumber, SECRET),
      );
    }
  });

  // Nobody can make the file from the bundle: without the secret it cannot be drawn.
  it('is another file under another secret', () => {
    for (const noun of ITEM_NOUNS) {
      const missionNumber = jobsFor(noun)[0]!;
      expect(missionFileContent(missionNumber, 'another-secret'), noun).not.toBe(
        missionFileContent(missionNumber, SECRET),
      );
    }
  });

  // A copy goes through a signed write and a TEXT column, which refuse NUL and would cost
  // control characters six times their size; a soft hyphen reads as nothing. An attachment is
  // at most 8,000 characters.
  it('fits in one mail, made of characters a copy carries unchanged', () => {
    for (const noun of ITEM_NOUNS) {
      for (const missionNumber of someJobsFor(noun)) {
        const content = missionFileContent(missionNumber, SECRET);
        const label = `${noun} ${missionNumber}`;

        expect(content.length, label).toBeLessThanOrEqual(8000);
        expect(content, label).toMatch(/^[\n -~\u00a1-\u00ac\u00ae-\u00ff]+$/);
        // Only a pdf breaks into lines.
        expect(content.includes('\n'), label).toBe(noun === 'signed contract');
      }
    }
  });
});

/** The items that are a readable header and then noise, with the header each one's
 *  number gives. */
const HEADERED: readonly (readonly [string, (missionNumber: number) => string])[] = [
  [
    'firmware image',
    (missionNumber) => {
      const [device, , version] = missionFileName(missionNumber)
        .replace(/\.bin$/, '')
        .split('-');
      return `FWIMG v${version} ${device}`;
    },
  ],
  ['customer export', () => 'CUSTDB01'],
  ['key ring', () => 'KEYRING v2'],
];

describe.each(HEADERED)('a %s', (noun, headerOf) => {
  it('opens with its header, the one run `strings` finds', () => {
    for (const missionNumber of someJobsFor(noun)) {
      expect(readableRuns(missionFileContent(missionNumber, SECRET))).toEqual([
        headerOf(missionNumber),
      ]);
    }
  });

  it('runs 1,000 to 3,000 characters of noise past its header, varying from job to job', () => {
    const lengths = jobsFor(noun).map((missionNumber) => {
      const content = missionFileContent(missionNumber, SECRET);
      return content.length - headerOf(missionNumber).length;
    });

    for (const length of lengths) {
      expect(length).toBeGreaterThanOrEqual(1000);
      expect(length).toBeLessThanOrEqual(3000);
    }
    expect(Math.min(...lengths)).toBeLessThan(1200);
    expect(Math.max(...lengths)).toBeGreaterThan(2800);
  });

  it('draws its noise from the whole of Latin-1 above `strings`, from ¡ up to ÿ', () => {
    const drawn = new Set(
      someJobsFor(noun)
        .slice(0, 20)
        .flatMap((missionNumber) => [
          ...missionFileContent(missionNumber, SECRET).slice(headerOf(missionNumber).length),
        ]),
    );

    expect(drawn.size).toBe(0xff - 0xa1);
    expect(drawn.has('¡')).toBe(true);
    expect(drawn.has('ÿ')).toBe(true);
  });
});

describe('a firmware image', () => {
  it('is named for a device and a version, as a firmware build is', () => {
    const names = jobsFor('firmware image').map(missionFileName);

    for (const name of names) expect(name).toMatch(/^[a-z]{3}-fw-\d\.\d\.\d{1,2}\.bin$/);
    expect(new Set(names.map((name) => name.slice(0, 3)))).toEqual(
      new Set(['ctl', 'plc', 'rtu', 'hmi', 'cam']),
    );
  });

  it('sits in /opt/firmware or /srv/releases', () => {
    expect(new Set(jobsFor('firmware image').map(missionFilePath).map(directoryOf))).toEqual(
      new Set(['/opt/firmware', '/srv/releases']),
    );
  });

  // The other items came after it; a job that still asks for one is the job it was.
  it('keeps the name, place and bytes it had before there were other items', () => {
    const pinned = [
      [
        66060,
        '/srv/releases/hmi-fw-3.3.14.bin',
        '4bd901c9240e741586ff14f1455c45e8739e0a2b0589286377f368daca6ff862',
      ],
      [
        66076,
        '/opt/firmware/ctl-fw-2.1.12.bin',
        'e41eb1aa7556cb1244e888baeef71d219111d16b1d3251bda977776372abaff4',
      ],
    ] as const;

    for (const [missionNumber, path, digest] of pinned) {
      const content = missionFileContent(missionNumber, SECRET);
      expect(missionFileItem(missionNumber).noun).toBe('firmware image');
      expect(missionFilePath(missionNumber)).toBe(path);
      expect(bytesToHex(sha256(new TextEncoder().encode(content)))).toBe(digest);
    }
  });
});

describe('a customer export', () => {
  it('is named for a month the world has dated, in /var/backups or /srv/exports', () => {
    const jobs = jobsFor('customer export');

    for (const missionNumber of jobs) {
      const [, year, month] = missionFileName(missionNumber).match(
        /^customers-(\d{4})-(\d{2})\.dat$/,
      )!;
      const monthStart = Date.UTC(Number(year), Number(month) - 1, 1);
      const monthEnd = Date.UTC(Number(year), Number(month), 1);
      expect(monthStart < WORLD_EPOCH && monthEnd > WORLD_EPOCH - 300 * DAY_MS).toBe(true);
    }
    expect(new Set(jobs.map(missionFilePath).map(directoryOf))).toEqual(
      new Set(['/var/backups', '/srv/exports']),
    );
  });
});

describe('a key ring', () => {
  it("is keyring.dat, in root's vault or the company's own directory under /etc", () => {
    const jobs = jobsFor('key ring');
    const places = jobs.map((missionNumber) => {
      const directory = directoryOf(missionFilePath(missionNumber));
      expect(missionFileName(missionNumber)).toBe('keyring.dat');
      expect(['/root/.vault', `/etc/${missionTopology(missionNumber).stem}`]).toContain(directory);
      return directory === '/root/.vault' ? 'vault' : 'etc';
    });

    expect(new Set(places)).toEqual(new Set(['vault', 'etc']));
  });
});

/** The renderers a render's Exif names, as a camera's make and model. */
const RENDERERS = [
  ['Blender', 'Cycles'],
  ['Luxion', 'KeyShot'],
  ['Chaos', 'V-Ray'],
  ['Autodesk', 'VRED Pro'],
];

const EXIF_DATE = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;

const exifMoment = (date: string): number => {
  const [, year, month, day, hours, minutes, seconds] = date.match(EXIF_DATE)!;
  return Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hours),
    Number(minutes),
    Number(seconds),
  );
};

/** A person's full name, as the world's people are drawn: a first name and a surname. */
const PERSON = /^[A-Z][a-z-]+ [A-Z][A-Za-z']+$/;

describe('a prototype render', () => {
  it('is named for a project code and a stage, in /srv/design or /opt/cad/renders', () => {
    const jobs = jobsFor('prototype render');
    const names = jobs.map(missionFileName);

    for (const name of names) {
      expect(name).toMatch(/^[a-z]{2}\d-render-(final|v2|v3|approved|review)\.jpg$/);
    }
    expect(new Set(names.map((name) => name.split('-')[2]))).toEqual(
      new Set(['final.jpg', 'v2.jpg', 'v3.jpg', 'approved.jpg', 'review.jpg']),
    );
    expect(new Set(jobs.map(missionFilePath).map(directoryOf))).toEqual(
      new Set(['/srv/design', '/opt/cad/renders']),
    );
  });

  it('is a jpeg whose Exif names its renderer, when it was made and who made it', () => {
    const renderers = new Set<string>();

    for (const missionNumber of someJobsFor('prototype render')) {
      const runs = readableRuns(missionFileContent(missionNumber, SECRET));
      const [jfif, exif, make, model, date, artist, ...rest] = runs;

      expect([jfif, exif]).toEqual(['JFIF', 'Exif']);
      expect(RENDERERS).toContainEqual([make, model]);
      expect(isInWindow(exifMoment(date!)), date).toBe(true);
      expect(artist).toMatch(PERSON);
      expect(rest).toEqual([]);
      renderers.add(make!);
    }
    expect(renderers.size).toBe(RENDERERS.length);
  });
});

describe('a site photo', () => {
  const NAME = /^IMG_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})\.jpg$/;

  it('is named for the moment it was taken, in working hours, in uploads or media', () => {
    const jobs = jobsFor('site photo');

    for (const missionNumber of jobs) {
      const [, year, month, day, hours, minutes, seconds] =
        missionFileName(missionNumber).match(NAME)!;
      expect(isInWindow(Date.UTC(+year!, +month! - 1, +day!, +hours!, +minutes!, +seconds!))).toBe(
        true,
      );
      expect(Number(hours)).toBeGreaterThanOrEqual(7);
      expect(Number(hours)).toBeLessThanOrEqual(18);
    }
    const minutes = jobs.map((missionNumber) => missionFileName(missionNumber).slice(15, 17));
    expect(new Set(minutes).size).toBeGreaterThan(30);
    expect(new Set(jobs.map(missionFilePath).map(directoryOf))).toEqual(
      new Set(['/var/lib/uploads', '/srv/media/photos']),
    );
  });

  it('is a jpeg whose Exif names a camera and the moment its name gives, and nobody', () => {
    for (const missionNumber of someJobsFor('site photo')) {
      const [, year, month, day, hours, minutes, seconds] =
        missionFileName(missionNumber).match(NAME)!;
      const runs = readableRuns(missionFileContent(missionNumber, SECRET));
      const [jfif, exif, make, model, ...rest] = runs;

      expect([jfif, exif]).toEqual(['JFIF', 'Exif']);
      expect(CAMERAS).toContainEqual({ make, model });
      expect(rest).toEqual([`${year}:${month}:${day} ${hours}:${minutes}:${seconds}`]);
    }
  });
});

describe('a signed contract', () => {
  const PROJECTS = [
    'harbour',
    'northgate',
    'riverside',
    'eastfield',
    'millbank',
    'westpier',
    'oakridge',
    'kingsway',
  ];
  const DEALS = ['bid', 'lease', 'merger', 'supply', 'nda'];
  const NAME = new RegExp(`^(${PROJECTS.join('|')})-(${DEALS.join('|')})-signed\\.pdf$`);

  const capitalised = (word: string): string => `${word[0]!.toUpperCase()}${word.slice(1)}`;

  /** A PDF date, `D:YYYYMMDDHHmmSSZ`, as a moment. */
  const pdfMoment = (date: string): number => {
    const [, year, month, day, hours, minutes, seconds] = date.match(
      /^D:(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/,
    )!;
    return Date.UTC(+year!, +month! - 1, +day!, +hours!, +minutes!, +seconds!);
  };

  it('is named for a project and a deal, in /srv/legal or /var/archive/contracts', () => {
    const jobs = jobsFor('signed contract');
    const parts = jobs.map((missionNumber) => missionFileName(missionNumber).match(NAME)!);

    expect(new Set(parts.map(([, project]) => project))).toEqual(new Set(PROJECTS));
    expect(new Set(parts.map(([, , deal]) => deal))).toEqual(new Set(DEALS));
    expect(new Set(jobs.map(missionFilePath).map(directoryOf))).toEqual(
      new Set(['/srv/legal', '/var/archive/contracts']),
    );
  });

  it('is a pdf whose Info gives its title, who wrote it and when, its stream noise alone', () => {
    for (const missionNumber of someJobsFor('signed contract')) {
      const [, project, deal] = missionFileName(missionNumber).match(NAME)!;
      const title = `${capitalised(project!)} ${deal === 'nda' ? 'NDA' : capitalised(deal!)} (signed)`;
      const content = missionFileContent(missionNumber, SECRET);
      const info = readableRuns(content).find((run) => run.includes('/Title'));
      const [, author, created, modified] = info!.match(
        /\/Author \((.+?)\) .*\/CreationDate \((.+?)\) \/ModDate \((.+?)\)/,
      )!;
      const stream = content.slice(
        content.indexOf('stream\n') + 'stream\n'.length,
        content.indexOf('\nendstream'),
      );

      expect(content.startsWith('%PDF-1.7\n')).toBe(true);
      expect(info).toContain(`/Title (${title}) /Author (`);
      expect(author).toMatch(PERSON);
      expect(isInWindow(pdfMoment(created!)), created).toBe(true);
      expect(pdfMoment(modified!)).toBeGreaterThanOrEqual(pdfMoment(created!));
      expect(pdfMoment(modified!)).toBeLessThan(WORLD_EPOCH);
      expect(stream).toMatch(/^[\u00a1-\u00ac\u00ae-\u00ff]+$/);
    }
  });

  it('was last saved within four hours of being made, the afternoon it was signed', () => {
    const gaps = jobsFor('signed contract').map((missionNumber) => {
      const info = readableRuns(missionFileContent(missionNumber, SECRET)).find((run) =>
        run.includes('/Title'),
      );
      const [, created, modified] = info!.match(/\/CreationDate \((.+?)\) \/ModDate \((.+?)\)/)!;
      return pdfMoment(modified!) - pdfMoment(created!);
    });

    for (const gap of gaps) expect(gap).toBeLessThanOrEqual(4 * 3_600_000);
    expect(Math.max(...gaps)).toBeGreaterThan(3 * 3_600_000);
  });
});
