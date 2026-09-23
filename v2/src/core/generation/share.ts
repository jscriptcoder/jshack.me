/**
 * The share a file server keeps under `/srv`: the departments of the place it serves.
 *
 * What a share holds is the network's kind of place — a café's menus and rotas, a
 * family's paperwork and photos — and who wrote it is the network's own people, so a
 * PDF's author is somebody whose mail the network really carries. It is drawn on its
 * own stream, keyed by the box: a share arriving on a file server moves nothing else
 * the world already generated.
 */

import { WORLD_EPOCH } from '../cve/worldClock';
import type { Directory, FileEntry } from '../filesystem/types';
import { dir, file, SHARE_DIR, SHARE_FILE, TRAVERSABLE_DIR } from './baseFs';
import { renderDocument } from './documentFormats';
import type { LanHost } from './generateHomeLan';
import type { MailPerson } from './networkMail';
import { networkPersona } from './persona';
import { CAMERAS, SHARE_FOLDERS, type ShareFileSpec } from './pools/shareFiles';
import { createPrng, type Prng } from './prng';

const DAY_SECONDS = 86_400;
const LAST_SECOND = WORLD_EPOCH / 1000 - 1;

/** How far back a share's files reach: most of a year, and never before the box could
 *  have been installed. */
const WINDOW_SECONDS = 300 * DAY_SECONDS;

/** How long a document is worked on after it is first saved. */
const EDITING_SECONDS = 30 * DAY_SECONDS;

const FOLDER_COUNT = { min: 3, max: 6 } as const;
const FILES_PER_FOLDER = { min: 3, max: 10 } as const;

/** How often a photo carries the name of whoever took it. */
const SIGNED_PHOTO_CHANCE = 0.5;

/** The hostname prefixes that name a working share, as against a backup box. */
const WORKING_SHARE_PREFIXES: readonly string[] = ['share', 'files', 'nas'];

const prefixOf = (hostname: string): string => hostname.slice(0, hostname.lastIndexOf('-'));

/** When a file was first saved and when it was last, in that order, before the world
 *  stopped. */
const savedMoments = (prng: Prng) => {
  const createdSecond = prng.nextInt(LAST_SECOND - WINDOW_SECONDS, LAST_SECOND);
  const modifiedSecond = Math.min(
    createdSecond + prng.nextInt(0, EDITING_SECONDS),
    LAST_SECOND,
  );
  return { createdAt: createdSecond * 1000, modifiedAt: modifiedSecond * 1000 };
};

const contentOf = (
  spec: ShareFileSpec,
  author: MailPerson,
  prng: Prng,
): string => {
  const { createdAt, modifiedAt } = savedMoments(prng);
  switch (spec.format) {
    case 'text':
      return spec.body;
    case 'pdf':
      return renderDocument(
        { format: 'pdf', title: spec.title, author: author.fullName, createdAt, modifiedAt },
        prng,
      );
    case 'jpeg': {
      const camera = prng.pick(CAMERAS);
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

/**
 * The `/srv` of a file server, or null for a box that keeps no share.
 *
 * `people` are who may have written what is on it; `account` is the box's own login,
 * which uploaded all of it and so owns it.
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
}): Directory | null => {
  if (!WORKING_SHARE_PREFIXES.includes(prefixOf(host.hostname))) return null;

  const prng = createPrng(`share-${essid}-${host.ip}`);
  const departments = SHARE_FOLDERS[networkPersona(essid).category];
  const folderNames = Object.keys(departments);
  const chosen = prng.pickN(
    folderNames,
    prng.nextInt(FOLDER_COUNT.min, Math.min(FOLDER_COUNT.max, folderNames.length)),
  );
  const folders = Object.fromEntries(
    chosen.map((folder) => {
      const specs = departments[folder] ?? [];
      const picked = prng.pickN(
        specs,
        prng.nextInt(FILES_PER_FOLDER.min, FILES_PER_FOLDER.max),
      );
      const files: Record<string, FileEntry> = Object.fromEntries(
        picked.map((spec) => [
          spec.name,
          file(contentOf(spec, prng.pick(people), prng), SHARE_FILE, account),
        ]),
      );
      return [folder, dir(files, SHARE_DIR, account)];
    }),
  );
  return dir({ share: dir(folders, SHARE_DIR, account) }, TRAVERSABLE_DIR);
};
