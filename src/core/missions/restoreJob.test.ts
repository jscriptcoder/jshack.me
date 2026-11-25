import { describe, expect, it } from 'vitest';
import {
  RECORD_SETTINGS,
  missionAction,
  missionRecords,
  missionSetting,
  rowsAddedSince,
} from './missionRecords.js';
import { missionFilePaths, missionFiles } from './missionLeak.js';
import { missionKind, missionShape, recordsStorage } from './missionShape.js';
import { isMissionNumber } from './missionNetwork.js';
import { parseMysqlDatabase, type MysqlRow, type MysqlTable } from '../mysql/types.js';
import { DATADIR_PATH } from '../mysql/datadir.js';
import { ROOT_FILE } from '../generation/baseFs.js';
import type { MissionStorage } from './missionShape.js';
import { DEPLOYMENT_SECRETS } from '../../test/passwords.js';

/** Restore-the-record contracts spread across the whole block. */
const RESTORE_NUMBERS = Array.from({ length: 12000 }, (_unused, index) => index * 1371 + 2).filter(
  (missionNumber) => isMissionNumber(missionNumber) && missionKind(missionNumber) === 'restore',
);

const keptIn = (storage: MissionStorage): readonly number[] =>
  RESTORE_NUMBERS.filter((missionNumber) => recordsStorage(missionNumber) === storage);

/** Every file the server lays on a restore job's target. */
const laidOn = (missionNumber: number) =>
  missionFiles({ missionNumber, role: 'key' }, { keySecret: undefined, rawSecrets: undefined });

const laidAt = (missionNumber: number, path: string) => {
  const laid = laidOn(missionNumber).find((each) => each.path === path);
  if (laid === undefined) throw new Error(`contract ${missionNumber} lays nothing at ${path}`);
  return laid;
};

/** The rows a table had when it was generated, and so when the intruder came. */
const generatedTables = (missionNumber: number): Readonly<Record<string, MysqlTable>> =>
  Object.fromEntries(missionRecords(missionNumber).tables.map(({ name, table }) => [name, table]));

/** The target table's rows as the intruder left them: the one value changed. */
const changedRows = (missionNumber: number): readonly MysqlRow[] => {
  const { tables, target } = missionRecords(missionNumber);
  if (target.action !== 'change') throw new Error(`contract ${missionNumber} is not a change`);
  return (tables[0]?.table.rows ?? []).map((row, index) =>
    index === target.rowIndex ? { ...row, [target.column]: target.to } : row,
  );
};

/** Each table's rows as the backup holds them: the target table's newest rows not yet added. */
const backedUpRows = (missionNumber: number, table: string): readonly MysqlRow[] => {
  const rows = generatedTables(missionNumber)[table]?.rows ?? [];
  return table === missionRecords(missionNumber).target.table
    ? rows.slice(0, rows.length - rowsAddedSince(missionNumber))
    : rows;
};

const csvOf = (columns: readonly string[], rows: readonly MysqlRow[]): string =>
  `${[columns.join(','), ...rows.map((row) => columns.map((name) => `${row[name]}`).join(','))].join('\n')}\n`;

const sqlValue = (value: MysqlRow[string]): string =>
  typeof value === 'number' ? `${value}` : `'${value}'`;

describe('the records a restore-the-record job is about', () => {
  it('always asks for a changed record back, never an erased one, in every setting', () => {
    expect(RESTORE_NUMBERS.length).toBeGreaterThan(300);
    for (const missionNumber of RESTORE_NUMBERS) {
      expect(missionAction(missionNumber), `contract ${missionNumber}`).toBe('change');
      expect(missionRecords(missionNumber).target.action, `contract ${missionNumber}`).toBe(
        'change',
      );
    }
    expect(new Set(RESTORE_NUMBERS.map(missionSetting))).toEqual(new Set(RECORD_SETTINGS));
  });

  // A row added after the backup has no true value in it, so the changed row is never one.
  it('adds one to three rows to the target table since the backup, all after the changed row', () => {
    for (const missionNumber of RESTORE_NUMBERS) {
      const { tables, target } = missionRecords(missionNumber);
      const rowsAfter = (tables[0]?.table.rows.length ?? 0) - 1 - target.rowIndex;
      const added = rowsAddedSince(missionNumber);
      const label = `contract ${missionNumber}, ${rowsAfter} rows after the target`;

      expect(added, label).toBeLessThanOrEqual(Math.min(3, rowsAfter));
      expect(added, label).toBeGreaterThanOrEqual(Math.min(1, rowsAfter));
    }
    expect(new Set(RESTORE_NUMBERS.map(rowsAddedSince))).toEqual(new Set([0, 1, 2, 3]));
  });

  it('draws how many were added on a stream of its own, so the records drawn never move', () => {
    const sample = RESTORE_NUMBERS.slice(0, 40);
    expect(sample.map(rowsAddedSince)).toEqual(sample.map(rowsAddedSince));
    expect(new Set(sample.map(rowsAddedSince)).size).toBeGreaterThan(1);
  });
});

describe('a restore-the-record target keeping its records in a database', () => {
  const NUMBERS = keptIn('database').slice(0, 60);

  it("holds the intruder's change in the target table, and the tables beside it as generated", () => {
    expect(NUMBERS.length).toBeGreaterThan(20);
    for (const missionNumber of NUMBERS) {
      const datadir = parseMysqlDatabase(laidAt(missionNumber, DATADIR_PATH).content);
      const { target, tables } = missionRecords(missionNumber);
      const label = `contract ${missionNumber}`;

      expect(datadir?.tables[target.table]?.rows, label).toEqual(changedRows(missionNumber));
      for (const { name, table } of tables.slice(1)) {
        expect(datadir?.tables[name]?.rows, `${label}, ${name}`).toEqual(table.rows);
      }
    }
  });

  it('keeps a dump of every table under /var/backups, root-only, one INSERT a row as it stood before', () => {
    for (const missionNumber of NUMBERS) {
      const path = `/var/backups/${missionShape(missionNumber).stem}-records.sql`;
      const backup = laidAt(missionNumber, path);
      const lines = backup.content.split('\n');
      const label = `contract ${missionNumber}`;

      expect(backup.perms, label).toEqual(ROOT_FILE);
      expect(lines[0], label).toMatch(/^-- MySQL dump/);
      for (const name of Object.keys(generatedTables(missionNumber))) {
        // Every generated column is NOT NULL and every table is keyed by one column.
        const tableColumns = generatedTables(missionNumber)[name]?.columns ?? [];
        const key = tableColumns.find((column) => column.key === 'PRI')?.name;
        const createdAt = lines.indexOf(`CREATE TABLE \`${name}\` (`);
        expect(
          lines.slice(createdAt, createdAt + tableColumns.length + 4),
          `${label}, ${name}`,
        ).toEqual([
          `CREATE TABLE \`${name}\` (`,
          ...tableColumns.map((column) => `  \`${column.name}\` ${column.type} NOT NULL,`),
          `  PRIMARY KEY (\`${key}\`)`,
          ');',
          '',
        ]);
        const inserts = lines.filter((line) => line.startsWith(`INSERT INTO \`${name}\` `));
        const columns =
          generatedTables(missionNumber)[name]?.columns.map(({ name: column }) => column) ?? [];
        expect(inserts, `${label}, ${name}`).toEqual(
          backedUpRows(missionNumber, name).map(
            (row) =>
              `INSERT INTO \`${name}\` VALUES (${columns.map((column) => sqlValue(row[column] ?? null)).join(',')});`,
          ),
        );
      }
      expect(missionFilePaths({ missionNumber, role: 'key' }), label).toContain(path);
    }
  });
});

describe('a restore-the-record target keeping its records in files', () => {
  const NUMBERS = keptIn('file').slice(0, 60);

  it("holds the intruder's change in the target CSV, and the CSVs beside it as generated", () => {
    expect(NUMBERS.length).toBeGreaterThan(20);
    for (const missionNumber of NUMBERS) {
      const { stem } = missionShape(missionNumber);
      const { target, tables } = missionRecords(missionNumber);
      for (const { name, table } of tables) {
        const laid = laidAt(missionNumber, `/srv/${stem}/records/${name}.csv`);
        const columns = table.columns.map(({ name: column }) => column);
        expect(laid.content, `contract ${missionNumber}, ${name}`).toBe(
          csvOf(columns, name === target.table ? changedRows(missionNumber) : table.rows),
        );
      }
    }
  });

  it('keeps a copy of every CSV under /var/backups/records, root-only, as it stood before', () => {
    for (const missionNumber of NUMBERS) {
      for (const { name, table } of missionRecords(missionNumber).tables) {
        const path = `/var/backups/records/${name}.csv`;
        const backup = laidAt(missionNumber, path);
        const label = `contract ${missionNumber}, ${name}`;

        expect(backup.perms, label).toEqual(ROOT_FILE);
        expect(backup.content, label).toBe(
          csvOf(
            table.columns.map(({ name: column }) => column),
            backedUpRows(missionNumber, name),
          ),
        );
        expect(missionFilePaths({ missionNumber, role: 'key' }), label).toContain(path);
      }
    }
  });
});

describe('beside the other kinds', () => {
  const OTHER_NUMBERS = Array.from({ length: 3000 }, (_unused, index) => index * 5477 + 2).filter(
    (missionNumber) => isMissionNumber(missionNumber) && missionKind(missionNumber) !== 'restore',
  );

  // The change is the intruder's on a restore job, and the contractor's to make on a tamper job.
  it("lays a tamper job's records as generated", () => {
    const tamperInDatabase = OTHER_NUMBERS.filter(
      (missionNumber) =>
        missionKind(missionNumber) === 'tamper' && recordsStorage(missionNumber) === 'database',
    );
    expect(tamperInDatabase.length).toBeGreaterThan(10);
    for (const missionNumber of tamperInDatabase) {
      const laid = missionFiles(
        { missionNumber, role: 'key' },
        { keySecret: 'restore-test-secret', rawSecrets: DEPLOYMENT_SECRETS },
      ).find(({ path }) => path === DATADIR_PATH);
      const datadir = parseMysqlDatabase(laid?.content ?? '');
      for (const { name, table } of missionRecords(missionNumber).tables) {
        expect(datadir?.tables[name]?.rows, `contract ${missionNumber}, ${name}`).toEqual(
          table.rows,
        );
      }
    }
  });

  it("lays a backup on a restore job's target alone: never on another kind's box, nor on the edge machine", () => {
    const isBackup = (path: string) =>
      path.startsWith('/var/backups/records/') || path.endsWith('-records.sql');
    const twoHopRestores = RESTORE_NUMBERS.filter(
      (missionNumber) => missionShape(missionNumber).frontBox !== null,
    );
    expect(twoHopRestores.length).toBeGreaterThan(10);
    for (const missionNumber of OTHER_NUMBERS) {
      expect(
        missionFilePaths({ missionNumber, role: 'key' }).filter(isBackup),
        `contract ${missionNumber}`,
      ).toEqual([]);
    }
    for (const missionNumber of twoHopRestores) {
      expect(
        missionFilePaths({ missionNumber, role: 'front' }).filter(isBackup),
        `contract ${missionNumber}`,
      ).toEqual([]);
    }
  });
});
