/**
 * The records a tamper job's box holds, and the one change the client wants made to them, a pure
 * function of the contract's number as its network is.
 *
 * Nothing here is secret: a player holding the number could draw the same rows, and the server
 * draws them again when the contractor mails in, to tell the row the job asked for from every row
 * it did not. What proves the job is the box, never anything the contractor says.
 *
 * Each contract draws a setting (a school's grades, a police department's warrants, a club's
 * members, and so on), which brings the table the job is about and two tables beside it that no
 * job is about, there to be looked past. The client reads only the first.
 */

import { createPrng } from '../generation/prng.js';
import { databaseIn } from '../mysql/datadir.js';
import { createFsView } from '../filesystem/fsView.js';
import { asAbsPath } from '../types.js';
import { missionTopology, recordsStorage } from './missionShape.js';
import {
  PEOPLE,
  RECORD_SETTINGS,
  SETTING_RECORDS,
  type RecordAction,
  type RecordSetting,
} from './recordSettings.js';
import type { Directory } from '../filesystem/types.js';
import type { MysqlRow, MysqlTable } from '../mysql/types.js';

export { RECORD_SETTINGS, type RecordAction, type RecordSetting };

/** The one row the client wants changed or gone: which table it sits in, where, the row as the
 *  box was laid with it, and the columns and values the briefing names it by, which fit no other
 *  row. A change also names the column it moves, the value there now and the value asked for,
 *  each as text. */
export type RecordTarget = {
  readonly table: string;
  readonly rowIndex: number;
  readonly row: MysqlRow;
  readonly namedBy: Readonly<Record<string, string>>;
} & (
  | {
      readonly action: 'change';
      readonly column: string;
      readonly from: string;
      readonly to: string;
    }
  | { readonly action: 'erase' }
);

export type NamedTable = { readonly name: string; readonly table: MysqlTable };

export type MissionRecords = {
  readonly setting: RecordSetting;
  /** The table the job is about first, then the two beside it. */
  readonly tables: readonly NamedTable[];
  readonly target: RecordTarget;
};

/** Which setting a tamper job is about. On a stream of its own, so drawing it moved no
 *  contract's topology, route, storage, action, client or pay. */
export const missionSetting = (missionNumber: number): RecordSetting =>
  createPrng(`mission-setting-${missionNumber}`).pick(RECORD_SETTINGS);

/** About half the tamper jobs ask for a record gone rather than changed. */
const ERASE_SHARE = 1 / 2;

/** Whether a tamper job asks for its record changed or gone: drawn on a stream of its own, and
 *  a change wherever the setting has nothing worth erasing. */
export const missionAction = (missionNumber: number): RecordAction =>
  SETTING_RECORDS[missionSetting(missionNumber)].erases &&
  createPrng(`mission-action-${missionNumber}`).next() < ERASE_SHARE
    ? 'erase'
    : 'change';

/** Five to fifteen rows for a table beside the target. */
const MIN_NEIGHBOUR_ROWS = 5;
const MAX_NEIGHBOUR_ROWS = 15;

/** The tables beside the target, drawn on a stream of their own so the target never moves for
 *  them, and naming nobody the target names. */
const neighbourTables = (
  missionNumber: number,
  setting: RecordSetting,
  named: ReadonlySet<string>,
): readonly NamedTable[] => {
  const prng = createPrng(`mission-neighbours-${missionNumber}`);
  const others = PEOPLE.filter((person) => !named.has(person));
  return SETTING_RECORDS[setting].neighbours.map(({ name, columns, rows }) => {
    const people = prng.pickN(others, MAX_NEIGHBOUR_ROWS);
    let drawn = 0;
    const person = (): string => people[drawn++] ?? '';
    const drawnRows = rows(prng, prng.nextInt(MIN_NEIGHBOUR_ROWS, MAX_NEIGHBOUR_ROWS), person);
    return {
      name,
      table: { columns, rows: drawnRows.map((row, index) => ({ id: index + 1, ...row })) },
    };
  });
};

export const missionRecords = (missionNumber: number): MissionRecords => {
  const setting = missionSetting(missionNumber);
  const action = missionAction(missionNumber);
  const records = SETTING_RECORDS[setting];
  const { rows, targetIndex, to } = records.draw(
    createPrng(`mission-records-${missionNumber}`),
    action,
  );
  const row = rows[targetIndex];
  if (row === undefined) throw new Error(`contract ${missionNumber} drew no target row`);
  const where = {
    table: records.table,
    rowIndex: targetIndex,
    row,
    namedBy: Object.fromEntries(records.identity.map((column) => [column, `${row[column]}`])),
  };
  const named = new Set(rows.flatMap((each) => Object.values(each).map((value) => `${value}`)));
  return {
    setting,
    tables: [
      { name: records.table, table: { columns: records.columns, rows } },
      ...neighbourTables(missionNumber, setting, new Set([...named, to])),
    ],
    target:
      action === 'erase'
        ? { ...where, action }
        : { ...where, action, column: records.changes, from: `${row[records.changes]}`, to },
  };
};

/** Where a job keeping its records in files keeps a table: under the stem its boxes are named
 *  on, one file a table. */
const recordsPathOf = (missionNumber: number, table: string): string =>
  `/srv/${missionTopology(missionNumber).stem}/records/${table}.csv`;

/** Where a job keeping its records in files keeps the table it is about. */
export const recordsFilePath = (missionNumber: number): string =>
  recordsPathOf(missionNumber, missionRecords(missionNumber).target.table);

/** A table as its file holds it: a header naming the columns, then one line per row in order,
 *  and a final newline. */
const csvOf = ({ columns, rows }: MysqlTable): string => {
  const names = columns.map(({ name }) => name);
  const lines = rows.map((row) => names.map((name) => `${row[name]}`).join(','));
  return `${[names.join(','), ...lines].join('\n')}\n`;
};

/** Every file a job keeping its records in files holds, the table it is about first. */
export const recordsFiles = (
  missionNumber: number,
): readonly { readonly path: string; readonly content: string }[] =>
  missionRecords(missionNumber).tables.map(({ name, table }) => ({
    path: recordsPathOf(missionNumber, name),
    content: csvOf(table),
  }));

/** One value as the client reads it: trimmed, and out of the double quotes around it. */
const csvValue = (raw: string): string => {
  const value = raw.trim();
  return value.length >= 2 && value.startsWith('"') && value.endsWith('"')
    ? value.slice(1, -1)
    : value;
};

/** The rows a CSV holds, each keyed by the header's names, or none when a line holds more or
 *  fewer values than the header names. Line endings and blank lines do not count. */
const csvRows = (content: string): readonly MysqlRow[] | undefined => {
  const [header, ...lines] = content
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map((line) => line.split(',').map(csvValue));
  if (header === undefined) return undefined;
  if (lines.some((values) => values.length !== header.length)) return undefined;
  return lines.map((values) =>
    Object.fromEntries(header.map((name, index) => [name, values[index]])),
  );
};

/** The rows of the table the job is about as the box holds them now, wherever the job keeps
 *  them, or undefined when there are none to read: no table, no file, or a file the client
 *  cannot read as rows. */
const liveRows = (
  missionNumber: number,
  table: string,
  fs: Directory,
): readonly MysqlRow[] | undefined => {
  if (recordsStorage(missionNumber) === 'database') return databaseIn(fs)?.tables[table]?.rows;
  const read = createFsView(fs, { userType: 'root' }).read(
    asAbsPath(recordsPathOf(missionNumber, table)),
  );
  return read.ok ? csvRows(read.content) : undefined;
};

/** Whether two rows hold the same values in the same columns, each read as the text the
 *  database prints: a statement writes every value as text, so `3` and `'3'` are one id. */
const sameRow = (live: MysqlRow, generated: MysqlRow): boolean => {
  const columns = Object.keys(generated);
  return (
    Object.keys(live).length === columns.length &&
    columns.every((column) => column in live && `${live[column]}` === `${generated[column]}`)
  );
};

/** What the client sees when the contractor mails in: the table the job is about as it stands
 *  now. On a change it reads right when the target row holds the value asked for, trimmed and
 *  case-sensitive; on an erase, when the target row is gone. Either way every other row must be
 *  exactly the row the number drew, in the order it drew them. Anything else reads wrong: the
 *  old value, another value, a row touched, gone or added beside it, or no records at all. The
 *  tables beside it are never read. */
export const recordsLookRight = (missionNumber: number, fs: Directory): boolean => {
  const { tables, target } = missionRecords(missionNumber);
  const live = liveRows(missionNumber, target.table, fs);
  if (live === undefined) return false;
  const generatedRows = tables[0]?.table.rows ?? [];
  const expected =
    target.action === 'erase'
      ? generatedRows.filter((_generated, index) => index !== target.rowIndex)
      : generatedRows;
  return (
    live.length === expected.length &&
    expected.every((generated, index) => {
      const row = live[index];
      if (row === undefined) return false;
      if (target.action === 'erase' || index !== target.rowIndex) {
        return sameRow(row, generated);
      }
      return (
        sameRow({ ...row, [target.column]: target.from }, generated) &&
        `${row[target.column]}`.trim() === target.to
      );
    })
  );
};
