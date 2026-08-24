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

/** The directory the conf names in its `dir` line.
 *
 *  The path to the FILE inside it, and the owner a rewrite has to preserve, belong to
 *  whoever reads and writes the store. They are not declared here until then: an export
 *  nothing consumes is a claim no test can check. */
export const DATADIR_DIR = asAbsPath(`/${DATADIR_SEGMENTS.join('/')}`);
