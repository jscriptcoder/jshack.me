/**
 * The guardian's restore: one public website put back as generated, then patched — a
 * reinstall from current media, so a box the operator brings back never comes back on the
 * holes it fell through.
 *
 * The script does the throwing off and the wiping; this decides what the clean box is
 * written as once the journal is empty. The manifest is the same patch a round would
 * make on a box nobody has touched, and the boot marker is what tells a terminal already
 * standing on the box that it went down. Both are written as the box itself, under the
 * network key its logs accrete under, so the restore leaves no trace but the reboot.
 *
 * Pure, framework-agnostic (core/): the day and the boot id are supplied by the script.
 */

import { BOOT_ID_OWNER, BOOT_ID_PATH, BOOT_ID_PERMISSIONS } from '../boot/bootId.js';
import { apGatewayLogWriterKey } from '../logging/apGatewayLogWriter.js';
import {
  boxesNamed,
  decidePatch,
  patchSummary,
  plural,
  type BoxesOrder,
  type PatchOutcome,
  type PatchRow,
} from './patch.js';
import type { PublicBox } from './publicBoxes.js';

export type RestoreInput = {
  readonly box: PublicBox;
  readonly gameDay: number;
  /** A fresh, unguessable id for the boot the restore stands for. */
  readonly bootId: string;
};

export type Restore = {
  /** The patch the reinstalled box takes. */
  readonly patch: PatchOutcome;
  /** Every row the emptied journal is written with. */
  readonly rows: readonly PatchRow[];
};

/** What `box` is written as on `gameDay`, once its journal is gone. */
export const decideRestore = ({ box, gameDay, bootId }: RestoreInput): Restore => {
  const patch = decidePatch({ box, journal: null, gameDay });
  const marker: PatchRow = {
    path: BOOT_ID_PATH,
    content: `${bootId}\n`,
    owner: BOOT_ID_OWNER,
    permissions: BOOT_ID_PERMISSIONS,
    node_type: 'file',
    writer_key: apGatewayLogWriterKey(box.networkKey),
  };
  return { patch, rows: [...(patch.kind === 'upgraded' ? [patch.row] : []), marker] };
};

export type RestoreDone = {
  /** Every session the restore ended: on the box, and every chain standing on those. */
  readonly closed: number;
  /** Every journal row it deleted. */
  readonly removed: number;
  readonly patch: PatchOutcome;
};

/** The operator's line for one restored box. */
export const restoreLine = (name: string, { closed, removed, patch }: RestoreDone): string =>
  `${name}: restored (${plural(closed, 'session', 'sessions')} closed, ` +
  `${plural(removed, 'row', 'rows')} removed), ${patchSummary(patch)}`;

/** The line before a restore: how many boxes, and the database the rows go to. */
export const restoreHeader = (count: number, host: string): string =>
  `Restoring ${plural(count, 'box', 'boxes')} on ${host}`;

/** The line after it. */
export const restoreTotal = (count: number): string => `Restored ${plural(count, 'box', 'boxes')}.`;

/** The boxes a restore names. Unlike a patch, a restore never falls back on the patrol:
 *  wiping every box a player has touched is the owner's pick, box by box, never a default. */
export const restoreOrder = (names: readonly string[]): BoxesOrder =>
  names.length === 0
    ? { ok: false, error: 'restore names the boxes it restores' }
    : boxesNamed(names);
