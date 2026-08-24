/**
 * Where a box keeps its key-value store.
 *
 * ONE declaration, because the generator that plants the file, the conf the box
 * publishes about itself, and whoever later reads the store back are three facts that
 * have to agree. On the day they stop, a box states one directory in a file a guest can
 * read while its daemon serves another — and the recon that file exists to provide
 * becomes a lie.
 */

import { asAbsPath } from '../types';

const DATADIR_SEGMENTS = ['var', 'lib', 'redis'] as const;

/** The directory the conf names in its `dir` line. */
export const DATADIR_DIR = asAbsPath(`/${DATADIR_SEGMENTS.join('/')}`);

/** The file inside it that holds the store. */
export const DATADIR_PATH = asAbsPath(`${DATADIR_DIR}/data.json`);

/** Root's, like the file the generator lays down — and it has to STAY root's through a
 *  rewrite. This file holds the hash a sweep has to work for, so a write that widened
 *  it would hand every tier on the box the answer key, quietly, with nothing about the
 *  statement looking any different. */
export const DATADIR_OWNER = 'root';
