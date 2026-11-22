/**
 * Fails the build if any uncrackable or white-hat password appears in `dist/`.
 *
 * The game ships the uncrackable pool as md5s only, so a player who digs through the
 * bundle finds hashes to crack, exactly as they would in-game, rather than the answer
 * key to every door that holds. The white-hat words ship the same way, since a client hands
 * each over only in a briefing. Lint forbids the one import that would undo that
 * (`__plaintext.js`); this checks the outcome itself, whatever route a word took.
 *
 * Runs first in `postbuild`, before the timing budgets: it is deterministic, and a
 * leak is the louder failure.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { UNCRACKABLE_PASSWORDS, WHITE_HAT_PASSWORDS } from '../src/core/secrets/__plaintext.js';
import { findSecretLeaks } from '../src/core/secrets/findSecretLeaks.js';

const ROOT = join(import.meta.dirname, '..');
const DIST_DIR = join(ROOT, 'dist');

const files = readdirSync(DIST_DIR, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => {
    const fullPath = join(entry.parentPath, entry.name);
    return {
      path: relative(ROOT, fullPath).replaceAll('\\', '/'),
      content: readFileSync(fullPath, 'utf8'),
    };
  });

const HELD_BACK = [...UNCRACKABLE_PASSWORDS, ...WHITE_HAT_PASSWORDS];

const leaks = findSecretLeaks(HELD_BACK, files);
if (leaks.length > 0) {
  leaks.forEach(({ word, path }) => {
    console.error(`FAIL secrets: held-back password "${word}" is in ${path}`);
  });
  console.error(
    'checkSecrets: the bundle must carry the uncrackable and white-hat pools as hashes only',
  );
  process.exit(1);
}
console.log(
  `ok   secrets: none of ${HELD_BACK.length} uncrackable and white-hat passwords in ${files.length} built files`,
);
