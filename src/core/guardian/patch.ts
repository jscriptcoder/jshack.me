/**
 * The guardian's patch: one public website moved onto every fix that has shipped, exactly
 * as a root's `apt upgrade` would move it.
 *
 * The same decision apt makes (`planUpgrade`), against whatever the box's manifest claims
 * once every write to it is replayed — so a root's hand edit is upgraded from the version
 * it claims, as apt would. A hole whose fix is still inside its patch delay stays open
 * until a later round: the operator answers to the world's clock like everybody else.
 *
 * A patch evicts nobody, and leaves no trace but the versions it moved. Its row is
 * written as the box itself, under the network key its logs accrete under, so nothing on
 * the box says the operator came by. A bricked box is left alone: apt cannot run on a box
 * that does not boot, and only a restore brings it back.
 *
 * Pure, framework-agnostic (core/): the journal and the day are supplied by the script.
 */

import { planUpgrade, type Exposure, type Upgrade } from '../cve/planUpgrade.js';
import {
  DPKG_STATUS_OWNER,
  DPKG_STATUS_PATH,
  DPKG_STATUS_PERMISSIONS,
  readDpkgStatus,
} from '../packages/dpkgStatus.js';
import { materializeMachineFs, type OwnerPatchRow } from '../network/materializeMachineFs.js';
import { canBoot } from '../boot/bootFiles.js';
import { apGatewayLogWriterKey } from '../logging/apGatewayLogWriter.js';
import { PATROL, publicBox, type PublicBox } from './publicBoxes.js';
import type { FilePermissions } from '../filesystem/types.js';

/** The journal row a patch writes: the box's whole manifest, upgraded. */
export type PatchRow = {
  readonly path: string;
  readonly content: string;
  readonly owner: string;
  readonly permissions: FilePermissions;
  readonly node_type: 'file';
  readonly writer_key: string;
};

/** A package with a live hole and no fix shipped yet: what a patch has to leave open. */
export type Held = Exposure & {
  readonly status: Extract<Exposure['status'], { kind: 'no-fix-yet' }>;
};

const isHeld = (exposure: Exposure): exposure is Held => exposure.status.kind === 'no-fix-yet';

export type PatchOutcome =
  | { readonly kind: 'bricked' }
  /** Nothing has a fix to install; what is held is still waiting for one. */
  | { readonly kind: 'up-to-date'; readonly held: readonly Held[] }
  | {
      readonly kind: 'upgraded';
      readonly upgrades: readonly Upgrade[];
      readonly held: readonly Held[];
      readonly row: PatchRow;
    };

export type PatchInput = {
  readonly box: PublicBox;
  /** Every row the box's journal holds, or null for a box nobody has written to. */
  readonly journal: readonly OwnerPatchRow[] | null;
  readonly gameDay: number;
};

/** What a patch does to `box` on `gameDay`, given everything written to it so far. */
export const decidePatch = ({ box, journal, gameDay }: PatchInput): PatchOutcome => {
  const root = materializeMachineFs(box.baseFs(), journal);
  if (!canBoot(root).ok) return { kind: 'bricked' };
  const plan = planUpgrade(readDpkgStatus(root), gameDay);
  const held = plan.exposures.filter(isHeld);
  if (plan.upgrades.length === 0) return { kind: 'up-to-date', held };
  return {
    kind: 'upgraded',
    upgrades: plan.upgrades,
    held,
    row: {
      path: DPKG_STATUS_PATH,
      content: plan.manifest,
      // Restated, as apt restates them: a rewrite at any other owner or mode would hide
      // the manifest from every scan and every `apt list -u`.
      owner: DPKG_STATUS_OWNER,
      permissions: DPKG_STATUS_PERMISSIONS,
      node_type: 'file',
      writer_key: apGatewayLogWriterKey(box.networkKey),
    },
  };
};

const plural = (count: number, one: string, many: string): string =>
  `${count} ${count === 1 ? one : many}`;

const heldPart = (held: readonly Held[]): string => {
  const waiting = held.map(
    ({ pkg, status }) => `${pkg}: no fix yet — ETA ~${plural(status.etaDays, 'day', 'days')}`,
  );
  return `${held.length} held (${waiting.join(', ')})`;
};

/** The operator's line for one box. */
export const patchLine = (name: string, outcome: PatchOutcome): string => {
  if (outcome.kind === 'bricked') return `${name}: bricked — restore it to bring it back`;
  const holding = outcome.held.length > 0 ? [heldPart(outcome.held)] : [];
  if (outcome.kind === 'up-to-date') return [`${name}: up to date`, ...holding].join(', ');
  const moved = outcome.upgrades.map(({ pkg, from, to }) => `${pkg} ${from} → ${to}`);
  return [`${name}: ${outcome.upgrades.length} upgraded (${moved.join(', ')})`, ...holding].join(
    ', ',
  );
};

/** The line before the round: how many boxes, and the database the rows go to. */
export const patchHeader = (count: number, host: string): string =>
  `Patching ${plural(count, 'box', 'boxes')} on ${host}`;

/** The line after the round. */
export const patchTotal = (outcomes: readonly PatchOutcome[]): string => {
  const count = (kind: PatchOutcome['kind']): number =>
    outcomes.filter((outcome) => outcome.kind === kind).length;
  return (
    `Patched ${plural(outcomes.length, 'box', 'boxes')}: ${count('upgraded')} upgraded, ` +
    `${count('up-to-date')} up to date, ${count('bricked')} bricked.`
  );
};

export type BoxesOrder =
  | { readonly ok: true; readonly boxes: readonly PublicBox[] }
  | { readonly ok: false; readonly error: string };

/** The boxes an order names, or the patrol when it names none. A name that is no public
 *  website, or a box named twice, refuses the whole order: the operator meant something
 *  else, and half a round run on a guess is worse than none. */
export const boxesNamed = (names: readonly string[]): BoxesOrder => {
  if (names.length === 0) return { ok: true, boxes: PATROL };
  const boxes: PublicBox[] = [];
  for (const name of names) {
    const box = publicBox(name);
    if (box === undefined) return { ok: false, error: `${name} is no public website` };
    if (boxes.includes(box)) return { ok: false, error: `${box.name} is named twice` };
    boxes.push(box);
  }
  return { ok: true, boxes };
};
