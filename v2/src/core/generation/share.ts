/**
 * The share a file server keeps under `/srv`: the departments of the place it serves.
 *
 * What a share holds is the network's kind of place — a café's menus and rotas, a
 * family's paperwork and photos — and who wrote it is the network's own people, so a
 * PDF's author is somebody whose mail the network really carries. The box's name says
 * what shape it is kept in: a share box keeps the working tree, a backup box keeps
 * dated snapshots of one, each the tree as it stood that night. It is drawn on its own
 * stream, keyed by the box: a share arriving on a file server moves nothing else the
 * world already generated.
 */

import { WORLD_EPOCH } from '../cve/worldClock';
import type { Directory, FileEntry } from '../filesystem/types';
import { dir, file, SHARE_DIR, SHARE_FILE, TRAVERSABLE_DIR } from './baseFs';
import { renderDocument } from './documentFormats';
import { generateHomeLan, isOnHomeLan, type LanHost } from './generateHomeLan';
import type { MailPerson } from './networkMail';
import { networkPersona } from './persona';
import { CAMERAS, PHONE_MODELS, SHARE_FOLDERS, type ShareFileSpec } from './pools/shareFiles';
import { createPrng, type Prng } from './prng';

const DAY_SECONDS = 86_400;
const LAST_SECOND = WORLD_EPOCH / 1000 - 1;
const EPOCH_DAY = Math.floor(WORLD_EPOCH / 1000 / DAY_SECONDS);

/** How far back a share's files reach: most of a year, and never before the box could
 *  have been installed. */
const WINDOW_SECONDS = 300 * DAY_SECONDS;

/** How long a document is worked on after it is first saved. */
const EDITING_SECONDS = 30 * DAY_SECONDS;

const FOLDER_COUNT = { min: 3, max: 6 } as const;
const FILES_PER_FOLDER = { min: 3, max: 10 } as const;

/** How many files a working share holds in all. */
const WORKING_SHARE_FILES = { min: 25, max: 60 } as const;
/** How many files a backup box holds across every snapshot it keeps: a nightly copy of
 *  a whole department share would bury the box in the same files. */
const BACKUP_FILES_MAX = 80;

/** How often a photo carries the name of whoever took it. */
const SIGNED_PHOTO_CHANCE = 0.5;

/** The hostname prefixes of a file server that keeps backups; every other file server
 *  (`share-`, `files-`, `nas-`) keeps the working tree. */
const BACKUP_PREFIXES: readonly string[] = ['backup', 'vault'];

const SNAPSHOT_COUNT = { min: 2, max: 4 } as const;
/** Days from the last snapshot to the world stopping, and between two snapshots. */
const DAYS_SINCE_LAST_SNAPSHOT = { min: 1, max: 7 } as const;
const DAYS_BETWEEN_SNAPSHOTS = { min: 5, max: 30 } as const;
/** The nightly job runs in the small hours, for up to half an hour. */
const SNAPSHOT_HOUR_SECONDS = 2 * 3600;
const SNAPSHOT_SPREAD_SECONDS = 1800;

/** How often a file first appears in a later snapshot rather than the first, and how
 *  often a document already backed up is saved again before a later one. */
const LATE_ARRIVAL_CHANCE = 0.15;
const REVISION_CHANCE = 0.2;

const prefixOf = (hostname: string): string => hostname.slice(0, hostname.lastIndexOf('-'));

/** How long the nightly job takes to collect everything the desks send it. */
const PUSH_SPREAD_SECONDS = 1200;

/** One saved state of a file: when it was saved, what it held, and the first snapshot
 *  that holds it. */
type Version = { readonly savedAt: number; readonly content: string; readonly enters: number };

type ShareFile = {
  readonly folder: string;
  readonly name: string;
  readonly author: MailPerson;
  /** The first snapshot it is in: the snapshot after it was first saved. */
  readonly firstIn: number;
  /** Oldest first. */
  readonly versions: readonly Version[];
};

/** A snapshot's moment, in seconds, and the day it is named for. */
type Snapshot = { readonly at: number; readonly date: string };

const dateOf = (day: number): string =>
  new Date(day * DAY_SECONDS * 1000).toISOString().slice(0, 10);

/** The nights the backup job ran, oldest first. */
const snapshotNights = (prng: Prng): readonly Snapshot[] => {
  const count = prng.nextInt(SNAPSHOT_COUNT.min, SNAPSHOT_COUNT.max);
  const lastDay =
    EPOCH_DAY - prng.nextInt(DAYS_SINCE_LAST_SNAPSHOT.min, DAYS_SINCE_LAST_SNAPSHOT.max);
  const days = Array.from({ length: count - 1 }).reduce<readonly number[]>(
    (later) => [
      (later[0] ?? lastDay) -
        prng.nextInt(DAYS_BETWEEN_SNAPSHOTS.min, DAYS_BETWEEN_SNAPSHOTS.max),
      ...later,
    ],
    [lastDay],
  );
  return days.map((day) => ({
    at: day * DAY_SECONDS + SNAPSHOT_HOUR_SECONDS + prng.nextInt(0, SNAPSHOT_SPREAD_SECONDS),
    date: dateOf(day),
  }));
};

type Span = { readonly from: number; readonly to: number };

/** The span, in seconds, between snapshot `index` and the one before it: where anything
 *  that snapshot is the first to hold was saved. */
const spanBefore = (boundaries: readonly number[], index: number): Span => ({
  from:
    index === 0
      ? (boundaries[0] ?? LAST_SECOND) - WINDOW_SECONDS
      : (boundaries[index - 1] ?? 0) + 1,
  to: boundaries[index] ?? LAST_SECOND,
});

const secondIn = (prng: Prng, span: Span): number => prng.nextInt(span.from, span.to);

type Device = { readonly make: string; readonly model: string };

/** Who and what a share's files can name: the people who may have written them, what
 *  they call the place, and the devices a photo there could have been taken on. */
type ShareCast = {
  readonly people: readonly MailPerson[];
  readonly place: string;
  readonly devices: readonly Device[];
};

/** Every person is drawn with a first name and a surname, so the first space ends it. */
const firstNameOf = (person: MailPerson): string =>
  person.fullName.slice(0, person.fullName.indexOf(' '));

/** A text body with every slot filled. A slot nothing fills is left as written, so a
 *  misspelt one shows up in the file rather than vanishing. */
const fillSlots = ({
  body,
  cast,
  createdAt,
  prng,
}: {
  readonly body: string;
  readonly cast: ShareCast;
  readonly createdAt: number;
  readonly prng: Prng;
}): string =>
  body.replace(/\{(\w+)\}/g, (slot, name: string) => {
    switch (name) {
      case 'place':
        return cast.place;
      case 'person':
        return prng.pick(cast.people).fullName;
      case 'first':
        return firstNameOf(prng.pick(cast.people));
      case 'date':
        return new Date(createdAt).toISOString().slice(0, 10);
      case 'number':
        return String(prng.nextInt(2, 40));
      case 'amount':
        return String(prng.nextInt(20, 4000));
      default:
        return slot;
    }
  });

const renderVersion = ({
  spec,
  author,
  cast,
  createdAt,
  modifiedAt,
  prng,
}: {
  readonly spec: ShareFileSpec;
  readonly author: MailPerson;
  readonly cast: ShareCast;
  readonly createdAt: number;
  readonly modifiedAt: number;
  readonly prng: Prng;
}): string => {
  switch (spec.format) {
    case 'text':
      return fillSlots({ body: spec.body, cast, createdAt, prng });
    case 'pdf':
      return renderDocument(
        { format: 'pdf', title: spec.title, author: author.fullName, createdAt, modifiedAt },
        prng,
      );
    case 'jpeg': {
      const camera = prng.pick(cast.devices);
      return renderDocument(
        {
          format: 'jpeg',
          make: camera.make,
          model: camera.model,
          takenAt: createdAt,
          artist: prng.next() < SIGNED_PHOTO_CHANCE ? author.fullName : null,
        },
        prng,
      );
    }
    case 'docx':
    case 'xlsx':
      return renderDocument({ format: spec.format }, prng);
  }
};

/** A photo is taken once and a note is rewritten whole; the documents are what people
 *  keep saving over. */
const isRevisable = (spec: ShareFileSpec): boolean =>
  spec.format === 'pdf' || spec.format === 'docx' || spec.format === 'xlsx';

/** Every file the share has ever held, each with the states it was saved in. `boundaries`
 *  are the moments, in seconds, the share was captured: a backup box's snapshots, or the
 *  last moment of the world for a working share. */
const drawFiles = ({
  essid,
  prng,
  cast,
  boundaries,
  budget,
}: {
  readonly essid: string;
  readonly prng: Prng;
  readonly cast: ShareCast;
  readonly boundaries: readonly number[];
  /** How many files the share may hold in all. */
  readonly budget: { readonly min: number; readonly max: number };
}): readonly ShareFile[] => {
  const departments = Object.entries(SHARE_FOLDERS[networkPersona(essid).category]);
  const chosen = prng.pickN(
    departments,
    prng.nextInt(FOLDER_COUNT.min, Math.min(FOLDER_COUNT.max, departments.length)),
  );
  // Each department's share of the budget, so the whole lands inside it however many
  // departments were drawn.
  const perFolder = {
    min: Math.max(FILES_PER_FOLDER.min, Math.ceil(budget.min / chosen.length)),
    max: Math.min(FILES_PER_FOLDER.max, Math.floor(budget.max / chosen.length)),
  };
  const specs = chosen.flatMap(([folder, pool]) =>
    prng
      .pickN(pool, prng.nextInt(perFolder.min, perFolder.max))
      .map((spec) => ({ folder, spec })),
  );

  // Every snapshot after the first holds at least one file the one before it did not:
  // a backup that never changed would be the same night kept twice.
  const lastIndex = boundaries.length - 1;
  const arrivals = new Map(
    prng.pickN(specs, lastIndex).map((entry, index) => [entry, index + 1] as const),
  );

  return specs.map((entry) => {
    const { folder, spec } = entry;
    const firstIn =
      arrivals.get(entry) ??
      (lastIndex > 0 && prng.next() < LATE_ARRIVAL_CHANCE ? prng.nextInt(1, lastIndex) : 0);
    const author = prng.pick(cast.people);
    const span = spanBefore(boundaries, firstIn);
    const createdSecond = secondIn(prng, span);
    const firstSaved = prng.nextInt(
      createdSecond,
      Math.min(createdSecond + EDITING_SECONDS, span.to),
    );
    const revisedIn =
      isRevisable(spec) && firstIn < lastIndex && prng.next() < REVISION_CHANCE
        ? prng.nextInt(firstIn + 1, lastIndex)
        : null;
    const saves = [
      { savedSecond: firstSaved, enters: firstIn },
      ...(revisedIn === null
        ? []
        : [{ savedSecond: secondIn(prng, spanBefore(boundaries, revisedIn)), enters: revisedIn }]),
    ];
    return {
      folder,
      name: spec.name,
      author,
      firstIn,
      versions: saves.map(({ savedSecond, enters }) => ({
        savedAt: savedSecond,
        enters,
        content: renderVersion({
          spec,
          author,
          cast,
          createdAt: createdSecond * 1000,
          modifiedAt: savedSecond * 1000,
          prng,
        }),
      })),
    };
  });
};

/** The share as it stood at snapshot `index`: every file already in it, in the last
 *  state it was saved in by then, under the department it belongs to. */
const treeAt = ({
  files,
  index,
  boundary,
  account,
}: {
  readonly files: readonly ShareFile[];
  readonly index: number;
  readonly boundary: number;
  readonly account: string;
}): Directory => {
  const present = files.filter((shareFile) => shareFile.firstIn <= index);
  const folders = [...new Set(present.map((shareFile) => shareFile.folder))];
  return dir(
    Object.fromEntries(
      folders.map((folder) => {
        const entries: Record<string, FileEntry> = Object.fromEntries(
          present
            .filter((shareFile) => shareFile.folder === folder)
            .map((shareFile) => {
              // The first version was saved before the snapshot that first holds the
              // file, so there is always one to start from.
              const current = shareFile.versions.reduce((latest, version) =>
                version.savedAt <= boundary ? version : latest,
              );
              return [shareFile.name, file(current.content, SHARE_FILE, account)];
            }),
        );
        return [folder, dir(entries, SHARE_DIR, account)];
      }),
    ),
    SHARE_DIR,
    account,
  );
};

/** What a phone of each kind is, one model for its whole life: drawn on its own share
 *  stream keyed by the phone, so every file server on the network agrees on it. */
const phoneModel = (essid: string, phone: LanHost): Device | undefined => {
  const models = PHONE_MODELS[prefixOf(phone.hostname)];
  return models === undefined
    ? undefined
    : createPrng(`share-phone-${essid}-${phone.ip}`).pick(models);
};

/**
 * What a photo on this box could have been taken with: the network's own phones, where
 * it has any, and a camera otherwise. A box below the LAN cannot see the phones on it, so
 * its photos came off a camera.
 */
const photoDevices = (essid: string, host: LanHost): readonly Device[] => {
  const phones = isOnHomeLan(essid, host)
    ? generateHomeLan(essid).hosts.flatMap((neighbour) => phoneModel(essid, neighbour) ?? [])
    : [];
  return phones.length > 0 ? phones : CAMERAS;
};

/** One file arriving on the share over ftp: who sent it from which machine, where it
 *  landed and how long it was, at the moment, in milliseconds, it arrived. */
export type ShareUpload = {
  readonly at: number;
  readonly from: LanHost;
  readonly user: string;
  readonly path: string;
  readonly bytes: number;
};

export type Share = {
  readonly tree: Directory;
  /** Every arrival that built the share, in the order the files were drawn. */
  readonly uploads: readonly ShareUpload[];
};

/**
 * The `/srv` of a file server: dated snapshots on a backup box, the working tree on any
 * other, with the uploads that put each file there.
 *
 * `people` are who may have written what is on it; `account` is the box's own login,
 * which every upload logged in as and which so owns it all.
 */
export const buildShare = ({
  essid,
  host,
  account,
  people,
}: {
  readonly essid: string;
  readonly host: LanHost;
  readonly account: string;
  readonly people: readonly MailPerson[];
}): Share => {
  const keepsBackups = BACKUP_PREFIXES.includes(prefixOf(host.hostname));
  const prng = createPrng(`share-${essid}-${host.ip}`);
  const cast: ShareCast = {
    people,
    place: networkPersona(essid).place,
    devices: photoDevices(essid, host),
  };
  if (!keepsBackups) {
    const files = drawFiles({
      essid,
      prng,
      cast,
      boundaries: [LAST_SECOND],
      budget: WORKING_SHARE_FILES,
    });
    // Saved straight onto the share, so each file arrived the moment it was saved.
    return {
      tree: dir(
        { share: treeAt({ files, index: 0, boundary: LAST_SECOND, account }) },
        TRAVERSABLE_DIR,
      ),
      uploads: files.flatMap(({ folder, name, author, versions }) =>
        versions.map((version) => ({
          at: version.savedAt * 1000,
          from: author.host,
          user: account,
          path: `/srv/share/${folder}/${name}`,
          bytes: version.content.length,
        })),
      ),
    };
  }

  const nights = snapshotNights(prng);
  const boundaries = nights.map((night) => night.at);
  // Every snapshot can hold the whole tree, so the tree is what the cap divides.
  const files = drawFiles({
    essid,
    prng,
    cast,
    boundaries,
    budget: { min: 0, max: Math.floor(BACKUP_FILES_MAX / nights.length) },
  });
  const snapshots = Object.fromEntries(
    nights.map((night, index) => [
      night.date,
      treeAt({ files, index, boundary: night.at, account }),
    ]),
  );
  // Each desk sends the nightly job what it saved since the night before, so a file
  // arrives in the first snapshot to hold each state of it and is not sent again.
  const uploads = nights.flatMap((night, index) =>
    files.flatMap(({ folder, name, author, versions }) =>
      versions
        .filter((version) => version.enters === index)
        .map((version) => ({
          at: (night.at + prng.nextInt(0, PUSH_SPREAD_SECONDS)) * 1000,
          from: author.host,
          user: account,
          path: `/srv/backup/${night.date}/${folder}/${name}`,
          bytes: version.content.length,
        })),
    ),
  );
  return { tree: dir({ backup: dir(snapshots, SHARE_DIR, account) }, TRAVERSABLE_DIR), uploads };
};
