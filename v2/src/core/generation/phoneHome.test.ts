import { describe, expect, it } from 'vitest';
import { npcUsername } from './remoteHostFs';
import { phoneModel } from './share';
import { PERSONAL_DOWNLOADS, PLACE_DOWNLOADS, TABLET_MODELS } from './pools/phoneFiles';
import { peopleOn } from './networkMail';
import { networkPersona } from './persona';
import { WORLD_EPOCH } from '../cve/worldClock';
import { createFsView } from '../filesystem/fsView';
import { asAbsPath } from '../types';
import type { Directory } from '../filesystem/types';
import { filesUnder, serialise } from '../../test/worldContent';
import {
  readableLinesOf,
  syntheticBoxes,
  syntheticLanBoxes,
  worldBoxesNamed,
  type BuiltBox,
} from '../../test/deviceBoxes';

/**
 * A phone is not somebody's Linux account: what its person left on it is what a phone
 * keeps — the photos it took and the folders its storage always has — and nothing a
 * shell wrote. Read the way a player reads it, through the box's own tree.
 */

const DAY_MS = 86_400_000;
const TWO_YEARS_MS = 730 * DAY_MS;

const boxesNamed = (prefix: string): readonly BuiltBox[] => [
  ...worldBoxesNamed([prefix]),
  ...syntheticBoxes(prefix),
];
const androids = (): readonly BuiltBox[] => boxesNamed('android');
const iphones = (): readonly BuiltBox[] => boxesNamed('iphone');
const phones = (): readonly BuiltBox[] => [...androids(), ...iphones()];
const tablets = (): readonly BuiltBox[] => boxesNamed('tablet');
const devices = (): readonly BuiltBox[] => [...phones(), ...tablets()];

/** The top of each maker's storage, as `ls ~` lists it, and the camera app's folder. */
const ANDROID_HOME = ['DCIM', 'Documents', 'Download', 'Movies', 'Music', 'Pictures'];
const APPLE_HOME = ['DCIM', 'Documents', 'Downloads'];

const homeOf = (box: BuiltBox): Directory => {
  const home = box.tree.entries.get('home');
  const own =
    home?.kind === 'directory' ? home.entries.get(npcUsername(box.essid, box.host)) : undefined;
  if (own?.kind !== 'directory') throw new Error(`${box.host.hostname}: no home`);
  return own;
};

const entriesOf = (directory: Directory, folder: string): readonly string[] => {
  const node = directory.entries.get(folder);
  return node?.kind === 'directory' ? [...node.entries.keys()] : [];
};

const dotfilesIn = (box: BuiltBox): readonly string[] =>
  [...filesUnder(homeOf(box)).keys()].filter((path) =>
    path.split('/').some((part) => part.startsWith('.')),
  );

/** Every photo under `DCIM/`, keyed by its file name, whichever folder the camera app
 *  keeps them in. */
const cameraRollOf = (box: BuiltBox): ReadonlyMap<string, string> =>
  new Map(
    [...filesUnder(homeOf(box))]
      .filter(([path]) => path.startsWith('DCIM/'))
      .map(([path, content]) => [path.slice(path.lastIndexOf('/') + 1), content]),
  );

/** When each photo was taken, as its Exif says, keyed by its file name. */
const momentsOf = async (box: BuiltBox): Promise<ReadonlyMap<string, string>> => {
  const entries: (readonly [string, string])[] = [];
  for (const [name, content] of cameraRollOf(box)) {
    const [, , , , moment = ''] = await readableLinesOf(content);
    entries.push([name, moment]);
  }
  return new Map(entries);
};

/** `IMG_20250901_070309.jpg` → `2025:09:01 07:03:09`, the way Exif writes the moment. */
const exifMomentOfName = (name: string): string =>
  name.replace(
    /^IMG_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})\.jpg$/,
    '$1:$2:$3 $4:$5:$6',
  );

/** `2025:09:01 07:03:09` → its instant, read as UTC like every date in the world. */
const instantOf = (exifMoment: string): number => {
  const [date = '', time = ''] = exifMoment.split(' ');
  return Date.parse(`${date.replaceAll(':', '-')}T${time}Z`);
};

describe('an NPC phone or tablet reads as the device it is', () => {
  it('holds six to sixteen photos', () => {
    devices().forEach((box) => {
      const roll = cameraRollOf(box);
      expect(roll.size, box.host.hostname).toBeGreaterThanOrEqual(6);
      expect(roll.size, box.host.hostname).toBeLessThanOrEqual(16);
    });
  });

  it('took every photo itself: its own make and model, and nobody signed it', async () => {
    for (const box of phones()) {
      const model = phoneModel(box.essid, box.host);
      if (model === undefined) throw new Error(`${box.host.hostname} has no model`);
      for (const [name, content] of cameraRollOf(box)) {
        const lines = await readableLinesOf(content);
        expect(lines.slice(0, 4), `${box.host.hostname} ${name}`).toEqual([
          'JFIF',
          'Exif',
          model.make,
          model.model,
        ]);
        expect(lines, `${box.host.hostname} ${name}: an artist line`).toHaveLength(5);
      }
    }
  });

  it('took its photos in bursts on four to ten days, within the two years before the epoch', async () => {
    for (const box of devices()) {
      const instants = [...(await momentsOf(box)).values()].map(instantOf);
      instants.forEach((instant) => {
        expect(instant, box.host.hostname).toBeLessThan(WORLD_EPOCH);
        expect(instant, box.host.hostname).toBeGreaterThanOrEqual(WORLD_EPOCH - TWO_YEARS_MS);
      });
      const days = new Set(instants.map((instant) => Math.floor(instant / DAY_MS)));
      expect(days.size, box.host.hostname).toBeGreaterThanOrEqual(4);
      expect(days.size, box.host.hostname).toBeLessThanOrEqual(10);
    }
  });

  it("is its person's to read and write, and shows a guest none of it", () => {
    devices().forEach((box) => {
      const username = npcUsername(box.essid, box.host);
      const user = createFsView(box.tree, { userType: 'user' });
      const guest = createFsView(box.tree, { userType: 'guest' });
      [...filesUnder(homeOf(box)).keys()].forEach((path) => {
        const absolute = asAbsPath(`/home/${username}/${path}`);
        expect(user.read(absolute).ok, `${box.host.hostname} ${path}`).toBe(true);
        expect(user.canWrite(absolute).allowed, `${box.host.hostname} ${path}`).toBe(true);
        expect(guest.read(absolute).ok, `${box.host.hostname} ${path}`).toBe(false);
      });
      expect(guest.list(asAbsPath(`/home/${username}`)).ok).toBe(false);
    });
  });

  it('is built the same way every time it is read', () => {
    const first = worldBoxesNamed(['android', 'iphone', 'tablet']);
    const again = worldBoxesNamed(['android', 'iphone', 'tablet']);
    expect(first.length).toBeGreaterThan(0);
    first.forEach((box, index) => {
      const twin = again[index];
      if (twin === undefined) throw new Error('the world changed between two reads');
      expect(serialise(homeOf(twin)), box.host.hostname).toEqual(serialise(homeOf(box)));
    });
  });
});

describe('an android keeps what Android keeps', () => {
  it("keeps the camera roll and a phone's storage folders, and nothing a shell wrote", () => {
    androids().forEach((box) => {
      expect([...homeOf(box).entries.keys()].sort(), box.host.hostname).toEqual(ANDROID_HOME);
      expect(entriesOf(homeOf(box), 'DCIM'), box.host.hostname).toEqual(['Camera']);
      expect(dotfilesIn(box)).toEqual([]);
    });
  });

  it('names every photo for the second it was taken', async () => {
    for (const box of androids()) {
      for (const [name, moment] of await momentsOf(box)) {
        expect(name, box.host.hostname).toMatch(/^IMG_\d{8}_\d{6}\.jpg$/);
        expect(moment, `${box.host.hostname} ${name}`).toBe(exifMomentOfName(name));
      }
    }
  });
});

describe('an iPhone keeps what an iPhone keeps', () => {
  it("keeps the camera roll, the Files app's downloads and documents, and nothing a shell wrote", () => {
    iphones().forEach((box) => {
      expect([...homeOf(box).entries.keys()].sort(), box.host.hostname).toEqual(APPLE_HOME);
      expect(entriesOf(homeOf(box), 'DCIM'), box.host.hostname).toEqual(['100APPLE']);
      expect(dotfilesIn(box)).toEqual([]);
    });
  });

  it('numbers its photos on one running counter, in the order they were taken', async () => {
    for (const box of iphones()) {
      const byMoment = [...(await momentsOf(box))].sort(([, left], [, right]) =>
        left.localeCompare(right),
      );
      byMoment.forEach(([name]) => {
        expect(name, box.host.hostname).toMatch(/^IMG_\d{4}\.JPG$/);
      });
      const numbers = byMoment.map(([name]) => Number(name.slice(4, 8)));
      numbers.slice(1).forEach((number, index) => {
        expect(number, `${box.host.hostname} after IMG_${numbers[index]}`).toBeGreaterThan(
          numbers[index] ?? Infinity,
        );
      });
    }
  });
});

describe('a tablet is a tablet', () => {
  it('is one model for its whole life, drawn from the tablets a household buys', async () => {
    const known = new Set(TABLET_MODELS.map(({ make, model }) => `${make} ${model}`));
    for (const box of tablets()) {
      const stamped = new Set<string>();
      for (const content of cameraRollOf(box).values()) {
        const [, , make = '', model = ''] = await readableLinesOf(content);
        stamped.add(`${make} ${model}`);
      }
      expect(stamped.size, box.host.hostname).toBe(1);
      [...stamped].forEach((device) => {
        expect(known.has(device), `${box.host.hostname}: ${device}`).toBe(true);
      });
    }
  });

  it("keeps its maker's storage: an iPad an iPhone's, every other tablet an android's", async () => {
    const makers = new Set<string>();
    for (const box of tablets()) {
      const [firstPhoto] = cameraRollOf(box).values();
      const [, , make = ''] = await readableLinesOf(firstPhoto ?? '');
      makers.add(make === 'Apple' ? 'Apple' : 'other');
      const expected = make === 'Apple' ? APPLE_HOME : ANDROID_HOME;
      expect([...homeOf(box).entries.keys()].sort(), `${box.host.hostname} (${make})`).toEqual(
        expected,
      );
      expect(entriesOf(homeOf(box), 'DCIM'), box.host.hostname).toEqual([
        make === 'Apple' ? '100APPLE' : 'Camera',
      ]);
    }
    expect(makers).toEqual(new Set(['Apple', 'other']));
  });

  it("is no phone to the boxes that already name the network's phones", () => {
    tablets().forEach((box) => {
      expect(phoneModel(box.essid, box.host), box.host.hostname).toBeUndefined();
    });
  });
});

/** An entry of a PDF's Info dictionary, as `strings` shows it. */
const pdfEntry = (lines: readonly string[], key: string): string | undefined =>
  lines.join('\n').match(new RegExp(`/${key} \\(([^)]*)\\)`))?.[1];

/** `D:20250901070309Z` → its instant. */
const pdfInstant = (pdfDate: string): number =>
  Date.parse(
    pdfDate.replace(
      /^D:(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/,
      '$1-$2-$3T$4:$5:$6Z',
    ),
  );

/** Every file in the device's download folder, whichever its maker calls it. */
const downloadsOf = (box: BuiltBox): ReadonlyMap<string, string> =>
  new Map(
    [...filesUnder(homeOf(box))].filter(([path]) => /^Downloads?\//.test(path)),
  );

type Download = {
  readonly name: string;
  readonly title: string;
  readonly author: string;
  readonly createdAt: number;
  readonly modifiedAt: number;
};

const readDownloads = async (box: BuiltBox): Promise<readonly Download[]> => {
  const read: Download[] = [];
  for (const [path, content] of downloadsOf(box)) {
    const lines = await readableLinesOf(content);
    expect(lines[0], `${box.host.hostname} ${path}`).toBe('%PDF-1.7');
    read.push({
      name: path.slice(path.indexOf('/') + 1),
      title: pdfEntry(lines, 'Title') ?? '',
      author: pdfEntry(lines, 'Author') ?? '',
      createdAt: pdfInstant(pdfEntry(lines, 'CreationDate') ?? ''),
      modifiedAt: pdfInstant(pdfEntry(lines, 'ModDate') ?? ''),
    });
  }
  return read;
};

/** Devices on home LANs the catalog does not hold, for the kinds of place it has few of. */
const lanDevices = (): readonly BuiltBox[] => [
  ...devices().filter((box) => box.layer === 'lan'),
  ...syntheticLanBoxes(['android', 'iphone', 'tablet']),
];

const ISSUERS = new Set(PERSONAL_DOWNLOADS.map(({ author }) => author));

const neighbourNames = (box: BuiltBox): ReadonlySet<string> =>
  new Set(peopleOn(box.essid).map(({ fullName }) => fullName));

describe('a device keeps what its person downloaded', () => {
  it('keeps two to seven PDFs in its download folder, and nothing else', async () => {
    for (const box of devices()) {
      const downloads = await readDownloads(box);
      expect(downloads.length, box.host.hostname).toBeGreaterThanOrEqual(2);
      expect(downloads.length, box.host.hostname).toBeLessThanOrEqual(7);
      downloads.forEach(({ name }) => {
        expect(name, box.host.hostname).toMatch(/^[\w.-]+\.pdf$/);
      });
    }
  });

  it('was made within the two years before the epoch, and saved no earlier than it was made', async () => {
    for (const box of devices()) {
      for (const download of await readDownloads(box)) {
        const label = `${box.host.hostname} ${download.name}`;
        expect(download.createdAt, label).toBeGreaterThanOrEqual(WORLD_EPOCH - TWO_YEARS_MS);
        expect(download.modifiedAt, label).toBeGreaterThanOrEqual(download.createdAt);
        expect(download.modifiedAt, label).toBeLessThan(WORLD_EPOCH);
      }
    }
  });

  it('credits what a person fetched to whoever issued it', async () => {
    for (const box of devices().filter((device) => device.layer === 'deep')) {
      for (const download of await readDownloads(box)) {
        expect(ISSUERS.has(download.author), `${box.host.hostname} ${download.name}`).toBe(true);
      }
    }
  });

  it("keeps at most one of the place's own papers on a home LAN, written by somebody who lives there", async () => {
    let placePapers = 0;
    let devicesWithout = 0;
    for (const box of lanDevices()) {
      const people = neighbourNames(box);
      const category = networkPersona(box.essid).category;
      const titles = new Set(PLACE_DOWNLOADS[category].map(({ title }) => title));
      const downloads = await readDownloads(box);
      const fromNeighbours = downloads.filter(({ author }) => people.has(author));
      downloads
        .filter(({ author }) => !people.has(author))
        .forEach(({ author, name }) => {
          expect(ISSUERS.has(author), `${box.host.hostname} ${name}: ${author}`).toBe(true);
        });
      fromNeighbours.forEach(({ title, name }) => {
        expect(titles.has(title), `${box.host.hostname} ${name}: ${title} (${category})`).toBe(true);
      });
      expect(fromNeighbours.length, box.host.hostname).toBeLessThanOrEqual(1);
      placePapers += fromNeighbours.length;
      devicesWithout += fromNeighbours.length === 0 ? 1 : 0;
    }
    expect(placePapers).toBeGreaterThan(0);
    expect(devicesWithout).toBeGreaterThan(0);
  });
});

/** Every note the person typed, keyed by its file name. */
const notesOf = (box: BuiltBox): ReadonlyMap<string, string> =>
  new Map(
    [...filesUnder(homeOf(box))]
      .filter(([path]) => path.startsWith('Documents/'))
      .map(([path, content]) => [path.slice('Documents/'.length), content]),
  );

describe('a device keeps a few things its person typed', () => {
  it('keeps up to three plain-text notes in Documents, every blank filled in', () => {
    devices().forEach((box) => {
      const notes = notesOf(box);
      expect(notes.size, box.host.hostname).toBeLessThanOrEqual(3);
      notes.forEach((body, name) => {
        const label = `${box.host.hostname} ${name}`;
        expect(name, label).toMatch(/^[\w.-]+\.txt$/);
        expect(body.trim(), label).not.toBe('');
        expect(body.endsWith('\n'), label).toBe(true);
        expect(body, label).not.toMatch(/[{}]/);
      });
    });
  });

  it('writes about the place the network belongs to, somewhere in the world', () => {
    const mentions = devices().filter((box) =>
      [...notesOf(box).values()].some((body) => body.includes(networkPersona(box.essid).place)),
    );
    expect(mentions.length).toBeGreaterThan(0);
  });

  it('leaves some devices with nothing typed at all, and gives others notes', () => {
    const counts = devices().map((box) => notesOf(box).size);
    expect(counts).toContain(0);
    expect(counts.some((count) => count > 0)).toBe(true);
  });

  it('writes no password down', () => {
    devices().forEach((box) => {
      notesOf(box).forEach((body, name) => {
        expect(body, `${box.host.hostname} ${name}`).not.toMatch(/pass(word|wd|code)?\s*[:=]/i);
        expect(body, `${box.host.hostname} ${name}`).not.toMatch(/\bpin\b\s*[:=]?\s*\d/i);
      });
    });
  });
});

describe('a device holds as much as its kind does', () => {
  it('keeps ten to twenty-five files in all', () => {
    devices().forEach((box) => {
      const count = filesUnder(homeOf(box)).size;
      expect(count, box.host.hostname).toBeGreaterThanOrEqual(10);
      expect(count, box.host.hostname).toBeLessThanOrEqual(25);
    });
  });
});
