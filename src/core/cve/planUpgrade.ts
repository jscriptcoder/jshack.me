/**
 * planUpgrade — what an upgrade would do to a box's manifest on a given game day.
 *
 * The one place the decision lives. `apt upgrade`, `apt list -u`, `apt update` and the
 * operator's guardian rounds all read it, so a player's upgrade and the guardian's
 * cannot disagree about which package moves, where to, or which hole is still waiting
 * for its fix.
 *
 * Pure, framework-agnostic (core/): the manifest and the day are supplied by the caller.
 */

import { parseDpkgVersions, withPackageVersion } from '../packages/dpkgStatus.js';
import { upgradeStatusFor, type UpgradeStatus } from './packageTimeline.js';
import { liveCve } from './liveCve.js';

/** A package that needs a move, and the hole that is why. */
export type Exposure = {
  readonly pkg: string;
  /** The version the manifest claims, as a scan shows it. */
  readonly version: string;
  readonly status: Extract<UpgradeStatus, { kind: 'upgradable' | 'no-fix-yet' }>;
  /** `CVE-… high`: the id and severity, never what firing it would grant — that stays
   *  the act of firing. Severity forecasts the privilege; the id is what a defender
   *  matches against a scan. */
  readonly hole: string;
};

/** One package leaving the release it is on for the one that fixes it. */
export type Upgrade = { readonly pkg: string; readonly from: string; readonly to: string };

export type UpgradePlan = {
  /** Every package that needs a move, in manifest order: the ones a fix has shipped for
   *  and the ones still inside their patch delay. */
  readonly exposures: readonly Exposure[];
  /** The exposures a fix has shipped for, each with the release it moves to. */
  readonly upgrades: readonly Upgrade[];
  /** The manifest with every upgrade applied, every other byte where it was. */
  readonly manifest: string;
};

/** Where a package stands, when it needs a move at all. The hole comes from the same
 *  derivation a scan answers from, so `apt` and `nmap -sV` cannot name different CVEs
 *  for one package — and one format serves services and libraries alike. */
const exposureOf = (pkg: string, version: string, gameDay: number): Exposure | undefined => {
  const status = upgradeStatusFor(pkg, version, gameDay);
  const live = liveCve(pkg, version, gameDay);
  if (live === undefined) return undefined;
  if (status.kind !== 'upgradable' && status.kind !== 'no-fix-yet') return undefined;
  return { pkg, version, status, hole: `${live.cve} ${live.severity}` };
};

/** The upgrade of `manifest` on `gameDay` — of every package, or of `onlyPackage` alone. */
export const planUpgrade = (
  manifest: string,
  gameDay: number,
  onlyPackage?: string,
): UpgradePlan => {
  const exposures = Array.from(parseDpkgVersions(manifest))
    .filter(([pkg]) => onlyPackage === undefined || pkg === onlyPackage)
    .flatMap(([pkg, version]) => exposureOf(pkg, version, gameDay) ?? []);
  const upgrades = exposures.flatMap(({ pkg, version, status }): readonly Upgrade[] =>
    status.kind === 'upgradable' ? [{ pkg, from: version, to: status.target }] : [],
  );
  return {
    exposures,
    upgrades,
    manifest: upgrades.reduce(
      (content, { pkg, to }) => withPackageVersion(content, pkg, to),
      manifest,
    ),
  };
};
