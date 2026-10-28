import { describe, expect, it } from 'vitest';
import { decideReport, reportHeader, reportLine, reportTotal, type Report } from './report.js';
import { decidePatch } from './patch.js';
import { decideRestore } from './restore.js';
import { decideRotation, type PasswordDraw } from './rotate.js';
import { publicBox, type PublicBox } from './publicBoxes.js';
import { planUpgrade } from '../cve/planUpgrade.js';
import { readDpkgStatus } from '../packages/dpkgStatus.js';
import type { OwnerPatchRow } from '../network/materializeMachineFs.js';

/**
 * What the operator reads before choosing: for each public website, how far behind its
 * fixes it is, and whether a player has done more to it than visit. A visit leaves only the
 * box's own log lines; anything else in its journal, an open session or a brick is the
 * work of somebody who got in.
 */

const DRAW: PasswordDraw = {
  crackable: () => 'crackable-hash',
  uncrackable: () => 'uncrackable-hash',
};

const NOW = Date.parse('2026-10-28T09:30:00.000Z');

const boxNamed = (name: string): PublicBox => {
  const box = publicBox(name);
  if (box === undefined) throw new Error(`${name} is no public website`);
  return box;
};

/** The first game day `box`, as generated, has a number of fixes to install that `holds`. */
const firstDay = (box: PublicBox, holds: (fixes: number) => boolean): number => {
  const manifest = readDpkgStatus(box.baseFs());
  const day = Array.from({ length: 400 }, (_, index) => index).find((candidate) =>
    holds(planUpgrade(manifest, candidate).upgrades.length),
  );
  if (day === undefined) throw new Error(`${box.name} never has such a day`);
  return day;
};

/** A day `box` has several fixes to install. */
const dayWithFixes = (box: PublicBox): number => firstDay(box, (fixes) => fixes > 1);

const PLAYER = 'a'.repeat(64);
const OTHER_PLAYER = 'b'.repeat(64);

const journalRow = (overrides?: Partial<OwnerPatchRow>): OwnerPatchRow => ({
  path: '/var/www/html/index.html',
  content: 'defaced\n',
  owner: 'root',
  permissions: null,
  node_type: 'file',
  updated_at: '2026-10-22T10:00:00.000Z',
  writer_key: PLAYER,
  ...overrides,
});

/** A box with nothing to install and nobody on it, unless told otherwise. */
const reportOf = (overrides?: Partial<Report>): Report => ({
  patch: { kind: 'up-to-date', held: [] },
  openSessions: [],
  written: [],
  ...overrides,
});

/** A line the box itself logged about a visitor, under the key its logs accrete under. */
const ownLog = (box: PublicBox, path: string): OwnerPatchRow =>
  journalRow({ path, content: 'a visitor\n', writer_key: `ap:${box.networkKey}` });

const behind = (box: PublicBox, gameDay: number): number => {
  const outcome = decidePatch({ box, journal: null, gameDay });
  if (outcome.kind !== 'upgraded') throw new Error('expected a fix to install');
  return outcome.upgrades.length;
};

describe('decideReport', () => {
  it('reads a box that was only visited as behind and nothing more', () => {
    const box = boxNamed('millbrook.gov');
    const gameDay = dayWithFixes(box);

    const report = decideReport({
      box,
      journal: [
        ownLog(box, '/var/log/access.log'),
        ownLog(box, '/var/log/auth.log'),
        ownLog(box, '/var/log/kern.log'),
      ],
      openSessions: [],
      gameDay,
    });

    expect(reportLine(box.name, report)).toBe(
      `millbrook.gov: ${behind(box, gameDay)} packages behind`,
    );
  });

  it('counts behind exactly what a patch would move', () => {
    const box = boxNamed('findit.io');
    const gameDay = dayWithFixes(box);
    const journal = [journalRow()];

    const report = decideReport({ box, journal, openSessions: [], gameDay });

    expect(report.patch).toEqual(decidePatch({ box, journal, gameDay }));
  });

  it('reads a box just restored as up to date and untouched', () => {
    const box = boxNamed('millbrook.gov');
    const gameDay = dayWithFixes(box);
    const { rows } = decideRestore({ box, gameDay, bootId: 'fresh', draw: DRAW, now: NOW });

    const report = decideReport({
      box,
      journal: rows.map((row) => ({ ...row, updated_at: '2026-10-22T10:00:00.000Z' })),
      openSessions: [],
      gameDay,
    });

    expect(reportLine(box.name, report)).toBe('millbrook.gov: up to date');
  });

  it("reads the guardian's own password round as nothing but the box's own", () => {
    const box = boxNamed('findit.io');
    const { rows } = decideRotation({ box, journal: null, draw: DRAW, now: NOW });

    const report = decideReport({
      box,
      journal: rows.map((row) => ({ ...row, updated_at: '2026-10-22T10:00:00.000Z' })),
      openSessions: [],
      gameDay: 0,
    });

    expect(report.written).toEqual([]);
  });

  it('names the account every open session on the box was opened as', () => {
    const box = boxNamed('findit.io');
    const gameDay = dayWithFixes(box);

    const report = decideReport({
      box,
      journal: null,
      openSessions: ['root', 'www-data'],
      gameDay,
    });

    expect(reportLine(box.name, report)).toBe(
      `findit.io: ${behind(box, gameDay)} packages behind, ` +
        'tampered (2 open sessions: root, www-data)',
    );
  });

  it('names every path a player wrote, each once and in order, logs included', () => {
    const box = boxNamed('millbrook.gov');
    const gameDay = dayWithFixes(box);

    const report = decideReport({
      box,
      journal: [
        ownLog(box, '/var/log/access.log'),
        journalRow({ path: '/var/www/html/index.html' }),
        journalRow({ path: '/etc/passwd' }),
        journalRow({ path: '/var/www/html/index.html', writer_key: OTHER_PLAYER }),
        journalRow({ path: '/var/log/auth.log', content: '' }),
        journalRow({ path: '/var/run/boot-id', content: 'rebooted\n' }),
      ],
      openSessions: [],
      gameDay,
    });

    expect(reportLine(box.name, report)).toBe(
      `millbrook.gov: ${behind(box, gameDay)} packages behind, tampered (4 paths written: ` +
        '/etc/passwd, /var/log/auth.log, /var/run/boot-id, /var/www/html/index.html)',
    );
  });

  it('reads a daemon rewritten through its port as written, though the box wrote it', () => {
    const box = boxNamed('millbrook.gov');

    const report = decideReport({
      box,
      journal: [
        journalRow({ path: '/var/lib/mysql/data.json', writer_key: `ap:${box.networkKey}` }),
      ],
      openSessions: [],
      gameDay: dayWithFixes(box),
    });

    expect(report.written).toEqual(['/var/lib/mysql/data.json']);
  });

  it("reads a log filed under another network's key as written", () => {
    const box = boxNamed('millbrook.gov');

    const report = decideReport({
      box,
      journal: [journalRow({ path: '/var/log/auth.log', writer_key: 'ap:elsewhere' })],
      openSessions: [],
      gameDay: dayWithFixes(box),
    });

    expect(report.written).toEqual(['/var/log/auth.log']);
  });

  it('reads a bricked box as bricked and tampered, with the write that killed it', () => {
    const box = boxNamed('ridgemontparks.gov');

    const report = decideReport({
      box,
      journal: [journalRow({ path: '/boot/vmlinuz', content: null, node_type: null })],
      openSessions: ['root'],
      gameDay: dayWithFixes(box),
    });

    expect(reportLine(box.name, report)).toBe(
      'ridgemontparks.gov: bricked, tampered (1 open session: root; 1 path written: /boot/vmlinuz)',
    );
  });
});

describe('reportLine', () => {
  it('reads a box one fix behind in the singular', () => {
    const box = boxNamed('findit.io');

    const report = decideReport({
      box,
      journal: null,
      openSessions: [],
      gameDay: firstDay(box, (fixes) => fixes === 1),
    });

    expect(reportLine(box.name, report)).toBe('findit.io: 1 package behind');
  });

  it('reads a box with nothing to install and nobody on it as up to date', () => {
    expect(reportLine('flyridgemont.com', reportOf())).toBe('flyridgemont.com: up to date');
  });
});

describe('reportHeader', () => {
  it('names how many boxes, and the database they are read from', () => {
    expect(reportHeader(51, 'db.example.co')).toBe('Looking over 51 boxes on db.example.co');
    expect(reportHeader(1, 'db.example.co')).toBe('Looking over 1 box on db.example.co');
  });
});

describe('reportTotal', () => {
  it('counts the boxes behind, the boxes tampered with, and the bricked among them', () => {
    const box = boxNamed('findit.io');
    const gameDay = dayWithFixes(box);
    const visited = decideReport({ box, journal: null, openSessions: [], gameDay });
    const entered = decideReport({ box, journal: null, openSessions: ['root'], gameDay });
    const bricked = reportOf({ patch: { kind: 'bricked' }, written: ['/boot'] });

    expect(reportTotal([reportOf(), visited, visited, entered, bricked])).toBe(
      'Looked over 5 boxes: 3 behind, 2 tampered, 1 bricked.',
    );
  });

  it('counts one box in the singular', () => {
    expect(reportTotal([reportOf()])).toBe('Looked over 1 box: 0 behind, 0 tampered, 0 bricked.');
  });
});
