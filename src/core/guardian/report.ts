/**
 * The guardian's report: what the operator reads before choosing, for each public
 * website, how far behind its fixes it is, and whether a player has done more to it
 * than visit.
 *
 * Behind is the patch a round would make today, so the report and the patch after it
 * cannot disagree. Tampered is any of three things a visit never leaves:
 *   - an open session on the box. A player who closed the tab still holds it, and their
 *     next boot stands the hop back up on it, so stale or not it is a foothold;
 *   - a row in its journal that is not the box's own. A visit leaves only the box's log
 *     lines, filed under the key its logs accrete under, and the guardian leaves its
 *     manifest and boot marker under the same key. Anything else is somebody's write: a
 *     player's (logs included, which is how a root wiping their trail shows up), and a
 *     daemon's data rewritten through its port, which the box files under its own key;
 *   - a brick, which comes with the write that killed the box.
 *
 * A report writes nothing. Pure, framework-agnostic (core/): the journal, the open
 * sessions and the day are supplied by the script.
 */

import { BOOT_ID_PATH } from '../boot/bootId.js';
import { DPKG_STATUS_PATH } from '../packages/dpkgStatus.js';
import { apGatewayLogWriterKey } from '../logging/apGatewayLogWriter.js';
import type { OwnerPatchRow } from '../network/materializeMachineFs.js';
import { decidePatch, plural, type PatchOutcome } from './patch.js';
import type { PublicBox } from './publicBoxes.js';

export type ReportInput = {
  readonly box: PublicBox;
  /** Every row the box's journal holds, or null for a box nobody has written to. */
  readonly journal: readonly OwnerPatchRow[] | null;
  /** The account each open session on the box was opened as, oldest first. */
  readonly openSessions: readonly string[];
  readonly gameDay: number;
};

export type Report = {
  /** The patch a round would make today. */
  readonly patch: PatchOutcome;
  readonly openSessions: readonly string[];
  /** Every path somebody other than the box wrote, once each, in order. */
  readonly written: readonly string[];
};

const LOG_DIR = '/var/log/';

/** Whether the box wrote `row` itself: a log line about a visitor, or the guardian's own. */
const isOwnRow = (box: PublicBox, row: OwnerPatchRow): boolean =>
  row.writer_key === apGatewayLogWriterKey(box.networkKey) &&
  (row.path.startsWith(LOG_DIR) || row.path === DPKG_STATUS_PATH || row.path === BOOT_ID_PATH);

/** How `box` stands on `gameDay`, given everything written to it and everyone on it. */
export const decideReport = ({ box, journal, openSessions, gameDay }: ReportInput): Report => {
  const foreign = (journal ?? []).filter((row) => !isOwnRow(box, row));
  return {
    patch: decidePatch({ box, journal, gameDay }),
    openSessions,
    written: [...new Set(foreign.map((row) => row.path))].sort(),
  };
};

const isTampered = (report: Report): boolean =>
  report.openSessions.length > 0 || report.written.length > 0;

const standing = (patch: PatchOutcome): string => {
  if (patch.kind === 'bricked') return 'bricked';
  if (patch.kind === 'up-to-date') return 'up to date';
  return plural(patch.upgrades.length, 'package behind', 'packages behind');
};

/** Who has been on the box, and what they wrote: what the operator reads the trail from. */
const trail = ({ openSessions, written }: Report): readonly string[] => [
  ...(openSessions.length > 0
    ? [
        `${plural(openSessions.length, 'open session', 'open sessions')}: ${openSessions.join(', ')}`,
      ]
    : []),
  ...(written.length > 0
    ? [`${plural(written.length, 'path', 'paths')} written: ${written.join(', ')}`]
    : []),
];

/** The operator's line for one box. */
export const reportLine = (name: string, report: Report): string => {
  const tampered = isTampered(report) ? [`tampered (${trail(report).join('; ')})`] : [];
  return `${name}: ${[standing(report.patch), ...tampered].join(', ')}`;
};

/** The line before the report: how many boxes, and the database they are read from. */
export const reportHeader = (count: number, host: string): string =>
  `Looking over ${plural(count, 'box', 'boxes')} on ${host}`;

/** The line after it. */
export const reportTotal = (reports: readonly Report[]): string => {
  const count = (holds: (report: Report) => boolean): number => reports.filter(holds).length;
  return (
    `Looked over ${plural(reports.length, 'box', 'boxes')}: ` +
    `${count((report) => report.patch.kind === 'upgraded')} behind, ` +
    `${count(isTampered)} tampered, ${count((report) => report.patch.kind === 'bricked')} bricked.`
  );
};
