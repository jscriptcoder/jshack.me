import { describe, expect, it } from 'vitest';
import { buildRemoteHostFs, npcUsername } from './remoteHostFs';
import { phoneModel } from './share';
import {
  PERSONAL_DOWNLOADS,
  PHONE_NOTES,
  PLACE_DOWNLOADS,
  TABLET_MODELS,
} from './pools/phoneFiles';
import { ALL_GENERATED_PASSWORDS } from './passwordPools';
import { createPatchApi } from '../../adapters/patchApi';
import { generateIdentity } from '../identity/identity';
import { computeWorkstationId } from '../identity/workstation';
import { signedEnvelopeSchema } from '../signedRequest/types';
import { peopleOn } from './networkMail';
import { networkPersona } from './persona';
import { WORLD_EPOCH } from '../cve/worldClock';
import { createFsView } from '../filesystem/fsView';
import { asAbsPath, asMachineId } from '../types';
import type { Directory } from '../filesystem/types';
import { filesUnder, lanBoxes, serialise, softwareVersionsIn } from '../../test/worldContent';
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

  it('was saved again, if at all, within two days of being made', async () => {
    let savedAgain = 0;
    for (const box of devices()) {
      for (const download of await readDownloads(box)) {
        const edited = download.modifiedAt - download.createdAt;
        expect(edited, `${box.host.hostname} ${download.name}`).toBeLessThanOrEqual(2 * DAY_MS);
        savedAgain += edited > 0 ? 1 : 0;
      }
    }
    expect(savedAgain).toBeGreaterThan(0);
  });

  it('was made on days spread across those two years, not all at once', async () => {
    const made: number[] = [];
    for (const box of devices()) {
      for (const download of await readDownloads(box)) made.push(download.createdAt);
    }
    expect(Math.max(...made) - Math.min(...made)).toBeGreaterThan(365 * DAY_MS);
  });

  it('credits what a person fetched to whoever issued it', async () => {
    for (const box of devices().filter((device) => device.layer === 'deep')) {
      for (const download of await readDownloads(box)) {
        expect(ISSUERS.has(download.author), `${box.host.hostname} ${download.name}`).toBe(true);
        expect(download.title, `${box.host.hostname} ${download.name}: no title`).not.toBe('');
        expect(download.author, `${box.host.hostname} ${download.name}: no author`).not.toBe('');
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
      downloads.forEach(({ title, author, name }) => {
        expect(name, box.host.hostname).toMatch(/^[\w.-]+\.pdf$/);
        expect(title, `${box.host.hostname} ${name}: no title`).not.toBe('');
        expect(author, `${box.host.hostname} ${name}: no author`).not.toBe('');
      });
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

/** What a player can read in a file: a note as it is, a photo or a PDF as `strings`
 *  shows it, past the format's own header line. */
const writtenIn = async (path: string, content: string): Promise<string> =>
  path.endsWith('.txt') ? content : (await readableLinesOf(content)).slice(1).join('\n');

/** A pool file name as a pattern, its `{ref}` whatever reference was stamped in. */
const namePattern = (template: string): RegExp =>
  new RegExp(`^${template.replaceAll('.', '\\.').replace('{ref}', '\\d{5}')}$`);

describe('a device keeps to the world’s rules', () => {
  it('states no version and leaves no slot unfilled', async () => {
    for (const box of devices()) {
      for (const [path, content] of filesUnder(homeOf(box))) {
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

  it('carries no word a player could try as a password', async () => {
    const pool = new Set(ALL_GENERATED_PASSWORDS.map((password) => password.toLowerCase()));
    for (const box of devices()) {
      for (const [path, content] of filesUnder(homeOf(box))) {
        const words = (await writtenIn(path, content)).toLowerCase().match(/[a-z0-9]+/g) ?? [];
        expect(`${path}: ${words.filter((word) => pool.has(word)).join(',')}`).toBe(`${path}: `);
      }
    }
  });

  it('can be given every tablet, download, paper and note its pools hold', async () => {
    const everywhere = [...devices(), ...syntheticLanBoxes(['android', 'iphone', 'tablet'])];
    const names = everywhere.flatMap((box) => [...filesUnder(homeOf(box)).keys()]);
    const drawn = (template: string): boolean =>
      names.some((path) => namePattern(template).test(path.slice(path.lastIndexOf('/') + 1)));

    PERSONAL_DOWNLOADS.forEach(({ name }) => expect(drawn(name), name).toBe(true));
    Object.values(PLACE_DOWNLOADS)
      .flat()
      .forEach(({ name }) => expect(drawn(name), name).toBe(true));
    PHONE_NOTES.forEach(({ file }) => expect(drawn(file), file).toBe(true));

    const models = new Set<string>();
    for (const box of everywhere.filter(({ host }) => host.hostname.startsWith('tablet-'))) {
      const [firstPhoto] = cameraRollOf(box).values();
      const [, , make = '', model = ''] = await readableLinesOf(firstPhoto ?? '');
      models.add(`${make} ${model}`);
    }
    expect(models).toEqual(new Set(TABLET_MODELS.map(({ make, model }) => `${make} ${model}`)));
  });

  it('keeps a home no other device keeps, on one network or across the world', () => {
    // Only machines a network really placed: the synthetic deep boxes reuse one address
    // for every kind, which no network does.
    const placed = [
      ...worldBoxesNamed(['android', 'iphone', 'tablet']),
      ...syntheticLanBoxes(['android', 'iphone', 'tablet']),
    ];
    const homes = placed.map((box) => [...filesUnder(homeOf(box)).keys()].sort().join('|'));
    expect(new Set(homes).size).toBe(homes.length);
  });
});

describe('what a player can carry home from a device', () => {
  it('fits every file into the one signed write that saves it on the player box', async () => {
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
    const hardest = devices()
      .flatMap((box) => [...filesUnder(homeOf(box))])
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

describe('a device holds as much as its kind does', () => {
  it('keeps ten to twenty-five files in all, and a full device types no note past that', () => {
    const counts = [...devices(), ...syntheticLanBoxes(['android', 'iphone', 'tablet'])].map(
      (box) => {
        const count = filesUnder(homeOf(box)).size;
        expect(count, box.host.hostname).toBeGreaterThanOrEqual(10);
        expect(count, box.host.hostname).toBeLessThanOrEqual(25);
        return count;
      },
    );
    // Both edges are reached, so the notes really are what holds a device inside them.
    expect(counts).toContain(10);
    expect(counts).toContain(25);
  });

  it('types fewer notes on a device its photos and papers have nearly filled', () => {
    // A device with the most photos and papers a draw allows is a rare one, so it is
    // looked for across many more home LANs than the other tests read.
    const essids = Array.from({ length: 1500 }, (_, index) => `HOME-NET-${index}`);
    const nearlyFull = lanBoxes(essids)
      .filter(({ host }) => /^(android|iphone|tablet)-/.test(host.hostname))
      .map((box) => filesUnder(homeOf({ ...box, tree: buildRemoteHostFs(box.essid, box.host), layer: 'lan' })))
      .filter((files) => [...files.keys()].filter((path) => !path.startsWith('Documents/')).length >= 23);
    expect(nearlyFull.length).toBeGreaterThan(0);
    nearlyFull.forEach((files) => {
      expect(files.size).toBeLessThanOrEqual(25);
    });
  });
});
