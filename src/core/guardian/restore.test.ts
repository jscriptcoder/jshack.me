import { describe, expect, it } from 'vitest';
import {
  decideRestore,
  restoreHeader,
  restoreLine,
  restoreOrder,
  restoreTotal,
} from './restore.js';
import { decidePatch, type Held, type PatchOutcome } from './patch.js';
import { publicBox, type PublicBox } from './publicBoxes.js';
import { planUpgrade } from '../cve/planUpgrade.js';
import { DPKG_STATUS_PERMISSIONS, readDpkgStatus } from '../packages/dpkgStatus.js';
import { BOOT_ID_OWNER, BOOT_ID_PATH, BOOT_ID_PERMISSIONS } from '../boot/bootId.js';
import { canBoot } from '../boot/bootFiles.js';
import { FIXED_BOXES } from '../generation/fixedSites.js';
import { PUBLISHERS } from '../generation/publishers.js';
import type { OwnerPatchRow } from '../network/materializeMachineFs.js';

/**
 * A restore puts a public website back as generated — a reinstall — and then patches it,
 * so a box the operator brings back never comes back on the holes it fell through.
 */

const boxNamed = (name: string): PublicBox => {
  const box = publicBox(name);
  if (box === undefined) throw new Error(`${name} is no public website`);
  return box;
};

const BOOT_ID = '6f1c2a9e-0b4d-4e57-9a3c-2d8e7f6a1b05';

/** The first game day `box`, as generated, has a fix to install. */
const dayWithFixes = (box: PublicBox): number => {
  const manifest = readDpkgStatus(box.baseFs());
  const day = Array.from({ length: 400 }, (_, index) => index).find(
    (candidate) => planUpgrade(manifest, candidate).upgrades.length > 0,
  );
  if (day === undefined) throw new Error(`${box.name} never has a fix`);
  return day;
};

/** The rows a restore writes, as they read back out of the journal. */
const asJournal = (rows: ReturnType<typeof decideRestore>['rows']): OwnerPatchRow[] =>
  rows.map((row) => ({ ...row, updated_at: '2026-10-22T10:00:00.000Z' }));

const held = (pkg: string, etaDays: number): Held => ({
  pkg,
  version: '1.0.0',
  status: { kind: 'no-fix-yet', etaDays },
  hole: 'CVE-2026-100001 high',
});

describe('decideRestore', () => {
  it('writes the generated box, upgraded, and a fresh boot marker, both as the box itself', () => {
    const box = boxNamed('millbrook.gov');
    const gameDay = dayWithFixes(box);
    const reinstalled = decidePatch({ box, journal: null, gameDay });
    if (reinstalled.kind !== 'upgraded') throw new Error('expected a fix to install');

    const restore = decideRestore({ box, gameDay, bootId: BOOT_ID });

    expect(restore).toEqual({
      patch: reinstalled,
      rows: [
        reinstalled.row,
        {
          path: BOOT_ID_PATH,
          content: `${BOOT_ID}\n`,
          owner: BOOT_ID_OWNER,
          permissions: BOOT_ID_PERMISSIONS,
          node_type: 'file',
          writer_key: `ap:${box.networkKey}`,
        },
      ],
    });
  });

  it('leaves a restored box with nothing left to patch the same day', () => {
    const box = boxNamed('findit.io');
    const gameDay = dayWithFixes(box);

    const { rows } = decideRestore({ box, gameDay, bootId: BOOT_ID });

    expect(decidePatch({ box, journal: asJournal(rows), gameDay })).toMatchObject({
      kind: 'up-to-date',
    });
  });

  it('writes only the marker when the generated box has nothing to install', () => {
    const box = boxNamed('boards.hireme.io');

    const restore = decideRestore({ box, gameDay: 0, bootId: BOOT_ID });

    expect(restore.patch).toEqual({ kind: 'up-to-date', held: [] });
    expect(restore.rows.map(({ path }) => path)).toEqual([BOOT_ID_PATH]);
  });

  it('writes the same rows for the same day and boot id, so a second restore changes nothing', () => {
    const box = boxNamed('ashbylibrary.org');
    const gameDay = dayWithFixes(box);

    expect(decideRestore({ box, gameDay, bootId: BOOT_ID })).toEqual(
      decideRestore({ box, gameDay, bootId: BOOT_ID }),
    );
  });
});

describe('every public website as generated', () => {
  it('boots, so a restore can never leave a box bricked', () => {
    const names = [...FIXED_BOXES.map(({ key }) => key), ...PUBLISHERS.map(({ domain }) => domain)];

    const dead = names.filter((name) => !canBoot(boxNamed(name).baseFs()).ok);

    expect(dead).toEqual([]);
  });
});

describe('restoreLine', () => {
  const upgraded: PatchOutcome = {
    kind: 'upgraded',
    upgrades: [
      { pkg: 'nginx', from: '1.26.0', to: '1.26.2' },
      { pkg: 'libssl', from: '3.2.1', to: '3.2.4' },
    ],
    held: [held('libpam', 2)],
    row: {
      path: '/var/lib/dpkg/status',
      content: '',
      owner: 'root',
      permissions: DPKG_STATUS_PERMISSIONS,
      node_type: 'file',
      writer_key: 'ap:millbrook',
    },
  };

  it('counts what it threw off and wiped, then says what the reinstall upgraded', () => {
    expect(restoreLine('millbrook.gov', { closed: 2, removed: 23, patch: upgraded })).toBe(
      'millbrook.gov: restored (2 sessions closed, 23 rows removed), ' +
        '2 upgraded (nginx 1.26.0 → 1.26.2, libssl 3.2.1 → 3.2.4), ' +
        '1 held (libpam: no fix yet — ETA ~2 days)',
    );
  });

  it('counts one of each in the singular, and calls a box with nothing to install up to date', () => {
    expect(
      restoreLine('findit.io', { closed: 1, removed: 1, patch: { kind: 'up-to-date', held: [] } }),
    ).toBe('findit.io: restored (1 session closed, 1 row removed), up to date');
  });

  it('counts an untouched box as nothing closed and nothing removed', () => {
    expect(
      restoreLine('ashby.gov', { closed: 0, removed: 0, patch: { kind: 'up-to-date', held: [] } }),
    ).toBe('ashby.gov: restored (0 sessions closed, 0 rows removed), up to date');
  });
});

describe('restoreHeader and restoreTotal', () => {
  it('names how many boxes a restore covers and the database it writes to', () => {
    expect(restoreHeader(2, 'db.example.co')).toBe('Restoring 2 boxes on db.example.co');
    expect(restoreHeader(1, 'db.example.co')).toBe('Restoring 1 box on db.example.co');
  });

  it('counts the boxes it brought back', () => {
    expect(restoreTotal(2)).toBe('Restored 2 boxes.');
    expect(restoreTotal(1)).toBe('Restored 1 box.');
  });
});

describe('restoreOrder', () => {
  it('restores only the boxes named, in the order named', () => {
    expect(restoreOrder(['Findit.io', 'millbrook.gov'])).toEqual({
      ok: true,
      boxes: [boxNamed('findit.io'), boxNamed('millbrook.gov')],
    });
  });

  it('refuses an order that names no box, rather than restoring the whole patrol', () => {
    expect(restoreOrder([])).toEqual({ ok: false, error: 'restore names the boxes it restores' });
  });

  it('refuses a name no public website answers to, or a box named twice', () => {
    expect(restoreOrder(['millbrook.gov', 'example.com'])).toEqual({
      ok: false,
      error: 'example.com is no public website',
    });
    expect(restoreOrder(['findit.io', 'FINDIT.IO'])).toEqual({
      ok: false,
      error: 'findit.io is named twice',
    });
  });
});
