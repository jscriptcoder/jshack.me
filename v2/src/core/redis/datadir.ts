/**
 * Where a box keeps its key-value store, and how a server-side reader gets it back.
 *
 * ONE declaration, because the generator that plants the file, the conf the box
 * publishes about itself, and whoever later reads the store back are three facts that
 * have to agree. On the day they stop, a box states one directory in a file a guest can
 * read while its daemon serves another — and the recon that file exists to provide
 * becomes a lie.
 *
 * The store is a FILE, so every read of it goes through `parseRedisStore` rather than a
 * cast: it is root-owned, root on a box is a tier a player can reach, and anything a
 * player can reach they can edit. A box with no store, a store that is not a file, and
 * a file holding something that is not a store all collapse to the same answer — this
 * box has no store — because from a reader's side they are one condition.
 */

import { parseRedisStore, type RedisStore } from './types';
import { asAbsPath } from '../types';
import type { Directory, FileNode } from '../filesystem/types';

const DATADIR_SEGMENTS = ['var', 'lib', 'redis'] as const;

/** The directory the conf names in its `dir` line. */
export const DATADIR_DIR = asAbsPath(`/${DATADIR_SEGMENTS.join('/')}`);

const DATADIR_FILE_SEGMENTS = [...DATADIR_SEGMENTS, 'data.json'] as const;

/** The file itself: walked by the reader below, and named by whoever writes one back.
 *  A reader walking one path and a writer naming another are two facts that have to
 *  agree — on the day they stop, a write lands somewhere nothing reads it and the
 *  change silently never happened. */
export const DATADIR_PATH = asAbsPath(`/${DATADIR_FILE_SEGMENTS.join('/')}`);

/** Who owns the file once somebody writes one back. The daemon runs as root and the
 *  generator plants the file as root, so a store rewritten through the port has to
 *  arrive the same way — a writer that named its own owner would be a second
 *  declaration of one fact, and the day the two disagreed a written store would be a
 *  store its own reader could no longer open. The permissions come from the shared
 *  `DATADIR_FILE`, which both datadirs on a box already answer to. */
export const DATADIR_OWNER = 'root';

/**
 * The store a box serves, or null when it serves none.
 *
 * Read from the box's CURRENT filesystem by every caller, so a key deleted between two
 * statements is gone on the second — and so an edit made with `nano` as root is an edit
 * the door answers with.
 */
export const storeIn = (fs: Directory): RedisStore | null => {
  const datadir = DATADIR_FILE_SEGMENTS.reduce<FileNode | undefined>(
    (node, segment) =>
      node !== undefined && node.kind === 'directory' ? node.entries.get(segment) : undefined,
    fs,
  );
  return datadir === undefined || datadir.kind !== 'file' ? null : parseRedisStore(datadir.content);
};
