import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DIRLIST,
  DIRLIST_PERMISSIONS,
  formatDirlist,
  parseDirlist,
} from './defaultDirlist';

/**
 * The shipped path list and the file it becomes. `apt install gobuster` writes
 * `formatDirlist(DEFAULT_DIRLIST)` onto the box, and every sweep reads that file
 * back through `parseDirlist` — so the two have to agree about what a line is, or
 * a default install ships a list that finds nothing.
 */

describe('the shipped path list', () => {
  it('holds no blank entry, so no probe asks about the document root itself', () => {
    // A blank entry resolves to `/`, which every server answers — one empty string
    // in the list would report a hit on every host in the game and mean nothing.
    expect(DEFAULT_DIRLIST.filter((path) => path.length === 0)).toEqual([]);
  });

  it('holds no duplicate, because a repeated path is a wasted probe on every run', () => {
    expect([...new Set(DEFAULT_DIRLIST)]).toHaveLength(DEFAULT_DIRLIST.length);
  });

  it('covers the paths the generated pages already advertise', () => {
    // Those paths return 404 today — the pages link them and nothing serves them.
    // Keeping them here means a default sweep starts finding them the moment the
    // generated world grows the pages its own markup promises, with no change here.
    for (const advertised of ['admin', 'status', 'server-status', 'api/health', 'metrics']) {
      expect(DEFAULT_DIRLIST).toContain(advertised);
    }
  });
});

describe('the path list as an object on the box', () => {
  it('lets any tier read it, so a guest-tier sweep can consult one', () => {
    // The tool runs at guest tier. A list root alone could read would make the
    // sweep useless exactly where a player most often stands — a box they just got
    // a foothold on.
    for (const tier of ['root', 'user', 'guest'] as const) {
      expect(DIRLIST_PERMISSIONS.read).toContain(tier);
    }
  });

  it('lets only root write it, so adding a path is a deliberate act', () => {
    expect(DIRLIST_PERMISSIONS.write).toEqual(['root']);
  });

  it('is never executable, because it is data the tool reads and not a program', () => {
    expect(DIRLIST_PERMISSIONS.execute).toEqual([]);
  });
});

describe('a path list as a file on the box', () => {
  it('writes one path per line, so the file a player opens is a list', () => {
    const written = formatDirlist(['admin', 'backup', 'metrics']);

    expect(written).toBe('admin\nbackup\nmetrics');
  });

  it('ends without a trailing blank line, which would probe the document root', () => {
    expect(formatDirlist(DEFAULT_DIRLIST).endsWith('\n')).toBe(false);
  });

  it('reads back exactly what was written', () => {
    // The round trip is the contract: apt writes the file, a sweep reads it, and a
    // disagreement between the two would silently change what a default install can
    // find.
    expect(parseDirlist(formatDirlist(DEFAULT_DIRLIST))).toEqual([...DEFAULT_DIRLIST]);
  });

  it('drops the blank line an editor leaves behind', () => {
    // A player curating the list with `nano` leaves a trailing newline. The empty
    // path is not something they typed, and probing it would report a hit on every
    // server they ever sweep.
    expect(parseDirlist('admin\n\nbackup\n')).toEqual(['admin', 'backup']);
  });
});
