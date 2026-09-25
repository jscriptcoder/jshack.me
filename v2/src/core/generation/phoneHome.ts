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
/** A day's photos start some time between breakfast and the evening, and follow one
 *  another seconds to minutes apart — a burst, never two in the same second. */
const BURST_START_SECONDS = { min: 8 * 3600, max: 20 * 3600 } as const;
const BURST_GAP_SECONDS = { min: 3, max: 300 } as const;

/** The folders an Android device's shared storage always has, empty until something is
 *  saved to them. */
const ANDROID_EMPTY_FOLDERS: readonly string[] = ['Documents', 'Download', 'Movies', 'Music', 'Pictures'];

const pad = (value: number): string => String(value).padStart(2, '0');

/** `IMG_20250901_070309.jpg`: the name Android's camera gives the photo it took at that
 *  moment, in UTC like every date in the world. */
const androidPhotoName = (takenAt: number): string => {
  const moment = new Date(takenAt);
  const date = `${moment.getUTCFullYear()}${pad(moment.getUTCMonth() + 1)}${pad(moment.getUTCDate())}`;
  const time = `${pad(moment.getUTCHours())}${pad(moment.getUTCMinutes())}${pad(moment.getUTCSeconds())}`;
  return `IMG_${date}_${time}.jpg`;
};

/** How many of the photos fell on each shooting day: every day at least one, the rest
 *  wherever they fell. */
const photosPerDay = (prng: Prng, photoCount: number): readonly number[] => {
  const dayCount = prng.nextInt(PHOTO_DAYS.min, Math.min(PHOTO_DAYS.max, photoCount));
  return Array.from({ length: photoCount - dayCount }).reduce<readonly number[]>(
    (counts) => {
      const day = prng.nextInt(0, dayCount - 1);
      return counts.map((count, index) => (index === day ? count + 1 : count));
    },
    Array.from({ length: dayCount }, () => 1),
  );
};

/** The moment, in milliseconds, each photo was taken: a burst on each of a few distinct
 *  days before the epoch. */
const photoMoments = (prng: Prng): readonly number[] => {
  const counts = photosPerDay(prng, prng.nextInt(PHOTO_COUNT.min, PHOTO_COUNT.max));
  const daysAgo = prng.pickN(
    Array.from({ length: DAYS_BACK }, (_, index) => index + 1),
    counts.length,
  );
  return counts.flatMap((count, index) => {
    const dayStart = EPOCH_SECONDS - (daysAgo[index] ?? 1) * DAY_SECONDS;
    const firstSecond = dayStart + prng.nextInt(BURST_START_SECONDS.min, BURST_START_SECONDS.max);
    return Array.from({ length: count }).reduce<readonly number[]>(
      (seconds) => [
        ...seconds,
        (seconds.at(-1) ?? firstSecond) +
          (seconds.length === 0 ? 0 : prng.nextInt(BURST_GAP_SECONDS.min, BURST_GAP_SECONDS.max)),
      ],
      [],
    ).map((second) => second * 1000);
  });
};

export const buildPhoneHome = (options: {
  readonly essid: string;
  readonly host: LanHost;
  readonly username: string;
  readonly device: Device;
}): Directory => {
  const { essid, host, username, device } = options;
  const prng = createPrng(`phone-content-${essid}-${host.ip}`);

  const photos: Record<string, FileNode> = Object.fromEntries(
    photoMoments(prng).map((takenAt) => [
      androidPhotoName(takenAt),
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
      DCIM: dir({ Camera: dir(photos, HOME_DIR, username) }, HOME_DIR, username),
      ...Object.fromEntries(
        ANDROID_EMPTY_FOLDERS.map((folder) => [folder, dir({}, HOME_DIR, username)]),
      ),
    },
    HOME_DIR,
    username,
  );
};
