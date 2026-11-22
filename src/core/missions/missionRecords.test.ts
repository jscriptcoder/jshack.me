import { describe, expect, it } from 'vitest';
import {
  RECORD_SETTINGS,
  missionAction,
  missionRecords,
  missionSetting,
  recordsLookRight,
  recordsWiped,
  type RecordSetting,
  type RecordTarget,
} from './missionRecords.js';
import { missionFiles } from './missionLeak.js';
import {
  missionKind,
  missionShape,
  type MissionRoute,
  type MissionStorage,
} from './missionShape.js';
import { isMissionNumber } from './missionNetwork.js';
import { mysqlTableSchema, type MysqlDatabase, type MysqlRow } from '../mysql/types.js';
import { runStatement } from '../mysql/statements.js';
import { DATADIR_PATH, databaseIn } from '../mysql/datadir.js';
import { buildMissionKeyBoxFs } from '../generation/missionKeyBoxFs.js';
import { DATADIR_FILE, ROOT_FILE, file, withFiles } from '../generation/baseFs.js';
import { materializeMachineFs } from '../network/materializeMachineFs.js';
import type { Directory } from '../filesystem/types.js';
import { createFsView } from '../filesystem/fsView.js';
import { asAbsPath } from '../types.js';
import { DEPLOYMENT_SECRETS } from '../../test/passwords.js';

/** A spread of contract numbers whose last octet is a host octet (2–254). */
const SAMPLE_NUMBERS = Array.from({ length: 400 }, (_unused, index) => index * 41893 + 7).filter(
  (missionNumber) => missionNumber % 256 >= 2 && missionNumber % 256 <= 254,
);

/** About two thousand contract numbers, spread across the whole block. */
const WIDE_SAMPLE = Array.from({ length: 2100 }, (_unused, index) => index * 7919 + 11).filter(
  isMissionNumber,
);

/** The first contract number, walking the block in wide steps, that `wanted` accepts. */
const firstNumber = (wanted: (missionNumber: number) => boolean): number => {
  for (let index = 0; index < 60_000; index++) {
    const candidate = index * 271 + 5;
    if (isMissionNumber(candidate) && wanted(candidate)) return candidate;
  }
  throw new Error('no contract in the block fits');
};

/** What each setting's records look like from outside: the table the job is about, its columns
 *  and their types, the columns the briefing names a row by, the column naming a person, and
 *  the two tables beside it. */
type SettingSpec = {
  readonly table: string;
  readonly columns: readonly (readonly [string, 'INT' | 'VARCHAR'])[];
  readonly identity: readonly string[];
  readonly person: string;
  readonly neighbours: readonly [string, string];
};

const SETTINGS: Readonly<Record<RecordSetting, SettingSpec>> = {
  school: {
    table: 'grades',
    columns: [
      ['id', 'INT'],
      ['student', 'VARCHAR'],
      ['subject', 'VARCHAR'],
      ['grade', 'VARCHAR'],
    ],
    identity: ['student', 'subject'],
    person: 'student',
    neighbours: ['attendance', 'staff'],
  },
  police: {
    table: 'warrants',
    columns: [
      ['id', 'INT'],
      ['name', 'VARCHAR'],
      ['dob', 'VARCHAR'],
      ['offence', 'VARCHAR'],
      ['status', 'VARCHAR'],
    ],
    identity: ['name'],
    person: 'name',
    neighbours: ['incidents', 'officers'],
  },
  payroll: {
    table: 'payroll',
    columns: [
      ['id', 'INT'],
      ['name', 'VARCHAR'],
      ['dept', 'VARCHAR'],
      ['salary', 'INT'],
    ],
    identity: ['name'],
    person: 'name',
    neighbours: ['departments', 'expenses'],
  },
  dmv: {
    table: 'offences',
    columns: [
      ['id', 'INT'],
      ['licence', 'VARCHAR'],
      ['name', 'VARCHAR'],
      ['offence', 'VARCHAR'],
      ['points', 'INT'],
    ],
    identity: ['name'],
    person: 'name',
    neighbours: ['inspections', 'examiners'],
  },
  tournament: {
    table: 'scores',
    columns: [
      ['id', 'INT'],
      ['player', 'VARCHAR'],
      ['game', 'VARCHAR'],
      ['score', 'INT'],
    ],
    identity: ['player'],
    person: 'player',
    neighbours: ['teams', 'matches'],
  },
  admissions: {
    table: 'applicants',
    columns: [
      ['id', 'INT'],
      ['name', 'VARCHAR'],
      ['dob', 'VARCHAR'],
      ['program', 'VARCHAR'],
      ['status', 'VARCHAR'],
    ],
    identity: ['name'],
    person: 'name',
    neighbours: ['programs', 'staff'],
  },
  club: {
    table: 'members',
    columns: [
      ['id', 'INT'],
      ['name', 'VARCHAR'],
      ['age', 'INT'],
      ['tier', 'VARCHAR'],
      ['status', 'VARCHAR'],
    ],
    identity: ['name'],
    person: 'name',
    neighbours: ['events', 'staff'],
  },
  registry: {
    table: 'vehicles',
    columns: [
      ['plate', 'VARCHAR'],
      ['owner', 'VARCHAR'],
      ['make', 'VARCHAR'],
      ['model', 'VARCHAR'],
      ['status', 'VARCHAR'],
    ],
    identity: ['plate'],
    person: 'owner',
    neighbours: ['dealers', 'inspections'],
  },
};

const PERSON_NAME = /^[A-Z][a-z]+ [A-Z][a-z]+$/;

const LETTER_GRADES = ['A', 'B', 'C', 'D', 'F'];

/** The table a contract's job is about, as drawn. */
const targetTableOf = (missionNumber: number): readonly MysqlRow[] => {
  const { tables, target } = missionRecords(missionNumber);
  const found = tables.find(({ name }) => name === target.table);
  if (found === undefined) throw new Error(`contract ${missionNumber} has no ${target.table}`);
  return found.table.rows;
};

/** The values a row holds in the columns the briefing names it by, as text. */
const identityOf = (setting: RecordSetting, row: MysqlRow): readonly string[] =>
  SETTINGS[setting].identity.map((column) => `${row[column]}`);

const isChange = (missionNumber: number): boolean =>
  missionRecords(missionNumber).target.action === 'change';

/** The contracts in the wide sample drawing `setting`. */
const numbersIn = (setting: RecordSetting): readonly number[] =>
  WIDE_SAMPLE.filter((missionNumber) => missionSetting(missionNumber) === setting);

/** The change a contract asks, failing the test on an erase job. */
const changeTargetOf = (
  missionNumber: number,
): Extract<RecordTarget, { readonly action: 'change' }> => {
  const { target } = missionRecords(missionNumber);
  if (target.action !== 'change') throw new Error(`contract ${missionNumber} is not a change`);
  return target;
};

/** The row an erase job asks gone, failing the test on a change job. */
const eraseTargetOf = (
  missionNumber: number,
): Extract<RecordTarget, { readonly action: 'erase' }> => {
  const { target } = missionRecords(missionNumber);
  if (target.action !== 'erase') throw new Error(`contract ${missionNumber} is not an erase`);
  return target;
};

/** The school row a change job asks changed, by the names the briefing gives it. */
const schoolChangeOf = (missionNumber: number) => {
  const { row, from, to } = changeTargetOf(missionNumber);
  return {
    rowId: Number(row['id']),
    student: `${row['student']}`,
    subject: `${row['subject']}`,
    from,
    to,
  };
};

/** The school row an erase job asks gone, by the names the briefing gives it. */
const schoolEraseOf = (missionNumber: number) => {
  const { row } = eraseTargetOf(missionNumber);
  return {
    rowId: Number(row['id']),
    student: `${row['student']}`,
    subject: `${row['subject']}`,
    grade: `${row['grade']}`,
  };
};

describe('missionSetting', () => {
  it('draws the same setting for the same number', () => {
    for (const missionNumber of SAMPLE_NUMBERS) {
      expect(missionSetting(missionNumber)).toBe(missionSetting(missionNumber));
    }
  });

  it('draws each of the eight settings for about an eighth of the contracts', () => {
    expect([...RECORD_SETTINGS].sort()).toEqual(Object.keys(SETTINGS).sort());
    for (const setting of RECORD_SETTINGS) {
      const share = numbersIn(setting).length / WIDE_SAMPLE.length;

      expect(share, setting).toBeGreaterThan(0.09);
      expect(share, setting).toBeLessThan(0.16);
    }
  });
});

describe('missionAction', () => {
  it('never asks a payroll contract to erase a record', () => {
    for (const missionNumber of numbersIn('payroll')) {
      expect(missionAction(missionNumber), `contract ${missionNumber}`).toBe('change');
    }
  });

  it("asks about half of every other setting's contracts to erase a record", () => {
    for (const setting of RECORD_SETTINGS.filter((each) => each !== 'payroll')) {
      const numbers = numbersIn(setting);
      const erasing = numbers.filter((missionNumber) => missionAction(missionNumber) === 'erase');

      expect(erasing.length / numbers.length, setting).toBeGreaterThan(0.38);
      expect(erasing.length / numbers.length, setting).toBeLessThan(0.62);
    }
  });

  it('asks for the action the records draw their target for', () => {
    for (const missionNumber of WIDE_SAMPLE) {
      expect(missionRecords(missionNumber).target.action).toBe(missionAction(missionNumber));
    }
  });
});

describe('missionRecords', () => {
  it('draws the same records for the same number', () => {
    expect(missionRecords(66051)).toEqual(missionRecords(66051));
  });

  it('draws different records for different numbers', () => {
    expect(missionRecords(66051).tables).not.toEqual(missionRecords(66052).tables);
  });

  it("lays the setting's table first, then its two neighbours, each a table a database can hold", () => {
    for (const missionNumber of WIDE_SAMPLE) {
      const { setting, tables, target } = missionRecords(missionNumber);
      const spec = SETTINGS[setting];
      const [first] = tables;

      expect(setting).toBe(missionSetting(missionNumber));
      expect(target.table).toBe(spec.table);
      expect(tables.map(({ name }) => name)).toEqual([spec.table, ...spec.neighbours]);
      expect(first?.table.columns).toEqual(
        spec.columns.map(([name, type], index) => ({
          name,
          type,
          nullable: false,
          ...(index === 0 ? { key: 'PRI' } : {}),
        })),
      );
      for (const { table } of tables) expect(mysqlTableSchema.parse(table)).toEqual(table);
    }
  });

  it('holds 20 to 40 rows in the target table, reaching both ends', () => {
    const counts = WIDE_SAMPLE.map((missionNumber) => targetTableOf(missionNumber).length);

    expect(Math.min(...counts)).toBe(20);
    expect(Math.max(...counts)).toBe(40);
  });

  it('holds 5 to 15 rows in each neighbour, reaching both ends', () => {
    const counts = WIDE_SAMPLE.flatMap((missionNumber) =>
      missionRecords(missionNumber)
        .tables.slice(1)
        .map(({ table }) => table.rows.length),
    );

    expect(Math.min(...counts)).toBe(5);
    expect(Math.max(...counts)).toBe(15);
  });

  it('numbers the rows of every table keyed by an id from 1, in order', () => {
    for (const missionNumber of SAMPLE_NUMBERS) {
      for (const { table } of missionRecords(missionNumber).tables) {
        if (table.columns[0]?.name !== 'id') continue;

        expect(table.rows.map(({ id }) => id)).toEqual(table.rows.map((_row, index) => index + 1));
      }
    }
  });

  it('holds a number in every numeric column and text in every other', () => {
    for (const missionNumber of WIDE_SAMPLE) {
      for (const { name, table } of missionRecords(missionNumber).tables) {
        for (const row of table.rows) {
          expect(Object.keys(row), name).toEqual(table.columns.map((column) => column.name));
          for (const { name: column, type } of table.columns) {
            expect(typeof row[column], `${name}.${column}`).toBe(
              type === 'INT' ? 'number' : 'string',
            );
          }
        }
      }
    }
  });

  it('names every column of every table by a lowercase word a player can type back', () => {
    for (const missionNumber of WIDE_SAMPLE) {
      for (const { name, table } of missionRecords(missionNumber).tables) {
        for (const column of table.columns) expect(column.name, name).toMatch(/^[a-z]+$/);
      }
    }
  });

  // A value is typed back into a quoted SQL condition or one comma-separated line, so none may
  // hold a quote, a comma or a word the condition reads as joining two.
  it('keeps every value one a CSV line and a quoted SQL value can hold', () => {
    for (const missionNumber of WIDE_SAMPLE) {
      for (const { table } of missionRecords(missionNumber).tables) {
        for (const value of table.rows.flatMap((row) => Object.values(row))) {
          expect(`${value}`).toMatch(/^[^\s,'"](?:[^,'"]*[^\s,'"])?$/);
          expect(`${value}`).not.toMatch(/\sand\s/i);
        }
      }
    }
  });

  it('names every person by a first and last name, and never one row by the same names twice', () => {
    for (const missionNumber of WIDE_SAMPLE) {
      const { setting } = missionRecords(missionNumber);
      const rows = targetTableOf(missionNumber);
      const identities = rows.map((row) => identityOf(setting, row).join('/'));

      expect(new Set(identities).size, `contract ${missionNumber}`).toBe(rows.length);
      for (const row of rows) expect(row[SETTINGS[setting].person]).toMatch(PERSON_NAME);
    }
  });

  it('shares no person between the target table and its neighbours', () => {
    for (const missionNumber of WIDE_SAMPLE) {
      const { setting, tables, target } = missionRecords(missionNumber);
      const people = new Set([
        ...targetTableOf(missionNumber).map((row) => `${row[SETTINGS[setting].person]}`),
        ...(target.action === 'change' ? [target.to] : []),
      ]);
      const besides = tables
        .slice(1)
        .flatMap(({ table }) => table.rows.flatMap((row) => Object.values(row)));

      expect(
        besides.filter((value) => people.has(`${value}`)),
        `contract ${missionNumber}`,
      ).toEqual([]);
    }
  });

  it('points the target at its own row, the only one fitting the names the briefing gives', () => {
    for (const missionNumber of WIDE_SAMPLE) {
      const { setting, target } = missionRecords(missionNumber);
      const rows = targetTableOf(missionNumber);
      const fitting = rows.filter(
        (row) => identityOf(setting, row).join('/') === Object.values(target.namedBy).join('/'),
      );

      expect(rows[target.rowIndex]).toEqual(target.row);
      expect(Object.keys(target.namedBy)).toEqual(SETTINGS[setting].identity);
      expect(Object.values(target.namedBy)).toEqual(identityOf(setting, target.row));
      expect(fitting, `contract ${missionNumber}`).toEqual([target.row]);
    }
  });

  it('asks a change to move a value the target row holds to a different one', () => {
    for (const missionNumber of WIDE_SAMPLE.filter(isChange)) {
      const { row, column, from, to } = changeTargetOf(missionNumber);

      expect(`${row[column]}`).toBe(from);
      expect(to).not.toBe(from);
    }
  });

  it('asks an erase for its row gone, with no column or value to move', () => {
    for (const missionNumber of WIDE_SAMPLE.filter((each) => !isChange(each))) {
      const { table, rowIndex, row, namedBy } = eraseTargetOf(missionNumber);

      expect(missionRecords(missionNumber).target).toEqual({
        action: 'erase',
        table,
        rowIndex,
        row,
        namedBy,
      });
    }
  });

  it('targets rows anywhere in the table, not only the first or the last', () => {
    const positions = WIDE_SAMPLE.map((missionNumber) => {
      const { rowIndex } = missionRecords(missionNumber).target;
      const last = targetTableOf(missionNumber).length - 1;
      return rowIndex === 0 ? 'first' : rowIndex === last ? 'last' : 'inside';
    });

    expect(positions.filter((position) => position === 'inside').length).toBeGreaterThan(
      WIDE_SAMPLE.length * 0.8,
    );
    expect(new Set(positions)).toEqual(new Set(['first', 'inside', 'last']));
  });

  it('meets every storage, route and two-hop placement, and every action it allows, in each setting', () => {
    // Wider than the sample the other tests share: each setting's tamper jobs must meet every
    // route, storage, hop count and action, and tamper jobs are a tenth of the numbers.
    const tamper = Array.from({ length: 4200 }, (_unused, index) => index * 3967 + 11)
      .filter(isMissionNumber)
      .filter((missionNumber) => missionKind(missionNumber) === 'tamper');
    for (const setting of RECORD_SETTINGS) {
      const met = tamper
        .filter((missionNumber) => missionSetting(missionNumber) === setting)
        .map((missionNumber) => ({ shape: missionShape(missionNumber), number: missionNumber }));

      expect(new Set(met.map(({ shape }) => shape.storage)), setting).toEqual(
        new Set(['database', 'file']),
      );
      expect(new Set(met.map(({ shape }) => shape.keyBox.route)), setting).toEqual(
        new Set(['hydra', 'msfconsole', 'web', 'ftp', 'mysql', 'snmp']),
      );
      expect(new Set(met.map(({ shape }) => shape.frontBox === null)), setting).toEqual(
        new Set([true, false]),
      );
      expect(new Set(met.map(({ number }) => missionAction(number))), setting).toEqual(
        new Set(setting === 'payroll' ? ['change'] : ['change', 'erase']),
      );
    }
  });
});

describe('missionRecords at a school', () => {
  const SCHOOL = numbersIn('school');

  it('gives every student one grade per subject, every one a letter from A to F', () => {
    for (const missionNumber of SCHOOL) {
      const rows = targetTableOf(missionNumber);
      const students = new Set(rows.map(({ student }) => student));
      const subjects = new Set(rows.map(({ subject }) => subject));

      expect(rows.length, `contract ${missionNumber}`).toBe(students.size * subjects.size);
      for (const { grade, subject } of rows) {
        expect(LETTER_GRADES).toContain(grade);
        expect(subject).toMatch(/^[A-Z][a-z]+$/);
      }
    }
  });

  it('leaves every other row the grade it drew, A and B among them', () => {
    const others = SCHOOL.flatMap((missionNumber) => {
      const { rowIndex } = missionRecords(missionNumber).target;
      return targetTableOf(missionNumber)
        .filter((_row, index) => index !== rowIndex)
        .map(({ grade }) => grade);
    });

    expect(new Set(others)).toEqual(new Set(LETTER_GRADES));
  });

  it('asks for a failing or middling grade to be raised to an A or a B', () => {
    const asked = SCHOOL.filter(isChange).map(changeTargetOf);

    expect(new Set(asked.map(({ column }) => column))).toEqual(new Set(['grade']));
    expect(new Set(asked.map(({ from }) => from))).toEqual(new Set(['C', 'D', 'F']));
    expect(new Set(asked.map(({ to }) => to))).toEqual(new Set(['A', 'B']));
  });

  // The briefing calls the grade failing, so the row it names must hold the one failing grade.
  it('asks for a failing grade gone', () => {
    for (const missionNumber of SCHOOL.filter((each) => !isChange(each))) {
      expect(eraseTargetOf(missionNumber).row['grade']).toBe('F');
    }
  });
});

/** The values each of a setting's target rows holds in `column`, as text. */
const valuesIn = (numbers: readonly number[], column: string): ReadonlySet<string> =>
  new Set(
    numbers.flatMap((missionNumber) => targetTableOf(missionNumber).map((row) => `${row[column]}`)),
  );

const DATE = /^(19|20)\d\d-(0[1-9]|1[0-2])-(0[1-9]|1\d|2[0-8])$/;

describe('missionRecords at a police department', () => {
  const POLICE = numbersIn('police');

  it('dates each birth and gives each warrant a status, active among them', () => {
    expect(valuesIn(POLICE, 'status')).toEqual(new Set(['active', 'cleared', 'served']));
    for (const dob of valuesIn(POLICE, 'dob')) expect(dob).toMatch(DATE);
  });

  it('asks for an active warrant cleared, or gone', () => {
    for (const missionNumber of POLICE) {
      const { target } = missionRecords(missionNumber);

      expect(target.row['status'], `contract ${missionNumber}`).toBe('active');
      if (target.action === 'change') {
        expect(target).toMatchObject({ column: 'status', from: 'active', to: 'cleared' });
      }
    }
  });
});

describe('missionRecords at a payroll', () => {
  it('pays every salary in thousands, from 28,000 to 95,000', () => {
    const salaries = [...valuesIn(numbersIn('payroll'), 'salary')].map(Number);

    for (const salary of salaries) expect(salary % 1000).toBe(0);
    expect(Math.min(...salaries)).toBe(28_000);
    expect(Math.max(...salaries)).toBe(95_000);
  });

  it('asks for a salary raised by 10,000 to 30,000, in thousands', () => {
    const raises = numbersIn('payroll').map((missionNumber) => {
      const { column, from, to } = changeTargetOf(missionNumber);
      expect(column).toBe('salary');
      return Number(to) - Number(from);
    });

    for (const raise of raises) expect(raise % 1000).toBe(0);
    expect(Math.min(...raises)).toBe(10_000);
    expect(Math.max(...raises)).toBe(30_000);
  });
});

describe('missionRecords at a motor registry', () => {
  const DMV = numbersIn('dmv');

  it('gives each offence a licence number and 1 to 12 points', () => {
    for (const licence of valuesIn(DMV, 'licence')) expect(licence).toMatch(/^[A-Z]\d{7}$/);
    expect(valuesIn(DMV, 'points')).toEqual(
      new Set(Array.from({ length: 12 }, (_unused, index) => `${index + 1}`)),
    );
  });

  it('asks for an offence of 3 to 12 points brought to 0', () => {
    const asked = DMV.filter(isChange).map(changeTargetOf);

    expect(new Set(asked.map(({ column }) => column))).toEqual(new Set(['points']));
    expect(new Set(asked.map(({ to }) => to))).toEqual(new Set(['0']));
    expect(new Set(asked.map(({ from }) => Number(from)))).toEqual(
      new Set(Array.from({ length: 10 }, (_unused, index) => index + 3)),
    );
  });
});

describe('missionRecords at a tournament', () => {
  it('asks for a score raised by 300 to 900, in fifties', () => {
    const raises = numbersIn('tournament')
      .filter(isChange)
      .map((missionNumber) => {
        const { column, from, to } = changeTargetOf(missionNumber);
        expect(column).toBe('score');
        return Number(to) - Number(from);
      });

    for (const raise of raises) expect(raise % 50).toBe(0);
    expect(Math.min(...raises)).toBe(300);
    expect(Math.max(...raises)).toBe(900);
  });
});

describe('missionRecords at a university', () => {
  const ADMISSIONS = numbersIn('admissions');

  it('dates each birth and gives each applicant a status', () => {
    expect(valuesIn(ADMISSIONS, 'status')).toEqual(new Set(['admitted', 'rejected', 'waitlisted']));
    for (const dob of valuesIn(ADMISSIONS, 'dob')) expect(dob).toMatch(DATE);
  });

  it('asks for a rejected applicant admitted', () => {
    for (const missionNumber of ADMISSIONS.filter(isChange)) {
      expect(changeTargetOf(missionNumber)).toMatchObject({
        column: 'status',
        from: 'rejected',
        to: 'admitted',
      });
    }
  });

  it('asks for an application gone whatever its status', () => {
    const statuses = ADMISSIONS.filter((missionNumber) => !isChange(missionNumber)).map(
      (missionNumber) => `${eraseTargetOf(missionNumber).row['status']}`,
    );

    expect(new Set(statuses)).toEqual(new Set(['admitted', 'rejected', 'waitlisted']));
  });
});

describe('missionRecords at a members club', () => {
  const CLUB = numbersIn('club');

  it('asks for a member of 17 made 21, every other member 18 or over', () => {
    for (const missionNumber of CLUB.filter(isChange)) {
      const { row, rowIndex, ...asked } = changeTargetOf(missionNumber);
      const others = targetTableOf(missionNumber).filter((_row, index) => index !== rowIndex);

      expect(row['age']).toBe(17);
      expect(asked).toMatchObject({ column: 'age', from: '17', to: '21' });
      for (const other of others) expect(Number(other['age'])).toBeGreaterThanOrEqual(18);
    }
  });

  it('asks for a banned member gone', () => {
    for (const missionNumber of CLUB.filter((each) => !isChange(each))) {
      expect(eraseTargetOf(missionNumber).row['status']).toBe('banned');
    }
  });
});

describe('missionRecords at a vehicle registry', () => {
  const REGISTRY = numbersIn('registry');

  it('keys each vehicle by a plate of its own', () => {
    for (const plate of valuesIn(REGISTRY, 'plate'))
      expect(plate).toMatch(/^[A-Z]{2}\d{2} [A-Z]{3}$/);
  });

  it('asks for a registered vehicle given a new owner, nobody else in the table', () => {
    for (const missionNumber of REGISTRY.filter(isChange)) {
      const { column, from, to, row } = changeTargetOf(missionNumber);
      const rows = targetTableOf(missionNumber);

      expect(column).toBe('owner');
      expect(from).toBe(row['owner']);
      expect(to).toMatch(PERSON_NAME);
      expect(rows.map(({ owner }) => owner)).not.toContain(to);
      expect(new Set(rows.map(({ status }) => status))).toEqual(new Set(['registered']));
    }
  });

  it('asks for the one vehicle flagged stolen gone', () => {
    for (const missionNumber of REGISTRY.filter((each) => !isChange(each))) {
      const { rowIndex } = eraseTargetOf(missionNumber);

      expect(
        targetTableOf(missionNumber).flatMap(({ status }, index) =>
          status === 'stolen' ? [index] : [],
        ),
      ).toEqual([rowIndex]);
    }
  });
});

/** A tamper job at a school whose records box falls to hydra, so its records are laid with no
 *  secret, kept as `storage` says: in its database unless a test asks for a file. */
const hydraTamperNumber = (
  numbers: readonly number[],
  storage: MissionStorage = 'database',
): number => {
  const [found] = numbers.filter((missionNumber) => {
    const shape = missionShape(missionNumber);
    return (
      shape.kind === 'tamper' &&
      shape.keyBox.route === 'hydra' &&
      shape.storage === storage &&
      missionSetting(missionNumber) === 'school'
    );
  });
  if (found === undefined) throw new Error(`no tamper hydra ${storage} school in the sample`);
  return found;
};

/** School contracts spread over the block, asking a change or an erase. Two spreads, the second
 *  after the first, so a pick the first holds stays the first found: a hydra erase job keeping a
 *  file is rare, and the first spread's one became a cleanup job. */
const SCHOOL_NUMBERS = [9, 2081]
  .flatMap((offset) => Array.from({ length: 4000 }, (_unused, index) => index * 4153 + offset))
  .filter(
    (missionNumber) => isMissionNumber(missionNumber) && missionSetting(missionNumber) === 'school',
  );
const CHANGE_NUMBERS = SCHOOL_NUMBERS.filter(isChange);
const ERASE_NUMBERS = SCHOOL_NUMBERS.filter((missionNumber) => !isChange(missionNumber));

const withDatadir = (box: Directory, content: string): Directory =>
  withFiles(box, [[DATADIR_PATH, file(content, DATADIR_FILE)]]);

type Rows = readonly Record<string, unknown>[];

/** A records box as the server lays it; as it stands after the application account ran each
 *  statement, each one landing; and after that with its grades rewritten by hand, as a root on
 *  the box can. A box on the database route needs the password pools its leaked word comes from. */
const recordsBoxOf = (missionNumber: number, rawSecrets?: string) => {
  const laid = (): Directory =>
    withFiles(
      buildMissionKeyBoxFs(missionNumber),
      missionFiles({ missionNumber, role: 'key' }, { keySecret: undefined, rawSecrets }).map(
        ({ path, content, perms }) => [path, file(content, perms)] as const,
      ),
    );
  const after = (...lines: readonly string[]): Directory => {
    const box = laid();
    const database = lines.reduce<MysqlDatabase | null>((current, line) => {
      if (current === null) return null;
      const result = runStatement({
        database: current,
        line,
        username: current.credentials.find(({ userType }) => userType === 'user')?.username ?? '',
        userType: 'user',
        sourceIp: '198.51.100.7',
      });
      if (result.database === undefined) throw new Error(`did not land: ${line}`);
      return result.database;
    }, databaseIn(box));
    return withDatadir(box, JSON.stringify(database));
  };
  const rewritten = (lines: readonly string[], rewrite: (rows: Rows) => Rows): Directory => {
    const database = databaseIn(after(...lines));
    if (database === null) throw new Error('the datadir could not be read');
    const grades = database.tables['grades'];
    if (grades === undefined) throw new Error('the datadir has no grades');
    return withDatadir(
      laid(),
      JSON.stringify({
        ...database,
        tables: { ...database.tables, grades: { ...grades, rows: rewrite(grades.rows) } },
      }),
    );
  };
  return { laid, after, rewritten };
};

describe('recordsLookRight on a change job', () => {
  const TAMPER_NUMBER = hydraTamperNumber(CHANGE_NUMBERS);
  const target = schoolChangeOf(TAMPER_NUMBER);
  const AT_TARGET = `WHERE student = '${target.student}' AND subject = '${target.subject}'`;
  const { laid: laidBox, after: boxAfter, rewritten } = recordsBoxOf(TAMPER_NUMBER);

  /** A grade that is neither the old one nor the one asked for. */
  const THIRD_GRADE = ['A', 'B', 'C', 'D', 'F'].find(
    (grade) => grade !== target.from && grade !== target.to,
  );

  it('reads right once the target grade is the one asked for and nothing else moved', () => {
    expect(
      recordsLookRight(
        TAMPER_NUMBER,
        boxAfter(`UPDATE grades SET grade = '${target.to}' ${AT_TARGET}`),
      ),
    ).toBe(true);
  });

  it('reads right with the new grade padded, since the client reads it trimmed', () => {
    expect(
      recordsLookRight(
        TAMPER_NUMBER,
        boxAfter(`UPDATE grades SET grade = '  ${target.to} ' ${AT_TARGET}`),
      ),
    ).toBe(true);
  });

  it('reads right after the row was set to something else and then to the grade asked for', () => {
    expect(
      recordsLookRight(
        TAMPER_NUMBER,
        boxAfter(
          `UPDATE grades SET grade = '${THIRD_GRADE}' ${AT_TARGET}`,
          `UPDATE grades SET grade = '${target.to}' ${AT_TARGET}`,
        ),
      ),
    ).toBe(true);
  });

  it('reads wrong while the target still holds the old grade', () => {
    expect(recordsLookRight(TAMPER_NUMBER, laidBox())).toBe(false);
  });

  it('reads wrong with a grade that is not the one asked for', () => {
    expect(
      recordsLookRight(
        TAMPER_NUMBER,
        boxAfter(`UPDATE grades SET grade = '${THIRD_GRADE}' ${AT_TARGET}`),
      ),
    ).toBe(false);
  });

  it('reads wrong with the grade in the wrong case', () => {
    expect(
      recordsLookRight(
        TAMPER_NUMBER,
        boxAfter(`UPDATE grades SET grade = '${target.to.toLowerCase()}' ${AT_TARGET}`),
      ),
    ).toBe(false);
  });

  it('reads wrong when every row was given the new grade', () => {
    expect(
      recordsLookRight(TAMPER_NUMBER, boxAfter(`UPDATE grades SET grade = '${target.to}'`)),
    ).toBe(false);
  });

  it('reads wrong when the target was changed and another row touched too', () => {
    const otherId = target.rowId === 1 ? 2 : 1;
    expect(
      recordsLookRight(
        TAMPER_NUMBER,
        boxAfter(
          `UPDATE grades SET grade = '${target.to}' ${AT_TARGET}`,
          `UPDATE grades SET student = 'Someone Else' WHERE id = '${otherId}'`,
        ),
      ),
    ).toBe(false);
  });

  it("reads wrong when the target's grade is right but its student was renamed", () => {
    expect(
      recordsLookRight(
        TAMPER_NUMBER,
        boxAfter(
          `UPDATE grades SET grade = '${target.to}' ${AT_TARGET}`,
          `UPDATE grades SET student = 'Someone Else' WHERE id = '${target.rowId}'`,
        ),
      ),
    ).toBe(false);
  });

  it('reads wrong when another row is gone', () => {
    const otherId = target.rowId === 1 ? 2 : 1;
    expect(
      recordsLookRight(
        TAMPER_NUMBER,
        boxAfter(
          `UPDATE grades SET grade = '${target.to}' ${AT_TARGET}`,
          `DELETE FROM grades WHERE id = '${otherId}'`,
        ),
      ),
    ).toBe(false);
  });

  /** The right change made, then the datadir rewritten by hand. */
  const boxRewritten = (rewrite: (rows: Rows) => Rows): Directory =>
    rewritten([`UPDATE grades SET grade = '${target.to}' ${AT_TARGET}`], rewrite);

  it('reads right after the change when the datadir is rewritten by hand unchanged', () => {
    expect(
      recordsLookRight(
        TAMPER_NUMBER,
        boxRewritten((rows) => rows),
      ),
    ).toBe(true);
  });

  it('reads wrong when a row was added beside the change', () => {
    expect(
      recordsLookRight(
        TAMPER_NUMBER,
        boxRewritten((rows) => [
          ...rows,
          { id: rows.length + 1, student: target.student, subject: 'Latin', grade: 'A' },
        ]),
      ),
    ).toBe(false);
  });

  it('reads wrong when another row gained a cell the records never had', () => {
    const otherId = target.rowId === 1 ? 2 : 1;
    expect(
      recordsLookRight(
        TAMPER_NUMBER,
        boxRewritten((rows) =>
          rows.map((row) => (row['id'] === otherId ? { ...row, note: 'retake' } : row)),
        ),
      ),
    ).toBe(false);
  });

  it('reads wrong when the target row is gone', () => {
    expect(recordsLookRight(TAMPER_NUMBER, boxAfter(`DELETE FROM grades ${AT_TARGET}`))).toBe(
      false,
    );
  });

  it('reads wrong when the grades table is gone', () => {
    const database = databaseIn(laidBox());
    if (database === null) throw new Error('the datadir could not be read');
    const { grades: _grades, ...others } = database.tables;

    expect(
      recordsLookRight(
        TAMPER_NUMBER,
        withDatadir(laidBox(), JSON.stringify({ ...database, tables: others })),
      ),
    ).toBe(false);
  });

  it('reads wrong when the datadir is not a database any more', () => {
    expect(recordsLookRight(TAMPER_NUMBER, withDatadir(laidBox(), 'not a database'))).toBe(false);
  });

  it("reads wrong once a root's rm took the datadir", () => {
    const removed = materializeMachineFs(laidBox(), [
      {
        path: DATADIR_PATH,
        content: null,
        owner: 'root',
        permissions: null,
        node_type: null,
        updated_at: '2026-11-11T12:00:00Z',
        writer_key: 'a-root-on-the-box',
      },
    ]);

    expect(databaseIn(removed)).toBeNull();
    expect(recordsLookRight(TAMPER_NUMBER, removed)).toBe(false);
  });
});

describe('recordsLookRight on an erase job', () => {
  const ERASE_NUMBER = hydraTamperNumber(ERASE_NUMBERS);
  const target = schoolEraseOf(ERASE_NUMBER);
  const AT_TARGET = `WHERE student = '${target.student}' AND subject = '${target.subject}'`;
  const RIGHT_DELETE = `DELETE FROM grades ${AT_TARGET}`;
  const OTHER_ID = target.rowId === 1 ? 2 : 1;
  const { laid, after, rewritten } = recordsBoxOf(ERASE_NUMBER);

  it('reads right once the target row is gone and nothing else moved', () => {
    expect(recordsLookRight(ERASE_NUMBER, after(RIGHT_DELETE))).toBe(true);
  });

  it('reads right when the target row was deleted by its id', () => {
    expect(
      recordsLookRight(ERASE_NUMBER, after(`DELETE FROM grades WHERE id = '${target.rowId}'`)),
    ).toBe(true);
  });

  it('reads right after the delete when the datadir is rewritten by hand unchanged', () => {
    expect(
      recordsLookRight(
        ERASE_NUMBER,
        rewritten([RIGHT_DELETE], (rows) => rows),
      ),
    ).toBe(true);
  });

  it('reads wrong while the target row is still there', () => {
    expect(recordsLookRight(ERASE_NUMBER, laid())).toBe(false);
  });

  it('reads wrong when every row was deleted', () => {
    expect(recordsLookRight(ERASE_NUMBER, after('DELETE FROM grades'))).toBe(false);
  });

  it('reads wrong when the target was given a passing grade instead of deleted', () => {
    expect(
      recordsLookRight(ERASE_NUMBER, after(`UPDATE grades SET grade = 'A' ${AT_TARGET}`)),
    ).toBe(false);
  });

  it('reads wrong when another row went with the target', () => {
    expect(
      recordsLookRight(
        ERASE_NUMBER,
        after(RIGHT_DELETE, `DELETE FROM grades WHERE id = '${OTHER_ID}'`),
      ),
    ).toBe(false);
  });

  it('reads wrong when only another row is gone', () => {
    expect(
      recordsLookRight(ERASE_NUMBER, after(`DELETE FROM grades WHERE id = '${OTHER_ID}'`)),
    ).toBe(false);
  });

  it('reads wrong when the target is gone and another row was touched', () => {
    expect(
      recordsLookRight(
        ERASE_NUMBER,
        after(RIGHT_DELETE, `UPDATE grades SET student = 'Someone Else' WHERE id = '${OTHER_ID}'`),
      ),
    ).toBe(false);
  });

  it("reads wrong when a row was added in the target row's place", () => {
    expect(
      recordsLookRight(
        ERASE_NUMBER,
        rewritten([RIGHT_DELETE], (rows) => [
          ...rows,
          { id: target.rowId, student: target.student, subject: 'Latin', grade: 'A' },
        ]),
      ),
    ).toBe(false);
  });

  it('reads wrong when the grades table is gone', () => {
    const database = databaseIn(laid());
    if (database === null) throw new Error('the datadir could not be read');
    const { grades: _grades, ...others } = database.tables;

    expect(
      recordsLookRight(
        ERASE_NUMBER,
        withDatadir(laid(), JSON.stringify({ ...database, tables: others })),
      ),
    ).toBe(false);
  });
});

/** A records box keeping a CSV: as the server lays it, and as it stands after a root on the box
 *  saved the file with new text, the save replayed from the journal as every read replays it. */
const csvBoxOf = (missionNumber: number, table = 'grades') => {
  const path = `/srv/${missionShape(missionNumber).stem}/records/${table}.csv`;
  const laid = (): Directory =>
    withFiles(
      buildMissionKeyBoxFs(missionNumber),
      missionFiles(
        { missionNumber, role: 'key' },
        { keySecret: undefined, rawSecrets: undefined },
      ).map(({ path: laidPath, content, perms }) => [laidPath, file(content, perms)] as const),
    );
  /** The box after a root saved the file with `content`, and any other `besides` too. */
  const saved = (
    content: string | null,
    besides: readonly { readonly path: string; readonly content: string | null }[] = [],
  ): Directory =>
    materializeMachineFs(
      laid(),
      [{ path, content }, ...besides].map((save) => ({
        ...save,
        owner: 'root',
        permissions: null,
        node_type: null,
        updated_at: '2026-11-11T12:00:00Z',
        writer_key: 'a-root-on-the-box',
      })),
    );
  /** The laid file's lines, the header first, without the final newline. */
  const laidLines = (): readonly string[] => {
    const read = createFsView(laid(), { userType: 'root' }).read(asAbsPath(path));
    if (!read.ok) throw new Error(`the records file could not be read: ${read.error}`);
    return read.content.replace(/\n$/, '').split('\n');
  };
  /** The box after a root saved the laid lines as `edit` reshapes them, newline-terminated. */
  const edited = (
    edit: (lines: readonly string[]) => readonly string[],
    lineEnding = '\n',
    besides: readonly { readonly path: string; readonly content: string | null }[] = [],
  ): Directory => saved(`${edit(laidLines()).join(lineEnding)}${lineEnding}`, besides);
  return { path, laid, saved, laidLines, edited };
};

/** The CSV line of the row with `rowId`: rows follow the header in id order. */
const lineIndexOf = (rowId: number): number => rowId;

describe('recordsLookRight on a change job keeping a file', () => {
  const FILE_NUMBER = hydraTamperNumber(CHANGE_NUMBERS, 'file');
  const target = schoolChangeOf(FILE_NUMBER);
  const TARGET_LINE = lineIndexOf(target.rowId);
  const OTHER_LINE = lineIndexOf(target.rowId === 1 ? 2 : 1);
  const { path, laid, saved, edited } = csvBoxOf(FILE_NUMBER);

  /** The laid lines with the target's grade set to the one asked for. */
  const changed = (lines: readonly string[]): readonly string[] =>
    lines.map((line, index) =>
      index === TARGET_LINE ? line.replace(new RegExp(`,${target.from}$`), `,${target.to}`) : line,
    );

  /** Each line's values run through `rewrite`, comma-joined again. */
  const eachValue =
    (rewrite: (value: string) => string) =>
    (lines: readonly string[]): readonly string[] =>
      lines.map((line) => line.split(',').map(rewrite).join(','));

  /** Each line's values reordered by `order`, the header with them. */
  const reordered =
    (order: readonly number[]) =>
    (lines: readonly string[]): readonly string[] =>
      lines.map((line) => {
        const values = line.split(',');
        return order.map((index) => values[index] ?? '').join(',');
      });

  it('keeps no database records on the box', () => {
    expect(databaseIn(laid())?.tables['grades']).toBeUndefined();
  });

  it('reads right once the target line holds the grade asked for and nothing else moved', () => {
    expect(recordsLookRight(FILE_NUMBER, edited(changed))).toBe(true);
  });

  it('reads wrong while the file is as laid', () => {
    expect(recordsLookRight(FILE_NUMBER, laid())).toBe(false);
  });

  it('reads right with Windows line endings', () => {
    expect(recordsLookRight(FILE_NUMBER, edited(changed, '\r\n'))).toBe(true);
  });

  it('reads right with blank lines before, between and after the rows', () => {
    expect(
      recordsLookRight(
        FILE_NUMBER,
        edited((lines) => ['', ...changed(lines).flatMap((line) => [line, '   ']), '']),
      ),
    ).toBe(true);
  });

  it('reads right with every value padded with spaces', () => {
    expect(
      recordsLookRight(
        FILE_NUMBER,
        edited((lines) => eachValue((value) => `  ${value} `)(changed(lines))),
      ),
    ).toBe(true);
  });

  it('reads right with every value in double quotes, padded outside them', () => {
    expect(
      recordsLookRight(
        FILE_NUMBER,
        edited((lines) => eachValue((value) => ` "${value}"  `)(changed(lines))),
      ),
    ).toBe(true);
  });

  it('reads wrong with a value whose quotes were opened and never closed', () => {
    expect(
      recordsLookRight(
        FILE_NUMBER,
        edited((lines) =>
          changed(lines).map((line, index) =>
            index === TARGET_LINE ? line.replace(/,(\w+)$/, ',"$1') : line,
          ),
        ),
      ),
    ).toBe(false);
  });

  // Only a value quoted at both ends loses its quotes: one character either side of the grade
  // asked for must not be taken for a quote.
  it.each([
    ['opens', `"${target.to}x`],
    ['closes', `x${target.to}"`],
  ])('reads wrong when a quote only %s the grade', (_end, grade) => {
    expect(
      recordsLookRight(
        FILE_NUMBER,
        edited((lines) =>
          lines.map((line, index) =>
            index === TARGET_LINE ? line.replace(/,\w+$/, `,${grade}`) : line,
          ),
        ),
      ),
    ).toBe(false);
  });

  it('reads right with the columns in another order, the header naming them', () => {
    expect(
      recordsLookRight(
        FILE_NUMBER,
        edited((lines) => reordered([3, 1, 0, 2])(changed(lines))),
      ),
    ).toBe(true);
  });

  it('reads wrong once the header renames a column', () => {
    expect(
      recordsLookRight(
        FILE_NUMBER,
        edited((lines) => ['id,student,class,grade', ...changed(lines).slice(1)]),
      ),
    ).toBe(false);
  });

  it('reads wrong once a column is gone from the header and every row', () => {
    expect(
      recordsLookRight(
        FILE_NUMBER,
        edited((lines) => reordered([0, 1, 3])(changed(lines))),
      ),
    ).toBe(false);
  });

  it('reads wrong once a column is added to the header and every row', () => {
    expect(
      recordsLookRight(
        FILE_NUMBER,
        edited((lines) =>
          changed(lines).map((line, index) => `${line},${index === 0 ? 'note' : 'none'}`),
        ),
      ),
    ).toBe(false);
  });

  it('reads wrong when the target line holds a value more than the header names', () => {
    expect(
      recordsLookRight(
        FILE_NUMBER,
        edited((lines) =>
          changed(lines).map((line, index) => (index === TARGET_LINE ? `${line},retake` : line)),
        ),
      ),
    ).toBe(false);
  });

  it('reads wrong when another line is missing a value the header names', () => {
    expect(
      recordsLookRight(
        FILE_NUMBER,
        edited((lines) =>
          changed(lines).map((line, index) =>
            index === OTHER_LINE ? line.replace(/,\w+$/, '') : line,
          ),
        ),
      ),
    ).toBe(false);
  });

  it('reads wrong when the target is right and another line is gone', () => {
    expect(
      recordsLookRight(
        FILE_NUMBER,
        edited((lines) => changed(lines).filter((_line, index) => index !== OTHER_LINE)),
      ),
    ).toBe(false);
  });

  it('reads wrong when every line was given the new grade', () => {
    expect(
      recordsLookRight(
        FILE_NUMBER,
        edited((lines) =>
          lines.map((line, index) => (index === 0 ? line : line.replace(/,\w+$/, `,${target.to}`))),
        ),
      ),
    ).toBe(false);
  });

  it('reads wrong once the file is emptied', () => {
    expect(recordsLookRight(FILE_NUMBER, saved(''))).toBe(false);
  });

  it("reads wrong once a root's rm took the file", () => {
    expect(recordsLookRight(FILE_NUMBER, saved(null))).toBe(false);
  });

  it('reads wrong when a directory stands where the file was', () => {
    const box = withFiles(buildMissionKeyBoxFs(FILE_NUMBER), [
      [`${path}/grades.csv`, file('id,student,subject,grade', ROOT_FILE)],
    ]);

    expect(recordsLookRight(FILE_NUMBER, box)).toBe(false);
  });
});

describe('recordsLookRight on an erase job keeping a file', () => {
  const FILE_NUMBER = hydraTamperNumber(ERASE_NUMBERS, 'file');
  const target = schoolEraseOf(FILE_NUMBER);
  const TARGET_LINE = lineIndexOf(target.rowId);
  const OTHER_LINE = lineIndexOf(target.rowId === 1 ? 2 : 1);
  const { laid, edited } = csvBoxOf(FILE_NUMBER);

  it('reads right once the target line is gone and nothing else moved', () => {
    expect(
      recordsLookRight(
        FILE_NUMBER,
        edited((lines) => lines.filter((_line, index) => index !== TARGET_LINE)),
      ),
    ).toBe(true);
  });

  it('reads wrong while the target line is still there', () => {
    expect(recordsLookRight(FILE_NUMBER, laid())).toBe(false);
  });

  it('reads wrong when another line went with the target', () => {
    expect(
      recordsLookRight(
        FILE_NUMBER,
        edited((lines) =>
          lines.filter((_line, index) => index !== TARGET_LINE && index !== OTHER_LINE),
        ),
      ),
    ).toBe(false);
  });

  it('reads wrong when every row is gone and only the header is left', () => {
    expect(
      recordsLookRight(
        FILE_NUMBER,
        edited((lines) => lines.slice(0, 1)),
      ),
    ).toBe(false);
  });
});

/** The records box of the first hydra contract drawing `setting`, `storage` and `action`. */
const settingNumber = (
  setting: RecordSetting,
  storage: MissionStorage,
  action: 'change' | 'erase',
): number =>
  firstNumber((candidate) => {
    const shape = missionShape(candidate);
    return (
      shape.kind === 'tamper' &&
      shape.keyBox.route === 'hydra' &&
      shape.storage === storage &&
      missionSetting(candidate) === setting &&
      missionAction(candidate) === action
    );
  });

/** The WHERE naming the target row by what the briefing gives. */
const whereTarget = (missionNumber: number): string => {
  const { setting, target } = missionRecords(missionNumber);
  return `WHERE ${SETTINGS[setting].identity
    .map((column) => `${column} = '${target.row[column]}'`)
    .join(' AND ')}`;
};

/** The statement doing the job right: the asked value set on the target row, or the row gone. */
const rightStatement = (missionNumber: number): string => {
  const { target } = missionRecords(missionNumber);
  return target.action === 'change'
    ? `UPDATE ${target.table} SET ${target.column} = '${target.to}' ${whereTarget(missionNumber)}`
    : `DELETE FROM ${target.table} ${whereTarget(missionNumber)}`;
};

/** The target CSV's laid lines with the job done right: the asked value in its column, or the
 *  target line gone. */
const doneRight =
  (missionNumber: number) =>
  (lines: readonly string[]): readonly string[] => {
    const { target } = missionRecords(missionNumber);
    const targetLine = target.rowIndex + 1;
    if (target.action === 'erase') return lines.filter((_line, index) => index !== targetLine);
    const column = (lines[0] ?? '').split(',').indexOf(target.column);
    return lines.map((line, index) =>
      index === targetLine
        ? line
            .split(',')
            .map((value, at) => (at === column ? target.to : value))
            .join(',')
        : line,
    );
  };

/** Every setting with every action it asks. */
const ALLOWED: readonly (readonly [RecordSetting, 'change' | 'erase'])[] = RECORD_SETTINGS.flatMap(
  (setting): (readonly [RecordSetting, 'change' | 'erase'])[] =>
    setting === 'payroll'
      ? [[setting, 'change']]
      : [
          [setting, 'change'],
          [setting, 'erase'],
        ],
);

describe('recordsLookRight in every setting, kept in a database', () => {
  it.each(ALLOWED)('reads a %s %s right once done, and wrong before', (setting, action) => {
    const missionNumber = settingNumber(setting, 'database', action);
    const { laid, after } = recordsBoxOf(missionNumber);

    expect(recordsLookRight(missionNumber, laid())).toBe(false);
    expect(recordsLookRight(missionNumber, after(rightStatement(missionNumber)))).toBe(true);
  });

  it.each(ALLOWED)('reads a %s %s right with both neighbours emptied', (setting, action) => {
    const missionNumber = settingNumber(setting, 'database', action);
    const { tables } = missionRecords(missionNumber);
    const { after } = recordsBoxOf(missionNumber);
    const emptied = tables.slice(1).map(({ name }) => `DELETE FROM ${name}`);

    expect(recordsLookRight(missionNumber, after(rightStatement(missionNumber), ...emptied))).toBe(
      true,
    );
  });

  it.each(RECORD_SETTINGS)('reads a careless %s change with no WHERE wrong', (setting) => {
    const missionNumber = settingNumber(setting, 'database', 'change');
    const target = changeTargetOf(missionNumber);
    const { after } = recordsBoxOf(missionNumber);

    expect(
      recordsLookRight(
        missionNumber,
        after(`UPDATE ${target.table} SET ${target.column} = '${target.to}'`),
      ),
    ).toBe(false);
  });

  it("reads a club member's age as the text it is set to: 21 right, 21.0 wrong", () => {
    const missionNumber = settingNumber('club', 'database', 'change');
    const { after } = recordsBoxOf(missionNumber);

    expect(
      recordsLookRight(
        missionNumber,
        after(`UPDATE members SET age = '21' ${whereTarget(missionNumber)}`),
      ),
    ).toBe(true);
    expect(
      recordsLookRight(
        missionNumber,
        after(`UPDATE members SET age = '21.0' ${whereTarget(missionNumber)}`),
      ),
    ).toBe(false);
  });
});

describe('recordsLookRight in every setting, kept in files', () => {
  it.each(ALLOWED)('reads a %s %s right once done, and wrong before', (setting, action) => {
    const missionNumber = settingNumber(setting, 'file', action);
    const { laid, edited } = csvBoxOf(missionNumber, SETTINGS[setting].table);

    expect(recordsLookRight(missionNumber, laid())).toBe(false);
    expect(recordsLookRight(missionNumber, edited(doneRight(missionNumber)))).toBe(true);
  });

  it.each(ALLOWED)('reads a %s %s right with both neighbour files gone', (setting, action) => {
    const missionNumber = settingNumber(setting, 'file', action);
    const { stem } = missionShape(missionNumber);
    const { edited } = csvBoxOf(missionNumber, SETTINGS[setting].table);
    const removed = SETTINGS[setting].neighbours.map((name) => ({
      path: `/srv/${stem}/records/${name}.csv`,
      content: null,
    }));

    expect(recordsLookRight(missionNumber, edited(doneRight(missionNumber), '\n', removed))).toBe(
      true,
    );
  });

  it("reads a club member's age as the digits in the file: 21 right, 21.0 wrong", () => {
    const missionNumber = settingNumber('club', 'file', 'change');
    const { edited } = csvBoxOf(missionNumber, 'members');
    const targetLine = changeTargetOf(missionNumber).rowIndex + 1;
    const withAge = (age: string) => (lines: readonly string[]) =>
      doneRight(missionNumber)(lines).map((line, index) =>
        index === targetLine ? line.replace(',21,', `,${age},`) : line,
      );

    expect(recordsLookRight(missionNumber, edited(withAge('21')))).toBe(true);
    expect(recordsLookRight(missionNumber, edited(withAge('21.0')))).toBe(false);
  });
});

/** The first wipe job, on the hydra route unless `route` says otherwise, keeping its records in
 *  `storage` and drawing `setting`. */
const wipeNumber = (
  setting: RecordSetting,
  storage: MissionStorage,
  route: MissionRoute = 'hydra',
): number =>
  firstNumber((candidate) => {
    if (missionKind(candidate) !== 'wipe' || missionSetting(candidate) !== setting) return false;
    const shape = missionShape(candidate);
    return shape.keyBox.route === route && shape.storage === storage;
  });

/** A hand edit of a table's rows. */
type RowsRewrite = (rows: readonly MysqlRow[]) => readonly MysqlRow[];

describe('recordsWiped on records kept in a database', () => {
  const WIPE_NUMBER = wipeNumber('school', 'database');
  const { laid, after } = recordsBoxOf(WIPE_NUMBER);

  /** The box after the statements, its tables then rewritten by hand, as a root on it can. */
  const rewritten = (
    lines: readonly string[],
    rewrite: (tables: MysqlDatabase['tables']) => MysqlDatabase['tables'],
  ): Directory => {
    const database = databaseIn(after(...lines));
    if (database === null) throw new Error('the datadir could not be read');
    return withDatadir(laid(), JSON.stringify({ ...database, tables: rewrite(database.tables) }));
  };

  /** `tables` with the rows of `name` run through `rewrite`. */
  const withRows = (
    tables: MysqlDatabase['tables'],
    name: string,
    rewrite: RowsRewrite,
  ): MysqlDatabase['tables'] => {
    const table = tables[name];
    if (table === undefined) throw new Error(`the datadir has no ${name}`);
    return { ...tables, [name]: { ...table, rows: rewrite(table.rows) } };
  };

  /** The name of the first table the records keep beside the grades. */
  const besideName = (): string => {
    const name = missionRecords(WIPE_NUMBER).tables[1]?.name;
    if (name === undefined) throw new Error('no table beside the grades');
    return name;
  };

  it('reads wiped once every grade is deleted and the tables beside it are untouched', () => {
    expect(recordsWiped(WIPE_NUMBER, after('DELETE FROM grades'))).toBe(true);
  });

  it('reads not wiped as the box was laid', () => {
    expect(recordsWiped(WIPE_NUMBER, laid())).toBe(false);
  });

  it('reads not wiped while one grade is left', () => {
    const oneLeft = rewritten([], (tables) =>
      withRows(tables, 'grades', (rows) => rows.slice(0, 1)),
    );

    expect(recordsWiped(WIPE_NUMBER, oneLeft)).toBe(false);
  });

  it('reads wiped once the grades table is gone from the datadir', () => {
    const gone = rewritten([], ({ grades: _grades, ...others }) => others);

    expect(recordsWiped(WIPE_NUMBER, gone)).toBe(true);
  });

  it('reads not wiped once a table beside it is emptied too', () => {
    for (const { name } of missionRecords(WIPE_NUMBER).tables.slice(1)) {
      const box = after('DELETE FROM grades', `DELETE FROM ${name}`);
      expect(recordsWiped(WIPE_NUMBER, box), name).toBe(false);
    }
  });

  it('reads not wiped once a table beside it loses, gains, reorders or changes a row', () => {
    const rewrites: readonly (readonly [string, RowsRewrite])[] = [
      ['a row gone', (rows) => rows.slice(1)],
      ['a row added', (rows) => [...rows, { ...rows[0], id: rows.length + 1 }]],
      ['two rows swapped', (rows) => [rows[1] ?? {}, rows[0] ?? {}, ...rows.slice(2)]],
      ['a value changed', (rows) => [{ ...rows[0], id: 99 }, ...rows.slice(1)]],
      ['a cell added', (rows) => [{ ...rows[0], extra: 'x' }, ...rows.slice(1)]],
    ];

    for (const [change, rewrite] of rewrites) {
      const box = rewritten(['DELETE FROM grades'], (tables) =>
        withRows(tables, besideName(), rewrite),
      );
      expect(recordsWiped(WIPE_NUMBER, box), change).toBe(false);
    }
  });

  it('reads not wiped once a table beside it is gone', () => {
    const box = rewritten(['DELETE FROM grades'], (tables) =>
      Object.fromEntries(Object.entries(tables).filter(([name]) => name !== besideName())),
    );

    expect(recordsWiped(WIPE_NUMBER, box)).toBe(false);
  });

  it('reads the same whatever became of the tables the box generated beside the records', () => {
    const names = new Set(missionRecords(WIPE_NUMBER).tables.map(({ name }) => name));
    const box = rewritten(['DELETE FROM grades'], (tables) =>
      Object.fromEntries(Object.entries(tables).filter(([name]) => names.has(name))),
    );

    expect(recordsWiped(WIPE_NUMBER, box)).toBe(true);
  });

  it('reads wiped on the database route with its settings table emptied too', () => {
    const missionNumber = wipeNumber('school', 'database', 'mysql');
    const { after: routeAfter } = recordsBoxOf(missionNumber, DEPLOYMENT_SECRETS);
    const box = routeAfter('DELETE FROM grades', 'DELETE FROM settings');

    expect(databaseIn(box)?.tables['settings']?.rows).toEqual([]);
    expect(recordsWiped(missionNumber, box)).toBe(true);
  });

  it("reads not wiped once a root's rm took the datadir", () => {
    const box = materializeMachineFs(laid(), [
      {
        path: DATADIR_PATH,
        content: null,
        owner: 'root',
        permissions: null,
        node_type: null,
        updated_at: '2026-11-19T12:00:00Z',
        writer_key: 'a-root-on-the-box',
      },
    ]);

    expect(recordsWiped(WIPE_NUMBER, box)).toBe(false);
  });

  it('refuses the application account a DROP of the grades', () => {
    const database = databaseIn(laid());
    if (database === null) throw new Error('the datadir could not be read');
    const application = database.credentials.find(({ userType }) => userType === 'user');

    const dropped = runStatement({
      database,
      line: 'DROP TABLE grades',
      username: application?.username ?? '',
      userType: 'user',
      sourceIp: '198.51.100.7',
    });

    expect(dropped.database).toBeUndefined();
    expect(dropped.output.join('\n')).toContain('DROP command denied');
  });
});

describe('recordsWiped on records kept in files', () => {
  const WIPE_NUMBER = wipeNumber('school', 'file');
  const { laid, saved, laidLines, edited } = csvBoxOf(WIPE_NUMBER);
  const { stem } = missionShape(WIPE_NUMBER);
  const besidePaths = missionRecords(WIPE_NUMBER)
    .tables.slice(1)
    .map(({ name }) => `/srv/${stem}/records/${name}.csv`);
  const headerOnly = (lines: readonly string[]): readonly string[] => lines.slice(0, 1);

  it('reads not wiped as the box was laid', () => {
    expect(recordsWiped(WIPE_NUMBER, laid())).toBe(false);
  });

  it("reads wiped once a root's rm took the file", () => {
    expect(recordsWiped(WIPE_NUMBER, saved(null))).toBe(true);
  });

  it('reads wiped once the file is emptied to no bytes, or to blank lines', () => {
    expect(recordsWiped(WIPE_NUMBER, saved(''))).toBe(true);
    expect(recordsWiped(WIPE_NUMBER, saved('\n \n'))).toBe(true);
  });

  it('reads wiped with only its header left, however the lines end', () => {
    expect(recordsWiped(WIPE_NUMBER, edited(headerOnly))).toBe(true);
    expect(recordsWiped(WIPE_NUMBER, edited(headerOnly, '\r\n'))).toBe(true);
    expect(recordsWiped(WIPE_NUMBER, saved(`\n${laidLines()[0]}\n\n`))).toBe(true);
  });

  it('reads not wiped while one line of grades is left below the header', () => {
    expect(
      recordsWiped(
        WIPE_NUMBER,
        edited((lines) => lines.slice(0, 2)),
      ),
    ).toBe(false);
  });

  it('reads not wiped with one line of grades left and no header', () => {
    expect(
      recordsWiped(
        WIPE_NUMBER,
        edited((lines) => lines.slice(1, 2)),
      ),
    ).toBe(false);
  });

  it('reads not wiped with uneven lines, which may still hold grades, and wiped once finished', () => {
    const uneven = edited((lines) => [lines[0] ?? '', 'Aiden Marsh']);

    expect(recordsWiped(WIPE_NUMBER, uneven)).toBe(false);
    expect(recordsWiped(WIPE_NUMBER, edited(headerOnly))).toBe(true);
  });

  it('reads not wiped once a file beside it is gone, emptied or changed', () => {
    const besideSaves: readonly (readonly [string, string | null])[] = [
      ['gone', null],
      ['emptied', ''],
      ['changed', 'id,name\n1,Nobody\n'],
    ];
    for (const path of besidePaths) {
      for (const [change, content] of besideSaves) {
        const box = edited(headerOnly, '\n', [{ path, content }]);
        expect(recordsWiped(WIPE_NUMBER, box), `${path} ${change}`).toBe(false);
      }
    }
  });
});

describe('recordsWiped in every setting', () => {
  it.each(RECORD_SETTINGS)(
    'reads a %s wipe in a database done once its table is emptied',
    (setting) => {
      const missionNumber = wipeNumber(setting, 'database');
      const { table, neighbours } = SETTINGS[setting];
      const { laid, after } = recordsBoxOf(missionNumber);

      expect(recordsWiped(missionNumber, laid())).toBe(false);
      expect(recordsWiped(missionNumber, after(`DELETE FROM ${table}`))).toBe(true);
      for (const neighbour of neighbours) {
        const box = after(`DELETE FROM ${table}`, `DELETE FROM ${neighbour}`);
        expect(recordsWiped(missionNumber, box), neighbour).toBe(false);
      }
    },
  );

  it.each(RECORD_SETTINGS)(
    'reads a %s wipe in files done once its file holds only the header',
    (setting) => {
      const missionNumber = wipeNumber(setting, 'file');
      const { laid, edited } = csvBoxOf(missionNumber, SETTINGS[setting].table);

      expect(recordsWiped(missionNumber, laid())).toBe(false);
      expect(
        recordsWiped(
          missionNumber,
          edited((lines) => lines.slice(0, 1)),
        ),
      ).toBe(true);
    },
  );
});
