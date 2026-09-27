/**
 * Player identity singleton for the UI.
 *
 * Memoizes `getOrCreateIdentity(localStorage)` for the page lifetime so the
 * terminal reads a stable key without re-hitting storage every command. The
 * read/validate/regenerate logic itself lives in (and is unit-tested in)
 * `core/identity` — this file is thin localStorage glue.
 */

import { getOrCreateIdentity } from '../core/identity/identity';
import type { Identity } from '../core/commands/types';

let cached: Identity | null = null;

export const getPlayerIdentity = (): Identity => {
  if (cached === null) cached = getOrCreateIdentity(localStorage);
  return cached;
};
