import { describe, expect, it } from 'vitest';
import {
  decidePatch,
  patchHeader,
  patchLine,
  patchTotal,
  boxesNamed,
  type Held,
  type PatchOutcome,
} from './patch.js';
import { PATROL, publicBox, type PublicBox } from './publicBoxes.js';
import { planUpgrade } from '../cve/planUpgrade.js';
import {
  DPKG_STATUS_OWNER,
  DPKG_STATUS_PATH,
  DPKG_STATUS_PERMISSIONS,
  parseDpkgVersions,
  readDpkgStatus,
  withPackageVersion,
} from '../packages/dpkgStatus.js';
import type { OwnerPatchRow } from '../network/materializeMachineFs.js';

/**
 * One box on a guardian's round: what a patch writes to it, or why it writes nothing, and
 * the words the operator reads. A patch is exactly a root's `apt upgrade` — the same
 * decision, against whatever the box's manifest claims after every write to it.
 */

const boxNamed = (name: string): PublicBox => {
  const box = publicBox(name);
  if (box === undefined) throw new Error(`${name} is no public website`);
  return box;
};

const baseManifestOf = (box: PublicBox): string => readDpkgStatus(box.baseFs());

/** The first game day `box`, as generated, has a fix to install and a hole still waiting
 *  for one — read off the same plan a patch answers from. */
const dayWithFixesAndHeld = (box: PublicBox): number => {
  const manifest = baseManifestOf(box);
  const day = Array.from({ length: 400 }, (_, index) => index).find((candidate) => {
    const plan = planUpgrade(manifest, candidate);
    return (
      plan.upgrades.length > 0 &&
      plan.exposures.some((exposure) => exposure.status.kind === 'no-fix-yet')
    );
  });
  if (day === undefined) throw new Error(`${box.name} never has both`);
  return day;
};

const journalRow = (overrides?: Partial<OwnerPatchRow>): OwnerPatchRow => ({
  path: '/var/www/html/index.html',
  content: 'defaced\n',
  owner: 'root',
  permissions: null,
  node_type: 'file',
  updated_at: '2026-10-22T10:00:00.000Z',
  writer_key: 'a'.repeat(64),
  ...overrides,
});

const held = (pkg: string, etaDays: number): Held => ({
  pkg,
  version: '1.0.0',
  status: { kind: 'no-fix-yet', etaDays },
  hole: 'CVE-2026-100001 high',
});

describe('decidePatch', () => {
  it("rewrites an untouched box's manifest exactly as apt upgrade would, as the box itself", () => {
    const box = boxNamed('millbrook.gov');
    const gameDay = dayWithFixesAndHeld(box);
    const plan = planUpgrade(baseManifestOf(box), gameDay);

    const outcome = decidePatch({ box, journal: null, gameDay });

    expect(outcome).toEqual({
      kind: 'upgraded',
      upgrades: plan.upgrades,
      held: plan.exposures.filter((exposure) => exposure.status.kind === 'no-fix-yet'),
      row: {
        path: DPKG_STATUS_PATH,
        content: plan.manifest,
        owner: DPKG_STATUS_OWNER,
        permissions: DPKG_STATUS_PERMISSIONS,
        node_type: 'file',
        writer_key: `ap:${box.networkKey}`,
      },
    });
  });

  it('finds nothing to do on a box it has just patched, the same day', () => {
    const box = boxNamed('findit.io');
    const gameDay = dayWithFixesAndHeld(box);
    const first = decidePatch({ box, journal: null, gameDay });
    if (first.kind !== 'upgraded') throw new Error(`expected an upgrade, got ${first.kind}`);

    const again = decidePatch({
      box,
      journal: [journalRow({ ...first.row, updated_at: '2026-10-22T11:00:00.000Z' })],
      gameDay,
    });

    expect(again).toEqual({ kind: 'up-to-date', held: first.held });
  });

  it('is up to date with nothing held on a box whose packages have no published hole', () => {
    expect(decidePatch({ box: boxNamed('ashby.gov'), journal: null, gameDay: 0 })).toEqual({
      kind: 'up-to-date',
      held: [],
    });
  });

  it("upgrades from the version a root's hand edit claims, not the one generated", () => {
    const box = boxNamed('millbrook.gov');
    const gameDay = dayWithFixesAndHeld(box);
    const patched = planUpgrade(baseManifestOf(box), gameDay);
    const [rolledBack] = patched.upgrades;
    if (rolledBack === undefined) throw new Error('nothing to roll back');
    const handEdited = withPackageVersion(patched.manifest, rolledBack.pkg, rolledBack.from);

    const outcome = decidePatch({
      box,
      journal: [journalRow({ path: DPKG_STATUS_PATH, content: handEdited })],
      gameDay,
    });

    expect(outcome).toEqual(expect.objectContaining({ kind: 'upgraded', upgrades: [rolledBack] }));
    if (outcome.kind !== 'upgraded') return;
    expect(parseDpkgVersions(outcome.row.content)).toEqual(parseDpkgVersions(patched.manifest));
  });

  it('leaves a bricked box alone, whatever it is exposed to', () => {
    const box = boxNamed('millbrook.gov');

    const outcome = decidePatch({
      box,
      journal: [journalRow({ path: '/boot/vmlinuz', content: null, node_type: null })],
      gameDay: dayWithFixesAndHeld(box),
    });

    expect(outcome).toEqual({ kind: 'bricked' });
  });

  it('reads past a write that does not touch the manifest', () => {
    const box = boxNamed('millbrook.gov');
    const gameDay = dayWithFixesAndHeld(box);

    const outcome = decidePatch({ box, journal: [journalRow()], gameDay });

    expect(outcome).toEqual(decidePatch({ box, journal: null, gameDay }));
  });
});

describe('patchLine', () => {
  it('names every package it moved and every one it had to hold', () => {
    const outcome: PatchOutcome = {
      kind: 'upgraded',
      upgrades: [
        { pkg: 'nginx', from: '1.26.0', to: '1.26.2' },
        { pkg: 'libssl', from: '3.2.1', to: '3.2.4' },
      ],
      held: [held('libpam', 2), held('vsftpd', 1)],
      row: {
        path: DPKG_STATUS_PATH,
        content: '',
        owner: DPKG_STATUS_OWNER,
        permissions: DPKG_STATUS_PERMISSIONS,
        node_type: 'file',
        writer_key: 'ap:r0/t1/n0',
      },
    };

    expect(patchLine('millbrook.gov', outcome)).toBe(
      'millbrook.gov: 2 upgraded (nginx 1.26.0 → 1.26.2, libssl 3.2.1 → 3.2.4), ' +
        '2 held (libpam: no fix yet — ETA ~2 days, vsftpd: no fix yet — ETA ~1 day)',
    );
  });

  it('says nothing of holding when nothing was held', () => {
    const outcome: PatchOutcome = {
      kind: 'upgraded',
      upgrades: [{ pkg: 'nginx', from: '1.26.0', to: '1.26.2' }],
      held: [],
      row: {
        path: DPKG_STATUS_PATH,
        content: '',
        owner: DPKG_STATUS_OWNER,
        permissions: DPKG_STATUS_PERMISSIONS,
        node_type: 'file',
        writer_key: 'ap:findit.io',
      },
    };

    expect(patchLine('findit.io', outcome)).toBe('findit.io: 1 upgraded (nginx 1.26.0 → 1.26.2)');
  });

  it('calls a box with nothing to install up to date, and still names what waits for a fix', () => {
    expect(patchLine('ashby.gov', { kind: 'up-to-date', held: [] })).toBe('ashby.gov: up to date');
    expect(patchLine('ashby.gov', { kind: 'up-to-date', held: [held('libz', 3)] })).toBe(
      'ashby.gov: up to date, 1 held (libz: no fix yet — ETA ~3 days)',
    );
  });

  it('tells the operator a bricked box needs a restore', () => {
    expect(patchLine('elypd.gov', { kind: 'bricked' })).toBe(
      'elypd.gov: bricked — restore it to bring it back',
    );
  });
});

describe('patchHeader and patchTotal', () => {
  it('names how many boxes a round covers and the database it writes to', () => {
    expect(patchHeader(51, 'aqoarbmstducbnxmhxxx.supabase.co')).toBe(
      'Patching 51 boxes on aqoarbmstducbnxmhxxx.supabase.co',
    );
    expect(patchHeader(1, '127.0.0.1')).toBe('Patching 1 box on 127.0.0.1');
  });

  it('counts every outcome of the round', () => {
    const upgraded: PatchOutcome = {
      kind: 'upgraded',
      upgrades: [],
      held: [],
      row: {
        path: DPKG_STATUS_PATH,
        content: '',
        owner: DPKG_STATUS_OWNER,
        permissions: DPKG_STATUS_PERMISSIONS,
        node_type: 'file',
        writer_key: 'ap:x',
      },
    };
    const upToDate: PatchOutcome = { kind: 'up-to-date', held: [] };

    expect(patchTotal([upgraded, upgraded, upToDate, { kind: 'bricked' }])).toBe(
      'Patched 4 boxes: 2 upgraded, 1 up to date, 1 bricked.',
    );
    expect(patchTotal([upToDate])).toBe('Patched 1 box: 0 upgraded, 1 up to date, 0 bricked.');
  });
});

describe('boxesNamed', () => {
  it('walks the patrol when the order names no box', () => {
    expect(boxesNamed([])).toEqual({ ok: true, boxes: PATROL });
  });

  it('walks only the boxes named, in the order named', () => {
    expect(boxesNamed(['kwikemart.com', 'Findit.io'])).toEqual({
      ok: true,
      boxes: [boxNamed('kwikemart.com'), boxNamed('findit.io')],
    });
  });

  it('refuses the whole order over a name no public website answers to', () => {
    expect(boxesNamed(['findit.io', 'nowhere.example'])).toEqual({
      ok: false,
      error: 'nowhere.example is no public website',
    });
  });

  it('refuses the whole order over a box named twice, whatever the case', () => {
    expect(boxesNamed(['millbrook.gov', 'findit.io', 'MILLBROOK.gov'])).toEqual({
      ok: false,
      error: 'millbrook.gov is named twice',
    });
  });
});
