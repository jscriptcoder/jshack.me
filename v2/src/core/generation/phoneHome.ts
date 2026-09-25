/**
 * The home of the person a phone belongs to, which on a phone is the device's own
 * storage: the photos it took and the folders every phone of its kind keeps. A shell
 * never ran there, so nothing a shell writes — no dotfile, no history — is in it.
 *
 * Every photo was taken on this phone, so its Exif names the model the rest of the
 * network already credits to it (`phoneModel`), and its file name is the second it was
 * taken, the way the camera app names it. Everything is drawn from the box's own
 * `phone-content` stream, so two builds of one phone are identical and no draw of any
 * other concern moves.
 */

import type { Directory, FileNode } from '../filesystem/types';
import { WORLD_EPOCH } from '../cve/worldClock';
import { dir, file, HOME_DIR, HOME_FILE } from './baseFs';
import { renderDocument } from './documentFormats';
import type { LanHost } from './generateHomeLan';
import { createPrng, type Prng } from './prng';
import type { Device } from './share';

const DAY_SECONDS = 86_400;
const EPOCH_SECONDS = WORLD_EPOCH / 1000;

const PHOTO_COUNT = { min: 6, max: 16 } as const;
const PHOTO_DAYS = { min: 4, max: 10 } as const;
/** Two years back, the window every home in the world dates itself within. */
const DAYS_BACK = 730;
const BURST_START_SECONDS = { min: 8 * 3600, max: 20 * 3600 } as const;
const BURST_GAP_SECONDS = { min: 3, max: 300 } as const;

const pad = (value: number): string => String(value).padStart(2, '0');

/** `IMG_20250901_070309.jpg`: the name Android's camera gives the photo it took at that
 *  moment, in UTC like every date in the world. */
const androidPhotoName = (takenAt: number): string => {
  const moment = new Date(takenAt);
  const date = `${moment.getUTCFullYear()}${pad(moment.getUTCMonth() + 1)}${pad(moment.getUTCDate())}`;
  const time = `${pad(moment.getUTCHours())}${pad(moment.getUTCMinutes())}${pad(moment.getUTCSeconds())}`;
  return `IMG_${date}_${time}.jpg`;
};

/** A photo as the camera app saved it: the name it gave the file, and the moment, in
 *  milliseconds, it was taken. */
type NamedPhoto = { readonly name: string; readonly takenAt: number };

/** An iPhone numbers what it shoots on one counter that only ever goes up, so a photo
 *  deleted along the way leaves a gap: `IMG_4127.JPG`, `IMG_4129.JPG`. */
const APPLE_COUNTER_START = { min: 1, max: 7000 } as const;
const APPLE_COUNTER_STEP = { min: 1, max: 4 } as const;

const nameOnAppleCounter = (prng: Prng, takenAt: readonly number[]): readonly NamedPhoto[] =>
  takenAt.reduce<{ readonly counter: number; readonly photos: readonly NamedPhoto[] }>(
    ({ counter, photos }, moment) => ({
      counter: counter + prng.nextInt(APPLE_COUNTER_STEP.min, APPLE_COUNTER_STEP.max),
      photos: [...photos, { name: `IMG_${String(counter).padStart(4, '0')}.JPG`, takenAt: moment }],
    }),
    { counter: prng.nextInt(APPLE_COUNTER_START.min, APPLE_COUNTER_START.max), photos: [] },
  ).photos;

/** Where a maker's camera app keeps the roll, what the rest of its storage looks like
 *  before anything is saved there, and how it names what it took, oldest first. */
type Layout = {
  readonly cameraFolder: string;
  readonly folders: readonly string[];
  readonly namePhotos: (prng: Prng, takenAt: readonly number[]) => readonly NamedPhoto[];
};

const ANDROID_LAYOUT: Layout = {
  cameraFolder: 'Camera',
  folders: ['Documents', 'Download', 'Movies', 'Music', 'Pictures'],
  namePhotos: (_prng, takenAt) =>
    takenAt.map((moment) => ({ name: androidPhotoName(moment), takenAt: moment })),
};

/** What an iPhone shows over a file share: the camera roll and the Files app's own two
 *  folders. */
const APPLE_LAYOUT: Layout = {
  cameraFolder: '100APPLE',
  folders: ['Documents', 'Downloads'],
  namePhotos: nameOnAppleCounter,
};

/** A shooting day, as how many days before the epoch it fell, and how many photos were
 *  taken on it. */
type ShootingDay = { readonly daysAgo: number; readonly photoCount: number };

/** A few distinct days, every one with at least one photo and the rest wherever they
 *  fell. */
const shootingDays = (prng: Prng, photoCount: number): readonly ShootingDay[] => {
  const dayCount = prng.nextInt(PHOTO_DAYS.min, Math.min(PHOTO_DAYS.max, photoCount));
  const days = prng
    .pickN(
      Array.from({ length: DAYS_BACK }, (_, index) => index + 1),
      dayCount,
    )
    .map((daysAgo) => ({ daysAgo, photoCount: 1 }));
  return Array.from({ length: photoCount - dayCount }).reduce<readonly ShootingDay[]>(
    (sofar) => {
      const lucky = prng.nextInt(0, dayCount - 1);
      return sofar.map((day, index) =>
        index === lucky ? { ...day, photoCount: day.photoCount + 1 } : day,
      );
    },
    days,
  );
};

/** One day's burst: the first photo some time between breakfast and the evening, each
 *  after it seconds to minutes later, so no two share a second. */
const burstOn = (prng: Prng, day: ShootingDay): readonly number[] =>
  Array.from({ length: day.photoCount }).reduce<{
    readonly second: number;
    readonly moments: readonly number[];
  }>(
    ({ second, moments }) => ({
      second: second + prng.nextInt(BURST_GAP_SECONDS.min, BURST_GAP_SECONDS.max),
      moments: [...moments, second * 1000],
    }),
    {
      second:
        EPOCH_SECONDS -
        day.daysAgo * DAY_SECONDS +
        prng.nextInt(BURST_START_SECONDS.min, BURST_START_SECONDS.max),
      moments: [],
    },
  ).moments;

/** The moment, in milliseconds, each photo was taken, oldest first. */
const photoMoments = (prng: Prng): readonly number[] =>
  shootingDays(prng, prng.nextInt(PHOTO_COUNT.min, PHOTO_COUNT.max))
    .flatMap((day) => burstOn(prng, day))
    .sort((left, right) => left - right);

export const buildPhoneHome = (options: {
  readonly essid: string;
  readonly host: LanHost;
  readonly username: string;
  readonly device: Device;
}): Directory => {
  const { essid, host, username, device } = options;
  const prng = createPrng(`phone-content-${essid}-${host.ip}`);

  const layout = device.make === 'Apple' ? APPLE_LAYOUT : ANDROID_LAYOUT;

  const photos: Record<string, FileNode> = Object.fromEntries(
    layout.namePhotos(prng, photoMoments(prng)).map(({ name, takenAt }) => [
      name,
      file(
        renderDocument(
          { format: 'jpeg', make: device.make, model: device.model, takenAt, artist: null },
          prng,
        ),
        HOME_FILE,
        username,
      ),
    ]),
  );

  return dir(
    {
      DCIM: dir({ [layout.cameraFolder]: dir(photos, HOME_DIR, username) }, HOME_DIR, username),
      ...Object.fromEntries(layout.folders.map((folder) => [folder, dir({}, HOME_DIR, username)])),
    },
    HOME_DIR,
    username,
  );
};
