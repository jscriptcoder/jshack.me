import { describe, expect, it } from 'vitest';
import { planUpgrade } from './planUpgrade.js';
import { upgradeStatusFor, type UpgradeStatus } from './packageTimeline.js';
import { liveCve } from './liveCve.js';
import { buildEntry, formatDpkgStatus, parseDpkgVersions } from '../packages/dpkgStatus.js';

const manifestOf = (versions: Readonly<Record<string, string>>): string =>
  formatDpkgStatus(Object.entries(versions).map(([pkg, version]) => buildEntry(pkg, version)));

/** The first game day `pkg` at `version` stands as `kind` — read off the same timeline
 *  the plan answers from, so a retuned clock moves the fixture with it. */
const firstDayWhere = (pkg: string, version: string, kind: UpgradeStatus['kind']): number => {
  const day = Array.from({ length: 400 }, (_, index) => index).find(
    (candidate) => upgradeStatusFor(pkg, version, candidate).kind === kind,
  );
  if (day === undefined) throw new Error(`${pkg} ${version} is never ${kind}`);
  return day;
};

const targetOn = (pkg: string, version: string, day: number): string => {
  const status = upgradeStatusFor(pkg, version, day);
  if (status.kind !== 'upgradable') throw new Error(`${pkg} ${version} is ${status.kind}`);
  return status.target;
};

describe('planUpgrade', () => {
  it('moves nothing on a box whose packages have no published hole', () => {
    const manifest = manifestOf({ nginx: '1.26.0', libssl: '3.2.1' });

    expect(planUpgrade(manifest, 0)).toEqual({ exposures: [], upgrades: [], manifest });
  });

  it('moves an exposed package onto the release that fixes it and names the hole', () => {
    const day = firstDayWhere('nginx', '1.26.0', 'upgradable');
    const manifest = manifestOf({ nginx: '1.26.0' });
    const target = targetOn('nginx', '1.26.0', day);
    const hole = liveCve('nginx', '1.26.0', day);

    const plan = planUpgrade(manifest, day);

    expect(plan.upgrades).toEqual([{ pkg: 'nginx', from: '1.26.0', to: target }]);
    expect(plan.exposures).toEqual([
      {
        pkg: 'nginx',
        version: '1.26.0',
        status: { kind: 'upgradable', target },
        hole: `${hole?.cve} ${hole?.severity}`,
      },
    ]);
    expect(parseDpkgVersions(plan.manifest).get('nginx')).toBe(target);
  });

  it('leaves a box it has just upgraded with nothing to move the same day', () => {
    const day = firstDayWhere('nginx', '1.26.0', 'upgradable');
    const once = planUpgrade(manifestOf({ nginx: '1.26.0', libssl: '3.2.1' }), day);

    const again = planUpgrade(once.manifest, day);

    expect(again.upgrades).toEqual([]);
    expect(again.manifest).toBe(once.manifest);
  });

  it('holds a package whose fix has not shipped, naming it without moving it', () => {
    const day = firstDayWhere('nginx', '1.26.0', 'no-fix-yet');
    const manifest = manifestOf({ nginx: '1.26.0' });

    const plan = planUpgrade(manifest, day);

    expect(plan.upgrades).toEqual([]);
    expect(plan.exposures).toEqual([
      expect.objectContaining({
        pkg: 'nginx',
        version: '1.26.0',
        status: { kind: 'no-fix-yet', etaDays: expect.any(Number) },
      }),
    ]);
    expect(plan.manifest).toBe(manifest);
  });

  it('plans only the package it is told to, and rewrites only that one', () => {
    const nginxDay = firstDayWhere('nginx', '1.26.0', 'upgradable');
    const day = Array.from({ length: 400 }, (_, index) => nginxDay + index).find(
      (candidate) => upgradeStatusFor('libssl', '3.2.1', candidate).kind === 'upgradable',
    );
    if (day === undefined) throw new Error('libssl never upgradable after nginx');
    const manifest = manifestOf({ nginx: '1.26.0', libssl: '3.2.1' });
    const libssl = targetOn('libssl', '3.2.1', day);

    const plan = planUpgrade(manifest, day, 'libssl');

    expect(plan.upgrades).toEqual([{ pkg: 'libssl', from: '3.2.1', to: libssl }]);
    expect(plan.exposures.map(({ pkg }) => pkg)).toEqual(['libssl']);
    expect(Object.fromEntries(parseDpkgVersions(plan.manifest))).toEqual({
      nginx: '1.26.0',
      libssl,
    });
  });

  it('leaves a package the world keeps no history for exactly as written', () => {
    const manifest = manifestOf({ 'my-own-tool': '9.9.9' });

    expect(planUpgrade(manifest, 100)).toEqual({ exposures: [], upgrades: [], manifest });
  });
});
