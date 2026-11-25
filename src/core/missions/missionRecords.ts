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
import { missionKind, missionTopology, recordsStorage } from './missionShape.js';
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
 *  a change wherever the setting has nothing worth erasing. A restore job always undoes a change:
 *  the game's `mysql` has no `INSERT`, so an erased row could not be put back through it. */
export const missionAction = (missionNumber: number): RecordAction =>
  missionKind(missionNumber) !== 'restore' &&
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

/** The most rows a restore job's target table gained after its backup was taken. */
const MOST_ROWS_ADDED_SINCE = 3;

/** How many of a restore job's newest target rows were added after the backup was taken, on a
 *  stream of its own: one to three, but never the changed row or one before it, since a row added
 *  after the backup has no true value in it. Where the changed row is the last, none were. */
export const rowsAddedSince = (missionNumber: number): number => {
  const { tables, target } = missionRecords(missionNumber);
  const rowsAfter = (tables[0]?.table.rows.length ?? 0) - 1 - target.rowIndex;
  return Math.min(
    createPrng(`mission-restore-${missionNumber}`).nextInt(1, MOST_ROWS_ADDED_SINCE),
    rowsAfter,
  );
};

/** A job's tables as the server lays them: as generated, but on a restore job with the change
 *  the intruder made, which the backup is there to undo. */
export const laidRecords = (missionNumber: number): readonly NamedTable[] => {
  const { tables, target } = missionRecords(missionNumber);
  if (missionKind(missionNumber) !== 'restore' || target.action !== 'change') return tables;
  return tables.map(({ name, table }) =>
    name !== target.table
      ? { name, table }
      : {
          name,
          table: {
            ...table,
            rows: table.rows.map((row, index) =>
              index === target.rowIndex ? { ...row, [target.column]: target.to } : row,
            ),
          },
        },
  );
};

/** Every table as a restore job's backup holds it: as generated, before the change, and before
 *  the target table's newest rows were added. */
const backedUpRecords = (missionNumber: number): readonly NamedTable[] => {
  const { tables, target } = missionRecords(missionNumber);
  const added = rowsAddedSince(missionNumber);
  return tables.map(({ name, table }) =>
    name === target.table
      ? { name, table: { ...table, rows: table.rows.slice(0, table.rows.length - added) } }
      : { name, table },
  );
};

/** One value as a dump writes it: a number bare, anything else quoted. No generated value holds
 *  a quote, so none needs escaping. */
const sqlValue = (value: MysqlRow[string]): string =>
  typeof value === 'number' ? `${value}` : `'${value}'`;

/** A table as `mysqldump` writes it with one `INSERT` a row, so `grep` finds a row by its line.
 *  Every generated column is NOT NULL and every table is keyed by its primary key, so the dump
 *  says so of each. */
const dumpOf = ({ name, table }: NamedTable): string => {
  const columns = table.columns.map((column) => `  \`${column.name}\` ${column.type} NOT NULL`);
  const keys = table.columns
    .filter((column) => column.key === 'PRI')
    .map((column) => `\`${column.name}\``);
  const inserts = table.rows.map(
    (row) =>
      `INSERT INTO \`${name}\` VALUES (${table.columns.map((column) => sqlValue(row[column.name] ?? null)).join(',')});`,
  );
  return [
    `CREATE TABLE \`${name}\` (`,
    [...columns, `  PRIMARY KEY (${keys.join(',')})`].join(',\n'),
    ');',
    '',
    ...inserts,
  ].join('\n');
};

/** A restore job's backup, under `/var/backups` where a Debian box keeps its own: a dump of the
 *  database, or a copy of each records file, as storage says. */
export const recordsBackupFiles = (
  missionNumber: number,
): readonly { readonly path: string; readonly content: string }[] => {
  const tables = backedUpRecords(missionNumber);
  if (recordsStorage(missionNumber) === 'file') {
    return tables.map((named) => ({
      path: `/var/backups/records/${named.name}.csv`,
      content: csvOf(named.table),
    }));
  }
  return [
    {
      path: `/var/backups/${missionTopology(missionNumber).stem}-records.sql`,
      content: `${['-- MySQL dump 10.13\n-- Host: localhost', ...tables.map(dumpOf)].join('\n\n')}\n`,
    },
  ];
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
  laidRecords(missionNumber).map(({ name, table }) => ({
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

/** A CSV's lines as the client reads them, each split into its values. Line endings and blank
 *  lines do not count. */
const csvLines = (content: string): readonly (readonly string[])[] =>
  content
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map((line) => line.split(',').map(csvValue));

/** The rows a CSV holds, each keyed by the header's names, or none when a line holds more or
 *  fewer values than the header names. */
const csvRows = (content: string): readonly MysqlRow[] | undefined => {
  const [header, ...lines] = csvLines(content);
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

/** Whether the box still holds exactly the rows the number drew for a table, in the order it
 *  drew them, nothing added. */
const holdsAsDrawn = (live: readonly MysqlRow[] | undefined, drawn: readonly MysqlRow[]): boolean =>
  live !== undefined &&
  live.length === drawn.length &&
  drawn.every((generated, index) => {
    const row = live[index];
    return row !== undefined && sameRow(row, generated);
  });

/** Whether the table a wipe job is about holds nothing now: in a database, no rows or no table;
 *  in a file, no file, nothing but blank lines, or the header alone. A file with lines the client
 *  cannot read as rows may still hold the data, so it is not empty. */
const emptied = (missionNumber: number, { name, table }: NamedTable, fs: Directory): boolean => {
  if (recordsStorage(missionNumber) === 'database') {
    return (databaseIn(fs)?.tables[name]?.rows.length ?? 0) === 0;
  }
  const read = createFsView(fs, { userType: 'root' }).read(
    asAbsPath(recordsPathOf(missionNumber, name)),
  );
  if (!read.ok) return true;
  const [first, ...rest] = csvLines(read.content);
  const header = table.columns.map((column) => column.name);
  return first === undefined || (rest.length === 0 && first.join(',') === header.join(','));
};

/** What the client sees when the contractor mails in on a wipe job: the table the job is about
 *  emptied, and the two beside it holding exactly the rows the number drew, in order. Any other
 *  table on the box is never read. */
export const recordsWiped = (missionNumber: number, fs: Directory): boolean => {
  const [target, ...beside] = missionRecords(missionNumber).tables;
  return (
    target !== undefined &&
    emptied(missionNumber, target, fs) &&
    beside.every(({ name, table }) => holdsAsDrawn(liveRows(missionNumber, name, fs), table.rows))
  );
};

/** What a restore job's client finds in the table the job is about. */
export type RestoreReading = 'restored' | 'stillChanged' | 'collateral';

/** What the client sees when the contractor mails in on a restore job: the table the job is about
 *  as it stands now. It still holds the change while no row is the one the number drew with the
 *  value put back, read trimmed, or while there are no records to read. Once one is, any other
 *  row touched, gone or added, or out of the order drawn, is collateral. The tables beside it
 *  are never read. */
export const recordsRestored = (missionNumber: number, fs: Directory): RestoreReading => {
  const { tables, target } = missionRecords(missionNumber);
  const live = liveRows(missionNumber, target.table, fs);
  const generatedRows = tables[0]?.table.rows ?? [];
  const generatedTarget = generatedRows[target.rowIndex];
  if (live === undefined || generatedTarget === undefined || target.action !== 'change') {
    return 'stillChanged';
  }
  const putBack = (row: MysqlRow): boolean =>
    sameRow({ ...row, [target.column]: `${row[target.column]}`.trim() }, generatedTarget);
  if (!live.some(putBack)) return 'stillChanged';
  const asDrawn =
    live.length === generatedRows.length &&
    generatedRows.every((generated, index) => {
      const row = live[index];
      if (row === undefined) return false;
      return index === target.rowIndex ? putBack(row) : sameRow(row, generated);
    });
  return asDrawn ? 'restored' : 'collateral';
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
