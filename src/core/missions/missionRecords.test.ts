import { describe, expect, it } from 'vitest';
import { missionRecords, recordsLookRight } from './missionRecords.js';
import { missionFiles } from './missionLeak.js';
import { missionShape } from './missionShape.js';
import { mysqlTableSchema, type MysqlDatabase } from '../mysql/types.js';
import { runStatement } from '../mysql/statements.js';
import { DATADIR_PATH, databaseIn } from '../mysql/datadir.js';
import { buildMissionKeyBoxFs } from '../generation/missionKeyBoxFs.js';
import { DATADIR_FILE, file, withFiles } from '../generation/baseFs.js';
import { materializeMachineFs } from '../network/materializeMachineFs.js';
import type { Directory } from '../filesystem/types.js';

/** A spread of contract numbers whose last octet is a host octet (2–254). */
const SAMPLE_NUMBERS = Array.from({ length: 400 }, (_unused, index) => index * 41893 + 7).filter(
  (missionNumber) => missionNumber % 256 >= 2 && missionNumber % 256 <= 254,
);

const LETTER_GRADES = ['A', 'B', 'C', 'D', 'F'];

describe('missionRecords', () => {
  it('draws the same records for the same number', () => {
    expect(missionRecords(66051)).toEqual(missionRecords(66051));
  });

  it('draws different records for different numbers', () => {
    expect(missionRecords(66051).grades).not.toEqual(missionRecords(66052).grades);
  });

  it('keeps a grades table a database can hold: id, student, subject and grade', () => {
    for (const missionNumber of SAMPLE_NUMBERS) {
      const { grades } = missionRecords(missionNumber);

      expect(mysqlTableSchema.parse(grades)).toEqual(grades);
      expect(grades.columns.map(({ name }) => name)).toEqual(['id', 'student', 'subject', 'grade']);
      expect(grades.columns).toEqual([
        { name: 'id', type: 'INT', nullable: false, key: 'PRI' },
        { name: 'student', type: 'VARCHAR', nullable: false },
        { name: 'subject', type: 'VARCHAR', nullable: false },
        { name: 'grade', type: 'VARCHAR', nullable: false },
      ]);
    }
  });

  it('names every student by a first and last name and every subject by one word', () => {
    for (const missionNumber of SAMPLE_NUMBERS) {
      for (const { student, subject } of missionRecords(missionNumber).grades.rows) {
        expect(student).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
        expect(subject).toMatch(/^[A-Z][a-z]+$/);
      }
    }
  });

  it('holds 20 to 40 rows, numbered from 1, reaching both ends', () => {
    const counts = SAMPLE_NUMBERS.map((missionNumber) => {
      const { rows } = missionRecords(missionNumber).grades;
      expect(rows.map(({ id }) => id)).toEqual(rows.map((_row, index) => index + 1));
      return rows.length;
    });

    expect(Math.min(...counts)).toBe(20);
    expect(Math.max(...counts)).toBe(40);
  });

  it('gives every student one grade per subject, every one a letter from A to F', () => {
    for (const missionNumber of SAMPLE_NUMBERS) {
      const { rows } = missionRecords(missionNumber).grades;
      const pairs = rows.map(({ student, subject }) => `${student}/${subject}`);

      expect(new Set(pairs).size, `contract ${missionNumber}`).toBe(rows.length);
      for (const { grade } of rows) expect(LETTER_GRADES).toContain(grade);
    }
  });

  it('leaves every other row the grade it drew, A and B among them', () => {
    const others = SAMPLE_NUMBERS.flatMap((missionNumber) => {
      const { grades, target } = missionRecords(missionNumber);
      return grades.rows.filter(({ id }) => id !== target.rowId).map(({ grade }) => grade);
    });

    expect(new Set(others)).toEqual(new Set(LETTER_GRADES));
  });

  it('names a target row holding the old grade, the only row for that student and subject', () => {
    for (const missionNumber of SAMPLE_NUMBERS) {
      const { grades, target } = missionRecords(missionNumber);
      const matching = grades.rows.filter(
        ({ student, subject }) => student === target.student && subject === target.subject,
      );

      expect(matching, `contract ${missionNumber}`).toEqual([
        { id: target.rowId, student: target.student, subject: target.subject, grade: target.from },
      ]);
    }
  });

  it('asks for a failing or middling grade to be raised to an A or a B', () => {
    const asked = SAMPLE_NUMBERS.map((missionNumber) => missionRecords(missionNumber).target);

    expect(new Set(asked.map(({ from }) => from))).toEqual(new Set(['C', 'D', 'F']));
    expect(new Set(asked.map(({ to }) => to))).toEqual(new Set(['A', 'B']));
  });

  it('targets rows anywhere in the table, not only the first or the last', () => {
    const positions = SAMPLE_NUMBERS.map((missionNumber) => {
      const { grades, target } = missionRecords(missionNumber);
      return target.rowId === 1 ? 'first' : target.rowId === grades.rows.length ? 'last' : 'inside';
    });

    expect(new Set(positions)).toContain('inside');
    expect(positions.filter((position) => position === 'inside').length).toBeGreaterThan(
      SAMPLE_NUMBERS.length * 0.8,
    );
  });
});

describe('recordsLookRight', () => {
  /** A tamper job whose records box falls to hydra: its datadir is laid with no secret. */
  const [TAMPER_NUMBER] = SAMPLE_NUMBERS.filter((missionNumber) => {
    const shape = missionShape(missionNumber);
    return shape.kind === 'tamper' && shape.keyBox.route === 'hydra';
  });
  if (TAMPER_NUMBER === undefined) throw new Error('no tamper hydra contract in the sample');
  const { target } = missionRecords(TAMPER_NUMBER);
  const AT_TARGET = `WHERE student = '${target.student}' AND subject = '${target.subject}'`;

  /** The records box as the server lays it, before anybody has touched it. */
  const laidBox = (): Directory =>
    withFiles(
      buildMissionKeyBoxFs(TAMPER_NUMBER),
      missionFiles(
        { missionNumber: TAMPER_NUMBER, role: 'key' },
        { keySecret: undefined, rawSecrets: undefined },
      ).map(({ path, content, perms }) => [path, file(content, perms)] as const),
    );

  const withDatadir = (box: Directory, content: string): Directory =>
    withFiles(box, [[DATADIR_PATH, file(content, DATADIR_FILE)]]);

  /** The laid box after the application account ran each statement, each one landing. */
  const boxAfter = (...lines: readonly string[]): Directory => {
    const laid = laidBox();
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
    }, databaseIn(laid));
    return withDatadir(laid, JSON.stringify(database));
  };

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

  /** The right change made, then the datadir rewritten by hand, as a root on the box can. */
  const boxRewritten = (
    rewrite: (rows: readonly Record<string, unknown>[]) => readonly Record<string, unknown>[],
  ): Directory => {
    const database = databaseIn(boxAfter(`UPDATE grades SET grade = '${target.to}' ${AT_TARGET}`));
    if (database === null) throw new Error('the datadir could not be read');
    const grades = database.tables['grades'];
    if (grades === undefined) throw new Error('the datadir has no grades');
    const rewritten = { ...grades, rows: rewrite(grades.rows) };
    return withDatadir(
      laidBox(),
      JSON.stringify({ ...database, tables: { ...database.tables, grades: rewritten } }),
    );
  };

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
