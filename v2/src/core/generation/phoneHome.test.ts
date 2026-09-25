import { describe, expect, it } from 'vitest';
import { npcUsername } from './remoteHostFs';
import { phoneModel } from './share';
import { WORLD_EPOCH } from '../cve/worldClock';
import { createFsView } from '../filesystem/fsView';
import { asAbsPath } from '../types';
import type { Directory } from '../filesystem/types';
import { filesUnder, serialise } from '../../test/worldContent';
import {
  readableLinesOf,
  syntheticBoxes,
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

describe('an NPC phone reads as a phone', () => {
  it('holds six to sixteen photos', () => {
    phones().forEach((box) => {
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
    for (const box of phones()) {
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
    phones().forEach((box) => {
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
    const first = worldBoxesNamed(['android', 'iphone']);
    const again = worldBoxesNamed(['android', 'iphone']);
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
      expect([...homeOf(box).entries.keys()].sort(), box.host.hostname).toEqual([
        'DCIM',
        'Documents',
        'Download',
        'Movies',
        'Music',
        'Pictures',
      ]);
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
      expect([...homeOf(box).entries.keys()].sort(), box.host.hostname).toEqual([
        'DCIM',
        'Documents',
        'Downloads',
      ]);
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
